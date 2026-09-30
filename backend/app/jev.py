"""
Minimal client for Jev, TypeSafe's decision model.

Jev doesn't write text - it answers typed questions (a choice, a yes/no, or a
score on a fixed scale) and returns a probability for every possible answer.
That makes it a natural fit for the judgment step: severity and likelihood are
decisions on a fixed 1-5 scale, not something that needs prose.

Talks to the REST API directly with httpx (already installed via openai), so
the app doesn't need the typesafe-sdk package or its newer pydantic pin.
"""

import os
import time

import httpx

JEV_URL = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL = os.environ.get("JEV_MODEL", "jev-latest")


def jev_available() -> bool:
    return bool(os.environ.get("TYPESAFE_API_KEY", "").strip())


def ask_jev(state, questions: dict, timeout: float = 30.0) -> dict:
    """Send one request, return the parsed response plus how long it took."""
    started = time.perf_counter()
    response = httpx.post(
        JEV_URL,
        headers={"Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}"},
        json={"state": state, "questions": questions, "model": JEV_MODEL},
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    data["latency_ms"] = round((time.perf_counter() - started) * 1000)
    return data
