from starlette.testclient import TestClient

from semantica_mcp_server.config import Config
from semantica_mcp_server.server import create_app
from semantica_mcp_server.service import SemanticaService


def _rpc(client, method, params=None, request_id=1, headers=None):
    return client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}},
        headers=headers or {},
    )


def test_protocol_and_tools(raw_dir, tmp_path):
    config = Config(raw_dir, tmp_path / "state", "127.0.0.1", 7333, None)
    service = SemanticaService(config)
    service.sync()
    client = TestClient(create_app(config, service))
    initialize = _rpc(client, "initialize", {"protocolVersion": "2024-11-05"})
    assert initialize.status_code == 200
    assert initialize.json()["result"]["serverInfo"]["name"] == "semantica-mcp-server"
    tools = _rpc(client, "tools/list").json()["result"]["tools"]
    assert "semantica_search_graph" in {tool["name"] for tool in tools}
    search = _rpc(
        client,
        "tools/call",
        {"name": "semantica_search_graph", "arguments": {"query": "品线"}},
    ).json()["result"]
    assert search["isError"] is False
    assert search["structuredContent"]["count"] > 0


def test_bearer_token(raw_dir, tmp_path):
    config = Config(raw_dir, tmp_path / "state", "127.0.0.1", 7333, "secret")
    client = TestClient(create_app(config, SemanticaService(config)))
    assert _rpc(client, "tools/list").status_code == 401
    assert _rpc(client, "tools/list", headers={"Authorization": "Bearer secret"}).status_code == 200
    assert client.get("/healthz").status_code == 200
