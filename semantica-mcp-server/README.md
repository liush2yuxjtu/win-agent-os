# semantica-mcp-server

独立 Python Streamable HTTP MCP sidecar：只读复用 `../qc-mcp-server/raw_files`，将固定十段 QC Markdown 映射为 Semantica knowledge graph，并供 Eve 通过 connection 调用。

## 边界

- `raw_files` 是唯一权威输入；服务不会修改或复制它。
- 只摄取 `SHA256SUMS` 列出的 Markdown；`DB.md` 永远排除。
- graph、SQLite state 和 fragment cache 都是 `.state/` 下的可重建派生物。
- 不开放 `add_entity`、`add_relationship`、decision、任意文件路径或外部 graph load。

## 安装

Semantica 基础依赖包含 torch、transformers、spacy、faiss 等重包，必须使用本目录隔离环境：

```bash
uv venv --python 3.11
uv sync --extra test
```

## 运行

```bash
uv run semantica-mcp-server self-test
uv run semantica-mcp-server sync --dry-run
uv run semantica-mcp-server sync
uv run semantica-mcp-server serve
# http://127.0.0.1:7333/mcp
```

服务启动不会自动执行重型同步；未初始化时查询返回 `not_initialized`。同一 corpus 再次同步是 no-op。

## 安全

默认只监听 loopback。非 loopback 必须设置 `SEMANTICA_MCP_TOKEN`，客户端使用 `Authorization: Bearer ...`。服务限制请求体、请求频率、遍历深度、返回数量和导出体积；工具不接受 filesystem path。

## 测试

```bash
uv run pytest
uv run python smoke.py --url http://127.0.0.1:7333/mcp
```
