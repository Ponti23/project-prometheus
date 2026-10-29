"""Permission modes: Ask first (default), Auto (small changes with a stated number) and Plan, plus Undo."""

import json
from dataclasses import replace

from fastapi.testclient import TestClient

from backend.app import demo
from backend.app.agent.loop import run_turn
from backend.app.agent.persona import system_message
from backend.app.agent.tools import numbers_in
from backend.app.config import get_settings
from backend.app.main import create_app
from tests.conftest import FakeClient, tool_call

WATER = {"name": "Water", "category": "water", "quantity": 5, "unit": "L", "target_key": "water"}


def _turn(store, hid, settings, text, call, permission):
    script = [{"role": "assistant", "content": "", "tool_calls": [call]}, {"role": "assistant", "content": "Done."}]
    return run_turn(store, hid, text, FakeClient(script), settings, view={"ui": "simple", "permission_mode": permission},
                    permission=permission)


def _water_total(store, hid):
    return sum(i["quantity"] for i in store.list_inventory(hid) if i["target_key"] == "water")


def test_numbers_in_reads_what_people_type():
    assert numbers_in("I bought 5 L of water") == {5}
    assert numbers_in("a 20,000 mAh power bank") == {20000}
    assert numbers_in("1,5 L and 2.5 L") == {1.5, 2.5}
    assert numbers_in("a slab of water") == set()


def test_auto_saves_a_stated_amount(store, hid, settings):
    demo.load_demo(store, hid)
    out = _turn(store, hid, settings, "I bought 5 L of water", tool_call("add_inventory_item", WATER), "auto")
    a = out["actions"][0]
    assert out["auto_saved"] == [a["id"]] and a["status"] == "approved" and a["resolved_by"] == "auto"
    assert _water_total(store, hid) == 65
    tool_msg = next(m for m in store.list_messages(hid) if m["role"] == "tool")
    assert json.loads(tool_msg["content"])["status"] == "saved_automatically"
    assert store.list_tool_log(hid)[0]["effect"] == "auto_approved"


def test_auto_asks_when_it_had_to_guess(store, hid, settings):
    demo.load_demo(store, hid)
    out = _turn(store, hid, settings, "I bought a slab of water", tool_call("add_inventory_item", {**WATER, "quantity": 24}), "auto")
    assert out["auto_saved"] == [] and out["actions"][0]["status"] == "pending"
    assert _water_total(store, hid) == 60
    tool_msg = next(m for m in store.list_messages(hid) if m["role"] == "tool")
    assert "isn't in the user's message" in json.loads(tool_msg["content"])["auto_mode"]


def test_auto_accepts_the_difference_for_an_update(store, hid, settings):
    demo.load_demo(store, hid)
    water = next(i for i in store.list_inventory(hid) if i["target_key"] == "water")
    out = _turn(store, hid, settings, "We drank 2 L", tool_call("update_inventory_item", {"item_id": water["id"], "changes": {"quantity": 58}}), "auto")
    assert out["auto_saved"] and _water_total(store, hid) == 58


def test_auto_still_asks_for_household_changes(store, hid, settings):
    out = _turn(store, hid, settings, "We are 3 adults now", tool_call("update_household_profile", {"adults": 3}), "auto")
    assert out["auto_saved"] == [] and out["actions"][0]["status"] == "pending"
    assert store.get_profile(hid).adults == 1


def test_ask_first_never_saves(store, hid, settings):
    demo.load_demo(store, hid)
    out = _turn(store, hid, settings, "I bought 5 L of water", tool_call("add_inventory_item", WATER), "ask")
    assert out["auto_saved"] == [] and _water_total(store, hid) == 60


def test_plan_and_auto_modes_are_in_the_prompt(store, hid):
    assert "PLAN MODE" in system_message(store, hid, {"ui": "simple", "permission_mode": "plan"})["content"]
    assert "AUTO MODE" in system_message(store, hid, {"ui": "simple", "permission_mode": "auto"})["content"]
    assert "MODE:" not in system_message(store, hid, {"ui": "simple", "permission_mode": "ask"})["content"]


def _client(store, hid):
    c = TestClient(create_app(settings=replace(get_settings(), nebius_api_key=None), store=store))
    c.cookies.set("prometheus_household", hid)
    return c


def test_undo_an_automatic_save(store, hid, settings):
    demo.load_demo(store, hid)
    out = _turn(store, hid, settings, "I bought 5 L of water", tool_call("add_inventory_item", WATER), "auto")
    c = _client(store, hid)
    aid = out["auto_saved"][0]
    assert c.post(f"/api/actions/{aid}/undo").json() == {"status": "undone"}
    assert _water_total(store, hid) == 60
    assert store.get_action(hid, aid)["status"] == "undone"
    assert "UNDID" in store.list_messages(hid)[-1]["content"]
    assert c.post(f"/api/actions/{aid}/undo").status_code == 409


def test_undo_restores_an_update_and_a_profile(store, hid, settings):
    demo.load_demo(store, hid)
    c = _client(store, hid)
    water = next(i for i in store.list_inventory(hid) if i["target_key"] == "water")
    up = _turn(store, hid, settings, "x", tool_call("update_inventory_item", {"item_id": water["id"], "changes": {"quantity": 10, "status": "unavailable"}}), "ask")
    aid = up["actions"][0]["id"]
    c.post(f"/api/actions/{aid}/approve")
    assert store.get_item(hid, water["id"])["status"] == "unavailable"
    c.post(f"/api/actions/{aid}/undo")
    item = store.get_item(hid, water["id"])
    assert (item["quantity"], item["status"]) == (60, "ok")
    prof = _turn(store, hid, settings, "x", tool_call("update_household_profile", {"adults": 4}), "ask")
    pid = prof["actions"][0]["id"]
    c.post(f"/api/actions/{pid}/approve")
    assert store.get_profile(hid).adults == 4
    c.post(f"/api/actions/{pid}/undo")
    assert store.get_profile(hid).adults == 2 and store.get_household(hid)["profile_confirmed"]


def test_undo_removes_saved_tasks(store, hid, settings):
    demo.load_demo(store, hid)
    c = _client(store, hid)
    out = _turn(store, hid, settings, "x", tool_call("propose_restock_tasks", {"target_keys": ["can_opener"]}), "auto")
    assert out["auto_saved"] and len(store.list_tasks(hid)) == 1
    c.post(f"/api/actions/{out['auto_saved'][0]}/undo")
    assert store.list_tasks(hid) == []


def test_an_old_database_gets_the_new_columns(tmp_path):
    import sqlite3

    from backend.app.db import Store
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE pending_actions (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, kind TEXT NOT NULL,"
                " payload_json TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',"
                " result_json TEXT, created_at TEXT NOT NULL, resolved_at TEXT)")
    con.commit()
    con.close()
    s = Store(path)
    hid = s.create_household()
    a = s.create_action(hid, "add_inventory", WATER, "x")
    assert a["before"] is None and a["resolved_by"] is None
