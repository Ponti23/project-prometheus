"""Readiness in stages, in human units, for Simple mode.

Every number here comes from calculate_readiness() run with a shorter plan length. Nothing is estimated.
A stage is reached when every planning target for that many days is met.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from ..schemas import HouseholdProfile
from .readiness import calculate_readiness, missing_supplies

STAGE_DAYS = (3, 7, 14)

# Simple-mode cards. Each groups planning targets from data/assumptions.json.
CATEGORIES = [
    ("water", "Water", ["water"]),
    ("food", "Food", ["food_kcal"]),
    ("medicine", "Medicine", ["medication_days", "first_aid_kit"]),
    ("pet_food", "Pet food", ["pet_food"]),
    ("light_power", "Light & power", ["torch", "batteries", "power_bank"]),
    ("radio", "Radio", ["radio"]),
    ("hygiene", "Hygiene", ["sanitation_bags", "toilet_paper", "hand_hygiene"]),
    ("tools", "Tools", ["can_opener"]),
    ("documents", "Documents", ["documents"]),
]
CATEGORY_OF = {k: c for c, _, keys in CATEGORIES for k in keys}

# Short names for counted gear: (one, many).
NOUNS = {
    "first_aid_kit": ("first aid kit", "first aid kits"),
    "torch": ("torch", "torches"),
    "batteries": ("battery set", "battery sets"),
    "radio": ("radio", "radios"),
    "power_bank": ("power bank", "power banks"),
    "can_opener": ("can opener", "can openers"),
    "sanitation_bags": ("bin bag", "bin bags"),
    "toilet_paper": ("toilet roll", "toilet rolls"),
    "hand_hygiene": ("soap", "soaps"),
    "documents": ("set of document copies", "sets of document copies"),
}
ONE_TITLES = {"documents": "Copies of documents", "radio": "Battery or wind-up radio"}


def stage_days(goal: int) -> list[int]:
    return sorted({d for d in (*STAGE_DAYS, goal) if d <= goal})


def stage_label(days: int) -> str:
    return {3: "3 days", 7: "1 week", 14: "2 weeks"}.get(days, f"{days} days")


def _n(x: float) -> str:
    return f"{x:g}" if x < 1000 else f"{round(x):,}"


def _count(qty: float, key: str) -> str:
    one, many = NOUNS.get(key, ("item", "items"))
    return f"{_n(qty)} {one if qty == 1 else many}"


def _days(d: float | None) -> str:
    if d is None:
        return "—"
    return "1 day" if round(d, 1) == 1 else f"{round(d, 1):g} days"


def _daily(target: dict[str, Any], plan_days: int) -> float:
    return target["quantity"] / plan_days if plan_days else 0.0


def _row_text(t: dict[str, Any], plan_days: int, pets: int) -> dict[str, Any]:
    """Have / need for one target in words people use."""
    key, have, need = t["key"], t["have"], t["quantity"]
    days = None
    if key == "water":
        days = have / _daily(t, plan_days) if need else None
        have_text, need_text = f"{_n(have)} L", f"{_n(need)} L"
    elif key == "food_kcal":
        days = have / _daily(t, plan_days) if need else None
        have_text, need_text = f"about {_days(days)} of food", f"{_days(plan_days)} of food"
    elif key == "pet_food":
        days = have / pets if pets else None
        have_text, need_text = f"{_days(days)} of pet food", f"{_days(plan_days)} of pet food"
    elif key == "medication_days":
        days = have
        have_text, need_text = f"{_days(have)} of medicine", _days(need)
    else:
        have_text, need_text = _count(have, key), _count(need, key)
    return {
        "key": key, "label": t["label"], "have": have, "need": need, "unit": t["unit"], "status": t["status"],
        "have_text": have_text, "need_text": need_text, "days": round(days, 1) if days is not None else None,
        **{k: t[k] for k in ("working", "explain", "basis", "source")},
    }


def next_up_item(m: dict[str, Any], daily_kcal: float) -> dict[str, Any]:
    key, qty = m["key"], m["shortfall"]
    if key == "water":
        title = f"{_n(qty)} L water"
    elif key == "food_kcal":
        n = round(qty / daily_kcal, 1) if daily_kcal else 0
        title = f"Food for {n:g} more day{'' if n == 1 else 's'}"
    elif key == "pet_food":
        title = f"{_days(qty)} of pet food"
    elif key == "medication_days":
        title = f"{_days(qty)} of medicine"
    else:
        title = _count(qty, key) if qty != 1 else ONE_TITLES.get(key) or NOUNS.get(key, (key,))[0].capitalize()
    return {
        "key": key, "title": title, "quantity": qty, "unit": m["unit"], "category": CATEGORY_OF.get(key),
        "status": m["status"],
    }


def build_summary(profile: HouseholdProfile, inventory: list[dict[str, Any]], today: date | None = None) -> dict[str, Any]:
    goal = profile.duration_days
    pets = sum(p.count for p in profile.pets)
    runs = []
    for d in stage_days(goal):
        r = calculate_readiness(profile.model_copy(update={"duration_days": d}), inventory, today)
        runs.append((d, r, missing_supplies(r)))
    stages = [{"days": d, "label": stage_label(d), "reached": not miss, "left": len(miss)} for d, _, miss in runs]
    current = next((i for i, s in enumerate(stages) if not s["reached"]), None)
    # Cards describe the stage you're working on (or the goal once everything is reached).
    focus_days, focus, focus_missing = runs[current if current is not None else -1]
    by_key = {t["key"]: t for t in focus["targets"]}
    goal_by_key = {t["key"]: t for t in runs[-1][1]["targets"]}
    daily_kcal = _daily(by_key["food_kcal"], focus_days) if "food_kcal" in by_key else 0.0

    next_up = [next_up_item(m, daily_kcal) for m in focus_missing]
    short = {n["key"]: n["title"] for n in next_up}
    categories = []
    for ckey, label, keys in CATEGORIES:
        rows = [_row_text(by_key[k], focus_days, pets) for k in keys if k in by_key]
        if not rows:
            continue
        for row in rows:
            row["goal_status"] = goal_by_key[row["key"]]["status"]
            row["short_text"] = short.get(row["key"])
        worst = "missing" if any(r["status"] == "missing" for r in rows) else (
            "partial" if any(r["status"] == "partial" for r in rows) else "met")
        categories.append({
            "key": ckey, "label": label, "status": worst, "targets": rows,
            "days": rows[0]["days"] if len(rows) == 1 or ckey == "medicine" else None,
            "goal_met": all(r["goal_status"] == "met" for r in rows),
        })

    return {
        "goal_days": goal,
        "stages": stages,
        "current": stages[current]["days"] if current is not None else None,
        "focus_days": focus_days,
        "next_up": next_up,
        "categories": categories,
        "water_days": runs[-1][1]["supply_days"]["water"],
        "food_days": runs[-1][1]["supply_days"]["food"],
        "daily_kcal": round(daily_kcal),
        "expired": focus["expired"],
        "expiring_soon": focus["expiring_soon"],
        "unavailable": focus["unavailable"],
        "not_counted": focus["not_counted"],
        "untracked": focus["untracked"],
        "disclaimer": focus["disclaimer"],
    }
