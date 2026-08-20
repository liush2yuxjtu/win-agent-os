from __future__ import annotations

import argparse
import json
import logging

import uvicorn

from .config import Config
from .pipeline import build_snapshot
from .server import create_app
from .service import SemanticaService
from .source_adapter import load_manifest, parse_source
from .tools import TOOL_DEFINITIONS


def _self_test(config: Config) -> int:
    config.ensure_paths()
    entries, corpus_sha = load_manifest(config.raw_files_dir)
    fragments = [fragment for entry in entries if (fragment := parse_source(entry)) is not None]
    snapshot = build_snapshot(fragments, corpus_sha, SemanticaService(config).semantica_version)
    if not snapshot.nodes or not snapshot.edges or len(fragments) != len(entries):
        raise RuntimeError("self-test failed")
    print(
        json.dumps(
            {
                "status": "ok",
                "sources": len(entries),
                "nodes": len(snapshot.nodes),
                "edges": len(snapshot.edges),
                "tools": [tool["name"] for tool in TOOL_DEFINITIONS],
            },
            ensure_ascii=False,
        )
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Semantica raw_files MCP sidecar")
    parser.add_argument("command", nargs="?", choices=["serve", "sync", "status", "self-test"], default="serve")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--log-level", default="warning", choices=["debug", "info", "warning", "error"])
    args = parser.parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level.upper()))
    config = Config.from_env()
    if args.command == "self-test":
        raise SystemExit(_self_test(config))
    service = SemanticaService(config)
    if args.command == "sync":
        print(json.dumps(service.sync(force=args.force, dry_run=args.dry_run), ensure_ascii=False))
        return
    if args.command == "status":
        print(json.dumps(service.status(), ensure_ascii=False))
        return
    uvicorn.run(create_app(config, service), host=config.host, port=config.port, log_level=args.log_level)


if __name__ == "__main__":
    main()
