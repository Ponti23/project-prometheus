import copy

import pytest

from backend.app.rebuild import techtree


def test_tree_loads_and_is_valid():
    tree = techtree.load_tree()
    assert len(tree["nodes"]) >= 10
    assert tree["goal"] == "dc_system"


def test_learning_path_respects_dependencies():
    tree = techtree.load_tree()
    nodes = {n["id"]: n for n in tree["nodes"]}
    path = techtree.prerequisite_ids(tree, "dc_system")
    assert path[0] == "energy_basics"
    assert "electrical_safety" in path
    seen = set()
    for p in path:
        assert set(nodes[p]["prerequisites"]) <= seen
        seen.add(p)


def test_hands_on_nodes_require_electrical_safety():
    tree = techtree.load_tree()
    for n in tree["nodes"]:
        if n["kind"] != "concept" and n["safety"]["level"] != "low" and n["id"] != "electrical_safety":
            assert "electrical_safety" in techtree.prerequisite_ids(tree, n["id"]), n["id"]


def test_cycle_is_rejected():
    tree = copy.deepcopy(techtree.load_tree())
    nodes = {n["id"]: n for n in tree["nodes"]}
    nodes["energy_basics"]["prerequisites"] = ["dc_system"]
    with pytest.raises(techtree.TechTreeError):
        techtree.validate_tree(tree)


def test_unknown_prerequisite_is_rejected():
    tree = copy.deepcopy(techtree.load_tree())
    tree["nodes"][0]["prerequisites"] = ["nope"]
    with pytest.raises(techtree.TechTreeError):
        techtree.validate_tree(tree)


def test_node_view_and_unlocks():
    v = techtree.node_view("ohms_law", [{"name": "Digital multimeter", "status": "ok"}])
    assert {u["id"] for u in v["unlocks"]} >= {"circuits", "batteries", "energy_budget"}
    assert v["materials"][0]["have"] is True
    assert all(s["url"].startswith("https://") for s in v["sources"])
    assert techtree.node_view("nope") is None


def test_materials_dont_match_unrelated_items():
    from backend.app.rebuild.techtree import node_view

    inv = [{"name": "Toilet paper", "status": "ok"}, {"name": "Manual can opener", "status": "ok"}]
    mats = node_view("energy_basics", inv)["materials"]
    assert not any(m["have"] for m in mats)
