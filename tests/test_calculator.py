from backend.app.prepare.calculator import compute_targets, load_assumptions, meal_equivalents
from backend.app.schemas import HouseholdProfile, Pet


def targets(**kw):
    return {t["key"]: t for t in compute_targets(HouseholdProfile(**kw))}


def test_family_of_five_for_30_days():
    t = targets(adults=2, children=3, duration_days=30)
    assert t["water"]["quantity"] == 570.0  # 3.8 L x 5 people x 30 days
    assert t["food_kcal"]["quantity"] == 264000  # (2x2000 + 3x1600) x 30
    assert t["torch"]["quantity"] == 5
    assert t["batteries"]["quantity"] == 25  # 1 x 5 people x ceil(30/7)
    assert t["toilet_paper"]["quantity"] == 30  # 1 x 5 x ceil(30/5)
    assert t["first_aid_kit"]["quantity"] == 1
    assert "pet_food" not in t and "medication_days" not in t


def test_hot_climate_doubles_water_and_pets_add_water():
    t = targets(adults=2, children=0, duration_days=3, hot_climate=True, pets=[Pet(kind="dog", size="large", count=1)])
    assert t["water"]["quantity"] == round((3.8 * 2 * 2.0 + 3.0) * 3, 1)
    assert t["pet_food"]["quantity"] == 3


def test_medication_target_only_when_needed_and_capped():
    t = targets(adults=1, duration_days=30, needs_medication=True)
    assert t["medication_days"]["quantity"] == 30
    assert t["medication_days"]["basis"] == "guideline"


def test_minimums_apply_to_single_person():
    t = targets(adults=1, duration_days=3)
    assert t["torch"]["quantity"] == 2
    assert t["sanitation_bags"]["quantity"] == 10


def test_every_target_cites_a_known_source_and_basis():
    from backend.app.knowledge.search import load_sources

    src = load_sources()
    for t in compute_targets(HouseholdProfile(adults=2, children=1, needs_medication=True, pets=[Pet(kind="cat")])):
        assert t["source"] in src
        assert t["basis"] in {"guideline", "prometheus"}
        assert t["working"]


def test_assumption_rules_are_all_known():
    known = {"per_person_day", "food_kcal", "pet_days", "medication_days", "per_household", "per_person",
             "per_adult", "per_person_per_n_days"}
    assert {t["rule"] for t in load_assumptions()["targets"]} <= known


def test_meal_equivalents():
    assert meal_equivalents(2000) == 3
    assert meal_equivalents(0) == 0
