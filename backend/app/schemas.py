"""Typed contracts shared by the API, the store and the agent tools."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Duration = Literal[3, 7, 14, 30]
Mode = Literal["companion", "prepare", "survive", "rebuild", "vault", "settings"]
ItemStatus = Literal["ok", "unavailable"]


class Pet(BaseModel):
    kind: str = Field(min_length=1, max_length=40, description="e.g. dog, cat")
    size: Literal["small", "medium", "large"] = "medium"
    count: int = Field(default=1, ge=1, le=20)


class HouseholdProfile(BaseModel):
    name: str = Field(default="My household", max_length=80)
    adults: int = Field(default=1, ge=0, le=30)
    children: int = Field(default=0, ge=0, le=30)
    pets: list[Pet] = Field(default_factory=list)
    duration_days: Duration = 7
    hot_climate: bool = False
    needs_medication: bool = False
    dietary_restrictions: list[str] = Field(default_factory=list)
    special_requirements: list[str] = Field(default_factory=list)
    location_note: str = Field(default="", max_length=120)

    @property
    def people(self) -> int:
        return self.adults + self.children


class HouseholdProfileUpdate(BaseModel):
    """Partial update. Only provided fields change."""

    name: str | None = Field(default=None, max_length=80)
    adults: int | None = Field(default=None, ge=0, le=30)
    children: int | None = Field(default=None, ge=0, le=30)
    pets: list[Pet] | None = None
    duration_days: Duration | None = None
    hot_climate: bool | None = None
    needs_medication: bool | None = None
    dietary_restrictions: list[str] | None = None
    special_requirements: list[str] | None = None
    location_note: str | None = Field(default=None, max_length=120)


class InventoryItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category: str = Field(default="other", max_length=40)
    quantity: float = Field(ge=0, le=1_000_000)
    unit: str = Field(default="each", min_length=1, max_length=20)
    target_key: str | None = Field(default=None, max_length=40, description="Planning target this item counts toward")
    kcal_per_unit: float | None = Field(default=None, ge=0, le=100_000)
    expires_on: date | None = None
    status: ItemStatus = "ok"
    notes: str = Field(default="", max_length=200)

    @field_validator("unit")
    @classmethod
    def _unit(cls, v: str) -> str:
        return v.strip()


class InventoryItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    category: str | None = Field(default=None, max_length=40)
    quantity: float | None = Field(default=None, ge=0, le=1_000_000)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    target_key: str | None = None
    kcal_per_unit: float | None = Field(default=None, ge=0, le=100_000)
    expires_on: date | None = None
    status: ItemStatus | None = None
    notes: str | None = Field(default=None, max_length=200)


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    detail: str = Field(default="", max_length=400)
    target_key: str | None = None
    quantity: float | None = Field(default=None, ge=0)
    unit: str | None = None


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    detail: str | None = Field(default=None, max_length=400)
    status: Literal["open", "done"] | None = None


class TaskComplete(BaseModel):
    add_to_inventory: bool = False


class MemoryNoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class ContextUpdate(BaseModel):
    mode: Mode | None = None
    topic: str | None = Field(default=None, max_length=60)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    mode: Mode | None = None


class PlanStepPatch(BaseModel):
    done: bool
