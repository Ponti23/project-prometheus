from datetime import date, timedelta

from backend.app.prepare.readiness import calculate_readiness, missing_supplies, restock_task_drafts
from backend.app.schemas import HouseholdProfile, InventoryItemIn

TODAY = date(2026, 10, 27)
FAMILY = HouseholdProfile(adults=2, children=3, duration_days=30)


def inv(store, hid, **kw):
    store.add_item(hid, InventoryItemIn(**kw))
    return store.list_inventory(hid)


def rows(r):
    return {t["key"]: t for t in r["targets"]}


def test_empty_inventory_has_zero_coverage(store, hid):
    r = calculate_readiness(FAMILY, [], today=TODAY)
    assert r["overall_coverage"] == 0
    assert r["coverage_label"] == "coverage of planning targets"
    assert "not a measure of safety" in r["disclaimer"]


def test_water_units_convert_and_coverage_caps_at_one(store, hid):
    items = inv(store, hid, name="Water jugs", category="water", quantity=10, unit="gal")
    w = rows(calculate_readiness(FAMILY, items, today=TODAY))["water"]
    assert w["have"] == 37.9  # 10 gal x 3.785, rounded
    items = inv(store, hid, name="Tank", category="water", quantity=1000, unit="L")
    w = rows(calculate_readiness(FAMILY, items, today=TODAY))["water"]
    assert w["coverage"] == 1.0 and w["status"] == "met" and w["shortfall"] == 0


def test_food_counts_kcal_not_cans(store, hid):
    items = inv(store, hid, name="Mystery cans", category="food", quantity=50, unit="cans")
    r = calculate_readiness(FAMILY, items, today=TODAY)
    assert rows(r)["food_kcal"]["have"] == 0
    assert [u["name"] for u in r["untracked"]] == ["Mystery cans"]
    items = inv(store, hid, name="Stew", category="food", quantity=10, unit="cans", kcal_per_unit=500)
    assert rows(calculate_readiness(FAMILY, items, today=TODAY))["food_kcal"]["have"] == 5000


def test_food_with_target_but_no_kcal_is_reported_not_counted(store, hid):
    items = inv(store, hid, name="Beans", category="food", quantity=5, unit="cans", target_key="food_kcal")
    r = calculate_readiness(FAMILY, items, today=TODAY)
    assert r["not_counted"][0]["reason"] == "kcal per unit not recorded"


def test_expired_and_unavailable_items_are_excluded(store, hid):
    inv(store, hid, name="Old water", category="water", quantity=100, unit="L", expires_on=TODAY - timedelta(days=1))
    inv(store, hid, name="Broken torch", category="lighting", quantity=3, unit="each", target_key="torch", status="unavailable")
    items = inv(store, hid, name="Soon water", category="water", quantity=20, unit="L", expires_on=TODAY + timedelta(days=10))
    r = calculate_readiness(FAMILY, items, today=TODAY)
    assert rows(r)["water"]["have"] == 20
    assert rows(r)["torch"]["have"] == 0
    assert [e["name"] for e in r["expired"]] == ["Old water"]
    assert r["expiring_soon"][0]["days_left"] == 10
    assert [u["name"] for u in r["unavailable"]] == ["Broken torch"]


def test_shortages_recalculate_after_inventory_update(store, hid):
    items = inv(store, hid, name="Water", category="water", quantity=100, unit="L")
    before = {m["key"]: m for m in missing_supplies(calculate_readiness(FAMILY, items, today=TODAY))}
    assert before["water"]["shortfall"] == 470
    items = inv(store, hid, name="More water", category="water", quantity=470, unit="L")
    after = {m["key"]: m for m in missing_supplies(calculate_readiness(FAMILY, items, today=TODAY))}
    assert "water" not in after


def test_missing_supplies_order_and_restock_drafts(store, hid):
    m = missing_supplies(calculate_readiness(FAMILY, [], today=TODAY))
    assert [x["key"] for x in m[:2]] == ["water", "food_kcal"]
    drafts = restock_task_drafts(m)
    water = next(d for d in drafts if d["target_key"] == "water")
    food = next(d for d in drafts if d["target_key"] == "food_kcal")
    assert water["quantity"] == 570 and water["unit"] == "L"
    assert "≈396 meals" in food["title"]  # 264000 / (2000/3)
