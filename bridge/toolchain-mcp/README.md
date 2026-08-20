# toolchain-mcp — 受控二进制执行器

独立进程的 MCP server（Streamable HTTP，仿 qc-mcp-server 单进程模式），
给 eve agent 提供**受控的真实二进制执行**（沙箱 just-bash 跑不了的）：

| 工具 | 能力 | 白名单 |
|---|---|---|
| `run_skill_script` | tsx 执行技能包脚本 | `agent/skills/<skill>/scripts/*.{ts,mts,js}`，cwd=项目根 |
| `git_op` | git 只读操作 | `status / show / diff / log / ls-files` |
| `python_script` | python3 执行 | `scripts/`、`lib/`、`qc-mcp-server/scripts|evals` 内 |

## 安全约束

- 所有路径 resolve 后必须在项目根内（防 `../` 逃逸）
- `execFile` 无 shell（防命令注入）；参数作为字符串数组传入
- 非 loopback 监听必须设 `TOOLCHAIN_MCP_TOKEN`（eve 连接自动带 Bearer）
- 超时 30s、输出截断 20KB

## 启动与连接

```bash
cd bridge/toolchain-mcp && npm install && npm start
# → http://127.0.0.1:7332/mcp（默认端口 7332，错开 qc 的 7331）
```

eve 连接（`agent/connections/toolchain.ts`）自动指向 `http://127.0.0.1:7332/mcp`，
agent 可用工具名为 `toolchain__run_skill_script` 等。

## 冒烟

```bash
npm start &        # 起 server
npm run smoke      # healthz + git_op + python_script
```

## 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `TOOLCHAIN_MCP_HOST` | `127.0.0.1` | 监听地址 |
| `TOOLCHAIN_MCP_PORT` | `7332` | 监听端口 |
| `TOOLCHAIN_MCP_TOKEN` | 未设置 | 非 loopback 必填 |
