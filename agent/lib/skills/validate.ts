/**
 * 技能表引用校验器：对照 qc 数据字典（38 张表）检查技能引用的表是否存在。
 *
 * 实现路径（侦察结论）：动态 import qc-mcp-server 的编译产物
 * （dist/dictionary/parser.js 零外部依赖，ESM），用鸭子类型做最小接口，
 * 不耦合 qc-mcp-server 的 TypeScript 类型系统。
 */
import fs from "node:fs";
import path from "node:path";
import { getAgentPaths } from "../../platform";
import type { QcTableDocLite, SkillTableIssue } from "./types";

let cachedTables: Map<string, QcTableDocLite> | null = null;
let cachedFieldNames: Set<string> | null = null;
let loadError: string | null = null;

function qcRoot(): string {
  return path.join(getAgentPaths().repoRoot, "qc-mcp-server");
}

function buildFieldNames(tables: Map<string, QcTableDocLite>): Set<string> {
  const names = new Set<string>();
  for (const doc of tables.values()) {
    for (const field of doc.fields) names.add(field.name.toUpperCase());
  }
  return names;
}

/** 加载 38 张表字典（模块级缓存；dist 过期/缺失时返回 null 并记录错误）。 */
export async function loadQcTables(): Promise<Map<string, QcTableDocLite> | null> {
  if (cachedTables) return cachedTables;
  if (loadError) return null;

  const parserPath = path.join(qcRoot(), "dist/dictionary/parser.js");
  const rawDir = path.join(qcRoot(), "raw_files");
  try {
    if (!fs.existsSync(parserPath)) {
      throw new Error(`qc-mcp-server 未构建：缺少 ${parserPath}，请在 qc-mcp-server 下运行 npm run build`);
    }
    if (!fs.existsSync(rawDir)) {
      throw new Error(`表字典目录缺失：${rawDir}`);
    }
    const { loadDictionary } = (await import(/* webpackIgnore: true */ parserPath)) as {
      loadDictionary: (dir: string) => QcTableDocLite[];
    };
    const docs = loadDictionary(rawDir);
    cachedTables = new Map(docs.map((doc) => [doc.table, doc]));
    cachedFieldNames = buildFieldNames(cachedTables);
    return cachedTables;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

/** 跨库限定名（WIN_DOUYIN.dbo.千川素材数据_素材列表）取末段。 */
export function qualifyToken(token: string): string {
  return token.split(".").pop()?.trim() ?? token;
}

/** 是否像表名：含下划线且非纯数字，或纯中文。表达式/表格文本/文件名不算。 */
export function looksLikeTableName(token: string): boolean {
  const bare = qualifyToken(token);
  if (/^[0-9.]+$/.test(bare)) return false;
  // 表达式、竖线表格文本、公式等一律排除
  if (/[\s|()/+*%<>"'=]/.test(bare)) return false;
  if (/[一-鿿]/.test(bare)) {
    return /^[一-鿿A-Za-z0-9_]+$/.test(bare) && bare.length >= 2;
  }
  // QC 表名只有两种形态：全大写（QC_*）或纯中文；小写/驼峰标识符不是表名
  return /^[A-Z][A-Z0-9_]*$/.test(bare) && bare.includes("_") && !bare.toLowerCase().startsWith("http");
}

/** 从 SKILL.md 正文提取反引号包裹的标识符（疑似表引用）。 */
export function extractTableCandidates(body: string): string[] {
  const tokens = new Set<string>();
  for (const match of body.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1].trim();
    if (looksLikeTableName(token)) tokens.add(qualifyToken(token));
  }
  return [...tokens].sort();
}

/**
 * 校验技能正文引用的表是否存在。
 * issues：missing_table（字典中无此表）。
 * 无法加载字典时返回 { unavailable: true, error }。
 */
export async function validateSkillReferences(
  skillName: string,
  body: string,
): Promise<{ unavailable: boolean; error?: string; issues: SkillTableIssue[] }> {
  const tables = await loadQcTables();
  if (!tables) {
    return { unavailable: true, error: loadError ?? "字典加载失败", issues: [] };
  }

  const issues: SkillTableIssue[] = [];
  const fieldNames = cachedFieldNames ?? new Set<string>();
  for (const token of extractTableCandidates(body)) {
    if (tables.has(token)) continue;
    const folded = [...tables.keys()].find((name) => name.toUpperCase() === token.toUpperCase());
    if (folded) continue;
    // 命中任一表的字段名 → 是字段引用而非表引用，跳过
    if (fieldNames.has(token.toUpperCase())) continue;
    issues.push({ skill: skillName, table: token, kind: "missing_table" });
  }
  return { unavailable: false, issues };
}

export function clearQcTableCache(): void {
  cachedTables = null;
  cachedFieldNames = null;
  loadError = null;
}
