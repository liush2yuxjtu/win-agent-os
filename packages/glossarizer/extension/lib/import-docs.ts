import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 权威字段标注文档解析器。
 *
 * 权威源 = 内容管理平台数据库表字段释义文档（每表一个 md，人工标注）：
 *   1. 表元数据：表名/数据库/中文名/解释/主键/粒度
 *   2. Schema DDL
 *   3. 样例数据：字段 → 中文名 → 示例值
 *   4. 字段释义区（部分表）：字段 → 中文名 → 详细释义 → 示例值 → 状态
 *
 * 输出 glossarizer config 的 tables/fields 数组：
 *   - term 用权威中文名（业务团队实际词汇，不是我们自造词）
 *   - annotated_by = 文档来源（不是编造的人名）
 *   - note = 权威释义
 */

export interface DocField {
  column: string;
  cn: string; // 权威中文名
  note?: string; // 权威释义
  status?: string; // 有效/已作废
}

export interface ParsedDoc {
  table: string;
  database?: string;
  chinese?: string;
  description?: string;
  fields: DocField[];
}

const RE_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 解析表格行（markdown | 单元格 |），返回去空字符串后的单元格数组 */
function cells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim().replace(/^`|`$/g, ""));
}

export function parseDoc(path: string): ParsedDoc {
  const text = readFileSync(path, "utf8");
  const doc: ParsedDoc = { table: "", fields: [] };

  const grab = (pat: RegExp) => {
    const m = text.match(pat);
    return m ? m[1].trim().replace(/^`|`$/g, "") : undefined;
  };
  doc.table = grab(/表名 \(Table Name\)\s*\|\s*`([^`]+)`/) ?? "";
  doc.database = grab(/数据库 \(Database\):\*\*\s*`([^`]+)`/);
  doc.chinese = grab(/中文名 \(Chinese Name\)\s*\|\s*([^|]+)/);
  doc.description = grab(/解释 \(Description\)\s*\|\s*([^|]+)/);

  // 收集释义：字段释义区优先，其次样例数据的中文名
  const byCol = new Map<string, DocField>();
  const lines = text.split("\n");
  let section = "";
  for (const line of lines) {
    if (/^##\s*4\.?\s*字段释义/i.test(line)) section = "释义";
    else if (/^##\s*3\.?\s*样例数据/i.test(line)) section = "样例";
    else if (/^##/.test(line)) section = "";
    if (!line.startsWith("|") || section === "") continue;
    const c = cells(line);
    if (c.length < 2 || !RE_COLUMN.test(c[0])) continue;

    if (section === "释义" && c.length >= 3) {
      const prev = byCol.get(c[0]);
      if (!prev || !prev.note)
        byCol.set(c[0], { column: c[0], cn: c[1], note: c[2], status: c.length > 6 ? c[6] : undefined });
    } else if (section === "样例" && !byCol.has(c[0])) {
      byCol.set(c[0], { column: c[0], cn: c[1] });
    }
  }
  doc.fields = [...byCol.values()];
  return doc;
}

export interface ImportResult {
  tables: { name: string; database?: string; logical?: string; note?: string }[];
  fields: {
    id: string;
    table: string;
    column: string;
    term: string;
    unit?: string;
    annotated_by: string;
    annotated_at: string;
    note?: string;
    source_doc: string;
  }[];
  docCount: number;
  fieldCount: number;
}

export const AUTHORITY_SOURCE = "内容管理平台数据库表字段释义文档-26-07-21";

/** 扫描目录下全部权威标注 md，生成 glossarizer config 的 tables/fields */
export function importDocs(docsDir: string, generatedAt = "2026-08-17"): ImportResult {
  const files = readdirSync(docsDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const tables: ImportResult["tables"] = [];
  const fields: ImportResult["fields"] = [];
  for (const f of files) {
    let doc: ParsedDoc;
    try {
      doc = parseDoc(join(docsDir, f));
    } catch {
      continue; // 解析失败跳过（非标注文档）
    }
    if (!doc.table) continue;
    tables.push({
      name: doc.table,
      database: doc.database,
      logical: doc.chinese,
      note: doc.description ? doc.description.slice(0, 200) : undefined,
    });
    for (const fld of doc.fields) {
      fields.push({
        id: `auth_${doc.table}_${fld.column}`,
        table: doc.table,
        column: fld.column,
        term: fld.cn, // 权威中文名即术语（业务团队词汇）
        annotated_by: AUTHORITY_SOURCE,
        annotated_at: generatedAt,
        note: fld.note,
        source_doc: f,
      });
    }
  }
  return { tables, fields, docCount: tables.length, fieldCount: fields.length };
}
