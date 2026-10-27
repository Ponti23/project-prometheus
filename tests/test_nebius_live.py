"""LIVE tests against Nebius Token Factory. Skipped unless NEBIUS_API_KEY is set.

Run: pytest tests/test_nebius_live.py -v -s
"""

import json
import os

import pytest

from backend.app.agent.llm import NebiusClient
from backend.app.agent.loop import run_turn
from backend.app.agent.tools import tool_specs
from backend.app.config import get_settings
from backend.app.db import Store
from backend.app.demo import load_demo

pytestmark = pytest.mark.skipif(not os.environ.get("NEBIUS_API_KEY"), reason="NEBIUS_API_KEY not set")


def test_configured_model_is_listed():
    s = get_settings()
    models = NebiusClient(s).list_models()
    print("NVIDIA/Nemotron models:", [m for m in models if "nemotron" in m.lower() or "nvidia" in m.lower()])
    assert s.nebius_model in models


def test_model_emits_a_real_tool_call():
    s = get_settings()
    comp = NebiusClient(s).complete(
        [{"role": "system", "content": "Use tools to answer."},
         {"role": "user", "content": "What supplies are we missing? Use the tool."}],
        tool_specs(),
    )
    print("model:", comp.model, "id:", comp.response_id, "usage:", comp.usage)
    calls = comp.message.get("tool_calls") or []
    print(json.dumps(calls, indent=2))
    assert calls, f"no tool call; content={comp.message.get('content')!r}"


def test_end_to_end_turn_uses_tools():
    s = get_settings()
    store = Store(":memory:")
    hid = store.create_household()
    load_demo(store, hid)
    out = run_turn(store, hid, "We're a family of five preparing for 30 days. What are we short of?",
                   NebiusClient(s), s, mode="prepare")
    names = [c["name"] for step in out["trace"] for c in step["tool_calls"]]
    print("tools called:", names)
    print(out["message"]["content"])
    assert names, "model answered without using any tool"
