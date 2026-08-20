from pathlib import Path

from semantica_mcp_server.config import Config
from semantica_mcp_server.source_adapter import load_manifest


def test_non_loopback_requires_token(raw_dir, tmp_path, monkeypatch):
    monkeypatch.setenv("SEMANTICA_RAW_FILES_DIR", str(raw_dir))
    monkeypatch.setenv("SEMANTICA_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("SEMANTICA_MCP_HOST", "0.0.0.0")
    monkeypatch.delenv("SEMANTICA_MCP_TOKEN", raising=False)
    try:
        Config.from_env()
    except ValueError as exc:
        assert "TOKEN" in str(exc)
    else:
        raise AssertionError("non-loopback should require token")


def test_manifest_rejects_path_escape(raw_dir):
    checksum = raw_dir / "SHA256SUMS"
    checksum.write_text("0" * 64 + "  ../secret.md\n", "utf-8")
    try:
        load_manifest(raw_dir)
    except ValueError as exc:
        assert "根目录" in str(exc)
    else:
        raise AssertionError("path escape should fail")
