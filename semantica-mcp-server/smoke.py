from __future__ import annotations

import argparse
import json
import urllib.request


def call(url: str, payload: dict, token: str | None) -> dict:
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, json.dumps(payload).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:7333/mcp")
    parser.add_argument("--token")
    args = parser.parse_args()
    init = call(args.url, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1"}}}, args.token)
    assert init["result"]["serverInfo"]["name"] == "semantica-mcp-server"
    tools = call(args.url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, args.token)
    names = {tool["name"] for tool in tools["result"]["tools"]}
    required = {"semantica_sync_raw_files", "semantica_search_graph", "semantica_get_graph_summary"}
    assert required <= names, required - names
    status = call(args.url, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "semantica_get_sync_status", "arguments": {}}}, args.token)
    assert not status["result"].get("isError")
    print(json.dumps({"status": "ok", "tools": len(names)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
