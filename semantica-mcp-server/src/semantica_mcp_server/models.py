from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Node:
    id: str
    label: str
    type: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Edge:
    id: str
    source: str
    target: str
    type: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphSnapshot:
    corpus_sha256: str
    parser_version: str
    semantica_version: str
    source_count: int
    nodes: list[Node]
    edges: list[Edge]

    def to_dict(self) -> dict[str, Any]:
        return {
            "corpus_sha256": self.corpus_sha256,
            "parser_version": self.parser_version,
            "semantica_version": self.semantica_version,
            "source_count": self.source_count,
            "nodes": [asdict(node) for node in self.nodes],
            "edges": [asdict(edge) for edge in self.edges],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GraphSnapshot":
        return cls(
            corpus_sha256=str(data["corpus_sha256"]),
            parser_version=str(data["parser_version"]),
            semantica_version=str(data["semantica_version"]),
            source_count=int(data["source_count"]),
            nodes=[Node(**node) for node in data.get("nodes", [])],
            edges=[Edge(**edge) for edge in data.get("edges", [])],
        )
