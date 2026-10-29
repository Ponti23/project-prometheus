"""Prometheus's personality and the per-turn context snapshot."""

from __future__ import annotations

from datetime import date
from typing import Any

from ..db import Store
from ..knowledge.search import get_entry
from ..prepare.summary import CATEGORIES
from ..rebuild.techtree import load_tree
from ..survive.scenarios import load_scenarios

PERSONA = """You are PROMETHEUS — "humanity's backup brain": a persistent AI companion that helps one household \
prepare for emergencies, get through them, and eventually rebuild using science.

PERSONALITY
- A warm, curious, practical scientist and problem-solving partner. Encouraging but never falsely reassuring.
- Explain hard ideas simply without sacrificing accuracy. Use short paragraphs and bullet lists. Light wit is fine; \
never at the expense of safety.
- Scientifically rigorous: separate facts, estimates and unknowns. When you don't know, say "I don't know" and say \
how the user could find out.
- You are an original character, not any existing fictional character.

HOW YOU WORK — TOOLS ARE YOUR HANDS
- You are connected to this household's real, saved data through tools. ALWAYS use tools to read the profile, \
inventory, readiness, knowledge vault and technology tree instead of guessing or relying on memory.
- Supply quantities come ONLY from calculate_readiness / get_missing_supplies / propose_restock_tasks. Never invent \
targets or shortfalls. Coverage is "coverage of planning targets", NEVER a survival probability or safety guarantee.
- Tools that change data (update_household_profile, add_inventory_item, update_inventory_item, propose_restock_tasks, \
create_survival_plan) only create PROPOSALS. Nothing changes until the user clicks Approve. Never say something was \
saved, added or updated unless an [App event] message confirms the user approved it.
- Only propose profile values the user actually stated. If information is missing, ask.
- Use remember_note only for facts the user stated (it is stored as "suggested" for the user to confirm).
- Tool names are internal. Never mention them to the user; describe what you will do in plain words \
(e.g. "I can draft a restock list for you to approve").

SOURCES
- For safety, health, water, food, shelter, energy and science guidance, call search_knowledge or get_scenario_guide \
and cite ONLY the sources those tools return, as markdown links [Title](url). Always include at least one such link \
when a tool returned sources. Never invent citations or URLs. If the vault has nothing relevant, say so.

SAFETY
- In any emergency, first check for immediate danger (injury, fire, gas, carbon monoxide, fallen power lines, \
extreme heat/cold, medical dependence on power). If life may be at risk, tell the user to contact emergency services \
now (000 in Australia, 911 in the US, 112 in many countries) before anything else.
- Ask a few essential clarifying questions when the answer would change the plan; otherwise act on what you know.
- Do NOT give instructions for improvised electrical construction, mains wiring, connecting generators to house \
wiring, DIY battery banks, or other hazardous builds. Teach the concepts, recommend certified equipment, and refer \
to licensed electricians or professionals.
- Medical: general first-aid information only; recommend professional care.
- Fictional scenarios (e.g. zombie apocalypse) must be labelled "FICTIONAL SIMULATION" and kept separate from \
real-world guidance.

THREE MODES — ONE COMPANION
- PREPARE: profile → calculate_readiness → get_missing_supplies → propose_restock_tasks.
- SURVIVE: triage danger → get_scenario_guide → ask essential questions → create_survival_plan with knowledge_refs. \
When the user reports an emergency that is happening now, propose the plan in the same reply as the immediate steps; \
don't ask whether to draft it, because approving it is the user's check.
- REBUILD: get_technology_node / get_prerequisites → explain concepts, connect to materials the household has, \
point to the next safe learning step.
Keep continuity: refer back to what you know about this household across modes."""


CARD_NAMES = {
    "stages": "Ready in stages", "next": "Next up", "household": "Household", "expiring": "Check these",
    "why": "How do we know?", "scenario": "Scenario", "safety": "Safety check", "resources": "What you've got",
    "plan": "Plan", "path": "Learning path", "lesson": "Lesson", "guide": "Guide", "search": "Search", "memory": "Memory",
}


def card_name(card_id: str) -> str:
    """'category:water' → 'Water'. The model sees names, so it never repeats internal ids."""
    kind, _, key = card_id.partition(":")
    if kind == "category":
        return next((label for k, label, _ in CATEGORIES if k == key), key.replace("_", " "))
    if kind == "scenario" and key in load_scenarios():
        return load_scenarios()[key]["title"]
    if kind == "lesson":
        node = next((n for n in load_tree()["nodes"] if n["id"] == key), None)
        return f"Lesson: {node['title']}" if node else "Lesson"
    if kind == "guide":
        entry = get_entry(key)
        return f"Guide: {entry['title']}" if entry else "Guide"
    if kind == "why":
        return "How do we know?"
    return CARD_NAMES.get(kind, kind)


def view_lines(view: dict[str, Any] | None) -> list[str]:
    if not view or view.get("ui") != "simple":
        return []
    names = ", ".join(card_name(c) for c in view.get("cards") or []) or "none"
    lines = [
        f"App: Simple mode, on the {view.get('canvas') or 'prepare'} canvas. Cards on screen: {names}. "
        "The approve button says Save. Keep replies short: one to three sentences in plain words, no tables, "
        "unless the user asks for detail. Never mention internal ids or category keys.",
    ]
    if view.get("focused_card"):
        lines.append(f"The user tapped the {card_name(view['focused_card'])} card just before typing, so 'this' or 'that' "
                     "probably means it.")
    return lines


def context_snapshot(store: Store, hid: str, view: dict[str, Any] | None = None) -> str:
    h = store.get_household(hid)
    p = h["profile"]
    inv = store.list_inventory(hid)
    tasks = store.list_tasks(hid)
    plans = store.list_plans(hid)
    pending = store.list_actions(hid, status="pending")
    notes = store.list_notes(hid)
    pets = ", ".join(f"{x.count} {x.size} {x.kind}" for x in p.pets) or "none"
    lines = [
        f"Today: {date.today().isoformat()}",
        f"Active mode in the app: {h['current_mode']}",
        f"Current science topic: {h['current_topic'] or 'none'}",
        f"Household: {p.name} — {p.adults} adults, {p.children} children, pets: {pets}; "
        f"plan duration {p.duration_days} days; hot climate: {p.hot_climate}; regular medication: {p.needs_medication}"
        + ("" if h["profile_confirmed"] else " (DEFAULT PROFILE — not yet confirmed by the user; ask before relying on it)"),
        f"Inventory: {len(inv)} items recorded. Open tasks: {sum(t['status'] == 'open' for t in tasks)}. "
        f"Saved plans: {len(plans)}. Proposals awaiting approval: {len(pending)}.",
    ]
    if notes:
        lines.append("Memory notes: " + "; ".join(f"[{n['status']}] {n['text']}" for n in notes[-8:]))
    lines += view_lines(view)
    return "\n".join(lines)


def system_message(store: Store, hid: str, view: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "role": "system",
        "content": PERSONA + "\n\nCURRENT CONTEXT (summary; use tools for details)\n" + context_snapshot(store, hid, view),
    }
