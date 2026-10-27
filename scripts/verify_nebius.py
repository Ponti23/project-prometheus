"""Verify the Nebius Token Factory setup: key, model availability and real tool calling.

Usage (Windows):  .venv\\Scripts\\python scripts\\verify_nebius.py
Usage (macOS/Linux): .venv/bin/python scripts/verify_nebius.py

Prints the NVIDIA/Nemotron models visible to your key, then sends ONE small tool-calling request to the
configured model and shows the raw tool call it returned. The API key is never printed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.agent.llm import LLMUnavailable, NebiusClient  # noqa: E402
from backend.app.agent.tools import tool_specs  # noqa: E402
from backend.app.config import get_settings  # noqa: E402


def main() -> int:
    s = get_settings()
    if not s.ai_configured:
        print("NEBIUS_API_KEY is not set. Copy .env.example to .env and add your key.")
        return 1
    print(f"Endpoint: {s.nebius_base_url}\nConfigured model: {s.nebius_model}\n")
    client = NebiusClient(s)
    try:
        models = client.list_models()
    except LLMUnavailable as e:
        print(f"FAILED to list models: {e}")
        return 1
    nvidia = [m for m in models if "nvidia" in m.lower() or "nemotron" in m.lower()]
    print(f"{len(models)} models visible. NVIDIA / Nemotron models:")
    for m in nvidia:
        print(f"  {'*' if m == s.nebius_model else ' '} {m}")
    if s.nebius_model not in models:
        print(f"\nConfigured model {s.nebius_model!r} is NOT available. Set NEBIUS_MODEL in .env to one of the above.")
        return 1

    print("\nSending a tool-calling probe…")
    try:
        comp = client.complete(
            [
                {"role": "system", "content": "You are a helpful assistant. Use the provided tools to answer."},
                {"role": "user", "content": "Which emergency supplies is my household missing?"},
            ],
            tool_specs(),
        )
    except LLMUnavailable as e:
        print(f"FAILED: {e}")
        return 1
    print(f"Model reported: {comp.model} | response id: {comp.response_id} | latency: {comp.latency_ms} ms")
    print(f"Usage: {comp.usage} | finish_reason: {comp.finish_reason}")
    calls = comp.message.get("tool_calls") or []
    if calls:
        print("Tool calls returned:")
        print(json.dumps(calls, indent=2))
        print("\nOK — real Nemotron tool calling works through Nebius Token Factory.")
        return 0
    print("The model replied without a tool call:")
    print((comp.message.get("content") or "")[:800])
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
