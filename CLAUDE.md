# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This project requires Node.js 24.x and uses npm workspaces. The Next.js web app lives in `surfaces/web`; the agent runtime lives in `agent/`.

```bash
npm install                 # Install all workspace dependencies
npm run dev                 # Start the web surface (surfaces/web) with the embedded Eve dev server
npm run surface:web         # Same as npm run dev (Next.js dev on port 3000, withEve pulls up the agent)
npm run surface:web:build   # Build the Next.js web surface
npm run surface:web:start   # Start a previously built web surface
npm run surface:web:typecheck # Typecheck the web surface only
npm run dev:frontend        # Frontend-only web dev (no embedded agent); proxies /eve/v1/* to EVE_AGENT_ORIGIN
npm run agent:dev           # eve dev (agent terminal development UI on 127.0.0.1:2000)
npm run agent:headless      # eve invoke (headless agent invocation; pass --help for usage)
npm run build               # Build the web surface (alias for surface:web:build)
npm run build:eve           # Build only the Eve agent
npm run dev:eve             # Start the Eve terminal development UI (alias of agent:dev)
npm run start:eve           # Start a previously built Eve agent
npm run typecheck           # Root typecheck: agent/ + packages/chat-surface-ui + surfaces/standalone + scripts
npm run typecheck:all       # Root typecheck + every workspace that has a typecheck script
npm run surface:standalone  # Vite standalone chat-surface test shell (port 5173)
npm run surface:standalone:build # Typecheck + build the standalone shell
npm run skills:sync         # Scan skill-packages/ → regenerate lib/skills/registry.json (keeps enabled overrides)
npm run skills:check        # Check-only sync + qc table-reference validation against the qc-mcp-server dictionary
npm run evals:run -- --max-concurrency 8 # 本地全量 eval；独立 just-bash 根沙盒，不占 AgentBay 会话
npm run extensions:sync     # 按 extension profile 生成 agent/extensions/(默认 full;--profile <name> 或 EVE_EXTENSION_PROFILE=<name>)
npm run dev:aro             # aro 组合启动(EVE_EXTENSION_PROFILE=aro + eve dev,只挂 aro+dashboard)
npm run start:aro           # aro 组合启动已构建产物
npm run build:aro           # aro 组合构建
npm run eve profile list                     # 列出所有 profile(统一 CLI,无需 --)
npm run eve profile use <name>               # 切换组合(生成 agent/extensions/,不启动)
npm run eve profile current                  # 显示当前生效组合
npm run eve <profile> <command> [args]       # profile 前置:如 `aro dev` / `aro build` / `aro start`
npm run eve <command> --extension-profile <name> # flag 形式:如 `dev --extension-profile aro`
```

Frontend-only standalone testing: run `npm run dev:eve` in one terminal (agent on `127.0.0.1:2000`, unchanged) and `npm run dev:frontend` in another. `EVE_FRONTEND_ONLY=1` makes `surfaces/web/next.config.ts` skip `withEve()` and rewrite `/eve/v1/*` to `EVE_AGENT_ORIGIN` (`surfaces/web/lib/eve-frontend-config.ts`), so no CORS change in `agent/channels/eve.ts` is needed.

`SURFACE_PROFILE` (`web` | `standalone` | `headless`) selects the path profile in `agent/platform.ts`; `SURFACE_WEB_ROOT` overrides the web surface root relative to the repo root. `withEve()` in `surfaces/web/next.config.ts` passes `eveRoot: "../.."`, so the agent is launched from the repository root while the Next.js app runs in `surfaces/web`.

**Extension 组合 profile**（开发者用单个 profile 配置组合出不同运行时）:eve 的 `agent/extensions/` 是静态目录扫描（全挂、无条件挂载），因此挂载哪些 extension 由 `npm run extensions:sync`（`scripts/sync-extensions.mts`）按 profile 生成:

- 全量挂载文件在 `agent/extensions-available/<plugin>.ts`（真实文件，commit）；`agent/extensions/` 是生成目录（gitignore，不 commit）
- 组合声明在 `profiles/<name>.json`（`{ "extensions": ["aro","dashboard"] }`）;内置 `full`（全量，默认）`aro`（aro+dashboard）`qc`（qc+dashboard）
- 用法: `EVE_EXTENSION_PROFILE=aro npm run dev:eve` 或 `npm run extensions:sync -- --profile aro`；eve dev watch 自动跟随目录变化（组合切换即时生效，无需重启）
- `SURFACE_PROFILE` 仍只控制 `web` / `standalone` / `headless` 路径；extension 组合只读 `EVE_EXTENSION_PROFILE`，两者互不覆盖
- web 和 eve 主启动脚本都在启动前 sync；`npm run dev`、`npm run build` 与全新 checkout 不依赖本地残留的生成目录
- 不带 `--url` 的 `eve eval` 默认设置 `EVE_SANDBOX_BACKEND=justbash`，避免 AgentBay 账户级并发污染结果；显式设置该变量可覆盖

No lint or test runner is currently configured, so there is no single-test command. Do not invent one; update this section when a test framework is added.

> 隐含原则:**可验证性优先** —— 任何改动按「文档 → 脚手架 → 工具 → API 演练 → typecheck 一条龙」验证,且尊重项目既有配置(如 `.gitignore`、`lib/skills/registry.json` 快照位置、既有 workspace 结构)。结构改动(迁移/重构)尤其要以真实调用(而非仅编译)证明行为未变。

## Architecture

This is a four-layer DSH (dashboard + skills + headless) workspace:

- `agent/` — the dsh-base Eve agent runtime. It must stay free of Next.js/React/Web imports and derives all host paths from `agent/platform.ts` (`getAgentPaths()`).
- `packages/chat-surface-ui/` — the pure React chat-surface plugin package (`@chat-surface-ui/core`).
- `surfaces/web/` — the Next.js dashboard surface. `withEve()` in `surfaces/web/next.config.ts` mounts the agent and its HTTP channel into the Next.js dev/deploy lifecycle.
- `surfaces/standalone/` — a Vite minimal test shell for the chat-surface package.

- `surfaces/web/app/page.tsx` owns the SaaS dashboard shell: desktop navigation, KPI/analytics content, and the persistent AI panel. The dashboard layout is a **generative element-tree spec** (see dashboard-spec layer below) whose data comes from real QC business data through a three-layer model:
  - `agent/lib/qc-dashboard/queries.ts` — fixed, read-only SQL scripts (anchored to the latest data date) run against the QC MCP bridge.
  - `agent/lib/qc-dashboard/formulas.ts` — business-readable Excel-style formula layer (`BUSINESS_FORMULAS`); page components never do business math themselves.
  - `surfaces/web/lib/qc-dashboard/data.ts` (server-only) — executes the fixed queries, evaluates the formulas, and runs per-figure evals (date completeness, non-negativity, formula finiteness). Result is cached 15 minutes via `unstable_cache`; every figure on the page carries a `queryId` + `formula` + `eval` trail. If QC is unreachable the page shows an explicit unavailable state — it never falls back to demo numbers.
- Dashboard spec layer (Generative UI — the dashboard is a JSON element-tree the chat can read/edit end-to-end):
  - `agent/lib/dashboard-spec/default-spec.ts` — `buildDefaultDashboardSpec()` returns the full base spec (banner/KPI5/trend/insights/table/quality cards); `injectKpiState()` binds live KPI numbers. `crud.ts` holds pure functions `baseSpec`/`addCard`/`removeCard`/`editCard` (baseSpec(null) → full base spec; CRUD never writes to disk, the preview goes through `render_ui` for human approval).
  - `surfaces/web/lib/qc-dashboard/registry.ts` — queryId registry (`fixed:anchor|daily|topMaterials|insights` + `user:<slug>`); `resolveQuery()` returns `{rows?, title?, description?, value?}`. **No `import "server-only"` here** — the eve tool loader breaks on it. `agent/lib/qc-dashboard/user-queries.ts` persists user SQL to `surfaces/web/data/dashboard-queries.json` with read-only validation.
  - `agent/lib/json-render/data-binding.ts` — spec data binding: `props.dataRef = { queryId, field }` collected via `collectDataRefs` / resolved via `resolveDataRefs` (rows normalized per component type: Table → array of arrays, BarChart → object array). `surfaces/web/lib/json-render/chat-renderer.tsx` (ChatJsonRender) auto-fetches dataRefs, downgrades Grid columns in narrow containers (<320px → 1 col, <560px → 2), and patches `w-full` (Stack/Grid collapse without it). `custom-components.tsx` adds the self-drawn BarChart (filter by period).
  - `agent/lib/platform/web/dashboard-spec-file.ts` + `surfaces/web/app/api/dashboard-spec/route.ts` — server copy at `surfaces/web/data/dashboard-spec.json`, synced by the frontend on save/clear, read by agent tools. `surfaces/web/app/api/query/route.ts` is the data outlet (`?queryId=`); `surfaces/web/app/api/dashboard-verify/route.ts` runs `scripts/dashboard-verify.py` (90s timeout).
  - `agent/tools/dashboard_{read,create,edit,remove,verify}.ts` + `qc_query_save.ts` — chat CRUD entry points; `agent/skills/edit-dashboard/SKILL.md` is the incremental-CRUD workflow (always `dashboard_read` first, never rebuild from scratch).
- `surfaces/web/app/_components/agent-chat.tsx` is the client-side Eve conversation controller. It uses `useEveAgent()` for sessions, streaming, cancellation, attachments, and human-in-the-loop responses.
- `surfaces/web/app/_components/agent-message.tsx` and the chat-surface package render streamed messages, tools, reasoning, files, and prompts. Keep dashboard layout concerns out of these lower-level renderers.
- `agent/agent.ts` defines the root model. `agent/instructions.md` is the always-on runtime prompt.
- `agent/channels/eve.ts` configures the built-in HTTP channel and auth chain. `placeholderAuth()` is development scaffolding and must be replaced with real application authentication before a production SaaS launch.
- Skill packages live in `skill-packages/<name>/` (SKILL.md + references/assets/scripts). eve never scans them directly: `agent/skills/<name>.ts` is a `defineDynamic` gate (see `agent/lib/skills-runtime.ts`) that exposes the package only when `lib/skills/registry.json` marks it `enabled` — **runtime disable works**: toggling in the UI flips the registry flag, and the gate re-resolves on every `turn.started`, so the disabled skill disappears from Available skills / `load_skill` on the next message. No directory moves, no rebuild. Skill-authoring skills (`authoring-skills`, `skill-creator`) live here so the chat can create/modify skills in natural language (`publish_skill.ts` writes to `skill-packages/` and generates the gate file).
- `lib/skills/registry.json` is the committed registry snapshot (read by `agent/lib/skills/registry-file.ts`; enabled overrides live in the snapshot). The runtime/web layer splits between `agent/lib/skills/` (scan/registry-file/types/validate, no Next.js deps) and `surfaces/web/lib/skills/` (`registry.ts` server-only + `actions.ts` server action). Refresh the snapshot with `npm run skills:sync`; validate with `npm run skills:check`.
- `surfaces/web/app/skills/page.tsx` renders the skill registry UI (list, toggle, audit) inside `DualModeShell`. Toggling is real runtime disable (see the gate mechanism above) — no rebuild needed.
- `lib/skills` metadata can optionally sync to the `public.skills` table in the `pulse-dashboard-dev` Supabase project (RLS enabled).
- Future integrations belong under `agent/connections/`; typed business operations belong under `agent/tools/`. Consult the installed, version-matched docs at `node_modules/eve/docs/README.md` before implementing Eve APIs.

The dashboard renders real QC business data (see the three-layer model above) through a generative spec. Keep the mapping honest: any new figure must come from a fixed SQL script in `agent/lib/qc-dashboard/queries.ts` plus a formula in `agent/lib/qc-dashboard/formulas.ts` (or a saved user query registered in `surfaces/web/lib/qc-dashboard/registry.ts`) — never hardcode values in components. Layout edits go through `agent/lib/dashboard-spec/crud.ts` pure functions, not component surgery. The chat is real and talks to the embedded Eve agent. Requires the QC MCP server (see `qc-mcp-server/README.md`) for data; the page renders an unavailable state when it is down.
