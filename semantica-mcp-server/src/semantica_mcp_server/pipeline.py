from __future__ import annotations

import hashlib
from typing import Iterable

from .models import Edge, GraphSnapshot, Node
from .source_adapter import PARSER_VERSION, TableFragment


def _slug(value: str) -> str:
    return value.strip().replace(" ", "_")


def _edge_id(source: str, edge_type: str, target: str) -> str:
    digest = hashlib.sha256(f"{source}\0{edge_type}\0{target}".encode()).hexdigest()[:20]
    return f"edge:{digest}"


def build_snapshot(
    fragments: Iterable[TableFragment], corpus_sha256: str, semantica_version: str
) -> GraphSnapshot:
    fragment_list = sorted(fragments, key=lambda item: (item.database, item.schema, item.table))
    nodes: dict[str, Node] = {}
    edges: dict[str, Edge] = {}
    table_ids: dict[str, str] = {}

    for fragment in fragment_list:
        database_id = f"database:{_slug(fragment.database)}"
        table_id = f"table:{_slug(fragment.database)}.{_slug(fragment.schema)}.{_slug(fragment.table)}"
        table_ids[fragment.table.upper()] = table_id
        provenance = {
            "source_path": fragment.source_file,
            "source_sha256": fragment.source_sha256,
        }
        nodes.setdefault(
            database_id,
            Node(database_id, fragment.database, "Database", {"database": fragment.database}),
        )
        nodes[table_id] = Node(
            table_id,
            fragment.chinese_name or fragment.table,
            "Table",
            {
                **provenance,
                "table": fragment.table,
                "database": fragment.database,
                "schema": fragment.schema,
                "description": fragment.description,
                "business_domain": fragment.metadata.get("业务域", ""),
                "primary_key": fragment.metadata.get("主键", ""),
            },
        )
        edge = Edge(
            _edge_id(database_id, "CONTAINS_TABLE", table_id),
            database_id,
            table_id,
            "CONTAINS_TABLE",
            provenance,
        )
        edges[edge.id] = edge
        for field in fragment.fields:
            field_id = f"column:{table_id.removeprefix('table:')}.{_slug(field.name)}"
            nodes[field_id] = Node(
                field_id,
                field.chinese_name or field.name,
                "Field",
                {
                    **provenance,
                    "section": "字段定义",
                    "name": field.name,
                    "data_type": field.type,
                    "nullable": field.nullable,
                    "primary_key": field.primary_key,
                    "description": field.description,
                    "sample": field.sample,
                },
            )
            edge = Edge(
                _edge_id(table_id, "HAS_FIELD", field_id),
                table_id,
                field_id,
                "HAS_FIELD",
                provenance,
            )
            edges[edge.id] = edge
            for enum_key, enum_label in sorted(field.enum.items()):
                enum_id = f"enum:{field_id.removeprefix('column:')}:{_slug(enum_key)}"
                nodes[enum_id] = Node(
                    enum_id,
                    enum_label,
                    "EnumValue",
                    {**provenance, "section": "枚举字典", "value": enum_key},
                )
                edge = Edge(
                    _edge_id(field_id, "HAS_ENUM_VALUE", enum_id),
                    field_id,
                    enum_id,
                    "HAS_ENUM_VALUE",
                    provenance,
                )
                edges[edge.id] = edge
        for index, issue in enumerate(fragment.known_issues):
            issue_digest = hashlib.sha256(issue.encode("utf-8")).hexdigest()[:16]
            issue_id = f"issue:{table_id.removeprefix('table:')}:{index}:{issue_digest}"
            nodes[issue_id] = Node(
                issue_id,
                issue[:120],
                "KnownIssue",
                {**provenance, "section": "已知问题", "text": issue},
            )
            edge = Edge(
                _edge_id(table_id, "HAS_ISSUE", issue_id),
                table_id,
                issue_id,
                "HAS_ISSUE",
                provenance,
            )
            edges[edge.id] = edge

    for fragment in fragment_list:
        source_id = table_ids.get(fragment.table.upper())
        if source_id is None:
            continue
        provenance = {"source_path": fragment.source_file, "source_sha256": fragment.source_sha256}
        for relation in fragment.relations:
            target_name = relation.get("target", "")
            target_id = table_ids.get(target_name.upper())
            if target_id is None:
                continue
            edge = Edge(
                _edge_id(source_id, "RELATES_TO", target_id),
                source_id,
                target_id,
                "RELATES_TO",
                {**provenance, **relation},
            )
            edges[edge.id] = edge

    snapshot = GraphSnapshot(
        corpus_sha256=corpus_sha256,
        parser_version=PARSER_VERSION,
        semantica_version=semantica_version,
        source_count=len(fragment_list),
        nodes=sorted(nodes.values(), key=lambda node: node.id),
        edges=sorted(edges.values(), key=lambda edge: edge.id),
    )
    validate_snapshot(snapshot)
    return snapshot


def validate_snapshot(snapshot: GraphSnapshot) -> None:
    if snapshot.source_count < 1 or not snapshot.nodes:
        raise ValueError("候选图为空")
    node_ids = {node.id for node in snapshot.nodes}
    if len(node_ids) != len(snapshot.nodes):
        raise ValueError("候选图存在重复节点 ID")
    for edge in snapshot.edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            raise ValueError(f"候选图存在悬空关系: {edge.id}")
        if "source_path" not in edge.metadata and edge.type != "CONTAINS_TABLE":
            raise ValueError(f"关系缺少 provenance: {edge.id}")
