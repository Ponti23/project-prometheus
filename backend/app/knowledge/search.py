"""Offline knowledge vault: curated entries + a small BM25 search. No network needed."""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from functools import lru_cache
from typing import Any

from ..config import DATA_DIR

_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on", "with", "how", "what", "do", "we",
    "i", "my", "our", "you", "your", "can", "be", "are", "if", "at", "as", "by", "this", "that", "should",
}


def tokenize(text: str) -> list[str]:
    toks = [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]
    # Light stemming so "batteries" matches "battery", "outages" matches "outage".
    out = []
    for t in toks:
        if len(t) > 4 and t.endswith("ies"):
            t = t[:-3] + "y"
        elif len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        out.append(t)
    return out


@lru_cache(maxsize=1)
def load_sources() -> dict[str, dict[str, Any]]:
    data = json.loads((DATA_DIR / "sources.json").read_text(encoding="utf-8"))
    return {s["id"]: s for s in data["sources"]}


@lru_cache(maxsize=1)
def load_entries() -> list[dict[str, Any]]:
    return json.loads((DATA_DIR / "knowledge.json").read_text(encoding="utf-8"))["entries"]


def _doc_text(e: dict[str, Any]) -> str:
    # Title and tags are weighted by repetition.
    return " ".join([e["title"]] * 3 + e.get("tags", []) * 2 + [e["summary"]] + e["points"] + [e["topic"]])


@lru_cache(maxsize=1)
def _index() -> tuple[list[Counter], dict[str, int], float]:
    docs = [Counter(tokenize(_doc_text(e))) for e in load_entries()]
    df: Counter = Counter()
    for d in docs:
        df.update(d.keys())
    avg = sum(sum(d.values()) for d in docs) / max(len(docs), 1)
    return docs, dict(df), avg


def resolve_sources(ids: list[str]) -> list[dict[str, Any]]:
    src = load_sources()
    return [
        {"id": i, "title": src[i]["title"], "publisher": src[i]["publisher"], "url": src[i]["url"]}
        for i in ids
        if i in src
    ]


def entry_view(e: dict[str, Any], full: bool = True) -> dict[str, Any]:
    v = {
        "id": e["id"], "topic": e["topic"], "title": e["title"], "summary": e["summary"],
        "safety": e["safety"], "sources": resolve_sources(e["sources"]),
    }
    if full:
        v["points"] = e["points"]
        v["tags"] = e.get("tags", [])
    return v


def search(query: str, limit: int = 4, topic: str | None = None) -> list[dict[str, Any]]:
    entries = load_entries()
    docs, df, avg = _index()
    q = tokenize(query)
    n = len(docs)
    k1, b = 1.4, 0.75
    scored = []
    for i, (e, d) in enumerate(zip(entries, docs)):
        if topic and e["topic"] != topic:
            continue
        length = sum(d.values())
        score = 0.0
        for t in q:
            if t not in d:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            tf = d[t]
            score += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * length / avg))
        if score > 0:
            scored.append((score, i))
    scored.sort(reverse=True)
    return [{**entry_view(entries[i]), "score": round(s, 3)} for s, i in scored[:limit]]


def get_entry(entry_id: str) -> dict[str, Any] | None:
    for e in load_entries():
        if e["id"] == entry_id:
            return entry_view(e)
    return None


def entry_ids() -> set[str]:
    return {e["id"] for e in load_entries()}


def topics() -> list[str]:
    return sorted({e["topic"] for e in load_entries()})
