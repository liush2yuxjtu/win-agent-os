from __future__ import annotations

from typing import Any, Callable

from .service import SemanticaService

TOOL_DEFINITIONS = [
    {
        "name": "semantica_sync_raw_files",
        "description": "校验同一 QC raw_files 语料并事务同步为 Semantica 知识图。相同版本与 hash 时幂等 no-op。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "force": {"type": "boolean", "default": False, "description": "是否强制完整重建"},
                "dry_run": {"type": "boolean", "default": False, "description": "仅报告变化，不提交新图"},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_get_sync_status",
        "description": "读取当前图 generation、语料 fingerprint、版本、stale 与最近失败状态。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_search_graph",
        "description": "按表名、字段名、中文名、描述或 provenance 搜索知识图节点。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 300},
                "entity_types": {"type": "array", "items": {"type": "string", "maxLength": 50}, "maxItems": 10},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_get_graph_summary",
        "description": "返回图的来源数、节点数、关系数、节点类型和版本信息。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_get_graph_analytics",
        "description": "返回图统计和度数最高的节点。",
        "inputSchema": {
            "type": "object",
            "properties": {"top_n": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10}},
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_get_entity",
        "description": "按稳定 entity ID 读取单个知识图节点。",
        "inputSchema": {
            "type": "object",
            "properties": {"entity_id": {"type": "string", "minLength": 1, "maxLength": 500}},
            "required": ["entity_id"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_get_neighbors",
        "description": "读取指定节点在限定深度内的相邻节点和关系。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_id": {"type": "string", "minLength": 1, "maxLength": 500},
                "relationship_types": {"type": "array", "items": {"type": "string", "maxLength": 80}, "maxItems": 10},
                "depth": {"type": "integer", "minimum": 1, "maximum": 5, "default": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
            },
            "required": ["entity_id"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_find_path",
        "description": "在两个节点之间寻找限定深度的最短无向路径。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source_id": {"type": "string", "minLength": 1, "maxLength": 500},
                "target_id": {"type": "string", "minLength": 1, "maxLength": 500},
                "max_depth": {"type": "integer", "minimum": 1, "maximum": 8, "default": 5},
            },
            "required": ["source_id", "target_id"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_run_reasoning",
        "description": "使用 Semantica Reasoner 对显式 facts 和 IF/THEN rules 运行无状态推理，不写权威图。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "facts": {"type": "array", "items": {"type": "string", "maxLength": 500}, "maxItems": 200},
                "rules": {"type": "array", "items": {"type": "string", "maxLength": 1000}, "maxItems": 100},
            },
            "required": ["facts", "rules"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_export_graph",
        "description": "以有界 JSON 导出当前图；超过上限时返回截断标记。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "format": {"type": "string", "enum": ["json"], "default": "json"},
                "max_items": {"type": "integer", "minimum": 1, "maximum": 1000, "default": 200},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
    {
        "name": "semantica_get_provenance",
        "description": "读取节点或关系对应的 source_path、source_sha256 和 section。",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "minLength": 1, "maxLength": 500}},
            "required": ["id"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False},
    },
]


def _boolean(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ValueError("布尔参数非法")
    return value


def _integer(value: Any, default: int, minimum: int, maximum: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError("整数参数超出允许范围")
    return value


def _text(value: Any, name: str, maximum: int = 500) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{name} 参数非法")
    return value.strip()


def call_tool(service: SemanticaService, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(arguments, dict):
        raise ValueError("arguments 必须是对象")
    if name == "semantica_sync_raw_files":
        return service.sync(
            force=_boolean(arguments.get("force")),
            dry_run=_boolean(arguments.get("dry_run")),
        )
    if name == "semantica_get_sync_status":
        return service.status()
    if name == "semantica_search_graph":
        query = _text(arguments.get("query"), "query", 300)
        types = arguments.get("entity_types")
        if types is not None and (not isinstance(types, list) or len(types) > 10 or not all(isinstance(item, str) for item in types)):
            raise ValueError("entity_types 参数非法")
        limit = _integer(arguments.get("limit"), 20, 1, service.config.max_results)
        results = service.graph.search(query, types, limit)
        return {"query": query, "count": len(results), "results": results}
    if name == "semantica_get_graph_summary":
        return service.graph.summary()
    if name == "semantica_get_graph_analytics":
        return service.graph.analytics(_integer(arguments.get("top_n"), 10, 1, 50))
    if name == "semantica_get_entity":
        entity_id = _text(arguments.get("entity_id"), "entity_id")
        node = service.graph.get_node(entity_id)
        if node is None:
            raise KeyError("entity_not_found")
        return service.graph.node_dict(node)
    if name == "semantica_get_neighbors":
        entity_id = _text(arguments.get("entity_id"), "entity_id")
        rel_types = arguments.get("relationship_types")
        if rel_types is not None and (not isinstance(rel_types, list) or len(rel_types) > 10 or not all(isinstance(item, str) for item in rel_types)):
            raise ValueError("relationship_types 参数非法")
        depth = _integer(arguments.get("depth"), 1, 1, service.config.max_depth)
        limit = _integer(arguments.get("limit"), 30, 1, service.config.max_results)
        return service.graph.neighbors(entity_id, rel_types, depth, limit)
    if name == "semantica_find_path":
        return service.graph.find_path(
            _text(arguments.get("source_id"), "source_id"),
            _text(arguments.get("target_id"), "target_id"),
            _integer(arguments.get("max_depth"), 5, 1, 8),
        )
    if name == "semantica_run_reasoning":
        facts, rules = arguments.get("facts"), arguments.get("rules")
        if (
            not isinstance(facts, list)
            or not isinstance(rules, list)
            or len(facts) > 200
            or len(rules) > 100
            or not all(isinstance(item, str) and len(item) <= 1000 for item in [*facts, *rules])
        ):
            raise ValueError("facts 和 rules 必须是有界字符串数组")
        return service.graph.run_reasoning(facts, rules)
    if name == "semantica_export_graph":
        return service.export(str(arguments.get("format", "json")), _integer(arguments.get("max_items"), 200, 1, 1000))
    if name == "semantica_get_provenance":
        return service.graph.provenance(_text(arguments.get("id"), "id"))
    raise KeyError("unknown_tool")
