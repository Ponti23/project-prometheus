"""Synthetic demo household for judges and the demo video (no real personal data)."""

from __future__ import annotations

from datetime import date, timedelta

from .db import Store
from .schemas import HouseholdProfile, InventoryItemIn, Pet


def load_demo(store: Store, hid: str) -> None:
    store.reset_household(hid)
    store.save_profile(
        hid,
        HouseholdProfile(
            name="The Rivera household (demo)",
            adults=2,
            children=3,
            pets=[Pet(kind="dog", size="medium", count=1)],
            duration_days=30,
            hot_climate=False,
            needs_medication=True,
            dietary_restrictions=["one child: peanut allergy"],
            special_requirements=["one adult takes daily blood-pressure medication"],
            location_note="Perth, WA (synthetic demo data)",
        ),
    )
    today = date.today()
    items = [
        InventoryItemIn(name="Bottled water (10 L casks)", category="water", quantity=60, unit="L", target_key="water",
                        expires_on=today + timedelta(days=300)),
        InventoryItemIn(name="Canned beef stew", category="food", quantity=24, unit="cans", target_key="food_kcal",
                        kcal_per_unit=450, expires_on=today + timedelta(days=500)),
        InventoryItemIn(name="White rice", category="food", quantity=5, unit="kg", target_key="food_kcal",
                        kcal_per_unit=3600, expires_on=today + timedelta(days=700)),
        InventoryItemIn(name="Muesli bars", category="food", quantity=30, unit="bars", target_key="food_kcal",
                        kcal_per_unit=180, expires_on=today + timedelta(days=18)),
        InventoryItemIn(name="Canned beans", category="food", quantity=12, unit="cans", notes="kcal not recorded yet"),
        InventoryItemIn(name="Dog food", category="food", quantity=10, unit="pet-days", target_key="pet_food"),
        InventoryItemIn(name="Blood-pressure medication", category="medical", quantity=12, unit="days",
                        target_key="medication_days", expires_on=today + timedelta(days=200)),
        InventoryItemIn(name="First aid kit", category="medical", quantity=1, unit="each", target_key="first_aid_kit"),
        InventoryItemIn(name="LED torch", category="lighting", quantity=2, unit="each", target_key="torch"),
        InventoryItemIn(name="Old torch (broken switch)", category="lighting", quantity=1, unit="each",
                        target_key="torch", status="unavailable"),
        InventoryItemIn(name="AA batteries", category="power", quantity=3, unit="sets", target_key="batteries"),
        InventoryItemIn(name="Wind-up radio", category="communication", quantity=1, unit="each", target_key="radio"),
        InventoryItemIn(name="Phone power bank (20,000 mAh)", category="power", quantity=1, unit="each",
                        target_key="power_bank"),
        InventoryItemIn(name="Toilet paper", category="hygiene", quantity=12, unit="rolls", target_key="toilet_paper"),
        InventoryItemIn(name="Hand soap", category="hygiene", quantity=4, unit="each", target_key="hand_hygiene"),
        InventoryItemIn(name="Small solar charger (USB)", category="power", quantity=1, unit="each"),
        InventoryItemIn(name="Notebook and pencils", category="tools", quantity=1, unit="each"),
    ]
    for it in items:
        store.add_item(hid, it)
    store.add_note(hid, "Prefers Australian sources and metric units.", status="confirmed", source="user")
