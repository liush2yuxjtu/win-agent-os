# QC stdio → Streamable HTTP MCP bridge

Eve 0.38.3 的 MCP client connection 只接受 Streamable HTTP/SSE URL。本 bridge 将 `/Users/liushiyuwin/MCP_source` 的 stdio MCP Server 暴露为仅 loopback 可访问的 Streamable HTTP endpoint。

## 前置条件

```bash
cd /Users/liushiyuwin/MCP_source
npm install
npm run build
```

数据库查询还需要可用的 `QC_MSSQL_*` 环境变量和 SQL Server 隧道；表字典工具不需要数据库连接。

## 安装与启动

```bash
cd /Users/liushiyuwin/MCP_connect_skill/bridge/qc-mcp
npm install
npm start
```

默认地址：

- MCP：`http://127.0.0.1:7331/mcp`
- 健康检查：`http://127.0.0.1:7331/healthz`

另开终端运行：

```bash
cd /Users/liushiyuwin/MCP_connect_skill/bridge/qc-mcp
npm run smoke
```

然后从项目根目录启动 Eve：

```bash
cd /Users/liushiyuwin/MCP_connect_skill
npm run dev:eve
```

Eve 从 `agent/connections/qc.ts` 发现连接，远端工具名为 `qc__qc_<tool>`。

## 配置

| 变量 | 默认值 | 用途 |
|---|---|---|
| `QC_MCP_BRIDGE_HOST` | `127.0.0.1` | bridge 监听地址 |
| `QC_MCP_BRIDGE_PORT` | `7331` | bridge 端口 |
| `QC_MCP_BRIDGE_URL` | `http://127.0.0.1:7331/mcp` | Eve/smoke 连接地址 |
| `QC_MCP_BRIDGE_TOKEN` | 未设置 | 非 loopback 监听时必填；Eve 自动添加 Bearer header |
| `QC_NODE_BIN` | 当前 Node | 启动 QC MCP 的 Node 路径 |
| `QC_MCP_CWD` | `/Users/liushiyuwin/MCP_source` | QC MCP 工作目录 |
| `QC_MCP_SERVER` | `<QC_MCP_CWD>/dist/index.js` | stdio server 入口 |
| `QC_RAW_FILES_DIR` | `<QC_MCP_CWD>/raw_files` | 表字典目录 |

bridge 默认只监听 loopback，并使用 SDK 自带的 Host header 校验。绑定到非 loopback 地址时，必须设置 `QC_MCP_BRIDGE_TOKEN`。
