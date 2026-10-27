import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("PROMETHEUS_DB", ":memory:")

from backend.app.agent.llm import Completion  # noqa: E402
from backend.app.config import get_settings  # noqa: E402
from backend.app.db import Store  # noqa: E402


@pytest.fixture
def store() -> Store:
    return Store(":memory:")


@pytest.fixture
def hid(store: Store) -> str:
    return store.create_household()


@pytest.fixture
def settings():
    from dataclasses import replace

    return replace(get_settings(), nebius_api_key="test-key", daily_turns_per_household=100)


class FakeClient:
    """Scripted stand-in for the model, used ONLY in tests. Each entry is the assistant message to return."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def complete(self, messages, tools):
        self.calls.append({"messages": messages, "tools": tools})
        msg = self.script.pop(0)
        return Completion(message=msg, model="fake-model", response_id=f"fake-{len(self.calls)}", usage={"total_tokens": 1})


def tool_call(name, arguments, call_id=None):
    import json

    return {
        "id": call_id or f"call_{name}",
        "type": "function",
        "function": {"name": name, "arguments": arguments if isinstance(arguments, str) else json.dumps(arguments)},
    }
