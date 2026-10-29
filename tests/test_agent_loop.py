"""Agent loop tests use a scripted FakeClient. They test OUR orchestration, not the model."""

from dataclasses import replace

import pytest

from backend.app.agent.llm import LLMUnavailable
from backend.app.agent.loop import RateLimited, history_for_model, run_turn
from backend.app.demo import load_demo
from tests.conftest import FakeClient, tool_call


def test_tool_loop_executes_reads_and_queues_writes(store, hid, settings):
    load_demo(store, hid)
    client = FakeClient([
        {"role": "assistant", "content": "", "tool_calls": [
            tool_call("get_household_profile", {}, "c1"), tool_call("get_missing_supplies", {}, "c2")]},
        {"role": "assistant", "content": None, "tool_calls": [tool_call("propose_restock_tasks", {}, "c3")]},
        {"role": "assistant", "content": "<think>plan</think>I've proposed restock tasks. Approve them when ready."},
    ])
    out = run_turn(store, hid, "Prepare my family of five for 30 days", client, settings, mode="prepare")

    assert out["message"]["content"] == "I've proposed restock tasks. Approve them when ready."
    assert [c["name"] for step in out["trace"] for c in step["tool_calls"]] == [
        "get_household_profile", "get_missing_supplies", "propose_restock_tasks"]
    assert out["trace"][0]["response_id"] == "fake-1"
    assert len(out["actions"]) == 1 and out["actions"][0]["status"] == "pending"
    assert store.list_tasks(hid) == []  # nothing saved without approval
    assert store.get_household(hid)["current_mode"] == "prepare"
    # Second model call saw the tool results.
    second = client.calls[1]["messages"]
    assert [m["role"] for m in second[-3:]] == ["assistant", "tool", "tool"]
    assert len(store.list_tool_log(hid)) == 3


def test_history_is_replayable_after_restart(store, hid, settings):
    client = FakeClient([
        {"role": "assistant", "content": "", "tool_calls": [tool_call("get_inventory", {}, "c1")]},
        {"role": "assistant", "content": "You have nothing yet."},
    ])
    run_turn(store, hid, "What do I have?", client, settings)
    hist = history_for_model(store, hid, 40)
    assert [m["role"] for m in hist] == ["user", "assistant", "tool", "assistant"]
    assert hist[1]["tool_calls"][0]["id"] == hist[2]["tool_call_id"]


def test_history_never_starts_with_orphan_tool_message(store, hid, settings):
    client = FakeClient([
        {"role": "assistant", "content": "", "tool_calls": [tool_call("get_inventory", {}, "c1")]},
        {"role": "assistant", "content": "Done."},
    ])
    run_turn(store, hid, "Inventory?", client, settings)
    hist = history_for_model(store, hid, 2)  # last 2 rows = tool + assistant
    assert hist == [] or hist[0]["role"] == "user"


def test_bad_json_and_unknown_tool_are_reported_back_to_model(store, hid, settings):
    client = FakeClient([
        {"role": "assistant", "content": "", "tool_calls": [
            tool_call("get_inventory", "{not json", "c1"), tool_call("hack_the_planet", {}, "c2")]},
        {"role": "assistant", "content": "Sorry, let me try differently."},
    ])
    out = run_turn(store, hid, "hi", client, settings)
    calls = out["trace"][0]["tool_calls"]
    assert [c["ok"] for c in calls] == [False, False]
    tool_msgs = [m for m in client.calls[1]["messages"] if m["role"] == "tool"]
    assert "not valid JSON" in tool_msgs[0]["content"] and "unknown tool" in tool_msgs[1]["content"]


def test_tool_rounds_are_bounded(store, hid, settings):
    s = replace(settings, max_tool_rounds=2)
    loop_call = {"role": "assistant", "content": "", "tool_calls": [tool_call("get_inventory", {})]}
    client = FakeClient([loop_call, loop_call, {"role": "assistant", "content": "Final answer."}])
    out = run_turn(store, hid, "loop forever", client, s)
    assert out["message"]["content"] == "Final answer."
    assert client.calls[-1]["tools"] == []  # last round offered no tools


def test_rate_limit(store, hid, settings):
    s = replace(settings, daily_turns_per_household=1)
    run_turn(store, hid, "one", FakeClient([{"role": "assistant", "content": "ok"}]), s)
    with pytest.raises(RateLimited):
        run_turn(store, hid, "two", FakeClient([{"role": "assistant", "content": "ok"}]), s)


def test_provider_failure_is_surfaced_not_faked(store, hid, settings):
    class Down:
        def complete(self, messages, tools):
            raise LLMUnavailable("Nebius returned HTTP 503")

    with pytest.raises(LLMUnavailable):
        run_turn(store, hid, "hello", Down(), settings)
    roles = [m["role"] for m in store.list_messages(hid)]
    assert roles == ["user", "error"]  # no assistant message invented


def test_system_prompt_contains_household_context(store, hid, settings):
    load_demo(store, hid)
    client = FakeClient([{"role": "assistant", "content": "Hello!"}])
    run_turn(store, hid, "hi", client, settings)
    system = client.calls[0]["messages"][0]
    assert system["role"] == "system"
    assert "2 adults, 3 children" in system["content"] and "PROMETHEUS" in system["content"]
    assert len(client.calls[0]["tools"]) >= 12


PLAN_STEPS = [
    {"text": "Check for CO", "priority": "immediate", "knowledge_refs": ["kb-carbon-monoxide"]},
    {"text": "Radio on", "priority": "today", "knowledge_refs": []},
    {"text": "Review daily", "priority": "ongoing", "knowledge_refs": ["kb-emergency-plan"]},
]


def test_emergency_answer_without_plan_gets_one_nudge(store, hid, settings):
    load_demo(store, hid)
    client = FakeClient([
        {"role": "assistant", "content": "", "tool_calls": [tool_call("get_scenario_guide", {"scenario": "blackout"}, "c1")]},
        {"role": "assistant", "content": "First, check for carbon monoxide."},
        {"role": "assistant", "content": "", "tool_calls": [tool_call(
            "create_survival_plan", {"scenario": "blackout", "title": "Blackout plan", "steps": PLAN_STEPS}, "c2")]},
        {"role": "assistant", "content": "Your plan is ready to approve."},
    ])
    out = run_turn(store, hid, "The power is out. What do we do?", client, settings)

    assert out["message"]["content"] == "First, check for carbon monoxide.\n\nYour plan is ready to approve."
    assert len(out["actions"]) == 1 and out["actions"][0]["kind"] == "create_plan"
    assert "[App note]" in client.calls[2]["messages"][-1]["content"]
    # The plan's own citations lead the sources footer.
    assert out["message"]["meta"]["sources"][0]["url"].startswith("https://")
    # The next turn sees the final reply once, without the draft or the nudge.
    store.add_message(hid, "user", "Thanks. What next?")
    hist = history_for_model(store, hid, 40)
    assert not any("[App note]" in (m["content"] or "") for m in hist)
    assert sum("check for carbon monoxide" in (m["content"] or "") for m in hist) == 1


def test_plan_nudge_happens_at_most_once(store, hid, settings):
    client = FakeClient([
        {"role": "assistant", "content": "", "tool_calls": [tool_call("get_scenario_guide", {"scenario": "blackout"}, "c1")]},
        {"role": "assistant", "content": "Stay safe."},
        {"role": "assistant", "content": "I'd rather ask a few questions first."},
    ])
    out = run_turn(store, hid, "Blackout!", client, settings)
    assert out["message"]["content"] == "Stay safe.\n\nI'd rather ask a few questions first."
    assert len(client.calls) == 3


def test_no_plan_nudge_outside_survive(store, hid, settings):
    client = FakeClient([
        {"role": "assistant", "content": "", "tool_calls": [tool_call("search_knowledge", {"query": "carbon monoxide"}, "c1")]},
        {"role": "assistant", "content": "Never run a generator indoors."},
    ])
    out = run_turn(store, hid, "Is a generator in the garage safe?", client, settings)
    assert len(client.calls) == 2
    sources = out["message"]["meta"]["sources"]
    assert sources and all(s["url"].startswith("https://") for s in sources)
