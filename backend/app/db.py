"""SQLite persistence. One file, one household per browser, no external database."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .schemas import HouseholdProfile, InventoryItemIn, TaskIn

SCHEMA = """
CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    profile_confirmed INTEGER NOT NULL DEFAULT 0,
    current_mode TEXT NOT NULL DEFAULT 'companion',
    current_topic TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'suggested')),
    source TEXT NOT NULL CHECK (source IN ('user', 'prometheus')),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL,
    target_key TEXT,
    kcal_per_unit REAL,
    expires_on TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    target_key TEXT,
    quantity REAL,
    unit TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    source TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS pending_actions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    tool_calls_json TEXT,
    tool_call_id TEXT,
    name TEXT,
    meta_json TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    scenario TEXT NOT NULL,
    title TEXT NOT NULL,
    fictional INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    steps_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    args_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    ok INTEGER NOT NULL,
    effect TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
    day TEXT NOT NULL,
    household_id TEXT NOT NULL,
    turns INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, household_id)
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(r) if r is not None else None


class Store:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._memory_conn: sqlite3.Connection | None = None
        with self.conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        if self.path == ":memory:":
            if self._memory_conn is None:
                self._memory_conn = sqlite3.connect(":memory:", check_same_thread=False)
                self._memory_conn.row_factory = sqlite3.Row
            yield self._memory_conn
            self._memory_conn.commit()
            return
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()

    # ---------- households ----------
    def create_household(self) -> str:
        hid = uuid.uuid4().hex
        ts = now()
        with self.conn() as c:
            c.execute(
                "INSERT INTO households (id, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (hid, HouseholdProfile().model_dump_json(), ts, ts),
            )
        return hid

    def household_exists(self, hid: str) -> bool:
        with self.conn() as c:
            return c.execute("SELECT 1 FROM households WHERE id = ?", (hid,)).fetchone() is not None

    def get_household(self, hid: str) -> dict[str, Any]:
        with self.conn() as c:
            r = _row(c.execute("SELECT * FROM households WHERE id = ?", (hid,)).fetchone())
        if r is None:
            raise KeyError(hid)
        r["profile"] = HouseholdProfile.model_validate_json(r.pop("profile_json"))
        r["profile_confirmed"] = bool(r["profile_confirmed"])
        return r

    def get_profile(self, hid: str) -> HouseholdProfile:
        return self.get_household(hid)["profile"]

    def save_profile(self, hid: str, profile: HouseholdProfile) -> HouseholdProfile:
        with self.conn() as c:
            c.execute(
                "UPDATE households SET profile_json = ?, profile_confirmed = 1, updated_at = ? WHERE id = ?",
                (profile.model_dump_json(), now(), hid),
            )
        return profile

    def set_context(self, hid: str, mode: str | None = None, topic: str | None = None) -> None:
        with self.conn() as c:
            if mode is not None:
                c.execute("UPDATE households SET current_mode = ? WHERE id = ?", (mode, hid))
            if topic is not None:
                c.execute("UPDATE households SET current_topic = ? WHERE id = ?", (topic or None, hid))

    def reset_household(self, hid: str) -> None:
        with self.conn() as c:
            for table in ("memory_notes", "inventory", "tasks", "pending_actions", "messages", "plans", "tool_log"):
                c.execute(f"DELETE FROM {table} WHERE household_id = ?", (hid,))
            c.execute(
                "UPDATE households SET profile_json = ?, profile_confirmed = 0, current_mode = 'companion',"
                " current_topic = NULL, updated_at = ? WHERE id = ?",
                (HouseholdProfile().model_dump_json(), now(), hid),
            )

    # ---------- memory notes ----------
    def list_notes(self, hid: str) -> list[dict[str, Any]]:
        with self.conn() as c:
            rows = c.execute("SELECT * FROM memory_notes WHERE household_id = ? ORDER BY id", (hid,)).fetchall()
        return [dict(r) for r in rows]

    def add_note(self, hid: str, text: str, status: str, source: str) -> dict[str, Any]:
        with self.conn() as c:
            cur = c.execute(
                "INSERT INTO memory_notes (household_id, text, status, source, created_at) VALUES (?, ?, ?, ?, ?)",
                (hid, text, status, source, now()),
            )
            return dict(c.execute("SELECT * FROM memory_notes WHERE id = ?", (cur.lastrowid,)).fetchone())

    def update_note(self, hid: str, note_id: int, text: str | None = None, status: str | None = None) -> dict | None:
        with self.conn() as c:
            if text is not None:
                c.execute("UPDATE memory_notes SET text = ? WHERE id = ? AND household_id = ?", (text, note_id, hid))
            if status is not None:
                c.execute("UPDATE memory_notes SET status = ? WHERE id = ? AND household_id = ?", (status, note_id, hid))
            return _row(c.execute("SELECT * FROM memory_notes WHERE id = ? AND household_id = ?", (note_id, hid)).fetchone())

    def delete_note(self, hid: str, note_id: int) -> bool:
        with self.conn() as c:
            return c.execute("DELETE FROM memory_notes WHERE id = ? AND household_id = ?", (note_id, hid)).rowcount > 0

    # ---------- inventory ----------
    def list_inventory(self, hid: str) -> list[dict[str, Any]]:
        with self.conn() as c:
            rows = c.execute("SELECT * FROM inventory WHERE household_id = ? ORDER BY category, name", (hid,)).fetchall()
        return [dict(r) for r in rows]

    def get_item(self, hid: str, item_id: int) -> dict[str, Any] | None:
        with self.conn() as c:
            return _row(c.execute("SELECT * FROM inventory WHERE id = ? AND household_id = ?", (item_id, hid)).fetchone())

    def add_item(self, hid: str, item: InventoryItemIn) -> dict[str, Any]:
        ts = now()
        d = item.model_dump()
        with self.conn() as c:
            cur = c.execute(
                "INSERT INTO inventory (household_id, name, category, quantity, unit, target_key, kcal_per_unit,"
                " expires_on, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    hid, d["name"], d["category"], d["quantity"], d["unit"], d["target_key"], d["kcal_per_unit"],
                    d["expires_on"].isoformat() if d["expires_on"] else None, d["status"], d["notes"], ts, ts,
                ),
            )
            item_id = cur.lastrowid
        return self.get_item(hid, item_id)  # type: ignore[return-value]

    def update_item(self, hid: str, item_id: int, fields: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"name", "category", "quantity", "unit", "target_key", "kcal_per_unit", "expires_on", "status", "notes"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        if "expires_on" in sets and isinstance(sets["expires_on"], date):
            sets["expires_on"] = sets["expires_on"].isoformat()
        if sets:
            cols = ", ".join(f"{k} = ?" for k in sets)
            with self.conn() as c:
                c.execute(
                    f"UPDATE inventory SET {cols}, updated_at = ? WHERE id = ? AND household_id = ?",
                    (*sets.values(), now(), item_id, hid),
                )
        return self.get_item(hid, item_id)

    def delete_item(self, hid: str, item_id: int) -> bool:
        with self.conn() as c:
            return c.execute("DELETE FROM inventory WHERE id = ? AND household_id = ?", (item_id, hid)).rowcount > 0

    # ---------- tasks ----------
    def list_tasks(self, hid: str) -> list[dict[str, Any]]:
        with self.conn() as c:
            rows = c.execute(
                "SELECT * FROM tasks WHERE household_id = ? ORDER BY status = 'done', id", (hid,)
            ).fetchall()
        return [dict(r) for r in rows]

    def get_task(self, hid: str, task_id: int) -> dict[str, Any] | None:
        with self.conn() as c:
            return _row(c.execute("SELECT * FROM tasks WHERE id = ? AND household_id = ?", (task_id, hid)).fetchone())

    def add_task(self, hid: str, task: TaskIn, source: str = "user") -> dict[str, Any]:
        with self.conn() as c:
            cur = c.execute(
                "INSERT INTO tasks (household_id, title, detail, target_key, quantity, unit, source, created_at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (hid, task.title, task.detail, task.target_key, task.quantity, task.unit, source, now()),
            )
            task_id = cur.lastrowid
        return self.get_task(hid, task_id)  # type: ignore[return-value]

    def update_task(self, hid: str, task_id: int, fields: dict[str, Any]) -> dict[str, Any] | None:
        sets = {k: v for k, v in fields.items() if k in {"title", "detail", "status"} and v is not None}
        if "status" in sets:
            sets["completed_at"] = now() if sets["status"] == "done" else None
        if sets:
            cols = ", ".join(f"{k} = ?" for k in sets)
            with self.conn() as c:
                c.execute(f"UPDATE tasks SET {cols} WHERE id = ? AND household_id = ?", (*sets.values(), task_id, hid))
        return self.get_task(hid, task_id)

    def delete_task(self, hid: str, task_id: int) -> bool:
        with self.conn() as c:
            return c.execute("DELETE FROM tasks WHERE id = ? AND household_id = ?", (task_id, hid)).rowcount > 0

    # ---------- pending actions ----------
    def create_action(self, hid: str, kind: str, payload: dict[str, Any], summary: str) -> dict[str, Any]:
        aid = uuid.uuid4().hex[:12]
        with self.conn() as c:
            c.execute(
                "INSERT INTO pending_actions (id, household_id, kind, payload_json, summary, created_at)"
                " VALUES (?,?,?,?,?,?)",
                (aid, hid, kind, json.dumps(payload, default=str), summary, now()),
            )
        return self.get_action(hid, aid)  # type: ignore[return-value]

    def get_action(self, hid: str, aid: str) -> dict[str, Any] | None:
        with self.conn() as c:
            r = _row(c.execute("SELECT * FROM pending_actions WHERE id = ? AND household_id = ?", (aid, hid)).fetchone())
        if r:
            r["payload"] = json.loads(r.pop("payload_json"))
            r["result"] = json.loads(r.pop("result_json")) if r["result_json"] else None
        return r

    def list_actions(self, hid: str, status: str | None = None) -> list[dict[str, Any]]:
        q = "SELECT id FROM pending_actions WHERE household_id = ?"
        args: list[Any] = [hid]
        if status:
            q += " AND status = ?"
            args.append(status)
        with self.conn() as c:
            ids = [r["id"] for r in c.execute(q + " ORDER BY created_at", args).fetchall()]
        return [self.get_action(hid, i) for i in ids]  # type: ignore[misc]

    def update_action(self, hid: str, aid: str, payload: dict[str, Any], summary: str) -> None:
        with self.conn() as c:
            c.execute(
                "UPDATE pending_actions SET payload_json = ?, summary = ? WHERE id = ? AND household_id = ? AND status = 'pending'",
                (json.dumps(payload, default=str), summary, aid, hid),
            )

    def resolve_action(self, hid: str, aid: str, status: str, result: dict[str, Any] | None) -> None:
        with self.conn() as c:
            c.execute(
                "UPDATE pending_actions SET status = ?, result_json = ?, resolved_at = ? WHERE id = ? AND household_id = ?",
                (status, json.dumps(result, default=str) if result is not None else None, now(), aid, hid),
            )

    # ---------- messages ----------
    def add_message(
        self,
        hid: str,
        role: str,
        content: str | None,
        tool_calls: list[dict] | None = None,
        tool_call_id: str | None = None,
        name: str | None = None,
        meta: dict | None = None,
    ) -> dict[str, Any]:
        with self.conn() as c:
            cur = c.execute(
                "INSERT INTO messages (household_id, role, content, tool_calls_json, tool_call_id, name, meta_json, created_at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (
                    hid, role, content, json.dumps(tool_calls) if tool_calls else None, tool_call_id, name,
                    json.dumps(meta, default=str) if meta else None, now(),
                ),
            )
            r = dict(c.execute("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone())
        return _decode_message(r)

    def list_messages(self, hid: str, limit: int | None = None) -> list[dict[str, Any]]:
        with self.conn() as c:
            if limit:
                rows = c.execute(
                    "SELECT * FROM (SELECT * FROM messages WHERE household_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id",
                    (hid, limit),
                ).fetchall()
            else:
                rows = c.execute("SELECT * FROM messages WHERE household_id = ? ORDER BY id", (hid,)).fetchall()
        return [_decode_message(dict(r)) for r in rows]

    def clear_messages(self, hid: str) -> None:
        with self.conn() as c:
            c.execute("DELETE FROM messages WHERE household_id = ?", (hid,))

    # ---------- plans ----------
    def add_plan(self, hid: str, scenario: str, title: str, fictional: bool, summary: str, steps: list[dict]) -> dict:
        ts = now()
        with self.conn() as c:
            cur = c.execute(
                "INSERT INTO plans (household_id, scenario, title, fictional, summary, steps_json, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (hid, scenario, title, int(fictional), summary, json.dumps(steps), ts, ts),
            )
            plan_id = cur.lastrowid
        return self.get_plan(hid, plan_id)  # type: ignore[return-value]

    def get_plan(self, hid: str, plan_id: int) -> dict[str, Any] | None:
        with self.conn() as c:
            r = _row(c.execute("SELECT * FROM plans WHERE id = ? AND household_id = ?", (plan_id, hid)).fetchone())
        if r:
            r["steps"] = json.loads(r.pop("steps_json"))
            r["fictional"] = bool(r["fictional"])
        return r

    def list_plans(self, hid: str) -> list[dict[str, Any]]:
        with self.conn() as c:
            ids = [r["id"] for r in c.execute("SELECT id FROM plans WHERE household_id = ? ORDER BY id DESC", (hid,))]
        return [self.get_plan(hid, i) for i in ids]  # type: ignore[misc]

    def set_plan_step(self, hid: str, plan_id: int, index: int, done: bool) -> dict[str, Any] | None:
        plan = self.get_plan(hid, plan_id)
        if plan is None or not (0 <= index < len(plan["steps"])):
            return None
        plan["steps"][index]["done"] = done
        with self.conn() as c:
            c.execute(
                "UPDATE plans SET steps_json = ?, updated_at = ? WHERE id = ? AND household_id = ?",
                (json.dumps(plan["steps"]), now(), plan_id, hid),
            )
        return self.get_plan(hid, plan_id)

    def delete_plan(self, hid: str, plan_id: int) -> bool:
        with self.conn() as c:
            return c.execute("DELETE FROM plans WHERE id = ? AND household_id = ?", (plan_id, hid)).rowcount > 0

    # ---------- tool log ----------
    def log_tool(self, hid: str, tool: str, args: dict, result: dict, ok: bool, effect: str) -> None:
        with self.conn() as c:
            c.execute(
                "INSERT INTO tool_log (household_id, tool, args_json, result_json, ok, effect, created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (hid, tool, json.dumps(args, default=str), json.dumps(result, default=str)[:20000], int(ok), effect, now()),
            )

    def list_tool_log(self, hid: str, limit: int = 100) -> list[dict[str, Any]]:
        with self.conn() as c:
            rows = c.execute(
                "SELECT * FROM tool_log WHERE household_id = ? ORDER BY id DESC LIMIT ?", (hid, limit)
            ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["args"] = json.loads(d.pop("args_json"))
            d["ok"] = bool(d["ok"])
            out.append(d)
        return out

    # ---------- usage / rate limiting ----------
    def bump_usage(self, hid: str) -> tuple[int, int]:
        """Increment today's turn count. Returns (household_turns, global_turns) after increment."""
        day = date.today().isoformat()
        with self.conn() as c:
            c.execute(
                "INSERT INTO usage (day, household_id, turns) VALUES (?, ?, 1)"
                " ON CONFLICT(day, household_id) DO UPDATE SET turns = turns + 1",
                (day, hid),
            )
            mine = c.execute("SELECT turns FROM usage WHERE day = ? AND household_id = ?", (day, hid)).fetchone()[0]
            total = c.execute("SELECT COALESCE(SUM(turns), 0) FROM usage WHERE day = ?", (day,)).fetchone()[0]
        return mine, total


def _decode_message(r: dict[str, Any]) -> dict[str, Any]:
    r["tool_calls"] = json.loads(r.pop("tool_calls_json")) if r.get("tool_calls_json") else None
    r["meta"] = json.loads(r.pop("meta_json")) if r.get("meta_json") else None
    return r
