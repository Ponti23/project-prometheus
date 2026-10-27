"""Deterministic preparedness targets computed from data/assumptions.json.

No AI involved: the same household always produces the same targets, and every
number carries its basis (cited guideline vs. Prometheus planning default).
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from typing import Any

from ..config import DATA_DIR
from ..schemas import HouseholdProfile


@lru_cache(maxsize=1)
def load_assumptions() -> dict[str, Any]:
    return json.loads((DATA_DIR / "assumptions.json").read_text(encoding="utf-8"))


def target_keys() -> list[str]:
    return [t["key"] for t in load_assumptions()["targets"]]


def _round_qty(value: float, unit: str) -> float:
    # Count-like units round up to whole numbers; continuous units to one decimal.
    if unit == "L":
        return math.ceil(round(value * 10, 6)) / 10
    return float(math.ceil(round(value, 6)))


def compute_targets(profile: HouseholdProfile, assumptions: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    a = assumptions or load_assumptions()
    days = profile.duration_days
    people = profile.people
    pet_count = sum(p.count for p in profile.pets)
    out: list[dict[str, Any]] = []

    for t in a["targets"]:
        rule = t["rule"]
        qty: float
        working: str
        if rule == "per_person_day":
            per_day = t["amount"] * people * (t.get("hot_climate_multiplier", 1) if profile.hot_climate else 1)
            pet_water = sum(t.get("pet_litres_per_day", {}).get(p.size, 0) * p.count for p in profile.pets)
            qty = (per_day + pet_water) * days
            working = f"{t['amount']} {t['unit']} × {people} people"
            if profile.hot_climate:
                working += f" × {t.get('hot_climate_multiplier', 1)} (hot climate)"
            if pet_water:
                working += f" + {pet_water:g} {t['unit']} for pets"
            working += f" × {days} days"
        elif rule == "food_kcal":
            f = a["food"]
            daily = profile.adults * f["kcal_per_adult_per_day"] + profile.children * f["kcal_per_child_per_day"]
            qty = daily * days
            working = (
                f"({profile.adults} adults × {f['kcal_per_adult_per_day']} + {profile.children} children × "
                f"{f['kcal_per_child_per_day']}) kcal × {days} days"
            )
        elif rule == "pet_days":
            if pet_count == 0:
                continue
            qty = pet_count * days
            working = f"{pet_count} pets × {days} days"
        elif rule == "medication_days":
            if not profile.needs_medication:
                continue
            qty = min(days, t.get("max_days", days))
            working = f"{qty:g} days of each regular medication"
        elif rule == "per_household":
            qty = t["amount"]
            working = "per household"
        elif rule == "per_person":
            qty = max(t["amount"] * people, t.get("minimum", 0))
            working = f"{t['amount']} × {people} people (min {t.get('minimum', 0)})"
        elif rule == "per_adult":
            qty = max(t["amount"] * profile.adults, t.get("minimum", 0))
            working = f"{t['amount']} × {profile.adults} adults (min {t.get('minimum', 0)})"
        elif rule == "per_person_per_n_days":
            qty = max(t["amount"] * people * math.ceil(days / t["per_days"]), t.get("minimum", 0))
            working = f"{t['amount']} × {people} people × ⌈{days}/{t['per_days']} days⌉ (min {t.get('minimum', 0)})"
        else:  # pragma: no cover - guarded by test_assumptions_rules_known
            raise ValueError(f"Unknown rule {rule}")

        out.append(
            {
                "key": t["key"],
                "category": t["category"],
                "label": t["label"],
                "quantity": _round_qty(qty, t["unit"]),
                "unit": t["unit"],
                "working": working,
                "basis": t["basis"],
                "source": t["source"],
                "explain": t["explain"],
            }
        )
    return out


def meal_equivalents(kcal: float, assumptions: dict[str, Any] | None = None) -> int:
    f = (assumptions or load_assumptions())["food"]
    per_meal = f["kcal_per_adult_per_day"] / f["meals_per_day"]
    return math.ceil(kcal / per_meal) if kcal > 0 else 0
