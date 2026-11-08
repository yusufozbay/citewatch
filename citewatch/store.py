"""SQLite storage for AI Overview snapshots and generated briefs."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY,
    prompt_id   TEXT NOT NULL,
    keyword     TEXT NOT NULL,
    source      TEXT NOT NULL,
    location_code INTEGER,
    language_code TEXT,
    device      TEXT,
    fetched_at  TEXT NOT NULL,          -- ISO 8601 UTC
    has_aio     INTEGER NOT NULL,
    text        TEXT NOT NULL,
    text_hash   TEXT NOT NULL,          -- detects whether the answer changed
    references_json TEXT NOT NULL,
    check_url   TEXT,
    cost        REAL,
    raw_json    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_snap_prompt ON snapshots(prompt_id, fetched_at);

CREATE TABLE IF NOT EXISTS briefs (
    id          INTEGER PRIMARY KEY,
    prompt_id   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    window_from TEXT NOT NULL,
    window_to   TEXT NOT NULL,
    snapshot_count INTEGER NOT NULL,
    model       TEXT NOT NULL,
    path        TEXT NOT NULL,
    markdown    TEXT NOT NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS ix_brief_prompt ON briefs(prompt_id, created_at);
"""


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s)


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def add_snapshot(self, prompt, source: str, result, fetched_at: datetime | None = None) -> int:
        cur = self.db.execute(
            """INSERT INTO snapshots (prompt_id, keyword, source, location_code, language_code, device,
                   fetched_at, has_aio, text, text_hash, references_json, check_url, cost, raw_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                prompt.id, prompt.keyword, source, prompt.location_code, prompt.language_code,
                prompt.device, iso(fetched_at or now()), int(result.has_aio), result.text,
                hashlib.sha256(result.text.encode()).hexdigest()[:16],
                json.dumps(result.references, ensure_ascii=False), result.check_url,
                result.cost, json.dumps(result.raw, ensure_ascii=False),
            ),
        )
        self.db.commit()
        return cur.lastrowid

    def last_fetch(self, prompt_id: str) -> datetime | None:
        row = self.db.execute(
            "SELECT MAX(fetched_at) AS t FROM snapshots WHERE prompt_id = ?", (prompt_id,)
        ).fetchone()
        return parse_iso(row["t"]) if row["t"] else None

    def snapshots(self, prompt_id: str, since: datetime | None = None) -> list[sqlite3.Row]:
        q = "SELECT * FROM snapshots WHERE prompt_id = ?"
        args: list = [prompt_id]
        if since:
            q += " AND fetched_at >= ?"
            args.append(iso(since))
        return self.db.execute(q + " ORDER BY fetched_at", args).fetchall()

    def last_brief(self, prompt_id: str) -> sqlite3.Row | None:
        return self.db.execute(
            "SELECT * FROM briefs WHERE prompt_id = ? ORDER BY created_at DESC LIMIT 1", (prompt_id,)
        ).fetchone()

    def add_brief(self, **fields) -> int:
        cols = ",".join(fields)
        cur = self.db.execute(
            f"INSERT INTO briefs ({cols}) VALUES ({','.join('?' * len(fields))})",
            tuple(fields.values()),
        )
        self.db.commit()
        return cur.lastrowid

    def first_snapshot(self, prompt_id: str) -> datetime | None:
        row = self.db.execute(
            "SELECT MIN(fetched_at) AS t FROM snapshots WHERE prompt_id = ?", (prompt_id,)
        ).fetchone()
        return parse_iso(row["t"]) if row["t"] else None


def window_start(days: float) -> datetime:
    return now() - timedelta(days=days)
