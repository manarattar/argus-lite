"""
ARGUS-Lite: the two ideas from ARGUS that actually matter, with everything else cut away.

Task 1 - Find evidence, verify it's real:
    An LLM pulls quotes relevant to a risk question out of a document. Plain code
    then checks each quote actually appears in the source text (a human never has
    to take the model's word that it quoted correctly).

Task 2 - Score by formula, not by asking:
    A decision model (Jev) rates only severity and likelihood on a fixed 1-5
    scale, returning a probability for every level. It is never asked "is this
    High/Medium/Low risk?" - that label is computed by a plain formula, so the
    number is auditable and doesn't move around between runs the way a
    directly-generated label would.

The two jobs go to the tool that suits them: an LLM for finding quotes (that
needs text generation), Jev for the ratings (a decision on a fixed scale).
Without a TYPESAFE_API_KEY the ratings fall back to the LLM.

Run:
    export OPENAI_API_KEY=sk-...
    export TYPESAFE_API_KEY=apikey_...
    python -m app.argus_lite sample_report.txt "financial risk"
"""

import difflib
import json
import sys

from app.jev import ask_jev, jev_available
from openai import OpenAI

client = OpenAI()
MODEL = "gpt-4o-mini"

# How much of a finding's score survives depending on how well the evidence
# behind it is actually grounded in the source document.
EVIDENCE_DISCOUNT = {
    "strong": 1.00,  # every quote matched the source closely
    "moderate": 0.82,  # most quotes matched, one or two were loose
    "weak": 0.55,  # only a minority of quotes were grounded
    "insufficient": 0.25,  # nothing meaningful was grounded
}

# Below this, Jev's probability is spread across several levels rather than
# peaked on one, so the rating is flagged for a human to look at.
LOW_CONFIDENCE = 0.5

SEVERITY_LEVELS = [
    "1 - Negligible: trivial or no real consequence",
    "2 - Minor: small inconvenience or cost, easily fixed",
    "3 - Moderate: noticeable financial, legal or operational impact",
    "4 - Serious: significant loss, liability or compliance breach",
    "5 - Critical: severe loss, regulatory violation or fraud exposure",
]
LIKELIHOOD_LEVELS = [
    "1 - Very unlikely: the evidence points against it",
    "2 - Unlikely: only weak or indirect support",
    "3 - Possible: the evidence is mixed or incomplete",
    "4 - Likely: the evidence clearly supports it",
    "5 - Almost certain: the evidence states it explicitly",
]


def extract_evidence(document: str, risk_question: str) -> list[str]:
    """Task 1a: ask the model for quotes relevant to the risk question."""
    prompt = f"""Find up to 4 short direct quotes from the document below that are
relevant to this risk question: "{risk_question}"

Return ONLY a JSON array of strings, each one an exact quote copied from the
document. Do not paraphrase - copy the text exactly as it appears.

Document:
{document}
"""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    # Ask for a JSON object wrapping the array, since some models handle a
    # bare top-level array in json_object mode inconsistently.
    parsed = json.loads(response.choices[0].message.content)
    quotes = parsed.get("quotes", parsed.get("evidence", []))
    return quotes if isinstance(quotes, list) else []


def verify_grounding(document: str, quotes: list[str]) -> list[dict]:
    """
    Task 1b: plain code, no AI. For each quote the model claimed to have
    found, check how closely it actually matches text that exists in the
    source document. This is the step that catches an invented or
    paraphrased quote before it can influence anything downstream.
    """
    results = []
    for quote in quotes:
        best_ratio = 0.0
        # Slide a window of the quote's own length across the document and
        # keep the best match - catches a real quote even if the model
        # returned it with slightly different surrounding whitespace.
        window = len(quote)
        for i in range(0, max(1, len(document) - window), 20):
            chunk = document[i : i + window]
            ratio = difflib.SequenceMatcher(None, quote, chunk).ratio()
            best_ratio = max(best_ratio, ratio)

        grounded = best_ratio >= 0.85
        results.append(
            {"quote": quote, "match_score": round(best_ratio, 2), "grounded": grounded}
        )
    return results


def assess_finding(
    document: str, risk_question: str, grounded_quotes: list[str]
) -> dict:
    """
    Task 2a: ask ONLY for the narrow judgments - severity and likelihood -
    never for a final risk label.
    """
    if not grounded_quotes:
        return {
            "severity": 0,
            "likelihood": 0,
            "summary": "No grounded evidence found.",
        }
    if jev_available():
        return _assess_with_jev(risk_question, grounded_quotes)
    return _assess_with_llm(risk_question, grounded_quotes)


def _level_label(levels: list[str], value: float) -> str:
    return levels[min(4, max(0, round(value) - 1))][4:]


def _assess_with_jev(risk_question: str, grounded_quotes: list[str]) -> dict:
    """
    Jev answers both ratings in one request and returns a probability for
    each of the five levels. The rating used is the probability-weighted
    average, so a 50/50 split between 4 and 5 counts as 4.5 instead of being
    rounded to whichever edged ahead.
    """
    # Jev reads questions literally, so "the risk" has to be spelled out: a
    # yes/no question like "does the warranty cover water damage?" otherwise
    # splits its answer between the two opposite readings.
    risk = (
        "The person asking is checking the document for a problem. The risk is the "
        "unfavourable answer to their question, for example a claim not being covered, "
        "an owner left unidentified, or a stated income not being supported."
    )
    questions = {
        "severity": {
            "type": "score",
            "instructions": {
                "risk": risk,
                "task": "How bad would that unfavourable outcome be for the person asking?",
            },
            "criteria": SEVERITY_LEVELS,
        },
        "likelihood": {
            "type": "score",
            "instructions": {
                "risk": risk,
                "task": "How strongly do the verified quotes show that the unfavourable "
                "answer is the true one?",
            },
            "criteria": LIKELIHOOD_LEVELS,
        },
    }
    state = {"question": risk_question, "verified_quotes": grounded_quotes}
    response = ask_jev(state, questions)

    ratings = {}
    for name in ("severity", "likelihood"):
        answer = response["answers"][name]
        # Jev numbers levels from 0; the scale shown to people runs 1-5
        probabilities = {
            int(level) + 1: round(p, 3) for level, p in answer["probabilities"].items()
        }
        ratings[name] = {
            "value": round(answer["score"] + 1, 1),
            "confidence": round(answer["confidence"], 2),
            "probabilities": dict(sorted(probabilities.items())),
        }

    severity, likelihood = ratings["severity"], ratings["likelihood"]
    uncertain = min(severity["confidence"], likelihood["confidence"]) < LOW_CONFIDENCE
    summary = (
        f"Severity {severity['value']}/5 ({_level_label(SEVERITY_LEVELS, severity['value'])}); "
        f"likelihood {likelihood['value']}/5 "
        f"({_level_label(LIKELIHOOD_LEVELS, likelihood['value'])})."
    )
    if uncertain:
        summary += (
            " Jev's confidence is low, so this rating should be checked by a person."
        )

    return {
        "severity": severity["value"],
        "likelihood": likelihood["value"],
        "summary": summary,
        "judge": {
            "model": response.get("model"),
            "latency_ms": response["latency_ms"],
            "uncertain": uncertain,
            "severity": severity,
            "likelihood": likelihood,
        },
    }


def _assess_with_llm(risk_question: str, grounded_quotes: list[str]) -> dict:
    """Fallback when no Jev key is configured: the same two numbers from the LLM."""
    prompt = f"""Based ONLY on these verified quotes from a document, assess the risk
described by: "{risk_question}"

Verified quotes:
{json.dumps(grounded_quotes, indent=2)}

Return a JSON object with:
- "severity": integer 1-5 (how bad would this be if true)
- "likelihood": integer 1-5 (how likely is this based on the evidence)
- "summary": one sentence explaining your reasoning

Do NOT include a risk label like "High" or "Low" - only the two numbers and the summary.
"""
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def compute_score(assessment: dict, grounding_results: list[dict]) -> dict:
    """
    Task 2b: pure arithmetic, no AI. This is the whole anti-hallucination
    mechanism in one function - a severe-sounding but weakly-grounded
    finding mathematically cannot produce a high score.
    """
    severity = assessment.get("severity", 0)
    likelihood = assessment.get("likelihood", 0)

    if not grounding_results:
        strength = "insufficient"
    else:
        grounded_ratio = sum(r["grounded"] for r in grounding_results) / len(
            grounding_results
        )
        if grounded_ratio >= 0.9:
            strength = "strong"
        elif grounded_ratio >= 0.6:
            strength = "moderate"
        elif grounded_ratio > 0:
            strength = "weak"
        else:
            strength = "insufficient"

    discount = EVIDENCE_DISCOUNT[strength]
    raw_score = round(severity * likelihood, 1)  # max 25
    final_score = round(raw_score * discount, 1)

    return {
        "severity": severity,
        "likelihood": likelihood,
        "evidence_strength": strength,
        "discount_applied": discount,
        "raw_score": raw_score,
        "final_score": final_score,
    }


def analyze_stream(document: str, risk_question: str):
    """
    Same two tasks, but yields one small event per real step so a frontend
    can show the agent working live instead of a single spinner-then-result.
    Each yielded dict has a "step" key naming what just happened.
    """
    yield {
        "step": "searching",
        "message": "Reading the document, looking for relevant evidence...",
    }
    quotes = extract_evidence(document, risk_question)
    yield {"step": "found_quotes", "quotes": quotes}

    # Grounding is a real loop over quotes - stream each check as it
    # completes instead of waiting for the whole batch, since this is
    # genuinely incremental work, not a single call being faked as steps.
    grounding_results = []
    for quote in quotes:
        result = verify_grounding(document, [quote])[0]
        grounding_results.append(result)
        yield {"step": "checked_quote", "result": result}

    grounded_quotes = [r["quote"] for r in grounding_results if r["grounded"]]

    yield {
        "step": "assessing",
        "message": "Judging severity and likelihood from the verified evidence only...",
        "judge": "jev" if jev_available() else "llm",
    }
    assessment = assess_finding(document, risk_question, grounded_quotes)
    yield {
        "step": "assessed",
        "summary": assessment.get("summary"),
        "judge": assessment.get("judge"),
    }

    yield {"step": "scoring", "message": "Computing the final score by formula..."}
    score = compute_score(assessment, grounding_results)
    yield {
        "step": "done",
        "score": score,
        "evidence": grounding_results,
        "summary": assessment.get("summary"),
    }


def analyze(document: str, risk_question: str) -> dict:
    """Same two tasks as run(), but returns structured data for the API instead of printing."""
    quotes = extract_evidence(document, risk_question)
    grounding_results = verify_grounding(document, quotes)
    grounded_quotes = [r["quote"] for r in grounding_results if r["grounded"]]

    assessment = assess_finding(document, risk_question, grounded_quotes)
    score = compute_score(assessment, grounding_results)

    return {
        "risk_question": risk_question,
        "evidence": grounding_results,
        "summary": assessment.get("summary"),
        "judge": assessment.get("judge"),
        "score": score,
    }


def run(document_path: str, risk_question: str) -> None:
    with open(document_path, encoding="utf-8") as f:
        document = f.read()

    print(f"\nRisk question: {risk_question}\n")

    print("--- Task 1: extract evidence, then verify it's real ---")
    quotes = extract_evidence(document, risk_question)
    grounding_results = verify_grounding(document, quotes)
    for r in grounding_results:
        status = "GROUNDED" if r["grounded"] else "NOT FOUND IN SOURCE"
        print(f"  [{status}] ({r['match_score']}) \"{r['quote'][:80]}\"")

    grounded_quotes = [r["quote"] for r in grounding_results if r["grounded"]]

    print("\n--- Task 2: assess severity/likelihood, then compute the score ---")
    assessment = assess_finding(document, risk_question, grounded_quotes)
    print(f"  Judgment: {assessment.get('summary')}")
    judge = assessment.get("judge")
    if judge:
        for name in ("severity", "likelihood"):
            print(f"  {name} probabilities: {judge[name]['probabilities']}")

    result = compute_score(assessment, grounding_results)
    print(
        f"\n  severity={result['severity']} x likelihood={result['likelihood']} "
        f"= {result['raw_score']}, x {result['discount_applied']} "
        f"({result['evidence_strength']} evidence) = {result['final_score']} / 25\n"
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print('Usage: python argus_lite.py <document.txt> "<risk question>"')
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])
