/**
 * 技能注册表本地 SQLite 层（Node 24 内置 node:sqlite，零依赖）。
 *
 * 数据流：
 *  文件系统（技能本体，单一事实源）→ 扫描 → SQLite（注册表数据库，本地权威副本）
 *  → 导出 registry.json（git 快照，供 /skills 页与部署读取）。
 *
 * SQLite 文件不入库（gitignore）；Supabase --push/--pull 仍为可选云端同步，
 * 不配置 key 不影响本地使用。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAgentPaths } from "../../../../platform";
import type { SkillRegistry, SkillRecord } from "../../../skills/types";

export function dbPath(): string {
  return getAgentPaths().skillsDbPath;
}

/** 打开（不存在则创建）注册表数据库。 */
export function openDb(): DatabaseSync {
  const dbPath = getAgentPaths().skillsDbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      name        TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      kind        TEXT NOT NULL,
      folder      TEXT NOT NULL,
      files       TEXT NOT NULL DEFAULT '[]',
      mtime       TEXT NOT NULL DEFAULT '',
      enabled     INTEGER NOT NULL DEFAULT 1,
      metadata    TEXT,
      updated_at  TEXT NOT NULL
    );
  `);
  return db;
}

const UPSERT = `
  INSERT INTO skills (name, description, kind, folder, files, mtime, enabled, metadata, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    description = excluded.description,
    kind = excluded.kind,
    folder = excluded.folder,
    files = excluded.files,
    mtime = excluded.mtime,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at
`;

/** 把扫描结果全量 upsert 进 SQLite（enabled 由调用方传入，通常来自目录位置）。 */
export function syncToDb(skills: SkillRecord[]): number {
  const db = openDb();
  const stmt = db.prepare(UPSERT);
  const now = new Date().toISOString();
  for (const skill of skills) {
    stmt.run(
      skill.name,
      skill.description,
      skill.kind,
      skill.folder,
      JSON.stringify(skill.files),
      skill.mtime,
      skill.enabled ? 1 : 0,
      skill.metadata ? JSON.stringify(skill.metadata) : null,
      now,
    );
  }
  const count = db.prepare("SELECT COUNT(*) AS n FROM skills").get() as { n: number };
  db.close();
  return count.n;
}

/** 读取 SQLite 全表（按名称排序）。 */
export function readFromDb(): SkillRecord[] {
  const db = openDb();
  const rows = db.prepare("SELECT * FROM skills ORDER BY name").all() as Array<{
    name: string;
    description: string;
    kind: string;
    folder: string;
    files: string;
    mtime: string;
    enabled: number;
    metadata: string | null;
  }>;
  db.close();
  return rows.map((row) => ({
    name: row.name,
    description: row.description,
    kind: row.kind as SkillRecord["kind"],
    folder: row.folder,
    files: JSON.parse(row.files) as string[],
    mtime: row.mtime,
    enabled: row.enabled === 1,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, string>) : undefined,
  }));
}

/** 完整流程：扫描结果 → SQLite → 导出 registry.json（保留 enabled 覆盖与 sync 状态）。 */
export function persistRegistry(registry: SkillRegistry): SkillRegistry {
  syncToDb(registry.skills);
  return registry;
}
