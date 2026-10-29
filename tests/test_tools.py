import json

from backend.app.agent.tools import TOOLS, execute_action, run_tool, tool_specs
from backend.app.demo import load_demo


def test_tool_specs_are_valid_openai_functions_without_refs():
    specs = tool_specs()
    names = {s["function"]["name"] for s in specs}
    assert {"get_household_profile", "get_inventory", "calculate_readiness", "get_missing_supplies",
            "propose_restock_tasks", "search_knowledge", "get_technology_node", "get_prerequisites",
            "create_survival_plan", "update_household_profile", "add_inventory_item"} <= names
    for s in specs:
        assert s["type"] == "function"
        assert s["function"]["parameters"]["type"] == "object"
        assert "$ref" not in json.dumps(s)


def test_invalid_arguments_return_structured_error(store, hid):
    result, ok, effect = run_tool(store, hid, "add_inventory_item", {"name": "Water", "quantity": -5})
    assert not ok and effect == "none"
    assert result["error"] == "invalid arguments"
    assert store.list_inventory(hid) == []


def test_unknown_tool(store, hid):
    result, ok, _ = run_tool(store, hid, "launch_rockets", {})
    assert not ok and "unknown tool" in result["error"]


def test_read_tools_reflect_real_state(store, hid):
    load_demo(store, hid)
    profile, ok, effect = run_tool(store, hid, "get_household_profile", {})
    assert ok and effect == "none"
    assert profile["profile"]["adults"] == 2 and profile["profile"]["children"] == 3
    inv, _, _ = run_tool(store, hid, "get_inventory", {"category": "water"})
    assert inv["count"] == 1
    r, _, _ = run_tool(store, hid, "calculate_readiness", {})
    assert r["coverage_label"] == "coverage of planning targets"


def test_propose_tools_never_mutate_until_approved(store, hid):
    load_demo(store, hid)
    n_items, n_tasks = len(store.list_inventory(hid)), len(store.list_tasks(hid))

    add, ok, effect = run_tool(store, hid, "add_inventory_item",
                               {"name": "Water cask", "category": "water", "quantity": 20, "unit": "L", "target_key": "water"})
    assert ok and effect == "pending_action" and add["status"] == "awaiting_user_approval"
    restock, ok, effect = run_tool(store, hid, "propose_restock_tasks", {})
    assert ok and effect == "pending_action" and restock["proposed_tasks"]
    prof, ok, _ = run_tool(store, hid, "update_household_profile", {"adults": 3})
    assert ok

    assert len(store.list_inventory(hid)) == n_items
    assert len(store.list_tasks(hid)) == n_tasks
    assert store.get_profile(hid).adults == 2

    execute_action(store, hid, store.get_action(hid, add["action_id"]))
    execute_action(store, hid, store.get_action(hid, restock["action_id"]))
    execute_action(store, hid, store.get_action(hid, prof["action_id"]))
    assert len(store.list_inventory(hid)) == n_items + 1
    assert len(store.list_tasks(hid)) == n_tasks + len(restock["proposed_tasks"])
    assert store.get_profile(hid).adults == 3


def test_restock_quantities_are_calculated_not_model_supplied(store, hid):
    load_demo(store, hid)
    res, _, _ = run_tool(store, hid, "propose_restock_tasks", {"target_keys": ["water"]})
    assert len(res["proposed_tasks"]) == 1
    assert res["proposed_tasks"][0]["quantity"] == 555  # 615 L target - 60 L stored


def test_survival_plan_rejects_invented_citations(store, hid):
    steps = [{"text": "Do a thing", "priority": "immediate", "knowledge_refs": ["kb-made-up"]}] * 3
    res, ok, _ = run_tool(store, hid, "create_survival_plan", {"scenario": "blackout", "title": "Plan", "steps": steps})
    assert not ok and "unknown knowledge ids" in json.dumps(res)


def test_survival_plan_proposal_and_fiction_flag(store, hid):
    steps = [
        {"text": "Ongoing check", "priority": "ongoing", "knowledge_refs": ["kb-emergency-plan"]},
        {"text": "Check for CO", "priority": "immediate", "knowledge_refs": ["kb-carbon-monoxide"]},
        {"text": "Radio on", "priority": "today", "knowledge_refs": []},
    ]
    res, ok, _ = run_tool(store, hid, "create_survival_plan", {"scenario": "zombie", "title": "Z-day", "steps": steps})
    assert ok and "FICTIONAL" in res["summary"]
    plan = execute_action(store, hid, store.get_action(hid, res["action_id"]))["plan"]
    assert plan["fictional"] is True
    assert [s["priority"] for s in plan["steps"]] == ["immediate", "today", "ongoing"]


def test_survival_plan_title_defaults_from_scenario(store, hid):
    steps = [{"text": "Check for CO", "priority": "immediate", "knowledge_refs": []}] * 3
    res, ok, _ = run_tool(store, hid, "create_survival_plan", {"scenario": "zombie", "steps": steps})
    assert ok and res["summary"].startswith("Save survival plan 'Zombie apocalypse plan' (FICTIONAL SIMULATION)")


def test_remember_note_is_only_suggested(store, hid):
    res, ok, effect = run_tool(store, hid, "remember_note", {"text": "Grandma visits on weekends"})
    assert ok and effect == "suggested_memory"
    assert store.list_notes(hid)[0]["status"] == "suggested"


def test_tech_node_tool_sets_context_and_checks_materials(store, hid):
    load_demo(store, hid)
    hints = []
    res, ok, _ = run_tool(store, hid, "get_technology_node", {"node_id": "solar_pv"}, hints)
    assert ok and res["title"] == "Solar photovoltaics"
    assert any(m["have"] for m in res["materials"])  # demo has a small solar charger
    assert store.get_household(hid)["current_topic"] == "solar_pv"
    assert hints == [{"open": "rebuild", "node": "solar_pv"}]
    bad, ok, _ = run_tool(store, hid, "get_technology_node", {"node_id": "fusion_reactor"})
    assert not ok


def test_search_knowledge_returns_sources(store, hid):
    res, _, _ = run_tool(store, hid, "search_knowledge", {"query": "is it safe to run a generator in the garage"})
    top = res["results"][0]
    assert top["id"] in {"kb-carbon-monoxide", "kb-generator-safety"}
    assert top["sources"][0]["url"].startswith("https://")


def test_every_tool_has_a_kind():
    assert {t.kind for t in TOOLS} <= {"read", "propose", "note"}
