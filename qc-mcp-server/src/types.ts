/** Shared types for the QC data dictionary MCP server. */

export type DatabaseName = "video_management" | "WIN_DOUYIN";

export interface FieldDoc {
  /** Uppercase column name, e.g. PROD_ID. */
  name: string;
  /** SQL data type, e.g. numeric(18,2). */
  type: string;
  /** Whether the column is nullable. */
  nullable: boolean;
  /** Whether the column is part of the primary key. */
  isPrimaryKey: boolean;
  /** Chinese field name. */
  chineseName?: string;
  /** Chinese description. */
  description?: string;
  /** Example value. */
  sample?: string;
  /** Validity status, e.g. 有效 / 已作废. */
  status?: string;
  /** Enum values keyed by code, when present. */
  enum?: Record<string, string>;
}

export interface TableRelation {
  /** Related table name. */
  target: string;
  /** Cardinality label, e.g. N:1, 1:N. */
  cardinality?: string;
  /** Join key expression. */
  joinKey?: string;
  /** Chinese description of the relation. */
  description?: string;
}

export interface TableDoc {
  /** Table name, e.g. QC_MONTAGE_PRODUCT. */
  table: string;
  /** Chinese name. */
  chineseName: string;
  /** Database the table lives in. */
  database: DatabaseName;
  /** Schema, usually dbo. */
  schema: string;
  /** Long Chinese description. */
  description: string;
  /** Business domain label. */
  businessDomain?: string;
  /** Data source label. */
  dataSource?: string;
  /** Refresh policy. */
  refreshPolicy?: string;
  /** Tags. */
  tags?: string[];
  /** Row granularity. */
  rowGranularity?: string;
  /** Primary key column names. */
  primaryKey?: string;
  /** Table status. */
  tableStatus?: string;
  /** Owner. */
  owner?: string;
  /** Column-level definitions. */
  fields: FieldDoc[];
  /** Relations to other tables. */
  relations: TableRelation[];
  /** Known issues. */
  knownIssues: string[];
  /** Common usage / related modules text. */
  commonUsage?: string;
  /** Raw markdown source (for include_raw mode). */
  raw?: string;
}
