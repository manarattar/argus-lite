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
2. **Score by formula, not by asking.** The LLM is only ever asked for
   severity and likelihood, never for a final label like "High risk." A plain
   formula (`severity × likelihood × evidence_discount`) computes the score,
   so a severe-sounding but weakly-grounded finding mathematically cannot
   produce a high score.

## What makes it interactive

The frontend streams each step live over Server-Sent Events as it actually
happens — you watch the agent search, watch each quote get checked one by
one, watch the assessment come in, then watch the score get computed. Every
step is tagged **AI call** or **plain code, no AI**, so it's visually obvious
where the model's judgment stops and deterministic logic takes over.

Accepts a PDF, DOCX, or TXT upload, or pasted text.

## Run it locally

**Backend**
```bash
cd backend
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
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
