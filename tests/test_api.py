from fastapi.testclient import TestClient

from backend.app.db import Store
from backend.app.main import create_app
from tests.conftest import FakeClient, tool_call


def make_client(store=None, settings=None, script=None):
    from dataclasses import replace

    from backend.app.config import get_settings

    s = settings or replace(get_settings(), nebius_api_key=None)
    app = create_app(settings=s, store=store or Store(":memory:"),
                     client_factory=(lambda _s: FakeClient(script)) if script is not None else None)
    return TestClient(app)


def test_households_are_isolated_by_cookie():
    store = Store(":memory:")
    a, b = make_client(store), make_client(store)
    a.post("/api/inventory", json={"name": "Water", "category": "water", "quantity": 10, "unit": "L"})
    assert len(a.get("/api/inventory").json()) == 1
    assert b.get("/api/inventory").json() == []


def test_profile_and_inventory_crud():
    c = make_client()
    r = c.put("/api/household", json={"adults": 2, "children": 3, "duration_days": 30})
    assert r.json()["confirmed"] is True
    item = c.post("/api/inventory", json={"name": "Torch", "category": "lighting", "quantity": 1, "unit": "each",
                                          "target_key": "torch"}).json()
    c.patch(f"/api/inventory/{item['id']}", json={"status": "unavailable"})
    assert c.get("/api/inventory").json()[0]["status"] == "unavailable"
    assert c.post("/api/inventory", json={"name": "x", "quantity": 1, "target_key": "bogus"}).status_code == 422
    assert c.delete(f"/api/inventory/{item['id']}").json() == {"deleted": True}
    assert c.put("/api/household", json={"duration_days": 5}).status_code == 422


def test_chat_without_key_is_honest_503():
    c = make_client()
    r = c.post("/api/chat", json={"message": "hello"})
    assert r.status_code == 503 and r.json()["error"] == "ai_unavailable"
    assert c.get("/api/status").json()["ai"]["mode"] == "unavailable"


def test_full_prepare_flow_with_approval_and_recalculation():
    from dataclasses import replace

    from backend.app.config import get_settings

    script = [
        {"role": "assistant", "content": "", "tool_calls": [tool_call("propose_restock_tasks", {"target_keys": ["can_opener"]})]},
        {"role": "assistant", "content": "Proposed one task."},
    ]
    c = make_client(settings=replace(get_settings(), nebius_api_key="k"), script=script)
    c.post("/api/household/demo")
    before = {m["key"] for m in c.get("/api/readiness").json()["missing"]}
    assert "can_opener" in before

    out = c.post("/api/chat", json={"message": "What am I missing?", "mode": "prepare"}).json()
    action = out["actions"][0]
    assert c.get("/api/tasks").json() == []

    assert c.post(f"/api/actions/{action['id']}/approve").json()["status"] == "approved"
    assert c.post(f"/api/actions/{action['id']}/approve").status_code == 409
    tasks = c.get("/api/tasks").json()
    assert len(tasks) == 1 and tasks[0]["source"] == "prometheus"

    done = c.post(f"/api/tasks/{tasks[0]['id']}/complete", json={"add_to_inventory": True}).json()
    assert done["task"]["status"] == "done" and done["added_item"]["target_key"] == "can_opener"
    after = {m["key"] for m in c.get("/api/readiness").json()["missing"]}
    assert "can_opener" not in after

    history = c.get("/api/chat/history").json()
    assert history[-1]["role"] == "event" and "APPROVED" in history[-1]["content"]
    assert any(e["effect"] == "state_changed_after_approval" for e in c.get("/api/toollog").json())


def test_reject_changes_nothing():
    c = make_client()
    store = c.app.state.store
    c.get("/api/status")  # creates the household
    with store.conn() as conn:
        full = conn.execute("SELECT id FROM households").fetchone()["id"]
    a = store.create_action(full, "add_inventory", {"name": "x", "quantity": 1}, "Add x")
    assert c.post(f"/api/actions/{a['id']}/reject").json()["status"] == "rejected"
    assert c.get("/api/inventory").json() == []


def test_persistence_across_restart(tmp_path):
    db = tmp_path / "p.db"
    c1 = make_client(store=Store(db))
    c1.put("/api/household", json={"adults": 2, "children": 3, "duration_days": 30})
    c1.post("/api/inventory", json={"name": "Water", "category": "water", "quantity": 40, "unit": "L"})
    c1.post("/api/tasks", json={"title": "Buy can opener"})
    cookie = c1.cookies.get("prometheus_household")

    c2 = make_client(store=Store(db))  # fresh app + store on the same file
    c2.cookies.set("prometheus_household", cookie)
    assert c2.get("/api/household").json()["profile"]["children"] == 3
    assert c2.get("/api/inventory").json()[0]["quantity"] == 40
    assert c2.get("/api/tasks").json()[0]["title"] == "Buy can opener"


def test_offline_content_endpoints():
    c = make_client()
    assert c.get("/api/knowledge?q=boil water").json()["results"][0]["id"] == "kb-water-treatment"
    assert len(c.get("/api/techtree").json()["nodes"]) >= 10
    g = c.get("/api/scenarios/blackout").json()
    assert g["triage_questions"] and g["label"] == "Real-world guidance"
    assert c.get("/api/scenarios/zombie").json()["scenario"]["fictional"] is True
    assert c.get("/").status_code == 200
