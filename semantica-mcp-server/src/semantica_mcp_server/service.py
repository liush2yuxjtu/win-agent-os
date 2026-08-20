from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from .config import Config
from .graph_store import GraphStore
from .pipeline import build_snapshot
from .source_adapter import PARSER_VERSION, TableFragment, load_manifest, parse_source
from .state import StateStore


class SemanticaService:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.config.ensure_paths()
        self.state = StateStore(config.state_dir)
        self.graph = GraphStore(self.state.load_active_snapshot())
        self._graph_lock = threading.RLock()

    @property
    def semantica_version(self) -> str:
        return GraphStore.semantica_version()

    def sync(self, *, force: bool = False, dry_run: bool = False) -> dict[str, Any]:
        with self.state.sync_lock() as acquired:
            if not acquired:
                return {"status": "sync_in_progress", "changed": False}
            entries, corpus_sha = load_manifest(self.config.raw_files_dir)
            active = self.state.active_generation()
            if (
                not force
                and active is not None
                and active["corpus_sha256"] == corpus_sha
                and active["parser_version"] == PARSER_VERSION
                and active["semantica_version"] == self.semantica_version
            ):
                return {
                    "status": "ready",
                    "changed": False,
                    "generation": int(active["id"]),
                    "source_count": int(active["source_count"]),
                }

            cached = self.state.load_fragments()
            next_fragments: dict[str, tuple[str, str, str, TableFragment]] = {}
            reparsed: list[str] = []
            for entry in entries:
                previous = cached.get(entry.name)
                if (
                    not force
                    and previous is not None
                    and previous[0] == entry.sha256
                    and previous[1] == PARSER_VERSION
                    and previous[2] == self.semantica_version
                ):
                    next_fragments[entry.name] = previous
                    continue
                fragment = parse_source(entry)
                if fragment is None:
                    continue
                next_fragments[entry.name] = (
                    entry.sha256,
                    PARSER_VERSION,
                    self.semantica_version,
                    fragment,
                )
                reparsed.append(entry.name)
            removed = sorted(set(cached) - set(next_fragments))
            if dry_run:
                return {
                    "status": "dry_run",
                    "changed": True,
                    "corpus_sha256": corpus_sha,
                    "source_count": len(next_fragments),
                    "reparsed_count": len(reparsed),
                    "removed_count": len(removed),
                }
            try:
                snapshot = build_snapshot(
                    [record[3] for record in next_fragments.values()],
                    corpus_sha,
                    self.semantica_version,
                )
                fd, roundtrip_path = tempfile.mkstemp(
                    prefix="semantica-roundtrip-", suffix=".json", dir=self.config.state_dir
                )
                os.close(fd)
                try:
                    self.graph.validate_semantica_roundtrip(snapshot, roundtrip_path)
                finally:
                    Path(roundtrip_path).unlink(missing_ok=True)
                generation = self.state.commit_generation(snapshot, next_fragments)
                with self._graph_lock:
                    self.graph.replace(snapshot)
                return {
                    "status": "ready",
                    "changed": True,
                    "generation": generation,
                    "source_count": snapshot.source_count,
                    "node_count": len(snapshot.nodes),
                    "edge_count": len(snapshot.edges),
                    "reparsed_count": len(reparsed),
                    "removed_count": len(removed),
                    "corpus_sha256": corpus_sha,
                }
            except Exception as exc:
                self.state.record_failure(corpus_sha, PARSER_VERSION, self.semantica_version, type(exc).__name__)
                raise RuntimeError("sync_failed") from exc

    def status(self) -> dict[str, Any]:
        active = self.state.active_generation()
        try:
            _, current_sha = load_manifest(self.config.raw_files_dir)
        except Exception:
            current_sha = None
        if active is None:
            return {
                "status": "not_initialized",
                "stale": False,
                "active_generation": None,
                "last_error": self.state.last_failure(),
                "semantica_version": self.semantica_version,
                "parser_version": PARSER_VERSION,
            }
        stale = current_sha is None or current_sha != active["corpus_sha256"]
        return {
            "status": "stale" if stale else "ready",
            "stale": stale,
            "active_generation": int(active["id"]),
            "source_count": int(active["source_count"]),
            "node_count": int(active["node_count"]),
            "edge_count": int(active["edge_count"]),
            "corpus_sha256": active["corpus_sha256"],
            "semantica_version": active["semantica_version"],
            "parser_version": active["parser_version"],
            "created_at": active["created_at"],
            "last_error": self.state.last_failure(),
        }

    def export(self, fmt: str, max_items: int) -> dict[str, Any]:
        snapshot = self.graph.require_snapshot()
        if fmt != "json":
            raise ValueError("当前安全导出仅支持 json")
        max_items = min(max_items, self.config.max_results * 10)
        payload = {
            "nodes": [self.graph.node_dict(node) for node in snapshot.nodes[:max_items]],
            "edges": [self.graph.edge_dict(edge) for edge in snapshot.edges[:max_items]],
            "truncated": len(snapshot.nodes) > max_items or len(snapshot.edges) > max_items,
        }
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if len(encoded) > self.config.max_export_bytes:
            raise ValueError("导出结果超过大小上限，请降低 max_items")
        return payload
