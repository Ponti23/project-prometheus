"""Tools the companion can call. Every tool operates on real, persisted application state.

Three kinds:
  read     — runs automatically, never changes state.
  propose  — validates arguments and creates a *pending action*. Nothing changes until the user
             clicks Approve, which calls execute_action() below.
  note     — saves a memory note marked "suggested" (never "confirmed") for the user to review.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

from ..config import Settings, get_settings
from ..db import Store
from ..knowledge import search as kb
from ..knowledge import web
from ..prepare.calculator import load_assumptions, target_keys
from ..prepare.readiness import calculate_readiness, missing_supplies, restock_task_drafts
from ..prepare.summary import CATEGORIES, card_for, num_key
from ..rebuild import techtree
from ..schemas import HouseholdProfile, HouseholdProfileUpdate, InventoryItemIn, InventoryItemPatch, TaskIn
from ..survive.scenarios import PRIORITIES, load_scenarios, scenario_guide

ToolKind = Literal["read", "propose", "note"]


@dataclass
class ToolContext:
    store: Store
    hid: str
    ui_hints: list[dict[str, Any]]


@dataclass
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    kind: ToolKind
    handler: Callable[[ToolContext, Any], dict[str, Any]]

    def spec(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": inline_schema(self.args)},
        }


def inline_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON schema with $refs inlined and titles removed (friendlier to OpenAI-compatible tool parsers)."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(copy.deepcopy(defs[node["$ref"].split("/")[-1]]))
            return {k: walk(v) for k, v in node.items() if k != "title"}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    out = walk(schema)
    out.setdefault("properties", {})
    out["type"] = "object"
    return out


# ---------------------------------------------------------------- argument models
class NoArgs(BaseModel):
    pass


class InventoryQuery(BaseModel):
    category: str | None = Field(default=None, description="Optional category filter, e.g. water, food, lighting")


class KnowledgeQuery(BaseModel):
    query: str = Field(min_length=2, max_length=200, description="What to look up, in plain words")
    topic: str | None = Field(
        default=None,
        description="Optional topic filter: communication, energy, first-aid, food, preparedness, science, shelter or water",
    )


class WebQuery(BaseModel):
    query: str = Field(min_length=2, max_length=200, description="What to look up, in plain words")


class ScenarioQuery(BaseModel):
    scenario: Literal["blackout", "supply_disruption", "isolation", "zombie"]


class NodeQuery(BaseModel):
    node_id: str = Field(description="Technology tree node id, e.g. energy_basics, solar_pv, batteries")


class AddInventoryArgs(InventoryItemIn):
    target_key: str | None = Field(
        default=None, description="Planning target this counts toward: " + ", ".join(target_keys())
    )

    @field_validator("target_key")
    @classmethod
    def _known_key(cls, v: str | None) -> str | None:
        if v is not None and v not in target_keys():
            raise ValueError(f"unknown target_key; use one of {target_keys()}")
        return v


class UpdateInventoryArgs(BaseModel):
    item_id: int
    changes: InventoryItemPatch


class RestockArgs(BaseModel):
    target_keys: list[str] | None = Field(
        default=None, description="Optional subset of shortfall target keys to include; omit for all shortfalls"
    )


class PlanStepArg(BaseModel):
    text: str = Field(min_length=3, max_length=300)
    priority: Literal["immediate", "today", "ongoing"]
    knowledge_refs: list[str] = Field(default_factory=list, description="Knowledge vault entry ids that support this step")

    @field_validator("knowledge_refs")
    @classmethod
    def _refs_exist(cls, v: list[str]) -> list[str]:
        unknown = [r for r in v if r not in kb.entry_ids()]
        if unknown:
            raise ValueError(f"unknown knowledge ids {unknown}; only cite ids returned by search_knowledge/get_scenario_guide")
        return v


class SurvivalPlanArgs(BaseModel):
    scenario: Literal["blackout", "supply_disruption", "isolation", "zombie"]
    title: str = Field(min_length=3, max_length=100)
    summary: str = Field(default="", max_length=600)
    steps: list[PlanStepArg] = Field(min_length=3, max_length=15)


CARD_TYPES = Literal[
    "stages", "next", "household", "category", "expiring", "scenario", "plan", "path", "lesson", "guide", "search", "memory",
]


class ShowCardArgs(BaseModel):
    card: CARD_TYPES = Field(description="stages (ready in stages), next (shopping list), household, category (one supply "
                                         "area), expiring, scenario, plan, path (learning path), lesson, guide, search, memory")
    key: str | None = Field(default=None, max_length=120, description="category: " + ", ".join(c for c, _, _ in CATEGORIES)
                            + "; scenario/plan: a scenario id; lesson: a node id; guide: a knowledge id; search: the query")


class NoteArgs(BaseModel):
    text: str = Field(min_length=3, max_length=300, description="A fact the user stated that is worth remembering")


# ---------------------------------------------------------------- canvas hints
# Simple mode shows a card for what each tool reads or proposes. Hints are derived here, never from model text.
# priority: 2 = a change is waiting on this card, 1 = this is what the turn was about, 0 = background reading.
# The "open" key (and node/scenario) is what Advanced mode already reads, so it is only set where it was before.
def _card(ctx: ToolContext, kind: str, key: str | None = None, *, priority: int = 1, focus: str | None = None,
          action_id: str | None = None, **extra: Any) -> None:
    hint: dict[str, Any] = {**extra, "card": {"type": kind, "key": key}, "priority": priority}
    if focus:
        hint["focus"] = focus
    if action_id:
        hint["action_id"] = action_id
    ctx.ui_hints.append(hint)


# ---------------------------------------------------------------- read handlers
def _get_profile(ctx: ToolContext, _: NoArgs) -> dict[str, Any]:
    _card(ctx, "household", priority=0)
    h = ctx.store.get_household(ctx.hid)
    return {
        "profile": h["profile"].model_dump(),
        "profile_confirmed_by_user": h["profile_confirmed"],
        "memory_notes": [
            {"id": n["id"], "text": n["text"], "status": n["status"], "source": n["source"]}
            for n in ctx.store.list_notes(ctx.hid)
        ],
        "current_mode": h["current_mode"],
        "current_topic": h["current_topic"],
    }


def _get_inventory(ctx: ToolContext, a: InventoryQuery) -> dict[str, Any]:
    items = ctx.store.list_inventory(ctx.hid)
    if a.category:
        items = [i for i in items if i["category"].lower() == a.category.lower()]
        if card_for(category=a.category):
            _card(ctx, "category", card_for(category=a.category))
    keep = ("id", "name", "category", "quantity", "unit", "target_key", "kcal_per_unit", "expires_on", "status", "notes")
    return {"count": len(items), "items": [{k: i[k] for k in keep} for i in items]}


def _readiness(ctx: ToolContext) -> dict[str, Any]:
    return calculate_readiness(ctx.store.get_profile(ctx.hid), ctx.store.list_inventory(ctx.hid))


def _calc_readiness(ctx: ToolContext, _: NoArgs) -> dict[str, Any]:
    r = _readiness(ctx)
    _card(ctx, "stages", priority=0, open="prepare")
    keep = ("key", "label", "quantity", "have", "unit", "coverage", "status", "working", "basis", "source")
    return {
        **{k: r[k] for k in ("household", "overall_coverage", "coverage_label", "supply_days", "disclaimer")},
        "targets": [{k: t[k] for k in keep} for t in r["targets"]],
        "expired": r["expired"], "expiring_soon": r["expiring_soon"], "unavailable": r["unavailable"],
        "not_counted": r["not_counted"],
        "food_assumptions": load_assumptions()["food"],
    }


def _missing(ctx: ToolContext, _: NoArgs) -> dict[str, Any]:
    _card(ctx, "next")
    r = _readiness(ctx)
    return {"missing": missing_supplies(r), "expired": r["expired"], "expiring_soon": r["expiring_soon"]}


def _search_knowledge(ctx: ToolContext, a: KnowledgeQuery) -> dict[str, Any]:
    # An unknown topic (e.g. a scenario id like "blackout") would filter out everything, so ignore it.
    topic = a.topic if a.topic in kb.topics() else None
    results = kb.search(a.query, limit=4, topic=topic)
    if results:
        _card(ctx, "search", priority=0, filter=a.query)
    return {
        "results": results,
        "citation_rule": "Cite only these sources, using their exact title and url.",
        "note": None if results else "No matching entries in the offline vault. Say so rather than guessing.",
    }


def _web_search(ctx: ToolContext, a: WebQuery) -> dict[str, Any]:
    key = get_settings().tavily_api_key
    if not key:
        return {"ok": False, "error": "web search is not configured"}
    try:
        results = web.search(a.query, key)
    except web.WebSearchUnavailable as e:
        return {"ok": False, "error": str(e), "note": "Say web search is unavailable right now; use the offline vault."}
    return {
        "results": results,
        "citation_rule": "These pages are from the trusted source sites only. Cite only these, using their exact title and url. "
                         "They are not vault entries, so never use them as knowledge_refs in a survival plan.",
        "note": None if results else "No matching pages on the trusted source sites. Say so rather than guessing.",
    }


def _scenario_guide(ctx: ToolContext, a: ScenarioQuery) -> dict[str, Any]:
    ctx.store.set_context(ctx.hid, mode="survive")
    _card(ctx, "scenario", a.scenario, open="survive", scenario=a.scenario)
    return scenario_guide(a.scenario, ctx.store.get_profile(ctx.hid), ctx.store.list_inventory(ctx.hid))


def _tech_node(ctx: ToolContext, a: NodeQuery) -> dict[str, Any]:
    view = techtree.node_view(a.node_id, ctx.store.list_inventory(ctx.hid))
    if view is None:
        return {"ok": False, "error": f"unknown node_id; valid ids: {[n['id'] for n in techtree.load_tree()['nodes']]}"}
    ctx.store.set_context(ctx.hid, mode="rebuild", topic=a.node_id)
    _card(ctx, "lesson", a.node_id, open="rebuild", node=a.node_id)
    return view


def _prerequisites(ctx: ToolContext, a: NodeQuery) -> dict[str, Any]:
    tree = techtree.load_tree()
    nodes = {n["id"]: n for n in tree["nodes"]}
    if a.node_id not in nodes:
        return {"ok": False, "error": f"unknown node_id; valid ids: {list(nodes)}"}
    path = techtree.prerequisite_ids(tree, a.node_id)
    _card(ctx, "path", filter=a.node_id)
    return {
        "node": {"id": a.node_id, "title": nodes[a.node_id]["title"]},
        "learning_path_in_order": [
            {"id": p, "title": nodes[p]["title"], "safety": nodes[p]["safety"]["level"]} for p in path
        ],
        "tree_overview": [{"id": n["id"], "title": n["title"], "prerequisites": n["prerequisites"]} for n in tree["nodes"]],
    }


def _get_tasks(ctx: ToolContext, _: NoArgs) -> dict[str, Any]:
    plans = ctx.store.list_plans(ctx.hid)
    if plans:
        _card(ctx, "plan", plans[0]["scenario"], priority=0)
    else:
        _card(ctx, "next", priority=0)
    return {
        "tasks": ctx.store.list_tasks(ctx.hid),
        "plans": [
            {"id": p["id"], "title": p["title"], "scenario": p["scenario"], "fictional": p["fictional"],
             "steps_done": sum(s.get("done", False) for s in p["steps"]), "steps_total": len(p["steps"])}
            for p in plans
        ],
    }


# ---------------------------------------------------------------- propose handlers
def _open_task_keys(store: Store, hid: str) -> set[str]:
    return {t["target_key"] for t in store.list_tasks(hid) if t["status"] == "open" and t["target_key"]}


def _pending(ctx: ToolContext, kind: str, payload: dict[str, Any], summary: str) -> dict[str, Any]:
    action = ctx.store.create_action(ctx.hid, kind, payload, summary)
    return {
        "status": "awaiting_user_approval",
        "action_id": action["id"],
        "summary": summary,
        "instruction": "Nothing has changed yet. Tell the user you have drafted this and that it is saved only when they "
                       "approve it in the app.",
    }


def _update_profile(ctx: ToolContext, a: HouseholdProfileUpdate) -> dict[str, Any]:
    changes = a.model_dump(exclude_none=True)
    if not changes:
        return {"ok": False, "error": "no changes provided"}
    summary = "Update household profile: " + ", ".join(f"{k} → {v}" for k, v in changes.items())
    result = _pending(ctx, "update_profile", changes, summary)
    focus = "household.people" if {"adults", "children"} & changes.keys() else "household.goal" if "duration_days" in changes else None
    _card(ctx, "household", priority=2, focus=focus, action_id=result["action_id"])
    return result


def _add_item(ctx: ToolContext, a: AddInventoryArgs) -> dict[str, Any]:
    item = a.model_dump(mode="json")
    summary = f"Add to inventory: {a.quantity:g} {a.unit} {a.name} ({a.category})"
    result = _pending(ctx, "add_inventory", item, summary)
    key = card_for(a.target_key, a.category)
    if key:
        _card(ctx, "category", key, priority=2, focus=num_key(a.target_key), action_id=result["action_id"])
    return result


def _update_item(ctx: ToolContext, a: UpdateInventoryArgs) -> dict[str, Any]:
    item = ctx.store.get_item(ctx.hid, a.item_id)
    if item is None:
        return {"ok": False, "error": f"no inventory item with id {a.item_id}; call get_inventory first"}
    changes = a.changes.model_dump(mode="json", exclude_none=True)
    if not changes:
        return {"ok": False, "error": "no changes provided"}
    summary = f"Update '{item['name']}': " + ", ".join(f"{k} → {v}" for k, v in changes.items())
    result = _pending(ctx, "update_inventory", {"item_id": a.item_id, "changes": changes}, summary)
    target = changes.get("target_key") or item["target_key"]
    key = card_for(target, changes.get("category") or item["category"])
    if key:
        _card(ctx, "category", key, priority=2, focus=num_key(target), action_id=result["action_id"], item=a.item_id)
    return result


def _propose_restock(ctx: ToolContext, a: RestockArgs) -> dict[str, Any]:
    missing = missing_supplies(_readiness(ctx))
    if a.target_keys:
        missing = [m for m in missing if m["key"] in set(a.target_keys)]
    if not missing:
        return {"ok": True, "status": "nothing_to_propose", "note": "All planning targets are met (or none selected)."}
    # Don't propose the same shortfall twice: skip keys with an open task or an unanswered restock proposal.
    covered = _open_task_keys(ctx.store, ctx.hid)
    pending = [x for x in ctx.store.list_actions(ctx.hid, status="pending") if x["kind"] == "save_approved_tasks"]
    for x in pending:
        covered |= {t.get("target_key") for t in x["payload"]["tasks"]}
    missing = [m for m in missing if m["key"] not in covered]
    if not missing:
        return {
            "ok": True,
            "status": "already_proposed",
            "pending_action_ids": [x["id"] for x in pending],
            "note": "Every shortfall already has an open task or a proposal awaiting approval. Point the user to those "
                    "instead of proposing again.",
        }
    drafts = restock_task_drafts(missing)
    result = _pending(ctx, "save_approved_tasks", {"tasks": drafts}, f"Save {len(drafts)} restock tasks to your checklist")
    result["proposed_tasks"] = drafts
    _card(ctx, "next", priority=2, action_id=result["action_id"])
    return result


def _create_plan(ctx: ToolContext, a: SurvivalPlanArgs) -> dict[str, Any]:
    fictional = load_scenarios()[a.scenario]["fictional"]
    payload = a.model_dump()
    payload["fictional"] = fictional
    label = " (FICTIONAL SIMULATION)" if fictional else ""
    result = _pending(ctx, "create_plan", payload, f"Save survival plan '{a.title}'{label} with {len(a.steps)} steps")
    _card(ctx, "plan", a.scenario, priority=2, action_id=result["action_id"])
    return result


def _show_card(ctx: ToolContext, a: ShowCardArgs) -> dict[str, Any]:
    valid = {
        "category": {c for c, _, _ in CATEGORIES}, "scenario": set(load_scenarios()), "plan": set(load_scenarios()),
        "lesson": {n["id"] for n in techtree.load_tree()["nodes"]}, "guide": kb.entry_ids(),
    }
    if a.card in valid and a.key not in valid[a.card]:
        return {"ok": False, "error": f"unknown key for {a.card}; use one of {sorted(valid[a.card])}"}
    if a.card == "search":
        _card(ctx, "search", filter=a.key or "")
    else:
        _card(ctx, a.card, a.key if a.card in valid else None)
    return {"shown": a.card, "key": a.key, "note": "The card is on the user's screen now. Refer to it in a few words."}


def _remember(ctx: ToolContext, a: NoteArgs) -> dict[str, Any]:
    note = ctx.store.add_note(ctx.hid, a.text, status="suggested", source="prometheus")
    _card(ctx, "memory")
    return {
        "saved_as": "suggested",
        "note_id": note["id"],
        "instruction": "This is stored as a SUGGESTED memory. The user can confirm, edit or delete it in Settings → Memory.",
    }


TOOLS: list[Tool] = [
    Tool("get_household_profile", "Get the household profile (people, pets, plan duration, needs), memory notes and current app context.", NoArgs, "read", _get_profile),
    Tool("get_inventory", "List the household's recorded supplies and equipment.", InventoryQuery, "read", _get_inventory),
    Tool("calculate_readiness", "Deterministically compute planning targets for this household and compare them with inventory. Returns coverage of planning targets (not survival probability).", NoArgs, "read", _calc_readiness),
    Tool("get_missing_supplies", "List planning targets that are not yet met, with exact shortfalls, plus expired/expiring items.", NoArgs, "read", _missing),
    Tool("search_knowledge", "Search the offline, source-attributed knowledge vault (preparedness, water, food, shelter, first aid, energy, science).", KnowledgeQuery, "read", _search_knowledge),
    Tool("web_search", "Search the live websites of the trusted publishers in the source registry (Ready.gov, Red Cross, CDC, Emergency WA and others) for current or more detailed guidance than the offline vault has. Use search_knowledge first.", WebQuery, "read", _web_search),
    Tool("get_scenario_guide", "Get triage questions, guideline steps, relevant knowledge and this household's resource situation for an emergency scenario. 'zombie' is a FICTIONAL simulation.", ScenarioQuery, "read", _scenario_guide),
    Tool("get_technology_node", "Open a node in the electricity technology tree: what it is, why it matters, prerequisites, materials the household has or lacks, safety level and sources. Also shows it to the user.", NodeQuery, "read", _tech_node),
    Tool("get_prerequisites", "Get the ordered learning path of prerequisites for a technology tree node.", NodeQuery, "read", _prerequisites),
    Tool("get_tasks_and_plans", "List saved tasks and survival plans with progress.", NoArgs, "read", _get_tasks),
    Tool("show_card", "Show a card in the app (e.g. the household, one supply area, a lesson or a guide) when the user asks to see something and no other tool already shows it.", ShowCardArgs, "read", _show_card),
    Tool("update_household_profile", "PROPOSE a change to the household profile. Requires user approval. Only propose values the user actually stated.", HouseholdProfileUpdate, "propose", _update_profile),
    Tool("add_inventory_item", "PROPOSE adding an item to inventory. Requires user approval. Include kcal_per_unit for food when known.", AddInventoryArgs, "propose", _add_item),
    Tool("update_inventory_item", "PROPOSE changing an existing inventory item (quantity, status working/unavailable, expiry...). Requires user approval.", UpdateInventoryArgs, "propose", _update_item),
    Tool("propose_restock_tasks", "PROPOSE restock tasks computed from current shortfalls (quantities are calculated, not guessed). The user approves before they are saved (save_approved_tasks).", RestockArgs, "propose", _propose_restock),
    Tool("create_survival_plan", "PROPOSE saving a prioritised survival plan. Every step's knowledge_refs must be ids returned by get_scenario_guide or search_knowledge. Requires user approval.", SurvivalPlanArgs, "propose", _create_plan),
    Tool("remember_note", "Save something the user told you as a SUGGESTED memory note (the user confirms it later). Never use for guesses.", NoteArgs, "note", _remember),
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


def tool_specs(settings: Settings | None = None) -> list[dict[str, Any]]:
    settings = settings or get_settings()
    return [t.spec() for t in TOOLS if t.name != "web_search" or settings.web_search_configured]


def run_tool(store: Store, hid: str, name: str, raw_args: dict[str, Any], ui_hints: list | None = None) -> tuple[dict, bool, str]:
    """Validate and execute a tool. Returns (result, ok, effect). Never raises for bad model input."""
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return {"ok": False, "error": f"unknown tool {name}"}, False, "none"
    try:
        args = tool.args.model_validate(raw_args or {})
    except ValidationError as e:
        errs = [{"field": ".".join(str(p) for p in err["loc"]), "error": err["msg"]} for err in e.errors()]
        return {"ok": False, "error": "invalid arguments", "details": errs}, False, "none"
    ctx = ToolContext(store, hid, ui_hints if ui_hints is not None else [])
    result = tool.handler(ctx, args)
    ok = result.get("ok", True) is not False
    effect = {"read": "none", "propose": "pending_action", "note": "suggested_memory"}[tool.kind] if ok else "none"
    if name == "propose_restock_tasks" and result.get("status") in {"nothing_to_propose", "already_proposed"}:
        effect = "none"
    return result, ok, effect


# ---------------------------------------------------------------- approval executors
class ActionError(Exception):
    pass


def execute_action(store: Store, hid: str, action: dict[str, Any]) -> dict[str, Any]:
    """Apply an approved pending action. This is the ONLY path by which agent proposals change state."""
    kind, p = action["kind"], action["payload"]
    if kind == "update_profile":
        current = store.get_profile(hid).model_dump()
        current.update(HouseholdProfileUpdate.model_validate(p).model_dump(exclude_none=True))
        profile = store.save_profile(hid, HouseholdProfile.model_validate(current))
        return {"profile": profile.model_dump()}
    if kind == "add_inventory":
        item = store.add_item(hid, InventoryItemIn.model_validate(p))
        return {"item": item}
    if kind == "update_inventory":
        if store.get_item(hid, p["item_id"]) is None:
            raise ActionError("item no longer exists")
        changes = InventoryItemPatch.model_validate(p["changes"]).model_dump(exclude_none=True)
        return {"item": store.update_item(hid, p["item_id"], changes)}
    if kind == "save_approved_tasks":
        # Approving an older, overlapping proposal must not duplicate tasks that are already open.
        open_keys = _open_task_keys(store, hid)
        saved = [
            store.add_task(hid, TaskIn.model_validate(t), source="prometheus")
            for t in p["tasks"]
            if not t.get("target_key") or t["target_key"] not in open_keys
        ]
        return {"tasks": saved}
    if kind == "create_plan":
        steps = [{**s, "done": False} for s in ensure_priority_order(p["steps"])]
        plan = store.add_plan(hid, p["scenario"], p["title"], p["fictional"], p.get("summary", ""), steps)
        return {"plan": plan}
    raise ActionError(f"unknown action kind {kind}")


def simulate_action(profile: HouseholdProfile, inventory: list[dict[str, Any]], action: dict[str, Any]) -> tuple[HouseholdProfile, list[dict[str, Any]]]:
    """Apply a pending action to copies of the profile and inventory, for a preview. Nothing is saved."""
    kind, p = action["kind"], action["payload"]
    inventory = [dict(i) for i in inventory]
    if kind == "update_profile":
        current = profile.model_dump()
        current.update(HouseholdProfileUpdate.model_validate(p).model_dump(exclude_none=True))
        profile = HouseholdProfile.model_validate(current)
    elif kind == "add_inventory":
        item = InventoryItemIn.model_validate(p).model_dump(mode="json")
        inventory.append({**item, "id": -1 - len(inventory)})
    elif kind == "update_inventory":
        changes = InventoryItemPatch.model_validate(p["changes"]).model_dump(mode="json", exclude_none=True)
        for i in inventory:
            if i["id"] == p["item_id"]:
                i.update(changes)
    return profile, inventory


# ---------------------------------------------------------------- undo and Auto mode
def snapshot(store: Store, hid: str, action: dict[str, Any]) -> dict[str, Any]:
    """What an action is about to overwrite, stored before it's applied so it can be undone."""
    if action["kind"] == "update_profile":
        h = store.get_household(hid)
        return {"profile": h["profile"].model_dump(), "confirmed": h["profile_confirmed"]}
    if action["kind"] == "update_inventory":
        return {"item": store.get_item(hid, action["payload"]["item_id"])}
    return {}


ITEM_FIELDS = ("name", "category", "quantity", "unit", "target_key", "kcal_per_unit", "expires_on", "status", "notes")


def undo_action(store: Store, hid: str, action: dict[str, Any]) -> None:
    kind, before, result = action["kind"], action.get("before") or {}, action.get("result") or {}
    if kind == "update_profile":
        store.save_profile(hid, HouseholdProfile.model_validate(before["profile"]), confirmed=before["confirmed"])
    elif kind == "add_inventory":
        store.delete_item(hid, result["item"]["id"])
    elif kind == "update_inventory":
        old = before["item"]
        if store.get_item(hid, old["id"]) is None:
            raise ActionError("item no longer exists")
        store.update_item(hid, old["id"], {k: old[k] for k in ITEM_FIELDS})
    elif kind == "save_approved_tasks":
        for t in result.get("tasks", []):
            store.delete_task(hid, t["id"])
    elif kind == "create_plan":
        store.delete_plan(hid, result["plan"]["id"])
    else:
        raise ActionError(f"can't undo {kind}")


# Auto mode saves only small, undoable supply changes, and only when it didn't have to guess a number.
AUTO_KINDS = {"add_inventory", "update_inventory", "save_approved_tasks"}
AUTO_FIELDS = {"quantity", "status", "expires_on", "kcal_per_unit", "notes"}
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def numbers_in(text: str) -> set[float]:
    text = re.sub(r"(?<=\d),(?=\d{3}\b)", "", text)  # 20,000 → 20000; 1,5 stays a decimal
    return {float(n.replace(",", ".")) for n in _NUMBER.findall(text)}


def auto_blocker(store: Store, hid: str, action: dict[str, Any], user_text: str) -> str | None:
    """None if Auto mode may save this straight away, else the reason it must ask."""
    kind, p = action["kind"], action["payload"]
    if kind not in AUTO_KINDS:
        return "household and plan changes always ask first"
    said = numbers_in(user_text)
    if kind == "add_inventory":
        if float(p["quantity"]) not in said:
            return "the amount isn't in the user's message"
        if p.get("kcal_per_unit") and float(p["kcal_per_unit"]) not in said:
            return "the kcal isn't in the user's message"
    if kind == "update_inventory":
        ch = p["changes"]
        if set(ch) - AUTO_FIELDS:
            return "renaming or re-linking an item asks first"
        if "quantity" in ch:
            old = float((store.get_item(hid, p["item_id"]) or {}).get("quantity", 0))
            new = float(ch["quantity"])
            if not {new, round(abs(new - old), 6)} & said:
                return "the amount isn't in the user's message"
        if ch.get("kcal_per_unit") and float(ch["kcal_per_unit"]) not in said:
            return "the kcal isn't in the user's message"
    return None


EDITED = " (edited by you)"


def edit_action(action: dict[str, Any], changes: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """The user changes a proposal before saving it. Re-validated with the same models as the tool arguments."""
    kind, p = action["kind"], copy.deepcopy(action["payload"])
    summary = action["summary"].removesuffix(EDITED)
    if kind == "add_inventory":
        p.update(changes)
        a = AddInventoryArgs.model_validate(p)
        p = a.model_dump(mode="json")
        summary = f"Add to inventory: {a.quantity:g} {a.unit} {a.name} ({a.category})"
    elif kind == "update_inventory":
        p["changes"] = InventoryItemPatch.model_validate({**p["changes"], **changes}).model_dump(mode="json", exclude_none=True)
        summary = summary.split(":")[0] + ": " + ", ".join(f"{k} → {v}" for k, v in p["changes"].items())
    elif kind == "update_profile":
        p = HouseholdProfileUpdate.model_validate({**p, **changes}).model_dump(exclude_none=True)
        summary = "Update household profile: " + ", ".join(f"{k} → {v}" for k, v in p.items())
    else:
        raise ActionError(f"{kind} proposals can't be edited")
    return p, summary + EDITED


def ensure_priority_order(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(steps, key=lambda s: PRIORITIES.index(s["priority"]))
