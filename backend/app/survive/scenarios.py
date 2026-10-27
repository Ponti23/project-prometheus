"""Emergency scenarios: triage questions, guideline steps and household-specific resource analysis."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from ..config import DATA_DIR
from ..knowledge.search import get_entry
from ..prepare.readiness import calculate_readiness
from ..schemas import HouseholdProfile

PRIORITIES = ("immediate", "today", "ongoing")


@lru_cache(maxsize=1)
def load_scenarios() -> dict[str, dict[str, Any]]:
    data = json.loads((DATA_DIR / "scenarios.json").read_text(encoding="utf-8"))
    return {s["id"]: s for s in data["scenarios"]}


def scenario_list() -> list[dict[str, Any]]:
    return [
        {"id": s["id"], "title": s["title"], "fictional": s["fictional"], "description": s["description"]}
        for s in load_scenarios().values()
    ]


def _has(inventory: list[dict[str, Any]], *words: str) -> list[str]:
    return [
        i["name"] for i in inventory
        if i.get("status") != "unavailable" and any(w in i["name"].lower() for w in words)
    ]


def household_situation(profile: HouseholdProfile, inventory: list[dict[str, Any]]) -> dict[str, Any]:
    r = calculate_readiness(profile, inventory)
    statuses = {t["key"]: t["status"] for t in r["targets"]}
    return {
        "people": profile.people,
        "adults": profile.adults,
        "children": profile.children,
        "pets": [p.model_dump() for p in profile.pets],
        "needs_medication": profile.needs_medication,
        "special_requirements": profile.special_requirements,
        "water_days_available": r["supply_days"]["water"],
        "food_days_available": r["supply_days"]["food"],
        "lighting": _has(inventory, "torch", "flashlight", "lantern", "headlamp"),
        "radio": _has(inventory, "radio"),
        "power": _has(inventory, "power bank", "power station", "solar", "battery", "batteries"),
        "first_aid": _has(inventory, "first aid"),
        "target_status": statuses,
        "unavailable_equipment": [u["name"] for u in r["unavailable"]],
        "expired_items": [e["name"] for e in r["expired"]],
    }


def scenario_guide(scenario_id: str, profile: HouseholdProfile, inventory: list[dict[str, Any]]) -> dict[str, Any]:
    s = load_scenarios().get(scenario_id)
    if s is None:
        raise KeyError(scenario_id)
    knowledge = [e for e in (get_entry(k) for k in s["knowledge_refs"]) if e]
    return {
        "scenario": {k: s[k] for k in ("id", "title", "fictional", "description")},
        "label": "FICTIONAL SIMULATION — not real-world guidance" if s["fictional"] else "Real-world guidance",
        "triage_questions": s["triage_questions"],
        "guideline_steps": s["steps"],
        "household": household_situation(profile, inventory),
        "knowledge": [{"id": e["id"], "title": e["title"], "summary": e["summary"], "sources": e["sources"]} for e in knowledge],
    }
