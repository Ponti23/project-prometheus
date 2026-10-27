"""The companion's agent loop: model → validated tool calls → real state → model → answer."""

from __future__ import annotations

import json
import uuid
from typing import Any

from ..config import Settings
from ..db import Store
from .llm import ChatClient, LLMUnavailable, clean_content
from .persona import system_message
from .tools import TOOLS_BY_NAME, run_tool, tool_specs

MAX_TOOL_RESULT_CHARS = 9000


class RateLimited(Exception):
    pass


def history_for_model(store: Store, hid: str, limit: int) -> list[dict[str, Any]]:
    rows = store.list_messages(hid, limit=limit)
    # Start at a user turn so we never send an orphaned tool result.
    while rows and rows[0]["role"] not in ("user", "event"):
        rows.pop(0)
    out: list[dict[str, Any]] = []
    for m in rows:
        if m["role"] == "user":
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


def run_turn(
    store: Store, hid: str, user_text: str, client: ChatClient, settings: Settings, mode: str | None = None
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
    tools = tool_specs()

    for round_no in range(1, settings.max_tool_rounds + 2):
        messages = [system_message(store, hid)] + history_for_model(store, hid, settings.history_messages)
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
            final = store.add_message(
                hid, "assistant", content or "(Prometheus returned an empty reply.)",
                meta={"trace": trace, "ui_hints": ui_hints, "actions": actions},
            )
            return {"message": final, "trace": trace, "ui_hints": ui_hints, "actions": [store.get_action(hid, a) for a in actions]}

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


def record_action_event(store: Store, hid: str, action: dict[str, Any], approved: bool, detail: str = "") -> None:
    verb = "APPROVED" if approved else "REJECTED"
    text = f"User {verb} proposal {action['id']} ({action['kind']}): {action['summary']}."
    if detail:
        text += f" {detail}"
    store.add_message(hid, "event", text, meta={"action_id": action["id"], "approved": approved})
