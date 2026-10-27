"""Civilisation technology tree: a validated, curated dependency graph (DAG)."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from ..config import DATA_DIR
from ..knowledge.search import entry_ids, get_entry, load_sources, resolve_sources


class TechTreeError(ValueError):
    pass


def validate_tree(tree: dict[str, Any]) -> None:
    nodes = {n["id"]: n for n in tree["nodes"]}
    if len(nodes) != len(tree["nodes"]):
        raise TechTreeError("duplicate node ids")
    sources, kb = load_sources(), entry_ids()
    for n in tree["nodes"]:
        for p in n["prerequisites"]:
            if p not in nodes:
                raise TechTreeError(f"{n['id']}: unknown prerequisite {p}")
        for s in n["sources"]:
            if s not in sources:
                raise TechTreeError(f"{n['id']}: unknown source {s}")
        for k in n.get("knowledge", []):
            if k not in kb:
                raise TechTreeError(f"{n['id']}: unknown knowledge entry {k}")
    # Cycle detection (DFS colouring).
    state: dict[str, int] = {}

    def visit(i: str) -> None:
        if state.get(i) == 1:
            raise TechTreeError(f"cycle through {i}")
        if state.get(i) == 2:
            return
        state[i] = 1
        for p in nodes[i]["prerequisites"]:
            visit(p)
        state[i] = 2

    for i in nodes:
        visit(i)
    for n in tree["nodes"]:
        hands_on = n["safety"]["level"] in {"caution", "professional"} and n["kind"] != "concept"
        if hands_on and n["id"] != "electrical_safety" and "electrical_safety" not in prerequisite_ids(tree, n["id"]):
            raise TechTreeError(f"{n['id']}: hands-on node must depend on electrical_safety")
    if tree.get("goal") and tree["goal"] not in nodes:
        raise TechTreeError("goal node missing")


@lru_cache(maxsize=1)
def load_tree() -> dict[str, Any]:
    tree = json.loads((DATA_DIR / "techtree" / "electricity.json").read_text(encoding="utf-8"))
    validate_tree(tree)
    return tree


def _nodes(tree: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {n["id"]: n for n in tree["nodes"]}


def prerequisite_ids(tree: dict[str, Any], node_id: str) -> list[str]:
    """All transitive prerequisites, in a valid learning order (dependencies first)."""
    nodes = _nodes(tree)
    order: list[str] = []
    seen: set[str] = set()

    def visit(i: str, depth: int = 0) -> None:
        if depth > len(nodes):
            raise TechTreeError("cycle detected")
        for p in nodes[i]["prerequisites"]:
            if p not in seen:
                visit(p, depth + 1)
                seen.add(p)
                order.append(p)

    visit(node_id)
    return order


def unlocks(tree: dict[str, Any], node_id: str) -> list[str]:
    return [n["id"] for n in tree["nodes"] if node_id in n["prerequisites"]]


def material_status(node: dict[str, Any], inventory: list[dict[str, Any]]) -> list[dict[str, Any]]:
    usable = [i for i in inventory if i.get("status") != "unavailable"]
    out = []
    for m in node["materials"]:
        hits = [i for i in usable if any(k in i["name"].lower() for k in m["match"])]
        out.append({"name": m["name"], "have": bool(hits), "matched_items": [h["name"] for h in hits]})
    return out


def node_view(node_id: str, inventory: list[dict[str, Any]] | None = None, learned: set[str] | None = None) -> dict | None:
    tree = load_tree()
    nodes = _nodes(tree)
    n = nodes.get(node_id)
    if n is None:
        return None
    prereqs = prerequisite_ids(tree, node_id)
    view = {
        "id": n["id"], "title": n["title"], "kind": n["kind"], "tier": n["tier"], "summary": n["summary"],
        "why": n["why"], "safety": n["safety"], "goals": n["goals"], "activity": n["activity"],
        "direct_prerequisites": [{"id": p, "title": nodes[p]["title"]} for p in n["prerequisites"]],
        "learning_path": [{"id": p, "title": nodes[p]["title"]} for p in prereqs],
        "unlocks": [{"id": u, "title": nodes[u]["title"]} for u in unlocks(tree, node_id)],
        "sources": resolve_sources(n["sources"]),
        "knowledge": [k for k in (get_entry(k) for k in n.get("knowledge", [])) if k],
        "materials": material_status(n, inventory or []),
    }
    if learned is not None:
        view["learned_prerequisites"] = [p for p in prereqs if p in learned]
    return view


def tree_view() -> dict[str, Any]:
    tree = load_tree()
    return {
        "id": tree["id"], "title": tree["title"], "description": tree["description"], "goal": tree["goal"],
        "nodes": [
            {k: n[k] for k in ("id", "title", "kind", "tier", "summary", "prerequisites")} | {"safety": n["safety"]["level"]}
            for n in tree["nodes"]
        ],
    }
