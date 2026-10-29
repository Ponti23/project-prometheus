"""Simple mode: card hints from tools, the on-screen context, previews and editing a proposal."""

from dataclasses import replace

from backend.app import demo
from backend.app.agent.loop import run_turn
from backend.app.agent.persona import system_message
from backend.app.agent.tools import run_tool
from backend.app.config import get_settings
from tests.conftest import FakeClient, tool_call


def _water(store, hid):
    return next(i for i in store.list_inventory(hid) if i["target_key"] == "water")


def test_propose_hints_point_at_the_card_and_number(store, hid):
    demo.load_demo(store, hid)
    hints = []
    res, ok, _ = run_tool(store, hid, "update_inventory_item", {"item_id": _water(store, hid)["id"], "changes": {"quantity": 65}}, hints)
    assert ok and hints == [{
        "card": {"type": "category", "key": "water"}, "priority": 2, "focus": "water.have",
        "action_id": res["action_id"], "item": _water(store, hid)["id"],
    }]
    hints = []
    res, *_ = run_tool(store, hid, "add_inventory_item", {"name": "Torch", "category": "lighting", "quantity": 1, "target_key": "torch"}, hints)
    assert hints[0]["card"] == {"type": "category", "key": "light_power"} and hints[0]["focus"] == "torch.have"
    hints = []
    res, *_ = run_tool(store, hid, "update_household_profile", {"adults": 3}, hints)
    assert hints[0]["card"]["type"] == "household" and hints[0]["focus"] == "household.people"


def test_read_hints_keep_what_advanced_mode_reads(store, hid):
    hints = []
    run_tool(store, hid, "calculate_readiness", {}, hints)
    run_tool(store, hid, "get_scenario_guide", {"scenario": "blackout"}, hints)
    run_tool(store, hid, "get_household_profile", {}, hints)
    assert hints[0]["open"] == "prepare" and hints[0]["card"]["type"] == "stages" and hints[0]["priority"] == 0
    assert hints[1]["open"] == "survive" and hints[1]["scenario"] == "blackout" and hints[1]["card"] == {"type": "scenario", "key": "blackout"}
    assert "open" not in hints[2] and hints[2]["card"]["type"] == "household"


def test_show_card_validates_keys(store, hid):
    hints = []
    _, ok, _ = run_tool(store, hid, "show_card", {"card": "category", "key": "water"}, hints)
    assert ok and hints == [{"card": {"type": "category", "key": "water"}, "priority": 1}]
    res, ok, _ = run_tool(store, hid, "show_card", {"card": "lesson", "key": "warp_drive"}, [])
    assert not ok and "unknown key" in res["error"]


def test_simple_view_goes_into_the_system_prompt(store, hid):
    view = {"ui": "simple", "canvas": "prepare", "cards": ["stages", "category:water"], "focused_card": "category:water"}
    text = system_message(store, hid, view)["content"]
    assert "Simple mode" in text and "Ready in stages, Water" in text and "tapped the Water card" in text
    assert "category:water" not in text
    assert "Simple mode" not in system_message(store, hid)["content"]


def test_chat_endpoint_passes_the_view(store):
    from fastapi.testclient import TestClient

    from backend.app.main import create_app
    client = FakeClient([{"role": "assistant", "content": "Hi."}])
    c = TestClient(create_app(settings=replace(get_settings(), nebius_api_key="k"), store=store, client_factory=lambda _s: client))
    r = c.post("/api/chat", json={"message": "hi", "mode": "prepare", "ui": "simple", "canvas": "prepare", "cards": ["stages"], "focused_card": "stages"})
    assert r.status_code == 200
    assert "tapped the Ready in stages card" in client.calls[0]["messages"][0]["content"]


def _client(store):
    from fastapi.testclient import TestClient

    from backend.app.main import create_app
    return TestClient(create_app(settings=replace(get_settings(), nebius_api_key=None), store=store))


def _propose_water(store, hid, litres=5):
    res, *_ = run_tool(store, hid, "add_inventory_item",
                       {"name": "Water", "category": "water", "quantity": litres, "unit": "L", "target_key": "water"}, [])
    return res["action_id"]


def test_preview_is_an_honest_before_and_after(store, hid):
    demo.load_demo(store, hid)
    c = _client(store)
    c.cookies.set("prometheus_household", hid)
    p = c.get(f"/api/actions/{_propose_water(store, hid)}/preview").json()
    changes = {(x["what"], x.get("key") or x.get("days")): x for x in p["changes"]}
    assert changes[("target", "water")]["before"]["have"] == 60 and changes[("target", "water")]["after"]["have"] == 65
    assert changes[("stage", 3)]["before"]["left"] == 8 and changes[("stage", 3)]["after"]["left"] == 7
    assert p["summary"]["stages"][0]["left"] == 7
    # Nothing was saved.
    assert c.get("/api/summary").json()["stages"][0]["left"] == 8
    assert c.get("/api/actions/nope/preview").status_code == 404


def test_preview_many_applies_in_order(store, hid):
    demo.load_demo(store, hid)
    c = _client(store)
    c.cookies.set("prometheus_household", hid)
    a = _propose_water(store, hid)
    b, *_ = run_tool(store, hid, "add_inventory_item", {"name": "Opener", "category": "tools", "quantity": 1, "target_key": "can_opener"}, [])
    p = c.get(f"/api/actions/preview?ids={a},{b['action_id']}").json()
    assert p["summary"]["stages"][0]["left"] == 6


def test_edit_a_proposal_then_save(store, hid):
    demo.load_demo(store, hid)
    c = _client(store)
    c.cookies.set("prometheus_household", hid)
    aid = _propose_water(store, hid)
    edited = c.post(f"/api/actions/{aid}/edit", json={"changes": {"quantity": 6}}).json()
    assert edited["payload"]["quantity"] == 6 and edited["summary"].endswith("(edited by you)")
    assert c.post(f"/api/actions/{aid}/edit", json={"changes": {"quantity": -1}}).status_code == 422
    assert c.post(f"/api/actions/{aid}/approve").status_code == 200
    assert sum(i["quantity"] for i in store.list_inventory(hid) if i["target_key"] == "water") == 66
    assert "edited it before saving" in store.list_messages(hid)[-1]["content"]
    assert c.post(f"/api/actions/{aid}/edit", json={"changes": {"quantity": 7}}).status_code == 409


def test_turn_returns_card_hints(store, hid, settings):
    demo.load_demo(store, hid)
    script = [
        {"role": "assistant", "content": "", "tool_calls": [tool_call("add_inventory_item", {"name": "Water", "category": "water", "quantity": 5, "unit": "L", "target_key": "water"})]},
        {"role": "assistant", "content": "Drafted it."},
    ]
    out = run_turn(store, hid, "I bought 5 L of water", FakeClient(script), settings, mode="prepare", view={"ui": "simple", "canvas": "prepare", "cards": []})
    assert out["ui_hints"][0]["card"] == {"type": "category", "key": "water"} and out["ui_hints"][0]["action_id"] == out["actions"][0]["id"]
