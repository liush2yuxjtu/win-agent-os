from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Config:
    raw_files_dir: Path
    state_dir: Path
    host: str
    port: int
    token: str | None
    max_results: int = 100
    max_depth: int = 5
    max_export_bytes: int = 2_000_000

    @classmethod
    def from_env(cls) -> "Config":
        root = _project_root()
        load_dotenv(Path.home() / ".env")
        load_dotenv(root / "semantica-mcp-server" / ".env")
        raw = Path(os.environ.get("SEMANTICA_RAW_FILES_DIR", root / "qc-mcp-server" / "raw_files"))
        state = Path(os.environ.get("SEMANTICA_STATE_DIR", root / "semantica-mcp-server" / ".state"))
        host = os.environ.get("SEMANTICA_MCP_HOST", "127.0.0.1")
        port_text = os.environ.get("SEMANTICA_MCP_PORT", "7333")
        try:
            port = int(port_text)
        except ValueError as exc:
            raise ValueError("SEMANTICA_MCP_PORT 必须是整数") from exc
        if not 1 <= port <= 65535:
            raise ValueError("SEMANTICA_MCP_PORT 必须在 1-65535 之间")
        token = os.environ.get("SEMANTICA_MCP_TOKEN") or None
        if host not in {"127.0.0.1", "localhost", "::1"} and not token:
            raise ValueError("非 loopback 监听必须设置 SEMANTICA_MCP_TOKEN")
        return cls(raw.resolve(), state.resolve(), host, port, token)

    def ensure_paths(self) -> None:
        if not self.raw_files_dir.is_dir():
            raise ValueError("raw_files 目录不存在或不可读")
        checksum = self.raw_files_dir / "SHA256SUMS"
        if not checksum.is_file():
            raise ValueError("raw_files 缺少 SHA256SUMS")
        self.state_dir.mkdir(parents=True, exist_ok=True)
