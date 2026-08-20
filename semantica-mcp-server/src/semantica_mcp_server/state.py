from __future__ import annotations

import fcntl
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .models import GraphSnapshot
from .source_adapter import TableFragment


class StateStore:
    def __init__(self, state_dir: Path) -> None:
        self.state_dir = state_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.graph_dir = self.state_dir / "generations"
        self.graph_dir.mkdir(exist_ok=True)
        self.db_path = self.state_dir / "state.sqlite3"
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS fragments (
                    source_path TEXT PRIMARY KEY,
                    source_sha256 TEXT NOT NULL,
                    parser_version TEXT NOT NULL,
                    semantica_version TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS generations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    corpus_sha256 TEXT NOT NULL,
                    parser_version TEXT NOT NULL,
                    semantica_version TEXT NOT NULL,
                    graph_path TEXT NOT NULL,
                    source_count INTEGER NOT NULL,
                    node_count INTEGER NOT NULL,
                    edge_count INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    error TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
            )

    @contextmanager
    def sync_lock(self) -> Iterator[bool]:
        thread_acquired = self._lock.acquire(blocking=False)
        if not thread_acquired:
            yield False
            return
        lock_fd = os.open(self.state_dir / "sync.lock", os.O_CREAT | os.O_RDWR, 0o600)
        file_acquired = False
        try:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                file_acquired = True
            except BlockingIOError:
                yield False
                return
            yield True
        finally:
            if file_acquired:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)
            self._lock.release()

    def load_fragments(self) -> dict[str, tuple[str, str, str, TableFragment]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM fragments").fetchall()
        return {
            row["source_path"]: (
                row["source_sha256"],
                row["parser_version"],
                row["semantica_version"],
                TableFragment.from_dict(json.loads(row["payload"])),
            )
            for row in rows
        }

    def active_generation(self) -> sqlite3.Row | None:
        with self._connect() as conn:
            setting = conn.execute("SELECT value FROM settings WHERE key='active_generation'").fetchone()
            if setting is None:
                return None
            return conn.execute("SELECT * FROM generations WHERE id=?", (int(setting["value"]),)).fetchone()

    def load_active_snapshot(self) -> GraphSnapshot | None:
        generation = self.active_generation()
        if generation is None:
            return None
        path = Path(generation["graph_path"])
        if not path.is_file() or path.parent.resolve() != self.graph_dir.resolve():
            return None
        return GraphSnapshot.from_dict(json.loads(path.read_text("utf-8")))

    def commit_generation(
        self,
        snapshot: GraphSnapshot,
        fragments: dict[str, tuple[str, str, str, TableFragment]],
    ) -> int:
        payload = json.dumps(snapshot.to_dict(), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            cursor = conn.execute(
                """INSERT INTO generations
                   (corpus_sha256, parser_version, semantica_version, graph_path,
                    source_count, node_count, edge_count, status, error, created_at)
                   VALUES (?, ?, ?, '', ?, ?, ?, 'preparing', NULL, ?)""",
                (
                    snapshot.corpus_sha256,
                    snapshot.parser_version,
                    snapshot.semantica_version,
                    snapshot.source_count,
                    len(snapshot.nodes),
                    len(snapshot.edges),
                    now,
                ),
            )
            generation_id = int(cursor.lastrowid)
            final_path = self.graph_dir / f"graph-{generation_id}.json"
            temp_path = self.graph_dir / f".graph-{generation_id}.tmp"
            with temp_path.open("w", encoding="utf-8") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            round_trip = GraphSnapshot.from_dict(json.loads(temp_path.read_text("utf-8")))
            if len(round_trip.nodes) != len(snapshot.nodes) or len(round_trip.edges) != len(snapshot.edges):
                temp_path.unlink(missing_ok=True)
                raise ValueError("候选图序列化 round-trip 失败")
            os.replace(temp_path, final_path)
            conn.execute("DELETE FROM fragments")
            conn.executemany(
                """INSERT INTO fragments
                   (source_path, source_sha256, parser_version, semantica_version, payload, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [
                    (
                        path,
                        sha,
                        parser_version,
                        semantica_version,
                        json.dumps(fragment.to_dict(), ensure_ascii=False),
                        now,
                    )
                    for path, (sha, parser_version, semantica_version, fragment) in fragments.items()
                ],
            )
            conn.execute(
                "UPDATE generations SET status='superseded' WHERE status='active' AND id<>?",
                (generation_id,),
            )
            conn.execute(
                "UPDATE generations SET graph_path=?, status='active' WHERE id=?",
                (str(final_path), generation_id),
            )
            conn.execute(
                """INSERT INTO settings(key, value) VALUES('active_generation', ?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                (str(generation_id),),
            )
        return generation_id

    def record_failure(self, corpus_sha256: str, parser_version: str, semantica_version: str, error: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        safe_error = error[:500]
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO generations
                   (corpus_sha256, parser_version, semantica_version, graph_path,
                    source_count, node_count, edge_count, status, error, created_at)
                   VALUES (?, ?, ?, '', 0, 0, 0, 'failed', ?, ?)""",
                (corpus_sha256, parser_version, semantica_version, safe_error, now),
            )

    def last_failure(self) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT error FROM generations WHERE status='failed' ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return str(row["error"]) if row and row["error"] else None
