"""Compare inventory against planning targets.

Coverage is reported as "coverage of planning targets" — it is NOT a survival
probability and the UI/agent must never present it as one.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any

from ..schemas import HouseholdProfile
from .calculator import compute_targets, load_assumptions, meal_equivalents

DISCLAIMER = (
    "Coverage compares your recorded supplies with planning targets. It is not a measure of safety or a "
    "survival probability, and real needs vary with health, climate and circumstances."
)

_VOLUME_TO_L = {
    "l": 1.0, "litre": 1.0, "litres": 1.0, "liter": 1.0, "liters": 1.0,
    "ml": 0.001, "gal": 3.785, "gallon": 3.785, "gallons": 3.785,
}
_INCOMPATIBLE_FOR_COUNTS = set(_VOLUME_TO_L) | {"kcal", "kg", "g"}


def _norm(unit: str | None) -> str:
    return (unit or "").strip().lower()


def effective_target(item: dict[str, Any]) -> str | None:
    if item.get("target_key"):
        return item["target_key"]
    cat = (item.get("category") or "").lower()
    if cat == "water" and _norm(item.get("unit")) in _VOLUME_TO_L:
        return "water"
    if cat == "food" and (item.get("kcal_per_unit") or _norm(item.get("unit")) == "kcal"):
        return "food_kcal"
    return None


def _parse_date(v: Any) -> date | None:
    if not v:
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def contribution(item: dict[str, Any], target: dict[str, Any]) -> tuple[float | None, str | None]:
    """Amount this item contributes to target, in the target's unit. None = cannot be counted."""
    qty = float(item["quantity"])
    unit = _norm(item.get("unit"))
    if target["unit"] == "L":
        if unit not in _VOLUME_TO_L:
            return None, f"unit '{item['unit']}' is not a volume"
        return qty * _VOLUME_TO_L[unit], None
    if target["unit"] == "kcal":
        if unit == "kcal":
            return qty, None
        if item.get("kcal_per_unit"):
            return qty * float(item["kcal_per_unit"]), None
        return None, "kcal per unit not recorded"
    if unit in _INCOMPATIBLE_FOR_COUNTS:
        return None, f"unit '{item['unit']}' doesn't match '{target['unit']}'"
    return qty, None


def calculate_readiness(
    profile: HouseholdProfile, inventory: list[dict[str, Any]], today: date | None = None
) -> dict[str, Any]:
    today = today or date.today()
    a = load_assumptions()
    warn_until = today + timedelta(days=a.get("expiry_warning_days", 30))
    targets = compute_targets(profile, a)
    by_key = {t["key"]: {**t, "have": 0.0, "items": []} for t in targets}

    expired, expiring, unavailable, uncounted, untracked = [], [], [], [], []
    for item in inventory:
        ref = {"id": item["id"], "name": item["name"], "quantity": item["quantity"], "unit": item["unit"]}
        exp = _parse_date(item.get("expires_on"))
        if item.get("status") == "unavailable":
            unavailable.append(ref)
            continue
        if exp and exp < today:
            expired.append({**ref, "expires_on": exp.isoformat()})
            continue
        if exp and exp <= warn_until:
            expiring.append({**ref, "expires_on": exp.isoformat(), "days_left": (exp - today).days})
        key = effective_target(item)
        if key is None or key not in by_key:
            untracked.append(ref)
            continue
        amount, problem = contribution(item, by_key[key])
        if amount is None:
            uncounted.append({**ref, "target": key, "reason": problem})
            continue
        by_key[key]["have"] += amount
        by_key[key]["items"].append(item["id"])

    rows = []
    for t in by_key.values():
        need = t["quantity"]
        have = round(t["have"], 1)
        coverage = 1.0 if need <= 0 else min(1.0, have / need)
        shortfall = max(0.0, need - have)
        t.update(
            have=have,
            coverage=round(coverage, 3),
            shortfall=math.ceil(shortfall * 10) / 10 if t["unit"] == "L" else float(math.ceil(shortfall)),
            status="met" if coverage >= 1 else ("partial" if have > 0 else "missing"),
        )
        rows.append(t)

    daily_water = by_key["water"]["quantity"] / profile.duration_days if "water" in by_key else 0
    daily_kcal = by_key["food_kcal"]["quantity"] / profile.duration_days if "food_kcal" in by_key else 0
    overall = sum(r["coverage"] for r in rows) / len(rows) if rows else 0.0

    return {
        "household": {
            "people": profile.people, "adults": profile.adults, "children": profile.children,
            "pets": sum(p.count for p in profile.pets), "duration_days": profile.duration_days,
        },
        "overall_coverage": round(overall, 3),
        "coverage_label": "coverage of planning targets",
        "targets": rows,
        "supply_days": {
            "water": round(by_key["water"]["have"] / daily_water, 1) if daily_water else None,
            "food": round(by_key["food_kcal"]["have"] / daily_kcal, 1) if daily_kcal else None,
        },
        "expired": expired,
        "expiring_soon": expiring,
        "unavailable": unavailable,
        "not_counted": uncounted,
        "untracked": untracked,
        "disclaimer": DISCLAIMER,
    }


def missing_supplies(readiness: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for t in readiness["targets"]:
        if t["status"] == "met":
            continue
        row = {
            "key": t["key"], "label": t["label"], "category": t["category"],
            "need": t["quantity"], "have": t["have"], "shortfall": t["shortfall"], "unit": t["unit"],
            "status": t["status"],
        }
        if t["unit"] == "kcal":
            row["shortfall_meal_equivalents"] = meal_equivalents(t["shortfall"])
        out.append(row)
    # Water and food first, then by how uncovered the target is.
    priority = {"water": 0, "food_kcal": 1, "medication_days": 2, "first_aid_kit": 3}
    out.sort(key=lambda r: (priority.get(r["key"], 9), -(r["shortfall"] / r["need"] if r["need"] else 0)))
    return out


def restock_task_drafts(missing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deterministic task suggestions for each shortfall (the agent may reword, never re-quantify)."""
    drafts = []
    for m in missing:
        if m["unit"] == "kcal":
            meals = m.get("shortfall_meal_equivalents", meal_equivalents(m["shortfall"]))
            title = f"Add ~{int(m['shortfall']):,} kcal of shelf-stable food (≈{meals} meals)"
            detail = "Choose foods your household will eat, check dietary restrictions, and record kcal per unit."
        elif m["unit"] == "L":
            title = f"Store {m['shortfall']:g} L more drinking water"
            detail = "Use sealed commercial bottled water or clean food-grade containers; label with the fill date."
        else:
            title = f"Get {m['shortfall']:g} {m['unit']} — {m['label']}"
            detail = ""
        drafts.append(
            {"title": title, "detail": detail, "target_key": m["key"], "quantity": m["shortfall"], "unit": m["unit"]}
        )
    return drafts
