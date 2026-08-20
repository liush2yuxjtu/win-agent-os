from __future__ import annotations

import hmac
import json
import logging
import time
from collections import defaultdict, deque
from typing import Any
from urllib.parse import urlsplit

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import __version__
from .config import Config
from .service import SemanticaService
from .tools import TOOL_DEFINITIONS, call_tool

log = logging.getLogger("semantica_mcp_server")
MAX_REQUEST_BYTES = 1_000_000
SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
LOOPBACK_ORIGIN_HOSTS = {"127.0.0.1", "localhost", "::1"}


class SecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Any, config: Config) -> None:
        super().__init__(app)
        self.config = config
        self.requests: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        if request.url.path == "/mcp":
            origin = request.headers.get("origin")
            if origin and urlsplit(origin).hostname not in LOOPBACK_ORIGIN_HOSTS:
                return JSONResponse({"error": "origin_not_allowed"}, status_code=403)
        if request.url.path != "/healthz" and self.config.token:
            provided = request.headers.get("authorization", "")
            expected = f"Bearer {self.config.token}"
            if not hmac.compare_digest(provided, expected):
                return JSONResponse({"error": "unauthorized"}, status_code=401)
        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        bucket = self.requests[client]
        while bucket and bucket[0] < now - 60:
            bucket.popleft()
        if len(bucket) >= 120:
            return JSONResponse({"error": "rate_limited"}, status_code=429)
        bucket.append(now)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store"
        return response


def _ok(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def create_app(config: Config | None = None, service: SemanticaService | None = None) -> Starlette:
    cfg = config or Config.from_env()
    svc = service or SemanticaService(cfg)

    async def healthz(_request: Request) -> Response:
        status = svc.status()
        code = 200 if status["status"] in {"ready", "stale", "not_initialized"} else 503
        return JSONResponse({"service": "semantica-mcp-server", **status}, status_code=code)

    async def mcp_post(request: Request) -> Response:
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return JSONResponse(_error(None, -32600, "Content-Type must be application/json"), status_code=415)
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_REQUEST_BYTES:
                    return JSONResponse(_error(None, -32600, "Request too large"), status_code=413)
            except ValueError:
                return JSONResponse(_error(None, -32600, "Invalid content length"), status_code=400)
        body = await request.body()
        if len(body) > MAX_REQUEST_BYTES:
            return JSONResponse(_error(None, -32600, "Request too large"), status_code=413)
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JSONResponse(_error(None, -32700, "Parse error"), status_code=400)
        if not isinstance(payload, dict):
            return JSONResponse(_error(None, -32600, "Invalid request"), status_code=400)
        request_id = payload.get("id")
        method = payload.get("method")
        params = payload.get("params") or {}
        if request_id is None:
            return Response(status_code=202)
        if method == "initialize":
            requested = params.get("protocolVersion") if isinstance(params, dict) else None
            negotiated = requested if requested in SUPPORTED_PROTOCOL_VERSIONS else SUPPORTED_PROTOCOL_VERSIONS[0]
            return JSONResponse(
                _ok(
                    request_id,
                    {
                        "protocolVersion": negotiated,
                        "capabilities": {"tools": {"listChanged": False}, "resources": {"subscribe": False, "listChanged": False}},
                        "serverInfo": {"name": "semantica-mcp-server", "version": __version__},
                    },
                )
            )
        if method == "ping":
            return JSONResponse(_ok(request_id, {}))
        if method == "tools/list":
            tools = [{key: value for key, value in definition.items()} for definition in TOOL_DEFINITIONS]
            return JSONResponse(_ok(request_id, {"tools": tools}))
        if method == "tools/call":
            if not isinstance(params, dict):
                return JSONResponse(_error(request_id, -32602, "Invalid params"), status_code=400)
            name = params.get("name")
            arguments = params.get("arguments") or {}
            try:
                result = call_tool(svc, str(name), arguments)
                return JSONResponse(
                    _ok(
                        request_id,
                        {
                            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
                            "structuredContent": result,
                            "isError": False,
                        },
                    )
                )
            except (ValueError, KeyError) as exc:
                reason = exc.args[0] if exc.args else "invalid_request"
                safe = reason if reason in {"entity_not_found", "unknown_tool", "not_initialized"} else "invalid_request"
                return JSONResponse(
                    _ok(
                        request_id,
                        {"content": [{"type": "text", "text": f"Error: {safe}"}], "isError": True},
                    )
                )
            except RuntimeError as exc:
                reason = exc.args[0] if exc.args else "operation_failed"
                safe = reason if reason in {"not_initialized", "sync_failed", "reasoning_unavailable"} else "operation_failed"
                log.exception("MCP tool failed: %s", name)
                return JSONResponse(
                    _ok(
                        request_id,
                        {"content": [{"type": "text", "text": f"Error: {safe}"}], "isError": True},
                    )
                )
        if method == "resources/list":
            resources = [
                {"uri": "semantica://graph/summary", "name": "Graph Summary", "mimeType": "application/json"},
                {"uri": "semantica://schema/info", "name": "Schema Info", "mimeType": "application/json"},
                {"uri": "semantica://sync/status", "name": "Sync Status", "mimeType": "application/json"},
            ]
            return JSONResponse(_ok(request_id, {"resources": resources}))
        if method == "resources/read":
            uri = params.get("uri", "") if isinstance(params, dict) else ""
            try:
                if uri == "semantica://graph/summary":
                    data = svc.graph.summary()
                elif uri == "semantica://schema/info":
                    data = {"name": "semantica-mcp-server", "version": __version__, "tools": [item["name"] for item in TOOL_DEFINITIONS]}
                elif uri == "semantica://sync/status":
                    data = svc.status()
                else:
                    return JSONResponse(_error(request_id, -32602, "Unknown resource"), status_code=400)
            except RuntimeError:
                data = {"status": "not_initialized"}
            return JSONResponse(
                _ok(
                    request_id,
                    {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(data, ensure_ascii=False)}]},
                )
            )
        return JSONResponse(_error(request_id, -32601, "Method not found"), status_code=404)

    async def method_not_allowed(_request: Request) -> Response:
        return JSONResponse(_error(None, -32000, "Method not allowed"), status_code=405)

    app = Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Route("/mcp", mcp_post, methods=["POST"]),
            Route("/mcp", method_not_allowed, methods=["GET", "DELETE"]),
        ]
    )
    app.add_middleware(SecurityMiddleware, config=cfg)
    app.state.service = svc
    return app
