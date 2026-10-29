from backend.app import demo
from backend.app.prepare.readiness import calculate_readiness, missing_supplies
from backend.app.prepare.summary import build_summary, stage_days
from backend.app.schemas import InventoryItemIn
from tests.test_api import make_client


def _demo(store, hid):
    demo.load_demo(store, hid)
    return build_summary(store.get_profile(hid), store.list_inventory(hid))


def test_stage_days_are_capped_at_the_goal():
    assert stage_days(30) == [3, 7, 14, 30]
    assert stage_days(14) == [3, 7, 14]
    assert stage_days(7) == [3, 7]
    assert stage_days(3) == [3]


def test_demo_three_day_stage(store, hid):
    s = _demo(store, hid)
    assert [x["days"] for x in s["stages"]] == [3, 7, 14, 30]
    assert s["current"] == 3 and s["stages"][0] == {"days": 3, "label": "3 days", "reached": False, "left": 8}
    short = {n["key"]: n["quantity"] for n in s["next_up"]}
    assert short == {
        "water": 1.5, "can_opener": 1, "sanitation_bags": 15, "documents": 1,
        "torch": 3, "power_bank": 1, "batteries": 2, "hand_hygiene": 1,
    }
    assert s["next_up"][0]["title"] == "1.5 L water"
    assert s["water_days"] == 2.9 and s["food_days"] == 3.9


def test_adding_five_litres_meets_three_day_water(store, hid):
    demo.load_demo(store, hid)
    store.add_item(hid, InventoryItemIn(name="Water", category="water", quantity=5, unit="L", target_key="water"))
    s = build_summary(store.get_profile(hid), store.list_inventory(hid))
    assert s["stages"][0]["left"] == 7
    water = next(c for c in s["categories"] if c["key"] == "water")
    assert water["status"] == "met" and water["targets"][0]["have_text"] == "65 L"


def test_week_stage_food_shortfall_in_days(store, hid):
    demo.load_demo(store, hid)
    week = store.get_profile(hid).model_copy(update={"duration_days": 7})
    food = next(m for m in missing_supplies(calculate_readiness(week, store.list_inventory(hid))) if m["key"] == "food_kcal")
    assert food["shortfall"] == 27400
    # The summary describes it in days for the whole household (daily need 8,800 kcal).
    store.add_item(hid, InventoryItemIn(name="Water", category="water", quantity=100, unit="L", target_key="water"))
    for key, qty in [("can_opener", 1), ("sanitation_bags", 15), ("documents", 1), ("torch", 3), ("power_bank", 1),
                     ("batteries", 2), ("hand_hygiene", 1)]:
        store.add_item(hid, InventoryItemIn(name=key, quantity=qty, unit="each", target_key=key))
    s = build_summary(store.get_profile(hid), store.list_inventory(hid))
    assert s["stages"][0]["reached"] and s["current"] == 7 and s["daily_kcal"] == 8800
    assert next(n for n in s["next_up"] if n["key"] == "food_kcal")["title"] == "Food for 3.1 more days"


def test_human_units_for_categories(store, hid):
    s = _demo(store, hid)
    cats = {c["key"]: c for c in s["categories"]}
    assert cats["water"]["targets"][0]["have_text"] == "60 L" and cats["water"]["days"] == 2.9
    assert cats["food"]["targets"][0]["have_text"] == "about 3.9 days of food"
    assert cats["pet_food"]["days"] == 10
    lights = {t["key"]: t for t in cats["light_power"]["targets"]}
    assert (lights["torch"]["have_text"], lights["torch"]["need_text"]) == ("2 torches", "5 torches")
    assert cats["tools"]["status"] == "missing" and not cats["water"]["goal_met"]


def test_summary_endpoint_and_empty_household():
    c = make_client()
    s = c.get("/api/summary").json()
    # Default profile: 1 adult, 7 days, nothing recorded yet.
    assert [x["days"] for x in s["stages"]] == [3, 7] and s["current"] == 3
    assert all(not x["reached"] for x in s["stages"])
    c.post("/api/household/demo")
    assert c.get("/api/summary").json()["stages"][0]["left"] == 8
