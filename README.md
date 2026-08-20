# DSH Workspace

四层 DSH(Dashboard + Skills + Headless)工作区:经营分析助手 —— QC 业务看板、技能系统与 headless agent 的合一工作区。

## 结构

- `agent/` — dsh-base Eve agent 运行时(不依赖 Web/Next/React;宿主路径统一经 `agent/platform.ts` 的 `getAgentPaths()` 派生)
- `packages/chat-surface-ui/` — 纯 React 聊天 surface 插件包(`@chat-surface-ui/core`,SurfacePlugin 按 view 插槽)
- `surfaces/web/` — Next.js dashboard surface(`withEve` 嵌入 agent,`/eve/v1/*` 为 agent 通道)
- `surfaces/standalone/` — Vite 独立测试壳(chat-surface 包解耦验证床,port 5173)
- `skill-packages/` — 技能包(SKILL.md + 资产),由 `agent/skills/*.ts` 的 defineDynamic gate 按 `lib/skills/registry.json` 开关
- `qc-mcp-server/` — QC 业务数据 MCP bridge(看板数据来源;不可用时页面显示不可用态,绝不回退 demo 数字)
- `scripts/` — 验证与工具脚本(`verify-chat-basic.mjs` 真实聊天 E2E、`agent-smoke.mjs` L1 冒烟等)

## 快速开始

需要 Node.js 24.x。模型 API key 放 `surfaces/web/.env.local`(参考 `.env.example`):

```bash
npm install
npm run dev            # Next.js dev(port 3000,withEve 拉起嵌入式 agent)
npm run surface:standalone  # Vite 测试壳(port 5173)
npm run typecheck      # agent/ + packages + standalone + scripts 类型检查
```

前端独立调试:`npm run dev:eve`(agent TUI,127.0.0.1:2000)+ `npm run dev:frontend`(前端代理 `/eve/v1/*` 到 `EVE_AGENT_ORIGIN`)。

## 验证

```bash
PORT=3000 node scripts/verify-chat-basic.mjs   # 真实聊天 E2E:流式→落库→会话恢复
node scripts/agent-smoke.mjs                   # L1 冒烟:真实 eve invoke,turn completed
npm run skills:sync / skills:check             # 技能注册表刷新/校验
```

隐含原则:**可验证性优先** —— 文档 → 脚手架 → 工具 → API 演练 → typecheck 一条龙,尊重项目既有配置(详见 CLAUDE.md)。

## 生产

```bash
npm run build          # next build(surfaces/web)
npm run build:eve      # eve build(agent 独立产物 → .output/)
npm run start          # next start
```

Vercel 部署:根目录即 workspace 根;构建命令 `npm run build`。
