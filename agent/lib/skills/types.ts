/**
 * 技能注册表类型。
 *
 * 单一事实源是 skill-packages/ 文件系统（eve 原生加载）；
 * 注册表快照（registry.json）是运行时数据源（serverless 下无法实时扫描文件系统），
 * enabled 覆盖层与快照同文件，由 sync 脚本保留。
 */

/** 技能形态：packaged = <name>/SKILL.md 目录包；flat = <name>.md 扁平文件；module = defineSkill TS。 */
export type SkillKind = "packaged" | "flat" | "module";

export interface SkillRecord {
  /** 技能名：packaged 取目录名，flat 取文件名去 .md，module 取文件名去 .ts（eve: name comes from path）。 */
  name: string;
  /** skill-packages/ 下的相对位置。 */
  folder: string;
  kind: SkillKind;
  /** frontmatter description；flat 缺省时取正文首行 fallback。 */
  description: string;
  license?: string;
  metadata?: Record<string, string>;
  /** 开局推荐气泡文案（SKILL.md frontmatter suggest 字段）；缺省不生成动态推荐。 */
  suggest?: string;
  /** 包内文件清单（相对技能目录）。 */
  files: string[];
  /** 最新文件 mtime（ISO）。 */
  mtime: string;
  /** 平台启停状态（唯一由注册表覆盖层管理，eve 扫描即加载）。 */
  enabled: boolean;
}

export interface RegistryAudit {
  status: "passed" | "warning";
  checks: { label: string; passed: boolean; detail: string }[];
  warnings: string[];
}

export interface SkillRegistry {
  version: 1;
  generatedAt: string;
  skills: SkillRecord[];
  audit: RegistryAudit;
  /** Supabase 双向同步状态（--push 成功后写入；pull 用 lastPushedAt 做 tie-break）。 */
  sync?: {
    lastPushedAt?: string;
  };
}

/** qc 数据字典的最小结构性类型（鸭子类型，不 import qc-mcp-server 的类型系统）。 */
export interface QcTableDocLite {
  table: string;
  database: string;
  chineseName?: string;
  fields: { name: string }[];
}

export interface SkillTableIssue {
  skill: string;
  table: string;
  kind: "missing_table" | "missing_field";
  field?: string;
  suggestion?: string;
}
