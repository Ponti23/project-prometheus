"""The companion's agent loop: model → validated tool calls → real state → model → answer."""

from __future__ import annotations

import json
import uuid
from typing import Any

from ..config import Settings
from ..db import Store
from ..knowledge.search import get_entry
from .llm import ChatClient, LLMUnavailable, clean_content
from .persona import system_message
from .tools import TOOLS_BY_NAME, ActionError, auto_blocker, execute_action, run_tool, snapshot, tool_specs

MAX_TOOL_RESULT_CHARS = 9000
MAX_FOOTER_SOURCES = 6
PLAN_NUDGE = (
    "[App note] You fetched a scenario guide but haven't proposed a survival plan. Call create_survival_plan now for "
    "this household, using knowledge_refs from the guide. Then reply with ONE short sentence telling the user the plan "
    "is ready for them to approve. Don't repeat your earlier answer."
)


class RateLimited(Exception):
    pass


def history_for_model(store: Store, hid: str, limit: int) -> list[dict[str, Any]]:
    rows = store.list_messages(hid, limit=limit)
    # Start at a user turn so we never send an orphaned tool result.
    while rows and rows[0]["role"] not in ("user", "event"):
        rows.pop(0)
    # A draft reply and its plan nudge only matter inside their own turn; the final message already contains the draft.
    last_user = max((i for i, m in enumerate(rows) if m["role"] == "user"), default=-1)
    rows = [m for i, m in enumerate(rows) if i > last_user or not (m["role"] == "note" or (m.get("meta") or {}).get("draft"))]
    out: list[dict[str, Any]] = []
    for m in rows:
        if m["role"] == "note":
            out.append({"role": "user", "content": m["content"] or ""})
        elif m["role"] == "user":
            out.append({"role": "user", "content": m["content"] or ""})
        elif m["role"] == "event":
            out.append({"role": "user", "content": f"[App event] {m['content']}"})
        elif m["role"] == "assistant":
            msg: dict[str, Any] = {"role": "assistant", "content": m["content"] or ""}
            if m["tool_calls"]:
                msg["tool_calls"] = m["tool_calls"]
            out.append(msg)
        elif m["role"] == "tool":
            out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"] or ""})
        # role "error" is UI-only.
    return out


def _normalise_tool_calls(raw: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    calls = []
    for c in raw or []:
        fn = c.get("function") or {}
        args = fn.get("arguments")
        if isinstance(args, (dict, list)):
            args = json.dumps(args)
        calls.append(
            {
                "id": c.get("id") or f"call_{uuid.uuid4().hex[:10]}",
                "type": "function",
                "function": {"name": fn.get("name", ""), "arguments": args or "{}"},
            }
        )
    return calls


def _parse_args(raw: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        val = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        return None, f"arguments are not valid JSON: {e.msg}"
    if not isinstance(val, dict):
        return None, "arguments must be a JSON object"
    return val, None


def collect_sources(result: Any, found: dict[str, dict[str, str]]) -> None:
    """Gather the {title, publisher, url} sources a tool result carries, in order, without duplicates."""
    if isinstance(result, dict):
        if {"title", "publisher", "url"} <= result.keys():
            found.setdefault(result["url"], {k: result[k] for k in ("title", "publisher", "url")})
            return
        for v in result.values():
            collect_sources(v, found)
    elif isinstance(result, list):
        for v in result:
            collect_sources(v, found)


def _turn_sources(results: list[tuple[str, dict, dict]]) -> list[dict[str, str]]:
    found: dict[str, dict[str, str]] = {}
    # A proposed plan's own citations come first, then everything else the turn's tools returned.
    for name, args, result in results:
        if name == "create_survival_plan" and result.get("action_id"):
            for step in args.get("steps", []):
                for ref in step.get("knowledge_refs", []):
                    collect_sources(get_entry(ref), found)
    for _, _, result in results:
        collect_sources(result, found)
    return list(found.values())[:MAX_FOOTER_SOURCES]


def _needs_plan_nudge(results: list[tuple[str, dict, dict]]) -> bool:
    names = {name for name, _, result in results if result.get("ok", True) is not False}
    return "get_scenario_guide" in names and not any(
        name == "create_survival_plan" and result.get("action_id") for name, _, result in results
    )


def apply_action(store: Store, hid: str, action: dict[str, Any], by: str = "user") -> dict[str, Any]:
    """Apply a pending action through execute_action(), keeping a snapshot for Undo. Raises ActionError/ValueError."""
    before = snapshot(store, hid, action)
    try:
        result = execute_action(store, hid, action)
    except (ActionError, ValueError) as e:
        store.resolve_action(hid, action["id"], "failed", {"error": str(e)}, by=by)
        raise
    store.resolve_action(hid, action["id"], "approved", result, before=before, by=by)
    store.log_tool(hid, action["kind"], action["payload"], result, True,
                   "auto_approved" if by == "auto" else "state_changed_after_approval")
    return result


def _auto_save(store: Store, hid: str, result: dict[str, Any], user_text: str) -> dict[str, Any]:
    """Auto mode: save a small proposal straight away, or say why it still needs the user."""
    action = store.get_action(hid, result["action_id"])
    blocker = auto_blocker(store, hid, action, user_text)  # type: ignore[arg-type]
    if blocker:
        return {**result, "auto_mode": f"Not saved automatically: {blocker}. The user must approve it."}
    try:
        apply_action(store, hid, action, by="auto")  # type: ignore[arg-type]
    except (ActionError, ValueError) as e:
        return {**result, "status": "failed", "error": str(e), "instruction": "This could not be saved. Tell the user."}
    return {**result, "status": "saved_automatically",
            "instruction": "Auto mode saved this small change straight away; the user can undo it. Say it's done in a few words."}


def run_turn(
    store: Store, hid: str, user_text: str, client: ChatClient, settings: Settings, mode: str | None = None,
    view: dict[str, Any] | None = None, permission: str = "ask",
) -> dict[str, Any]:
    mine, total = store.bump_usage(hid)
    if mine > settings.daily_turns_per_household or total > settings.daily_turns_global:
        raise RateLimited("Daily conversation limit reached for this demo. Data views still work.")

    if mode:
        store.set_context(hid, mode=mode)
    store.add_message(hid, "user", user_text, meta={"mode": mode} if mode else None)

    trace: list[dict[str, Any]] = []
    ui_hints: list[dict[str, Any]] = []
    actions: list[str] = []
    auto: list[str] = []
    results: list[tuple[str, dict, dict]] = []
    draft: str | None = None
    tools = tool_specs(settings)

    for round_no in range(1, settings.max_tool_rounds + 2):
        messages = [system_message(store, hid, view)] + history_for_model(store, hid, settings.history_messages)
        # Last round: no tools, force a final answer.
        offer_tools = tools if round_no <= settings.max_tool_rounds else []
        try:
            comp = client.complete(messages, offer_tools)
        except LLMUnavailable as e:
            store.add_message(hid, "error", str(e), meta={"trace": trace})
            raise
        step: dict[str, Any] = {
            "round": round_no, "model": comp.model, "response_id": comp.response_id, "provider": comp.provider,
            "latency_ms": comp.latency_ms, "usage": comp.usage, "finish_reason": comp.finish_reason, "tool_calls": [],
        }
        trace.append(step)
        calls = _normalise_tool_calls(comp.message.get("tool_calls")) if offer_tools else []
        content = clean_content(comp.message.get("content"))

        if not calls:
            if draft is None and offer_tools and content and _needs_plan_nudge(results):
                # The model answered an emergency without proposing a plan: give it one round to do so.
                draft = content
                store.add_message(hid, "assistant", content, meta={"draft": True})
                store.add_message(hid, "note", PLAN_NUDGE)
                continue
            if draft is not None:
                content = f"{draft}\n\n{content}".strip()
            final = store.add_message(
                hid, "assistant", content or "(Prometheus returned an empty reply.)",
                meta={"trace": trace, "ui_hints": ui_hints, "actions": actions, "auto_saved": auto,
                      "sources": _turn_sources(results)},
            )
            return {"message": final, "trace": trace, "ui_hints": ui_hints, "auto_saved": auto,
                    "actions": [store.get_action(hid, a) for a in actions]}

        store.add_message(hid, "assistant", content, tool_calls=calls)
        for call in calls:
            name = call["function"]["name"]
            args, err = _parse_args(call["function"]["arguments"])
            if err:
                result, ok, effect = {"ok": False, "error": err}, False, "none"
            else:
                result, ok, effect = run_tool(store, hid, name, args or {}, ui_hints)
            if result.get("action_id"):
                actions.append(result["action_id"])
                if permission == "auto":
                    result = _auto_save(store, hid, result, user_text)
                    if result.get("status") == "saved_automatically":
                        auto.append(result["action_id"])
                        effect = "auto_approved"
            results.append((name, args or {}, result))
            store.log_tool(hid, name, args or {"_raw": call["function"]["arguments"]}, result, ok, effect)
            payload = json.dumps(result, default=str)
            if len(payload) > MAX_TOOL_RESULT_CHARS:
                payload = payload[:MAX_TOOL_RESULT_CHARS] + '..."(truncated)"'
            store.add_message(hid, "tool", payload, tool_call_id=call["id"], name=name)
            step["tool_calls"].append(
                {
                    "id": call["id"], "name": name, "arguments": args if args is not None else call["function"]["arguments"],
                    "kind": TOOLS_BY_NAME[name].kind if name in TOOLS_BY_NAME else "unknown",
                    "ok": ok, "effect": effect, "action_id": result.get("action_id"),
                    "result_preview": payload[:600],
                }
            )

    raise AssertionError("unreachable")  # pragma: no cover


def record_action_event(
    store: Store, hid: str, action: dict[str, Any], approved: bool, detail: str = "", verb: str | None = None,
) -> None:
    verb = verb or ("APPROVED" if approved else "REJECTED")
    text = f"User {verb} proposal {action['id']} ({action['kind']}): {action['summary']}."
    if detail:
        text += f" {detail}"
    store.add_message(hid, "event", text, meta={"action_id": action["id"], "approved": approved})
