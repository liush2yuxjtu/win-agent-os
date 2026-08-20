/**
 * Agent Runtime 平台装配层（dsh-base 的单一配置点）。
 *
 * 目标：agent/ 目录不依赖 Web/Next/React，也不散落 `process.cwd()` 拼接
 * Web 路径假设。所有「宿主机路径」一律经本文件的 `getAgentPaths()` 派生，
 * web / standalone / headless 三种 profile 的差异只在本文件维护。
 *
 * - web        ：Next.js 嵌入式部署（默认，保持现有行为）。
 * - standalone ：独立 agent 进程（eve dev / eve start）。
 * - headless   ：无 Web 界面的纯 Runtime（测试 / 脚本 / 服务端调用）。
 *
 * Phase 4 迁移到 `surfaces/web/` 后，只需调整 `resolveWebSurfaceRoot()`，
 * 其余模块无需改动。
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { SkillRecord, SkillRegistry } from "./lib/skills/types";
import type { EvalRunRecord } from "./lib/platform/web/skill-evals/history";

export type SurfaceProfile = "web" | "standalone" | "headless";

/** 当前 profile。默认 "web" 保持现有嵌入式行为；standalone/headless 由环境显式指定。 */
export function resolveSurfaceProfile(): SurfaceProfile {
  const raw = process.env.SURFACE_PROFILE?.trim().toLowerCase();
  if (raw === "standalone" || raw === "headless" || raw === "web") return raw;
  return "web"; // 兼容现有 `npm run dev` / `eve dev` 未设置 profile 的行为
}

/**
 * 仓库根：从 cwd 向上查找包含 `agent/platform.ts` 的目录。
 *
 * Phase 4 后 Next.js dev/build/start 的 cwd 是 `surfaces/web`，而 eve 进程
 * cwd 仍是仓库根；单一 `process.cwd()` 不再可靠。本函数保证两种 cwd 下
 * 都解析到真正的仓库根（含 `agent/`、`skill-packages/`、`lib/skills/registry.json`）。
 */
export function resolveRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, "agent", "platform.ts"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return dir; // 到达文件系统根仍未找到，退回 cwd
    dir = parent;
  }
}

/**
 * web surface 根。
 * 最终形态：<repoRoot>/surfaces/web；Phase 1 尚未创建 surfaces/web，回退 repoRoot。
 * 可用 SURFACE_WEB_ROOT 显式覆盖（相对 repoRoot）。
 */
export function resolveWebSurfaceRoot(): string {
  const repoRoot = resolveRepoRoot();
  const override = process.env.SURFACE_WEB_ROOT?.trim();
  if (override) return path.resolve(repoRoot, override);
  const finalPath = path.join(repoRoot, "surfaces", "web");
  return fs.existsSync(path.join(finalPath, "package.json")) ? finalPath : repoRoot;
}

export interface AgentPaths {
  readonly profile: SurfaceProfile;
  readonly repoRoot: string; // 仓库根（skill-packages、agent/、.eve 的锚点）
  readonly webSurfaceRoot: string; // web surface 根（Phase 1 过渡期 = repoRoot）
  readonly skillsRoot: string; // <repoRoot>/skill-packages
  readonly gateRoot: string; // <repoRoot>/agent/skills
  readonly skillEvalsDir: string; // <repoRoot>/.eve/artifacts/skill-evals
  readonly reportsDir: string; // web: <webRoot>/public/reports；其他: <repoRoot>/.eve/artifacts/reports
  readonly dashboardSpecPath: string; // web: <webRoot>/data/dashboard-spec.json；其他: <repoRoot>/.eve/artifacts/dashboard-spec.json
  readonly registrySnapshotPath: string; // <repoRoot>/lib/skills/registry.json（git 快照，只读位置不变）
  readonly chatSessionsDbPath: string;
  readonly reportsDbPath: string;
  readonly skillEvalsDbPath: string; // web: <webRoot>/data/skill-evals.db；其他: <repoRoot>/.eve/artifacts/skill-evals.db
  readonly skillsDbPath: string;
  readonly botBindingsDbPath: string;
  readonly visibilityDbPath: string; // 可见性矩阵（插件/技能按渠道×用户开关）
}

export function getAgentPaths(profile: SurfaceProfile = resolveSurfaceProfile()): AgentPaths {
  const repoRoot = resolveRepoRoot();
  const webRoot = profile === "web" ? resolveWebSurfaceRoot() : repoRoot;
  return {
    profile,
    repoRoot,
    webSurfaceRoot: webRoot,
    skillsRoot: path.join(repoRoot, "skill-packages"),
    gateRoot: path.join(repoRoot, "agent", "skills"),
    skillEvalsDir: path.join(repoRoot, ".eve", "artifacts", "skill-evals"),
    reportsDir:
      profile === "web"
        ? path.join(webRoot, "public", "reports")
        : path.join(repoRoot, ".eve", "artifacts", "reports"),
    dashboardSpecPath:
      profile === "web"
        ? path.join(webRoot, "data", "dashboard-spec.json")
        : path.join(repoRoot, ".eve", "artifacts", "dashboard-spec.json"),
    registrySnapshotPath: path.join(repoRoot, "lib", "skills", "registry.json"),
    chatSessionsDbPath:
      profile === "web"
        ? path.join(webRoot, "data", "chat-sessions.db")
        : path.join(repoRoot, ".eve", "artifacts", "chat-sessions.db"),
    reportsDbPath:
      profile === "web"
        ? path.join(webRoot, "data", "reports.db")
        : path.join(repoRoot, ".eve", "artifacts", "reports.db"),
    skillEvalsDbPath:
      profile === "web"
        ? path.join(webRoot, "data", "skill-evals.db")
        : path.join(repoRoot, ".eve", "artifacts", "skill-evals.db"),
    skillsDbPath:
      profile === "web"
        ? path.join(webRoot, "data", "skill-registry.db")
        : path.join(repoRoot, ".eve", "artifacts", "skill-registry.db"),
    botBindingsDbPath:
      profile === "web"
        ? path.join(webRoot, "data", "bot-bindings.db")
        : path.join(repoRoot, ".eve", "artifacts", "bot-bindings.db"),
    visibilityDbPath:
      profile === "web"
        ? path.join(webRoot, "data", "visibility.db")
        : path.join(repoRoot, ".eve", "artifacts", "visibility.db"),
  };
}

/**
 * `dashboard-queries.json` 不单独成字段：始终与 dashboardSpecPath 同目录派生，
 * 保证与 dashboard spec 一起随 surface 迁移。
 */
export function getUserQueriesPath(paths: AgentPaths = getAgentPaths()): string {
  return path.join(path.dirname(paths.dashboardSpecPath), "dashboard-queries.json");
}

// ---------------------------------------------------------------------------
// Store seam：agent 内共享存储的 profile 选择器
// ---------------------------------------------------------------------------

// ---- HistoryStore（真实导出见 agent/lib/platform/web/chat-sessions/db.ts）----
export interface ChatHistoryEntryLite {
  readonly sessionId: string;
  readonly streamIndex: number;
  readonly title: string;
  readonly lastAt: number;
  readonly userMessages: number;
  readonly archived?: boolean;
}

export interface StoredChatMessageLite {
  seq: number;
  role: string;
  content: string;
  toolName?: string;
  createdAt: string;
}

export interface HistoryStore {
  chatSessionsDbPath(): string;
  openChatSessionsDb(): DatabaseSync | null;
  upsertChatSession(
    entry: Pick<ChatHistoryEntryLite, "sessionId" | "streamIndex" | "title" | "lastAt" | "userMessages">,
    source?: string,
    meta?: { archived?: boolean },
  ): void;
  listChatSessions(limit?: number, source?: string | null): ChatHistoryEntryLite[];
  getChatSession(sessionId: string): ChatHistoryEntryLite | null;
  listChatMessages(sessionId: string, limit?: number): StoredChatMessageLite[];
  appendChatMessages(sessionId: string, messages: Array<Omit<StoredChatMessageLite, "createdAt">>): number;
  botChatSessionId(botKey: string, conversationKey: string): string;
  recordBotMessage(opts: { botKey: string; conversationKey: string; role: "user" | "assistant"; text: string }): void;
  deleteChatSession(sessionId: string): void;
  clearChatSessions(): void;
}

// ---- ReportStore（真实导出见 agent/lib/platform/web/report-store/db.ts）----
export interface ReportMetaLite {
  id: string;
  name: string;
  path: string;
  title: string;
  sizeBytes: number;
  dynamic: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportStore {
  reportsDbPath(): string;
  openReportsDb(): DatabaseSync | null;
  isDynamicReport(html: string): boolean;
  registerReport(name: string, html: string): ReportMetaLite;
  archiveReport(id: string, archived: boolean): void;
  listReports(): ReportMetaLite[];
  getReport(id: string): ReportMetaLite | null;
  deleteReport(id: string): void;
  countReports(): number;
  scanReportsDir(): number;
}

// ---- SkillRegistryStore（真实导出见 agent/lib/platform/web/skills/db.ts + agent/lib/skills/registry-file.ts）----
export interface SkillRegistryStore {
  dbPath(): string;
  openDb(): DatabaseSync | null;
  syncToDb(skills: SkillRecord[]): number;
  readFromDb(): SkillRecord[];
  persistRegistry(registry: SkillRegistry): SkillRegistry;
  registryPath(): string;
  readRegistryFile(): SkillRegistry;
  writeRegistryFile(next: SkillRegistry): void;
}

// ---- SkillEvalsStore（真实导出见 agent/lib/platform/web/skill-evals/history.ts + feedback.ts）----
export interface EvalHistoryLite {
  skillName: string;
  runs: EvalRunRecord[];
}

export interface EvalComparisonLite {
  hasPrevious: boolean;
  triggerDelta: number | null;
  functionalDelta: number | null;
  triggerImproved: string[];
  triggerRegressed: string[];
  functionalImproved: string[];
  functionalRegressed: string[];
}

export interface SkillEvalsStore {
  loadHistory(skillName: string): EvalHistoryLite;
  appendRun(skillName: string, record: EvalRunRecord): EvalHistoryLite;
  getLastRun(skillName: string): EvalRunRecord | null;
  caseKey(text: string): string;
  buildComparison(skillName: string, current: EvalRunRecord): EvalComparisonLite | null;
  saveFeedback(skillName: string, key: string, text: string): void;
  loadFeedback(skillName: string): Record<string, string>;
  feedbackSummary(skillName: string): string;
}

/**
 * Store 选择器：web profile 用 SQLite/web 实现；standalone/headless 用
 * fs/JSON 降级实现。具体 store 绑定见 agent/lib/platform/stores.ts。
 */
export function getStore<T>(web: T, fallback: T): T {
  const profile = resolveSurfaceProfile();
  return profile === "web" ? web : fallback;
}
