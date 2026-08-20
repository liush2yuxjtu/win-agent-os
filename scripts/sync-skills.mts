/**
 * 技能注册表同步脚本（本地 + Supabase 双向）。
 *
 * 用法：
 *   npm run skills:sync                   # 扫描 skill-packages/ → 生成 lib/skills/registry.json（保留 enabled 覆盖）
 *   npm run skills:sync -- --check-only   # 只校验不写盘
 *   npm run skills:sync -- --check-tables # 附 qc 表引用校验（需 qc-mcp-server 已构建）
 *   npm run skills:sync -- --push         # 本地注册表 → Supabase skills 表（upsert onConflict name）
 *   npm run skills:sync -- --pull         # Supabase 启停状态 → 本地 enabled 覆盖（云端胜）
 *   npm run skills:sync -- --push --dry-run   # 只打印 diff 不写库
 *
 * Supabase 环境变量（.env.local，被 .gitignore 覆盖）：
 *   SUPABASE_URL=https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key>
 *
 * 方向性纪律：push 本地胜、pull 云端胜。工作流 = 本地改动 → push →（他处改动）→ pull。
 * pull 用 registry.sync.lastPushedAt 做 tie-break：仅当云端 updated_at 晚于上次推送才应用。
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { syncToDb } from "../agent/lib/platform/web/skills/db";
import { scanSkillsDir } from "../agent/lib/skills/scan";
import { readRegistryFile, registryPath, writeRegistryFile } from "../agent/lib/skills/registry-file";
import { validateSkillReferences } from "../agent/lib/skills/validate";
import type { SkillRecord, SkillRegistry } from "../agent/lib/skills/types";

const ROOT = path.resolve(process.cwd());
const SKILLS_ROOT = path.join(ROOT, "skill-packages");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check-only");
const checkTables = args.includes("--check-tables");
const doPush = args.includes("--push");
const doPull = args.includes("--pull");
const dryRun = args.includes("--dry-run");

function loadSkillBody(folder: string): string {
  const skillMd = path.join(ROOT, folder, "SKILL.md");
  return fs.existsSync(skillMd) ? fs.readFileSync(skillMd, "utf8") : "";
}

/** 加载 .env.local（Node 20.12+ 原生）与进程环境。 */
function loadSupabaseEnv(): { url: string; key: string } {
  try {
    process.loadEnvFile(path.join(ROOT, ".env.local"));
  } catch {
    // .env.local 不存在则仅用进程环境
  }
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "缺少 Supabase 环境变量：请在 .env.local 配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY（控制台 Project Settings → API Keys 获取）",
    );
  }
  return { url, key };
}

/** registry.json → Supabase 行映射。 */
function toSupabaseRows(skills: SkillRecord[]) {
  const now = new Date().toISOString();
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    tags: [],
    owner: skill.metadata?.owner ?? null,
    source: "local",
    version: null,
    status: skill.enabled ? "active" : "disabled",
    visibility: "private",
    metadata: { kind: skill.kind, folder: skill.folder, mtime: skill.mtime, filesCount: skill.files.length },
    updated_at: now,
  }));
}

/** 跳过云端 source != 'local' 的行（其他来源的技能不被本地覆盖）。 */
async function fetchNonLocalNames(url: string, key: string): Promise<Set<string>> {
  const client = createClient(url, key);
  const { data, error } = await client.from("skills").select("name, source");
  if (error) throw new Error(`查询 skills 失败：${error.message}`);
  return new Set((data ?? []).filter((row) => row.source !== "local").map((row) => row.name as string));
}

/** --push：本地注册表全量 upsert 到 Supabase。 */
async function pushToSupabase(registry: SkillRegistry): Promise<void> {
  const { url, key } = loadSupabaseEnv();
  const client = createClient(url, key);
  const nonLocal = await fetchNonLocalNames(url, key);

  const rows = toSupabaseRows(registry.skills).filter((row) => !nonLocal.has(row.name));
  const now = new Date().toISOString();

  if (dryRun) {
    console.log(`[push:dry-run] 将 upsert ${rows.length} 行（跳过 ${nonLocal.size} 个非本地来源）`);
    for (const row of rows) console.log(`  ${row.status === "active" ? "✓" : "○"} ${row.name} → ${row.status}`);
    return;
  }

  const { error } = await client.from("skills").upsert(rows, { onConflict: "name" });
  if (error) throw new Error(`upsert 失败：${error.message}`);

  // 记录推送时间（pull 的 tie-break）
  registry.sync = { lastPushedAt: now };
  writeRegistryFile(registry);
  console.log(`[push] 已推送 ${rows.length} 个技能到 Supabase（${now}）`);
}

/** --pull：云端启停状态合并回本地 enabled（仅 source='local' 的行）。 */
async function pullFromSupabase(registry: SkillRegistry): Promise<void> {
  const { url, key } = loadSupabaseEnv();
  const client = createClient(url, key);
  const { data, error } = await client
    .from("skills")
    .select("name, status, source, updated_at")
    .eq("source", "local");
  if (error) throw new Error(`查询 skills 失败：${error.message}`);

  const lastPushedAt = registry.sync?.lastPushedAt;
  let applied = 0;
  const diffs: string[] = [];
  for (const row of data ?? []) {
    const skill = registry.skills.find((s) => s.name === row.name);
    if (!skill) continue;
    // tie-break：云端比上次推送更新才应用，避免本地 toggle 后被旧值覆盖
    if (lastPushedAt && new Date(row.updated_at).toISOString() <= new Date(lastPushedAt).toISOString()) continue;
    const next = row.status === "active";
    if (row.status === "draft") {
      console.warn(`  ! ${row.name}: 云端状态 draft 按停用处理`);
    }
    if (skill.enabled !== next) {
      diffs.push(`${skill.name}: ${skill.enabled ? "启用" : "停用"} → ${next ? "启用" : "停用"}`);
      skill.enabled = next;
      applied++;
    }
  }

  if (dryRun) {
    console.log(`[pull:dry-run] 将应用 ${applied} 个状态变更（tie-break: lastPushedAt=${lastPushedAt ?? "无，云端优先"}）`);
    for (const d of diffs) console.log(`  ${d}`);
    return;
  }
  if (applied > 0) {
    registry.generatedAt = new Date().toISOString();
    writeRegistryFile(registry);
  }
  console.log(`[pull] 云端状态合并完成：${applied} 个变更`);
}

async function main(): Promise<void> {
  console.log(`[scan] ${SKILLS_ROOT}`);
  const { skills, audit } = scanSkillsDir(SKILLS_ROOT);
  const previous = readRegistryFile();
  // 保留上一版 registry 的 enabled 覆盖（runtime toggle 只改标记，重扫不得重置）
  const enabledByName = new Map(previous.skills.map((s) => [s.name, s.enabled]));
  for (const skill of skills) {
    const prev = enabledByName.get(skill.name);
    if (prev !== undefined) skill.enabled = prev;
  }

  // qc 表引用校验
  let tableIssues: { skill: string; table: string }[] = [];
  if (checkTables) {
    console.log("[qc] 表引用校验（对照 qc-mcp-server 字典）...");
    for (const skill of skills) {
      if (skill.kind !== "packaged") continue;
      const { unavailable, error, issues } = await validateSkillReferences(skill.name, loadSkillBody(skill.folder));
      if (unavailable) {
        console.log(`  ! ${skill.name}: 字典不可用（${error}）`);
        continue;
      }
      for (const issue of issues) {
        console.log(`  ✗ ${skill.name}: 引用的表「${issue.table}」不在 38 张表字典中`);
        tableIssues.push({ skill: skill.name, table: issue.table });
      }
    }
    if (tableIssues.length === 0) console.log("  ✓ 全部技能引用的表均在字典中");
  }

  const registry: SkillRegistry = {
    version: 1,
    generatedAt: new Date().toISOString(),
    skills,
    audit: {
      ...audit,
      warnings: [...audit.warnings, ...tableIssues.map((i) => `${i.skill} 引用未知表 ${i.table}`)],
    },
    sync: previous.sync, // 保留推送时间戳
  };
  registry.audit.status = registry.audit.warnings.length > 0 ? "warning" : "passed";

  if (doPull) {
    await pullFromSupabase(registry);
  }

  // 报告
  console.log(`[scan] ${skills.length} 个技能`);
  for (const skill of skills) {
    const kindBadge = skill.kind === "packaged" ? "packaged" : skill.kind === "flat" ? "flat" : "module";
    console.log(`  ${skill.enabled ? "✓" : "○"} ${skill.name} (${kindBadge}, ${skill.files.length} files)${skill.enabled ? "" : " [disabled]"}`);
  }
  for (const check of audit.checks) {
    console.log(`[audit] ${check.passed ? "✓" : "✗"} ${check.label} — ${check.detail}`);
  }

  if (checkOnly) {
    console.log("[done] --check-only，未写盘");
    return;
  }
  const dbCount = syncToDb(registry.skills);
  console.log(`[db] SQLite 注册表：${dbCount} 行`);
  writeRegistryFile(registry);

  if (doPush) {
    await pushToSupabase(registry);
  }
  console.log(`[write] ${registryPath()}`);
}

main().catch((error) => {
  console.error("同步失败:", error);
  process.exit(1);
});
