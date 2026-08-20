/**
 * 可见性矩阵存储层（SQLite，node:sqlite 零依赖，平台公共层，无 Next/React 依赖）。
 *
 * 目的：按「渠道 × 用户 × 插件/技能」三级粒度控制能力可见性。
 * 解析顺序（最具体者胜出，第一个命中即返回）：
 *   1. (channel, userId)  精确行
 *   2. (channel, '*')     渠道级
 *   3. ('*', '*')         全局
 * 无任何行时默认启用（true）。
 *
 * 表结构（plugin 与 skill 同构，skill 列名为 skill_id）：
 *  - plugin_visibility：插件可见性
 *  - skill_visibility：技能可见性
 *
 * 默认数据：建表后以 INSERT OR IGNORE 写入 channel='*', user_id='*' 的全量
 * 插件（qc/aro/dashboard/exa）与注册表内全部技能，enabled=1（幂等，重复开库不覆盖
 * 用户已有的显式配置）。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentPaths } from "../../platform";
import { readRegistryFile } from "../skills/registry-file";

/** 默认插件清单（全局全开的基础能力）。 */
export const DEFAULT_PLUGINS = ["qc", "aro", "dashboard", "exa"] as const;

/** 插件可见性行。 */
export interface PluginVisibilityRow {
  channel: string;
  userId: string;
  plugin: string;
  enabled: boolean;
}

/** 技能可见性行。 */
export interface SkillVisibilityRow {
  channel: string;
  userId: string;
  skillId: string;
  enabled: boolean;
}

/** listVisibility 返回的统一行（kind 判别 plugin / skill）。 */
export type VisibilityRow =
  | ({ kind: "plugin" } & PluginVisibilityRow)
  | ({ kind: "skill" } & SkillVisibilityRow);

/** 数据库文件路径（web: <webRoot>/data/visibility.db；其余: <repoRoot>/.eve/artifacts）。 */
export function visibilityDbPath(): string {
  return getAgentPaths().visibilityDbPath;
}

/** 打开（必要时创建）可见性数据库：建表 + 幂等写入默认行。 */
export function openVisibilityDb(): DatabaseSync {
  const dbPath = getAgentPaths().visibilityDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS plugin_visibility (
      channel TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '*',
      plugin  TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (channel, user_id, plugin)
    );
    CREATE TABLE IF NOT EXISTS skill_visibility (
      channel TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '*',
      skill_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (channel, user_id, skill_id)
    );
  `);
  seedDefaults(db);
  return db;
}

/** 默认行：全渠道全用户启用全部插件与注册表内全部技能（INSERT OR IGNORE 幂等）。 */
function seedDefaults(db: DatabaseSync): void {
  const pluginStmt = db.prepare(
    "INSERT OR IGNORE INTO plugin_visibility (channel, user_id, plugin, enabled) VALUES ('*', '*', ?, 1)",
  );
  for (const plugin of DEFAULT_PLUGINS) pluginStmt.run(plugin);
  const skillStmt = db.prepare(
    "INSERT OR IGNORE INTO skill_visibility (channel, user_id, skill_id, enabled) VALUES ('*', '*', ?, 1)",
  );
  for (const skill of readRegistryFile().skills) skillStmt.run(skill.name);
}

// ---------------------------------------------------------------------------
// 内存缓存：is* 查询结果按 (表|渠道|用户|名称) 缓存；写操作按祖先规则失效。
// 单进程部署，进程内 Map 足够。
// ---------------------------------------------------------------------------
const cache = new Map<string, boolean | VisibilityRow[]>();
/** 列表查询缓存键（任何写操作都失效）。 */
const LIST_CACHE_KEY = "visibility:list";

function cacheKey(table: "plugin" | "skill", channel: string, userId: string, name: string): string {
  return `${table}|${channel}|${userId}|${name}`;
}

/**
 * 写操作后失效缓存：解析 (ch, u) 只会读 (ch,u)、(ch,'*')、('*','*') 三档，
 * 故只有被写行 (wc, wu) 满足 (ch === wc || wc === '*') && (u === wu || wu === '*')
 * 时该查询结果才可能变化 —— 精确失效受影响的键，其余保留。
 */
function invalidateCache(table: "plugin" | "skill", channel: string, userId: string, name: string): void {
  cache.delete(LIST_CACHE_KEY);
  const prefix = `${table}|`;
  for (const key of cache.keys()) {
    if (!key.startsWith(prefix)) continue;
    const [, ch, u, n] = key.split("|");
    if (n === name && (ch === channel || channel === "*") && (u === userId || userId === "*")) {
      cache.delete(key);
    }
  }
}

/** 三档解析（精确 → 渠道级 → 全局），无任何行时默认 true。表/列名是内部常量，非用户输入。 */
function resolveEnabled(
  table: "plugin_visibility" | "skill_visibility",
  nameColumn: "plugin" | "skill_id",
  channel: string,
  userId: string,
  name: string,
): boolean {
  const db = openVisibilityDb();
  try {
    const stmt = db.prepare(
      `SELECT enabled FROM ${table} WHERE channel = ? AND user_id = ? AND ${nameColumn} = ?`,
    );
    // 档位 1+2：精确用户行 → 渠道级行
    for (const user of [userId, "*"]) {
      const row = stmt.get(channel, user, name) as { enabled: number } | undefined;
      if (row) return Number(row.enabled) === 1;
    }
    // 档位 3：全局行
    const globalRow = stmt.get("*", "*", name) as { enabled: number } | undefined;
    if (globalRow) return Number(globalRow.enabled) === 1;
    return true;
  } finally {
    db.close();
  }
}

/** 带缓存的解析：命中返回缓存，未命中解析并写入缓存。 */
function cachedResolve(table: "plugin" | "skill", channel: string, userId: string, name: string): boolean {
  const key = cacheKey(table, channel, userId, name);
  const hit = cache.get(key);
  if (hit !== undefined) return hit as boolean;
  const value =
    table === "plugin"
      ? resolveEnabled("plugin_visibility", "plugin", channel, userId, name)
      : resolveEnabled("skill_visibility", "skill_id", channel, userId, name);
  cache.set(key, value);
  return value;
}

/** 插件是否对 (渠道, 用户) 可见：最具体者胜出，无任何行时默认 true。 */
export function isPluginEnabled(channel: string, userId: string, plugin: string): boolean {
  return cachedResolve("plugin", channel, userId, plugin);
}

/** 技能是否对 (渠道, 用户) 可见：语义同 isPluginEnabled。 */
export function isSkillEnabled(channel: string, userId: string, skillId: string): boolean {
  return cachedResolve("skill", channel, userId, skillId);
}

/** 写可见性（upsert），成功后按祖先规则失效对应缓存。 */
function upsert(
  table: "plugin_visibility" | "skill_visibility",
  nameColumn: "plugin" | "skill_id",
  channel: string,
  userId: string,
  name: string,
  enabled: boolean,
): void {
  const db = openVisibilityDb();
  try {
    db.prepare(
      `INSERT INTO ${table} (channel, user_id, ${nameColumn}, enabled) VALUES (?, ?, ?, ?)
       ON CONFLICT(channel, user_id, ${nameColumn}) DO UPDATE SET enabled = excluded.enabled`,
    ).run(channel, userId, name, enabled ? 1 : 0);
  } finally {
    db.close();
  }
  invalidateCache(table === "plugin_visibility" ? "plugin" : "skill", channel, userId, name);
}

/** 写插件可见性（upsert）。 */
export function setPluginVisibility(channel: string, userId: string, plugin: string, enabled: boolean): void {
  upsert("plugin_visibility", "plugin", channel, userId, plugin, enabled);
}

/** 写技能可见性（upsert）。 */
export function setSkillVisibility(channel: string, userId: string, skillId: string, enabled: boolean): void {
  upsert("skill_visibility", "skill_id", channel, userId, skillId, enabled);
}

/** 清空全部可见性行（测试/重置用）；写操作失效缓存。 */
export function resetVisibility(): void {
  const db = openVisibilityDb();
  try {
    db.exec("DELETE FROM plugin_visibility; DELETE FROM skill_visibility;");
  } finally {
    db.close();
    cache.clear();
  }
}

/** 全部可见性行（调试/管理用）；结果缓存，任何写操作失效。 */
export function listVisibility(): VisibilityRow[] {
  const hit = cache.get(LIST_CACHE_KEY);
  if (hit !== undefined) return hit as VisibilityRow[];
  const db = openVisibilityDb();
  try {
    const pluginRows = db
      .prepare("SELECT channel, user_id, plugin, enabled FROM plugin_visibility ORDER BY plugin, channel, user_id")
      .all() as { channel: string; user_id: string; plugin: string; enabled: number }[];
    const skillRows = db
      .prepare("SELECT channel, user_id, skill_id, enabled FROM skill_visibility ORDER BY skill_id, channel, user_id")
      .all() as { channel: string; user_id: string; skill_id: string; enabled: number }[];
    const rows: VisibilityRow[] = [
      ...pluginRows.map((r) => ({
        kind: "plugin" as const,
        channel: r.channel,
        userId: r.user_id,
        plugin: r.plugin,
        enabled: Number(r.enabled) === 1,
      })),
      ...skillRows.map((r) => ({
        kind: "skill" as const,
        channel: r.channel,
        userId: r.user_id,
        skillId: r.skill_id,
        enabled: Number(r.enabled) === 1,
      })),
    ];
    cache.set(LIST_CACHE_KEY, rows);
    return rows;
  } finally {
    db.close();
  }
}
