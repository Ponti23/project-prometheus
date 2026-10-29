"""Prometheus FastAPI application: JSON API under /api, static frontend at /."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import demo
from .agent.llm import ChatClient, LLMUnavailable, NebiusClient
from .agent.loop import RateLimited, apply_action, record_action_event, run_turn
from .agent.tools import EDITED, ActionError, TOOLS, edit_action, simulate_action, undo_action
from .config import FRONTEND_DIR, Settings, get_settings
from .db import Store
from .knowledge import search as kb
from .prepare.calculator import load_assumptions, target_keys
from .prepare.readiness import calculate_readiness, missing_supplies
from .prepare.summary import build_summary, summary_changes
from .rebuild import techtree
from .schemas import (
    ActionEdit, ChatIn, ContextUpdate, HouseholdProfile, HouseholdProfileUpdate, InventoryItemIn, InventoryItemPatch,
    MemoryNoteIn, PlanStepPatch, TaskComplete, TaskIn, TaskPatch,
)
from .survive.scenarios import scenario_guide, scenario_list

COOKIE = "prometheus_household"
VERSION = "0.1.0"


def create_app(
    settings: Settings | None = None,
    store: Store | None = None,
    client_factory: Callable[[Settings], ChatClient] | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    store = store or Store(settings.db_path)
    client_factory = client_factory or (lambda s: NebiusClient(s))
    app = FastAPI(title="Project Prometheus", version=VERSION)
    app.state.settings, app.state.store = settings, store
    # Validate curated data at startup so a broken tree never ships silently.
    techtree.load_tree()

    def household(request: Request, response: Response) -> str:
        hid = request.cookies.get(COOKIE)
        if not hid or not store.household_exists(hid):
            hid = store.create_household()
            response.set_cookie(COOKIE, hid, max_age=60 * 60 * 24 * 365, httponly=True, samesite="lax")
        return hid

    H = Depends(household)

    def _404(what: str) -> HTTPException:
        return HTTPException(status_code=404, detail=f"{what} not found")

    # ------------------------------------------------------------- status
    @app.get("/api/status")
    def status(hid: str = H) -> dict[str, Any]:
        return {
            "version": VERSION,
            "household_id": hid[:8],
            "ai": {
                "configured": settings.ai_configured,
                "mode": "cloud" if settings.ai_configured else "unavailable",
                "provider": "Nebius Token Factory",
                "model": settings.nebius_model,
                "base_url": settings.nebius_base_url,
            },
            "offline_data": True,
            "tools": [{"name": t.name, "kind": t.kind} for t in TOOLS],
        }

    @app.get("/api/ai/verify")
    def verify_ai() -> dict[str, Any]:
        """Live check against Nebius: lists models visible to the key and whether the configured one exists."""
        if not settings.ai_configured:
            return {"ok": False, "reason": "NEBIUS_API_KEY not configured"}
        try:
            models = NebiusClient(settings).list_models()
        except LLMUnavailable as e:
            return {"ok": False, "reason": str(e)}
        return {
            "ok": settings.nebius_model in models,
            "configured_model": settings.nebius_model,
            "configured_model_available": settings.nebius_model in models,
            "nvidia_models": [m for m in models if "nvidia" in m.lower() or "nemotron" in m.lower()],
            "model_count": len(models),
        }

    # ------------------------------------------------------------- household & memory
    @app.get("/api/household")
    def get_household(hid: str = H) -> dict[str, Any]:
        h = store.get_household(hid)
        return {
            "profile": h["profile"].model_dump(), "confirmed": h["profile_confirmed"],
            "mode": h["current_mode"], "topic": h["current_topic"],
        }

    @app.put("/api/household")
    def put_household(profile: HouseholdProfile, hid: str = H) -> dict[str, Any]:
        return {"profile": store.save_profile(hid, profile).model_dump(), "confirmed": True}

    @app.patch("/api/household")
    def patch_household(update: HouseholdProfileUpdate, hid: str = H) -> dict[str, Any]:
        current = store.get_profile(hid).model_dump()
        current.update(update.model_dump(exclude_none=True))
        return {"profile": store.save_profile(hid, HouseholdProfile.model_validate(current)).model_dump(), "confirmed": True}

    @app.post("/api/household/demo")
    def load_demo(hid: str = H) -> dict[str, str]:
        demo.load_demo(store, hid)
        return {"status": "demo household loaded"}

    @app.post("/api/household/reset")
    def reset(hid: str = H) -> dict[str, str]:
        store.reset_household(hid)
        return {"status": "household reset"}

    @app.post("/api/context")
    def set_context(ctx: ContextUpdate, hid: str = H) -> dict[str, str]:
        store.set_context(hid, mode=ctx.mode, topic=ctx.topic)
        return {"status": "ok"}

    @app.get("/api/memory")
    def memory(hid: str = H) -> list[dict[str, Any]]:
        return store.list_notes(hid)

    @app.post("/api/memory")
    def add_memory(note: MemoryNoteIn, hid: str = H) -> dict[str, Any]:
        return store.add_note(hid, note.text, status="confirmed", source="user")

    @app.post("/api/memory/{note_id}/confirm")
    def confirm_memory(note_id: int, hid: str = H) -> dict[str, Any]:
        n = store.update_note(hid, note_id, status="confirmed")
        if n is None:
            raise _404("note")
        return n

    @app.patch("/api/memory/{note_id}")
    def edit_memory(note_id: int, note: MemoryNoteIn, hid: str = H) -> dict[str, Any]:
        n = store.update_note(hid, note_id, text=note.text, status="confirmed")
        if n is None:
            raise _404("note")
        return n

    @app.delete("/api/memory/{note_id}")
    def delete_memory(note_id: int, hid: str = H) -> dict[str, bool]:
        if not store.delete_note(hid, note_id):
            raise _404("note")
        return {"deleted": True}

    # ------------------------------------------------------------- inventory & readiness
    @app.get("/api/inventory")
    def inventory(hid: str = H) -> list[dict[str, Any]]:
        return store.list_inventory(hid)

    @app.post("/api/inventory")
    def add_inventory(item: InventoryItemIn, hid: str = H) -> dict[str, Any]:
        if item.target_key and item.target_key not in target_keys():
            raise HTTPException(422, f"unknown target_key {item.target_key}")
        return store.add_item(hid, item)

    @app.patch("/api/inventory/{item_id}")
    def patch_inventory(item_id: int, patch: InventoryItemPatch, hid: str = H) -> dict[str, Any]:
        if store.get_item(hid, item_id) is None:
            raise _404("item")
        # exclude_unset keeps explicit nulls (e.g. clearing an expiry date).
        fields = patch.model_dump(exclude_unset=True)
        if fields.get("target_key") and fields["target_key"] not in target_keys():
            raise HTTPException(422, "unknown target_key")
        return store.update_item(hid, item_id, fields)  # type: ignore[return-value]

    @app.delete("/api/inventory/{item_id}")
    def delete_inventory(item_id: int, hid: str = H) -> dict[str, bool]:
        if not store.delete_item(hid, item_id):
            raise _404("item")
        return {"deleted": True}

    @app.get("/api/readiness")
    def readiness(hid: str = H) -> dict[str, Any]:
        r = calculate_readiness(store.get_profile(hid), store.list_inventory(hid))
        r["missing"] = missing_supplies(r)
        return r

    @app.get("/api/summary")
    def summary(hid: str = H) -> dict[str, Any]:
        return build_summary(store.get_profile(hid), store.list_inventory(hid))

    @app.get("/api/assumptions")
    def assumptions() -> dict[str, Any]:
        return load_assumptions()

    # ------------------------------------------------------------- tasks, actions, plans
    @app.get("/api/tasks")
    def tasks(hid: str = H) -> list[dict[str, Any]]:
        return store.list_tasks(hid)

    @app.post("/api/tasks")
    def add_task(task: TaskIn, hid: str = H) -> dict[str, Any]:
        return store.add_task(hid, task, source="user")

    @app.patch("/api/tasks/{task_id}")
    def patch_task(task_id: int, patch: TaskPatch, hid: str = H) -> dict[str, Any]:
        t = store.update_task(hid, task_id, patch.model_dump(exclude_none=True))
        if t is None:
            raise _404("task")
        return t

    @app.post("/api/tasks/{task_id}/complete")
    def complete_task(task_id: int, body: TaskComplete, hid: str = H) -> dict[str, Any]:
        t = store.get_task(hid, task_id)
        if t is None:
            raise _404("task")
        added = None
        if body.add_to_inventory and t["target_key"] and t["quantity"]:
            target = next((x for x in load_assumptions()["targets"] if x["key"] == t["target_key"]), None)
            if target:
                added = store.add_item(
                    hid,
                    InventoryItemIn(
                        name=target["label"], category=target["category"], quantity=t["quantity"],
                        unit=t["unit"] or target["unit"], target_key=t["target_key"], notes=f"From task: {t['title']}",
                    ),
                )
        return {"task": store.update_task(hid, task_id, {"status": "done"}), "added_item": added}

    @app.delete("/api/tasks/{task_id}")
    def delete_task(task_id: int, hid: str = H) -> dict[str, bool]:
        if not store.delete_task(hid, task_id):
            raise _404("task")
        return {"deleted": True}

    @app.get("/api/actions")
    def actions(status: str | None = None, hid: str = H) -> list[dict[str, Any]]:
        return store.list_actions(hid, status=status)

    def _preview(ids: list[str], hid: str) -> dict[str, Any]:
        acts = [store.get_action(hid, i) for i in ids]
        if not ids or any(a is None for a in acts):
            raise _404("action")
        profile, inv = store.get_profile(hid), store.list_inventory(hid)
        before = build_summary(profile, inv)
        for a in acts:
            if a["status"] == "pending":  # type: ignore[index]
                try:
                    profile, inv = simulate_action(profile, inv, a)  # type: ignore[arg-type]
                except (ActionError, ValueError) as e:
                    raise HTTPException(422, f"could not preview action: {e}")
        after = build_summary(profile, inv)
        return {"action_ids": ids, "changes": summary_changes(before, after), "summary": after,
                "profile": profile.model_dump(), "inventory": inv}

    # Before → after for every number a pending change would move. Deterministic, no AI, nothing saved.
    @app.get("/api/actions/preview")
    def preview_many(ids: str, hid: str = H) -> dict[str, Any]:
        return _preview([i for i in ids.split(",") if i], hid)

    @app.get("/api/actions/{action_id}/preview")
    def preview(action_id: str, hid: str = H) -> dict[str, Any]:
        return _preview([action_id], hid)

    @app.post("/api/actions/{action_id}/edit")
    def edit(action_id: str, body: ActionEdit, hid: str = H) -> dict[str, Any]:
        a = store.get_action(hid, action_id)
        if a is None:
            raise _404("action")
        if a["status"] != "pending":
            raise HTTPException(409, f"action already {a['status']}")
        try:
            payload, summary = edit_action(a, body.changes)
        except (ActionError, ValueError) as e:
            raise HTTPException(422, f"could not edit action: {e}")
        store.update_action(hid, action_id, payload, summary)
        return store.get_action(hid, action_id)  # type: ignore[return-value]

    @app.post("/api/actions/{action_id}/approve")
    def approve(action_id: str, hid: str = H) -> dict[str, Any]:
        a = store.get_action(hid, action_id)
        if a is None:
            raise _404("action")
        if a["status"] != "pending":
            raise HTTPException(409, f"action already {a['status']}")
        try:
            result = apply_action(store, hid, a)
        except (ActionError, ValueError) as e:
            raise HTTPException(422, f"could not apply action: {e}")
        record_action_event(store, hid, a, approved=True,
                            detail="The user edited it before saving." if a["summary"].endswith(EDITED) else "")
        return {"status": "approved", "result": result}

    @app.post("/api/actions/{action_id}/undo")
    def undo(action_id: str, hid: str = H) -> dict[str, Any]:
        a = store.get_action(hid, action_id)
        if a is None:
            raise _404("action")
        if a["status"] != "approved":
            raise HTTPException(409, f"only saved changes can be undone (this one is {a['status']})")
        try:
            undo_action(store, hid, a)
        except (ActionError, KeyError, TypeError, ValueError) as e:
            raise HTTPException(422, f"could not undo: {e}")
        store.resolve_action(hid, action_id, "undone", a["result"])
        store.log_tool(hid, a["kind"], a["payload"], {"undone": True}, True, "undone_by_user")
        record_action_event(store, hid, a, approved=False, verb="UNDID", detail="It is back to how it was before.")
        return {"status": "undone"}

    @app.post("/api/actions/{action_id}/reject")
    def reject(action_id: str, hid: str = H) -> dict[str, Any]:
        a = store.get_action(hid, action_id)
        if a is None:
            raise _404("action")
        if a["status"] != "pending":
            raise HTTPException(409, f"action already {a['status']}")
        store.resolve_action(hid, action_id, "rejected", None)
        record_action_event(store, hid, a, approved=False)
        return {"status": "rejected"}

    @app.get("/api/plans")
    def plans(hid: str = H) -> list[dict[str, Any]]:
        return store.list_plans(hid)

    @app.patch("/api/plans/{plan_id}/steps/{index}")
    def plan_step(plan_id: int, index: int, patch: PlanStepPatch, hid: str = H) -> dict[str, Any]:
        p = store.set_plan_step(hid, plan_id, index, patch.done)
        if p is None:
            raise _404("plan step")
        return p

    @app.delete("/api/plans/{plan_id}")
    def delete_plan(plan_id: int, hid: str = H) -> dict[str, bool]:
        if not store.delete_plan(hid, plan_id):
            raise _404("plan")
        return {"deleted": True}

    # ------------------------------------------------------------- survive / knowledge / rebuild
    @app.get("/api/scenarios")
    def scenarios() -> list[dict[str, Any]]:
        return scenario_list()

    @app.get("/api/scenarios/{scenario_id}")
    def scenario(scenario_id: str, hid: str = H) -> dict[str, Any]:
        try:
            return scenario_guide(scenario_id, store.get_profile(hid), store.list_inventory(hid))
        except KeyError:
            raise _404("scenario")

    @app.get("/api/knowledge")
    def knowledge(q: str | None = None, topic: str | None = None) -> dict[str, Any]:
        if q:
            return {"results": kb.search(q, limit=8, topic=topic), "topics": kb.topics()}
        entries = [kb.entry_view(e) for e in kb.load_entries() if not topic or e["topic"] == topic]
        return {"results": entries, "topics": kb.topics()}

    @app.get("/api/knowledge/{entry_id}")
    def knowledge_entry(entry_id: str) -> dict[str, Any]:
        e = kb.get_entry(entry_id)
        if e is None:
            raise _404("entry")
        return e

    @app.get("/api/sources")
    def sources() -> list[dict[str, Any]]:
        return list(kb.load_sources().values())

    @app.get("/api/techtree")
    def tree() -> dict[str, Any]:
        return techtree.tree_view()

    @app.get("/api/techtree/{node_id}")
    def tree_node(node_id: str, hid: str = H) -> dict[str, Any]:
        v = techtree.node_view(node_id, store.list_inventory(hid))
        if v is None:
            raise _404("node")
        return v

    # ------------------------------------------------------------- companion chat
    @app.get("/api/chat/history")
    def history(hid: str = H) -> list[dict[str, Any]]:
        return [m for m in store.list_messages(hid) if m["role"] != "tool"]

    @app.delete("/api/chat/history")
    def clear_history(hid: str = H) -> dict[str, str]:
        store.clear_messages(hid)
        return {"status": "cleared"}

    @app.post("/api/chat")
    def chat(body: ChatIn, hid: str = H) -> Any:
        if not settings.ai_configured:
            return JSONResponse(
                status_code=503,
                content={"error": "ai_unavailable", "detail": "Cloud AI is not configured (NEBIUS_API_KEY missing). "
                         "Inventory, plans, knowledge and the tech tree still work offline."},
            )
        try:
            client = client_factory(settings)
            view = body.model_dump(include={"ui", "canvas", "cards", "focused_card", "permission_mode"})
            return run_turn(store, hid, body.message, client, settings, mode=body.mode, view=view,
                            permission=body.permission_mode)
        except RateLimited as e:
            return JSONResponse(status_code=429, content={"error": "rate_limited", "detail": str(e)})
        except LLMUnavailable as e:
            return JSONResponse(status_code=502, content={"error": "ai_unavailable", "detail": str(e)})

    @app.get("/api/toollog")
    def toollog(hid: str = H) -> list[dict[str, Any]]:
        return store.list_tool_log(hid)

    if FRONTEND_DIR.exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    return app


app = create_app()
