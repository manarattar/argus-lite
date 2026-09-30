# ARGUS-Lite

**Live at [argusv1.manarattar.com](https://argusv1.manarattar.com)**

Watch an AI agent find evidence in a document, verify it's real, and compute a
risk score by formula — the two ideas from ARGUS that actually matter, with
everything else cut away. No finance background needed: the example is a
phone warranty ("does this cover water damage?").

## The two ideas

1. **Find evidence, verify it's real.** An LLM pulls quotes relevant to your
   question from a document. Plain code then checks each quote actually
   appears in the source text — a human never has to trust the model's word
   that it quoted correctly.
2. **Score by formula, not by asking.** A decision model is only ever asked
   for severity and likelihood, never for a final label like "High risk." A
   plain formula (`severity × likelihood × evidence_discount`) computes the
   score, so a severe-sounding but weakly-grounded finding mathematically
   cannot produce a high score.

## Two kinds of AI, each where it fits

- **An LLM finds the quotes.** Pulling evidence out of a document is text
  work, so it goes to a language model (OpenAI).
- **Jev makes the ratings.** Severity and likelihood are decisions on a fixed
  1–5 scale, so they go to [Jev](https://typesafe.ai), a decision model that
  doesn't generate text: it returns a probability for every level. The
  rating used is the probability-weighted average, the UI shows the full
  distribution, and when the probability is spread over several levels the
  rating is flagged for a person to check. Jev answers in about 0.5 s,
  roughly 2–4× faster than the LLM did for the same step.

Without a `TYPESAFE_API_KEY` the ratings fall back to the LLM.

## What makes it interactive

The frontend streams each step live over Server-Sent Events as it actually
happens — you watch the agent search, watch each quote get checked one by
one, watch Jev's rating come in with its probabilities, then watch the score
get computed. Every step is tagged **AI call · LLM**, **AI decision · Jev** or
**plain code, no AI**, so it's visually obvious where each model's judgment
stops and deterministic logic takes over.

Accepts a PDF, DOCX, or TXT upload, or pasted text.

## Run it locally

**Backend**
```bash
cd backend
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
export TYPESAFE_API_KEY=apikey_...   # optional: without it the LLM makes the ratings
uvicorn app.main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

**Or from the command line, no frontend needed:**
```bash
cd backend
python -m app.argus_lite sample_report.txt "Does the warranty cover water damage?"
```

## Deploying

Same pattern as the other apps on the Contabo stack: backend runs as a Docker
service (`argusv1`) behind Caddy, frontend is a static build served from
`/srv/www/argusv1`. DNS is on Vercel (`vercel dns add manarattar.com argusv1 A
194.163.176.183`), same as every other `*.manarattar.com` subdomain.

## What's deliberately left out

No adversarial challenger, no policy-clause matching, no LangGraph, no
database, no provider abstraction. Those are real parts of the full ARGUS
project, but they're elaboration on these same two ideas, not new ones.
