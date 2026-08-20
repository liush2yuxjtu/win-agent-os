from __future__ import annotations

from collections import Counter, deque
from typing import Any

from .models import Edge, GraphSnapshot, Node


class GraphStore:
    def __init__(self, snapshot: GraphSnapshot | None = None) -> None:
        self.snapshot = snapshot
        self._semantica_graph: Any | None = None
        if snapshot is not None:
            self._semantica_graph = self._build_semantica_graph(snapshot)

    @staticmethod
    def semantica_version() -> str:
        try:
            import semantica

            return str(getattr(semantica, "__version__", "0.6.5"))
        except ImportError:
            return "0.6.5"

    def _build_semantica_graph(self, snapshot: GraphSnapshot) -> Any | None:
        try:
            from semantica.context import ContextGraph

            graph = ContextGraph(advanced_analytics=True)
            for node in snapshot.nodes:
                graph.add_node(
                    node_id=node.id,
                    node_type=node.type,
                    content=node.label,
                    **node.metadata,
                )
            for edge in snapshot.edges:
                graph.add_edge(
                    source_id=edge.source,
                    target_id=edge.target,
                    edge_type=edge.type,
                    **edge.metadata,
                    edge_id=edge.id,
                )
            return graph
        except ImportError:
            return None

    def validate_semantica_roundtrip(self, snapshot: GraphSnapshot, temp_path: str) -> None:
        graph = self._build_semantica_graph(snapshot)
        if graph is None:
            return
        if not hasattr(graph, "save_to_file"):
            raise RuntimeError("semantica_save_to_file_unavailable")
        graph.save_to_file(temp_path)
        from semantica.context import ContextGraph

        loaded = ContextGraph(advanced_analytics=True)
        if not hasattr(loaded, "load_from_file"):
            raise RuntimeError("semantica_load_from_file_unavailable")
        loaded.load_from_file(temp_path)
        loaded_count = len(list(loaded.find_nodes()))
        if loaded_count != len(snapshot.nodes):
            raise RuntimeError("semantica_roundtrip_count_mismatch")

    def replace(self, snapshot: GraphSnapshot) -> None:
        graph = self._build_semantica_graph(snapshot)
        self.snapshot = snapshot
        self._semantica_graph = graph

    def require_snapshot(self) -> GraphSnapshot:
        if self.snapshot is None:
            raise RuntimeError("not_initialized")
        return self.snapshot

    def summary(self) -> dict[str, Any]:
        snapshot = self.require_snapshot()
        return {
            "source_count": snapshot.source_count,
            "node_count": len(snapshot.nodes),
            "edge_count": len(snapshot.edges),
            "node_types": dict(Counter(node.type for node in snapshot.nodes)),
            "corpus_sha256": snapshot.corpus_sha256,
            "semantica_version": snapshot.semantica_version,
        }

    def search(self, query: str, entity_types: list[str] | None, limit: int) -> list[dict[str, Any]]:
        snapshot = self.require_snapshot()
        needle = query.casefold()
        type_filter = {item.casefold() for item in entity_types or []}
        hits = []
        for node in snapshot.nodes:
            if type_filter and node.type.casefold() not in type_filter:
                continue
            corpus = " ".join([node.id, node.label, node.type, *[str(value) for value in node.metadata.values()]])
            if needle in corpus.casefold():
                hits.append(self.node_dict(node))
                if len(hits) >= limit:
                    break
        return hits

    def get_node(self, node_id: str) -> Node | None:
        return next((node for node in self.require_snapshot().nodes if node.id == node_id), None)

    @staticmethod
    def node_dict(node: Node) -> dict[str, Any]:
        return {"id": node.id, "label": node.label, "type": node.type, "metadata": node.metadata}

    @staticmethod
    def edge_dict(edge: Edge) -> dict[str, Any]:
        return {"id": edge.id, "source": edge.source, "target": edge.target, "type": edge.type, "metadata": edge.metadata}

    def neighbors(self, node_id: str, relationship_types: list[str] | None, depth: int, limit: int) -> dict[str, Any]:
        snapshot = self.require_snapshot()
        if self.get_node(node_id) is None:
            raise KeyError("entity_not_found")
        allowed = {value.casefold() for value in relationship_types or []}
        adjacency: dict[str, list[tuple[str, Edge]]] = {}
        for edge in snapshot.edges:
            if allowed and edge.type.casefold() not in allowed:
                continue
            adjacency.setdefault(edge.source, []).append((edge.target, edge))
            adjacency.setdefault(edge.target, []).append((edge.source, edge))
        visited = {node_id}
        queue = deque([(node_id, 0)])
        found_nodes: list[dict[str, Any]] = []
        found_edges: dict[str, dict[str, Any]] = {}
        while queue and len(found_nodes) < limit:
            current, current_depth = queue.popleft()
            if current_depth >= depth:
                continue
            for neighbor, edge in adjacency.get(current, []):
                found_edges[edge.id] = self.edge_dict(edge)
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                node = self.get_node(neighbor)
                if node is not None:
                    found_nodes.append(self.node_dict(node))
                queue.append((neighbor, current_depth + 1))
                if len(found_nodes) >= limit:
                    break
        return {"entity_id": node_id, "nodes": found_nodes, "edges": list(found_edges.values())}

    def find_path(self, source_id: str, target_id: str, max_depth: int) -> dict[str, Any]:
        snapshot = self.require_snapshot()
        node_ids = {node.id for node in snapshot.nodes}
        if source_id not in node_ids or target_id not in node_ids:
            raise KeyError("entity_not_found")
        adjacency: dict[str, list[tuple[str, Edge]]] = {}
        for edge in snapshot.edges:
            adjacency.setdefault(edge.source, []).append((edge.target, edge))
            adjacency.setdefault(edge.target, []).append((edge.source, edge))
        queue = deque([(source_id, [], [])])
        visited = {source_id}
        while queue:
            current, node_path, edge_path = queue.popleft()
            if len(edge_path) >= max_depth:
                continue
            for neighbor, edge in adjacency.get(current, []):
                if neighbor in visited:
                    continue
                next_nodes = [*node_path, current]
                next_edges = [*edge_path, edge]
                if neighbor == target_id:
                    ids = [*next_nodes, target_id]
                    return {
                        "found": True,
                        "nodes": [self.node_dict(self.get_node(item)) for item in ids if self.get_node(item)],
                        "edges": [self.edge_dict(item) for item in next_edges],
                    }
                visited.add(neighbor)
                queue.append((neighbor, next_nodes, next_edges))
        return {"found": False, "nodes": [], "edges": []}

    def provenance(self, entity_id: str) -> dict[str, Any]:
        node = self.get_node(entity_id)
        if node is not None:
            return {"id": entity_id, "provenance": {k: v for k, v in node.metadata.items() if k.startswith("source_") or k == "section"}}
        edge = next((item for item in self.require_snapshot().edges if item.id == entity_id), None)
        if edge is not None:
            return {"id": entity_id, "provenance": {k: v for k, v in edge.metadata.items() if k.startswith("source_") or k == "section"}}
        raise KeyError("entity_not_found")

    def analytics(self, top_n: int) -> dict[str, Any]:
        snapshot = self.require_snapshot()
        degree = Counter()
        for edge in snapshot.edges:
            degree[edge.source] += 1
            degree[edge.target] += 1
        top = []
        for node_id, value in degree.most_common(top_n):
            node = self.get_node(node_id)
            if node:
                top.append({"id": node_id, "label": node.label, "type": node.type, "degree": value})
        return {**self.summary(), "top_by_degree": top, "semantica_graph_loaded": self._semantica_graph is not None}

    def run_reasoning(self, facts: list[str], rules: list[str]) -> dict[str, Any]:
        if len(facts) > 200 or len(rules) > 100:
            raise ValueError("facts 或 rules 超过上限")
        try:
            from semantica.reasoning import Reasoner

            reasoner = Reasoner()
            for rule in rules:
                reasoner.add_rule(rule)
            derived = reasoner.infer_facts(facts)
            return {"derived_facts": list(derived) if not isinstance(derived, list) else derived}
        except (ImportError, AttributeError, TypeError) as exc:
            raise RuntimeError("reasoning_unavailable") from exc
