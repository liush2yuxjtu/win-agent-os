# qc-mcp-server

MCP server 提供 **QC 数据字典**（`video_management` / `WIN_DOUYIN`，37 张表）与**只读 SQL 查询**能力。

## 能力

| 工具 | 说明 |
| --- | --- |
| `qc_search_table_docs` | 按业务词 / 中文名 / 表名 / 字段名搜索数据字典 |
| `qc_get_table_doc` | 读取单张表完整结构（字段 / 类型 / 主键 / 枚举 / 关联） |
| `qc_list_tables` | 按数据库分页列出所有表 |
| `qc_query_database` | 对 `video_management` / `WIN_DOUYIN` 执行只读 SELECT/CTE |
| `qc_recommend_table` | 根据业务问题推荐最相关的表 |

## 快速开始

```bash
npm install
npm run build

# 自检（打印字典加载情况与工具清单）
npm run self-test          # node dist/index.js --self-test

# 默认：Streamable HTTP server（Eve MCP client 直连）
npm start                  # node dist/index.js → http://127.0.0.1:7331/mcp

# 调试：作为 MCP stdio 服务器运行
npm run start:stdio
```

监听配置沿用原 bridge 的环境变量（Eve 连接 `agent/connections/qc.ts` 的 URL 不变）：

```
QC_MCP_BRIDGE_HOST=127.0.0.1        # 监听地址（默认 loopback）
QC_MCP_BRIDGE_PORT=7331             # 监听端口
QC_MCP_BRIDGE_TOKEN=***             # 非 loopback 监听时必填
```

配置通过环境变量（见 `.env.example`）或 `.env` 提供：

```
QC_MSSQL_HOST=127.0.0.1
QC_MSSQL_PORT=1433
QC_MSSQL_USER=app_data
QC_MSSQL_PASSWORD=***
QC_RAW_FILES_DIR=/abs/path/to/raw_files   # 默认 ./raw_files
```

## 连接数据库（本机开发）

生产库 `127.0.0.1:1433` 在公司内网，开发机无法直连，需要经 Tailscale 中继（`macmini`）+ SSH 隧道：

```bash
# 1. 确认 Tailscale 在线（macmini 为 active）
tailscale status

# 2. 建立隧道：本地 11433 → macmini → 127.0.0.1:1433
ssh -fN sqlserver-sucai        # 配置见 ~/.ssh/config
#    停隧道：ssh -O exit sqlserver-sucai

# 3. 用隧道配置覆盖 .env（模板见 .env.tunnel）
cp .env.tunnel .env && node dist/index.js --self-test
#    或运行时覆盖，无需改 .env：
#    QC_MSSQL_HOST=127.0.0.1 QC_MSSQL_PORT=11433 node dist/index.js
```

`sql_judge` 的判题脚本同样依赖该隧道（见 `evals/sql_judge/README.md`）。

## 安全约束

- **只读**：仅接受以 `SELECT` / `WITH` 开头的单条语句；`INSERT/UPDATE/DELETE/DDL/EXEC/SELECT INTO` 一律拒绝。
- **行数上限**：通过 `SET ROWCOUNT` 在会话级截断，`max_rows` 上限 500。
- **敏感脱敏**：列名匹配 password/token/secret/key 的值自动替换为 `[REDACTED]`。
- **配置校验**：连接失败时返回可操作的排查提示，不泄露堆栈。

## 并发与连接池

- 支持 **最多 16 个并行工具调用**（含并发 SQL 查询），由每库连接池 `max=16` 覆盖。
- 每数据库一个 **持久连接池**（`min=1` 常驻、`idleTimeout=300s`）：SQL 查询复用同一批连接，不按次新建 TCP/TLS 登录；连接池初始化有并发去重，避免竞态建池。
- 可用常量：`DB_POOL_MAX` / `DB_POOL_MIN` / `DB_POOL_IDLE_MS`（`src/constants.ts`）。


## 项目结构

```
src/
├── index.ts                 # 入口：Streamable HTTP（默认）/ stdio / 自检
├── constants.ts             # 环境配置 / 常量
├── types.ts                 # TableDoc / FieldDoc / TableRelation 等类型
├── dictionary/
│   ├── parser.ts            # 解析 raw_files/*.md 十段模板
│   └── index.ts             # 内存索引 + 关键词搜索 + 业务推荐
├── services/
│   └── mssql.ts             # 只读查询服务（校验 / 脱敏 / 截断）
└── tools/
    ├── register.ts          # 5 个工具注册（Zod schema + annotations）
    └── format.ts            # 输出格式化（markdown / 对齐文本）
```

## 与 Pi 集成

`.pi/extensions/qc-mcp.ts` 通过 stdio 调用本服务器（`node dist/index.js`），
对外暴露 `qc_search_table_docs`、`qc_get_table_doc`、`qc_list_tables`、`qc_query_database` 四个工具。

## 评估

`evals/evaluation.xml` 包含 10 条只读、可复现的问答对；用 `scripts/evaluation.py`（见 skill）或 Pi 运行。
