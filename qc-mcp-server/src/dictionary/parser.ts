/**
 * Parses QC data-dictionary markdown files (raw_files/*.md) into structured
 * TableDoc objects. The docs follow a fixed 10-section template; this parser
 * extracts metadata, DDL, samples, relations, field definitions, enums and
 * known issues from the markdown tables.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { DatabaseName, FieldDoc, TableDoc, TableRelation } from "../types.js";

interface ParsedTable {
  table: string;
  chineseName: string;
  database: DatabaseName;
  schema: string;
  description: string;
  businessDomain?: string;
  dataSource?: string;
  refreshPolicy?: string;
  tags?: string[];
  rowGranularity?: string;
  primaryKey?: string;
  tableStatus?: string;
  owner?: string;
  fields: FieldDoc[];
  relations: TableRelation[];
  knownIssues: string[];
  commonUsage?: string;
  raw: string;
}

/** Split a markdown table row into cells, stripping pipes and trimming. */
function splitRow(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((_, idx, arr) => !(idx === 0 && arr[0] === ""))
    .slice(0, -1)
    .map((cell) => cell.trim());
}

function cleanCell(cell: string): string {
  return cell.replace(/^`|`$/g, "").trim();
}

/** True for markdown separator rows like | --- | :---: | */
function isSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

/**
 * Parse a markdown table block given the header row and following rows.
 * Returns array of cell-arrays (header excluded).
 */
function parseTable(lines: string[]): string[][] {
  // find header line and separator, then collect rows until blank / new table
  const headerIdx = lines.findIndex((l) => l.trim().startsWith("|"));
  if (headerIdx === -1) return [];
  let sepIdx = headerIdx + 1;
  while (sepIdx < lines.length && !isSeparator(lines[sepIdx])) {
    if (lines[sepIdx].trim() === "" || lines[sepIdx].trim().startsWith("##")) break;
    sepIdx++;
  }
  if (sepIdx >= lines.length || !isSeparator(lines[sepIdx])) return [];
  const rows: string[][] = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    rows.push(splitRow(line));
  }
  return rows;
}

/** Extract `key: value` pairs from the metadata section (## 1. 表元数据). */
function parseMetadata(lines: string[]): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    const key = cleanCell(cells[0]).replace(/ \(.*\)$/, "").trim();
    const value = cleanCell(cells[1]);
    if (key && value && value !== "—") meta[key] = value;
  }
  return meta;
}

/** Parse the DDL schema table (## 2. Schema). */
function parseDdl(lines: string[]): FieldDoc[] {
  const rows = parseTable(lines);
  const fields: FieldDoc[] = [];
  for (const row of rows) {
    if (row.length < 2) continue;
    const name = cleanCell(row[0]);
    if (!name) continue;
    fields.push({
      name,
      type: cleanCell(row[1] ?? ""),
      nullable: (row[2] ?? "").includes("是"),
      isPrimaryKey: (row[3] ?? "").includes("是"),
    });
  }
  return fields;
}

/** Parse the field sample table (## 3. 样例数据). Returns {name -> {chineseName, sample}}. */
function parseSamples(lines: string[]): Map<string, { chineseName?: string; sample?: string }> {
  const rows = parseTable(lines);
  const samples = new Map<string, { chineseName?: string; sample?: string }>();
  for (const row of rows) {
    const name = cleanCell(row[0] ?? "");
    if (!name) continue;
    samples.set(name, {
      chineseName: cleanCell(row[1] ?? "") || undefined,
      sample: cleanCell(row[2] ?? "") || undefined,
    });
  }
  return samples;
}

/** Parse relations (## 5. 表关系). Format: "→ TARGET (CARD)" then "Join Key:" then description. */
function parseRelations(lines: string[]): TableRelation[] {
  const relations: TableRelation[] = [];
  let current: TableRelation | null = null;
  for (const line of lines) {
    const relMatch = line.match(/^\s*→\s*(.+?)\s*(?:\(([^)]*)\))?\s*$/);
    if (relMatch) {
      current = { target: relMatch[1].trim(), cardinality: relMatch[2]?.trim() || undefined };
      relations.push(current);
      continue;
    }
    const joinMatch = line.match(/^\s*Join Key:\s*(.+)$/);
    if (joinMatch && current) {
      current.joinKey = joinMatch[1].trim();
      continue;
    }
    if (current && !current.description && line.trim() && !line.trim().startsWith("→") && !line.trim().startsWith("##")) {
      current.description = line.trim();
    }
  }
  return relations.filter((r) => r.target && r.target !== "—");
}

/** Partial field info that patches an existing FieldDoc from the field-definition table. */
type FieldPatch = Omit<FieldDoc, "type" | "nullable" | "isPrimaryKey">;

/** Parse the field definition table (## 7. 字段定义). */
function parseFieldDefs(lines: string[]): FieldPatch[] {
  const rows = parseTable(lines);
  const fields: FieldPatch[] = [];
  for (const row of rows) {
    const name = cleanCell(row[0] ?? "");
    if (!name) continue;
    fields.push({
      name,
      chineseName: cleanCell(row[1] ?? "") || undefined,
      description: cleanCell(row[2] ?? "") || undefined,
      sample: cleanCell(row[4] ?? "") || undefined,
      status: cleanCell(row[7] ?? "") || undefined,
    });
  }
  return fields;
}

/** Parse enum dictionary (## 8. 枚举字典): ### `FIELD` · name then code block of "k = v". */
function parseEnums(lines: string[]): Map<string, { chineseName?: string; values: Record<string, string> }> {
  const enums = new Map<string, { chineseName?: string; values: Record<string, string> }>();
  let currentField: string | null = null;
  let chineseName: string | undefined;
  let inCode = false;
  for (const line of lines) {
    const fieldMatch = line.match(/^###\s+`([^`]+)`\s*·?\s*(.*)$/);
    if (fieldMatch) {
      currentField = cleanCell(fieldMatch[1]);
      chineseName = fieldMatch[2].trim() || undefined;
      enums.set(currentField, { chineseName, values: {} });
      continue;
    }
    if (!currentField) continue;
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      const eq = line.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/);
      if (eq) {
        const entry = enums.get(currentField);
        if (entry) entry.values[eq[1].trim()] = eq[2].trim();
      }
    }
  }
  return enums;
}

/** Parse known issues (## 9. 已知问题): bullets like "**FIELD**（已作废）: text". */
function parseKnownIssues(lines: string[]): string[] {
  const issues: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith("- **") || line.trim().startsWith("* **")) {
      issues.push(line.replace(/^[-*]\s+/, "").trim());
    }
  }
  return issues;
}

/** Parse a single dictionary file into a ParsedTable. */
function parseFile(filePath: string): ParsedTable | null {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || !lines[0].startsWith("# ")) return null;

  const title = lines[0].slice(2).trim();
  const titleMatch = title.match(/^(.+?)\s*·\s*(.+)$/);
  const table = titleMatch ? titleMatch[1].trim() : title;
  const chineseName = titleMatch ? titleMatch[2].trim() : "";

  // Database / schema from the header blockquote.
  const dbMatch = raw.match(/\*\*数据库 \(Database\):\*\*\s*`([^`]+)`\s*·\s*\*\*Schema:\*\*\s*`([^`]+)`/);
  const database: DatabaseName = dbMatch?.[1] === "WIN_DOUYIN" ? "WIN_DOUYIN" : "video_management";
  const schema = dbMatch?.[2] ?? "dbo";

  // Split into sections by "## N. Heading".
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    const secMatch = line.match(/^##\s+\d+\.\s+(.+)$/);
    if (secMatch) {
      current = { heading: secMatch[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  const getSection = (headingPrefix: string) =>
    sections.find((s) => s.heading.startsWith(headingPrefix))?.lines ?? [];

  const meta = parseMetadata(getSection("表元数据"));
  const ddl = parseDdl(getSection("Schema"));
  const samples = parseSamples(getSection("样例数据"));
  const relations = parseRelations(getSection("表关系"));
  const fieldDefs = parseFieldDefs(getSection("字段定义"));
  const enums = parseEnums(getSection("枚举字典"));
  const knownIssues = parseKnownIssues(getSection("已知问题"));
  const usage = getSection("常见用法").join("\n").trim();

  // Merge DDL + field definitions + samples + enums into final field list.
  const fieldMap = new Map<string, FieldDoc>();
  for (const f of ddl) fieldMap.set(f.name, f);
  for (const f of fieldDefs) {
    const existing = fieldMap.get(f.name) ?? { name: f.name, type: "", nullable: false, isPrimaryKey: false };
    fieldMap.set(f.name, { ...existing, ...f });
  }
  for (const [name, s] of samples) {
    const existing = fieldMap.get(name) ?? { name, type: "", nullable: false, isPrimaryKey: false };
    fieldMap.set(name, { ...existing, ...s });
  }
  for (const [name, e] of enums) {
    const existing = fieldMap.get(name) ?? { name, type: "", nullable: false, isPrimaryKey: false };
    fieldMap.set(name, { ...existing, enum: e.values, chineseName: existing.chineseName ?? e.chineseName });
  }

  return {
    table,
    chineseName,
    database,
    schema,
    description: meta["解释"] ?? meta["Description"] ?? "",
    businessDomain: meta["业务域"] ?? meta["Business Domain"],
    dataSource: meta["数据来源"] ?? meta["Data Source"],
    refreshPolicy: meta["刷新策略"] ?? meta["Refresh Policy"],
    tags: (meta["标签"] ?? meta["Tags"] ?? "").split("、").map((t) => t.trim()).filter(Boolean),
    rowGranularity: meta["行粒度"] ?? meta["Row Granularity"],
    primaryKey: meta["主键"] ?? meta["Primary Key"],
    tableStatus: meta["表状态"] ?? meta["Table Status"],
    owner: meta["负责人"] ?? meta["Owner"],
    fields: [...fieldMap.values()],
    relations,
    knownIssues,
    commonUsage: usage || undefined,
    raw,
  };
}

/** Load and parse every .md file in a directory (skips DB.md). */
export function loadDictionary(dir: string): TableDoc[] {
  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f));
  const docs: TableDoc[] = [];
  for (const file of entries) {
    const parsed = parseFile(file);
    if (parsed && parsed.table !== "DB") {
      const { raw, ...doc } = parsed;
      docs.push({ ...doc, raw });
    }
  }
  return docs;
}
