"""
ARGUS-Lite: the two ideas from ARGUS that actually matter, with everything else cut away.

Task 1 - Find evidence, verify it's real:
    An LLM pulls quotes relevant to a risk question out of a document. Plain code
    then checks each quote actually appears in the source text (a human never has
    to take the model's word that it quoted correctly).

Task 2 - Score by formula, not by asking:
    The LLM is only ever asked for things it's reliable at: severity, likelihood,
    and evidence strength. It is never asked "is this High/Medium/Low risk?" -
    that label is computed by a plain formula, so the number is auditable and
    doesn't move around between runs the way a directly-generated label would.

Run:
    export OPENAI_API_KEY=sk-...
    python argus_lite.py sample_report.txt "financial risk"
"""

import difflib
import json
import sys

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
    Task 2a: ask the model ONLY for the narrow, reliable judgments -
    severity and likelihood - never for a final risk label.
    """
    if not grounded_quotes:
        return {
            "severity": 0,
            "likelihood": 0,
            "summary": "No grounded evidence found.",
        }

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
    raw_score = severity * likelihood  # max 25
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
    }
    assessment = assess_finding(document, risk_question, grounded_quotes)
    yield {"step": "assessed", "summary": assessment.get("summary")}

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
    print(f"  Model's summary: {assessment.get('summary')}")

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
