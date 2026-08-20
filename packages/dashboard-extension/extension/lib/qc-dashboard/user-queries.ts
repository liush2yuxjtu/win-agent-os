/**
 * 用户自定义只读 SQL 注册表（user:<slug> 数据源）。
 *
 * 注意：本模块**不含** `server-only` 保护——eve 的 agent 工具模块
 * （agent/tools/*.ts）在宿主服务端执行，也会 import 本模块；
 * server-only 保护放在 registry.ts（Next.js 渲染侧消费方）即可。
 *
 * 本文件是 extension 副本：宿主路径由 extension.config.userQueriesPath 注入
 * （挂载时配置），禁止 import 平台 getAgentPaths。前端 registry.ts 引用的是
 * agent 侧副本（agent/lib/qc-dashboard/user-queries.ts，原样保留）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import extension from "../../extension";

export interface UserQueryRecord {
  sql: string;
  title?: string;
  createdAt: string;
}

export interface UserQueryRegistry {
  queries: Record<string, UserQueryRecord>;
}

export interface SaveUserQueryResult {
  ok: boolean;
  error?: string;
}

export const USER_PREFIX = "user:";

const USER_QUERY_MAX_ROWS = 100;

const SLUG_PATTERN = /^[a-z0-9_-]{1,40}$/;
const READ_ONLY_PREFIX = /^(select|with)\b/i;
// 词边界匹配，避免误伤列名（如 updated_at 不含 update）。
const FORBIDDEN_KEYWORDS = /\b(drop|insert|update|delete|alter|truncate|grant)\b/i;

function userRegistryPath(): string {
  return extension.config.userQueriesPath;
}

/** 用户查询最大返回行数（resolveUserQuery 用）。 */
export function userQueryMaxRows(): number {
  return USER_QUERY_MAX_ROWS;
}

export function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trim();
  return READ_ONLY_PREFIX.test(trimmed) && !FORBIDDEN_KEYWORDS.test(trimmed);
}

export function readUserRegistry(): UserQueryRegistry {
  if (!fs.existsSync(userRegistryPath())) return { queries: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(userRegistryPath(), "utf8"));
  } catch {
    throw new Error(`用户查询注册表文件无法解析：${userRegistryPath()}`);
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as UserQueryRegistry).queries !== null &&
    typeof (parsed as UserQueryRegistry).queries === "object"
  ) {
    return parsed as UserQueryRegistry;
  }
  throw new Error(`用户查询注册表文件结构非法：${userRegistryPath()}`);
}

/**
 * 保存用户自定义只读 SQL 为可复用的数据源（queryId: user:<slug>）。
 * 校验 slug 格式与 SQL 只读性；失败返回 { ok: false, error }，不抛错。
 */
export async function saveUserQuery(
  slug: string,
  sql: string,
  meta?: { title?: string },
): Promise<SaveUserQueryResult> {
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, error: "slug 格式不合法：仅允许小写字母、数字、下划线、连字符，长度 1-40" };
  }
  const trimmed = sql.trim();
  if (!isReadOnlySql(trimmed)) {
    return { ok: false, error: "SQL 必须以 SELECT 或 WITH 开头，且不得包含 DROP/INSERT/UPDATE/DELETE/ALTER/TRUNCATE/GRANT（只读查询）" };
  }

  try {
    const registry = readUserRegistry();
    registry.queries[slug] = {
      sql: trimmed,
      ...(meta?.title ? { title: meta.title } : {}),
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(userRegistryPath()), { recursive: true });
    fs.writeFileSync(userRegistryPath(), JSON.stringify(registry, null, 2), "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `保存失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
