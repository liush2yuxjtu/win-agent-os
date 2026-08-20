import "server-only";

import { unstable_cache } from "next/cache";
import {
  BUSINESS_FORMULAS,
  evaluateFormula,
  evaluateMaterialFormula,
  formulaToExcel,
  MATERIAL_FORMULAS,
  type BusinessFormula,
  type FormulaContext,
  createQcClient,
  queryDatabase,
  type McpQueryResult,
  createQueryWindow,
  DASHBOARD_QUERIES,
  QC_DATABASE,
  QC_SOURCE_TABLE,
  type QueryWindow,
} from "dsh-shared";

export interface DailyRawRow extends Record<string, unknown> {
  stat_date: string;
  period: "current" | "previous";
  spend: number;
  gmv: number;
  orders: number;
  plays: number;
  engagements: number;
  active_materials: number;
}

export interface MaterialRawRow extends Record<string, unknown> {
  material_id: string;
  material_name: string;
  material_source: string;
  spend: number;
  gmv: number;
  orders: number;
  plays: number;
  engagements: number;
}

export interface MaterialView extends MaterialRawRow {
  roi: number;
  costPerOrder: number;
  engagementRate: number;
}

export interface MetricView {
  id: string;
  label: string;
  value: number;
  change: number | null;
  formattedValue: string;
  formattedChange: string;
  description: string;
  formula: string;
  changeFormula?: string;
  status: "passed" | "warning";
}

export interface QueryAudit {
  id: string;
  title: string;
  database: string;
  table: string;
  sql: string;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

export interface DashboardAudit {
  status: "passed" | "warning";
  checks: Array<{ label: string; passed: boolean; detail: string }>;
}

export interface QcDashboardData {
  status: "ready";
  anchorDate: string;
  generatedAt: string;
  window: QueryWindow;
  freshnessDays: number;
  metrics: MetricView[];
  daily: DailyRawRow[];
  topMaterials: MaterialView[];
  queries: QueryAudit[];
  audit: DashboardAudit;
  formulas: {
    material: typeof MATERIAL_FORMULAS;
  };
}

export interface QcDashboardUnavailable {
  status: "unavailable";
  message: string;
  generatedAt: string;
}

export type QcDashboardResult = QcDashboardData | QcDashboardUnavailable;

const getCachedDashboard = unstable_cache(loadQcDashboard, ["qc-business-dashboard-v1"], {
  revalidate: 900,
  tags: ["qc-business-dashboard"],
});

export async function getQcDashboardData(): Promise<QcDashboardResult> {
  try {
    return await getCachedDashboard();
  } catch (error) {
    return {
      status: "unavailable",
      message: error instanceof Error ? error.message : "QC 数据读取失败",
      generatedAt: new Date().toISOString(),
    };
  }
}

async function loadQcDashboard(): Promise<QcDashboardData> {
  const client = await createQcClient();
  try {
    const anchorResult = await queryDatabase(client, DASHBOARD_QUERIES.anchor.sql, 2);
    const anchorDate = String(anchorResult.rows[0]?.anchor_date ?? "");
    if (!anchorDate) throw new Error("QC 数据源没有返回最新数据日期");

    const window = createQueryWindow(anchorDate);
    const dailySql = DASHBOARD_QUERIES.daily.sql(window);
    const topMaterialsSql = DASHBOARD_QUERIES.topMaterials.sql(window);
    const [dailyResult, topMaterialsResult] = await Promise.all([
      queryDatabase(client, dailySql, 30),
      queryDatabase(client, topMaterialsSql, 20),
    ]);

    const daily = dailyResult.rows.map(normalizeDailyRow);
    const topMaterials = topMaterialsResult.rows.map(normalizeMaterialRow).map((row) => ({
      ...row,
      roi: evaluateMaterialFormula("roi", row),
      costPerOrder: evaluateMaterialFormula("costPerOrder", row),
      engagementRate: evaluateMaterialFormula("engagementRate", row),
    }));

    const context: FormulaContext = { daily, topMaterials };
    const metrics = buildMetrics(context, daily);
    const audit = buildAudit(daily, topMaterials);
    const generatedAt = new Date().toISOString();

    return {
      status: "ready",
      anchorDate,
      generatedAt,
      window,
      freshnessDays: Math.max(0, Math.floor((Date.now() - new Date(`${anchorDate}T00:00:00Z`).getTime()) / 86_400_000)),
      metrics,
      daily,
      topMaterials,
      queries: [
        toQueryAudit(DASHBOARD_QUERIES.anchor, DASHBOARD_QUERIES.anchor.sql, anchorResult),
        toQueryAudit(DASHBOARD_QUERIES.daily, dailySql, dailyResult),
        toQueryAudit(DASHBOARD_QUERIES.topMaterials, topMaterialsSql, topMaterialsResult),
      ],
      audit,
      formulas: { material: MATERIAL_FORMULAS },
    };
  } finally {
    await client.close();
  }
}

function buildMetrics(context: FormulaContext, daily: DailyRawRow[]): MetricView[] {
  const definitions: Array<{ value: BusinessFormula; change?: BusinessFormula }> = [
    { value: BUSINESS_FORMULAS.gmv, change: BUSINESS_FORMULAS.gmvChange },
    { value: BUSINESS_FORMULAS.spend, change: BUSINESS_FORMULAS.spendChange },
    { value: BUSINESS_FORMULAS.roi, change: BUSINESS_FORMULAS.roiChange },
    { value: BUSINESS_FORMULAS.orders, change: BUSINESS_FORMULAS.ordersChange },
    { value: BUSINESS_FORMULAS.activeMaterials },
  ];
  const completeCurrentPeriod = daily.filter((row) => row.period === "current").length === 7;

  return definitions.map(({ value: formula, change }) => {
    const value = evaluateFormula(formula, context);
    const changeValue = change ? evaluateFormula(change, context) : null;
    return {
      id: formula.id,
      label: formula.label,
      value,
      change: changeValue,
      formattedValue: formatMetric(value, formula),
      formattedChange: changeValue === null ? "7 日均值" : formatSignedPercent(changeValue),
      description: formula.description,
      formula: formulaToExcel(formula),
      changeFormula: change ? formulaToExcel(change) : undefined,
      status: Number.isFinite(value) && completeCurrentPeriod ? "passed" : "warning",
    };
  });
}

function buildAudit(daily: DailyRawRow[], materials: MaterialView[]): DashboardAudit {
  const currentDays = daily.filter((row) => row.period === "current").length;
  const previousDays = daily.filter((row) => row.period === "previous").length;
  const checks = [
    { label: "本期日期完整", passed: currentDays === 7, detail: `${currentDays}/7 个数据日` },
    { label: "对比期日期完整", passed: previousDays === 7, detail: `${previousDays}/7 个数据日` },
    {
      label: "金额字段非负",
      passed: daily.every((row) => row.spend >= 0 && row.gmv >= 0),
      detail: `${daily.length} 行已检查`,
    },
    {
      label: "素材公式可计算",
      passed: materials.every((row) => [row.roi, row.costPerOrder, row.engagementRate].every(Number.isFinite)),
      detail: `${materials.length} 行 × 3 个公式`,
    },
  ];
  return { status: checks.every((check) => check.passed) ? "passed" : "warning", checks };
}

function normalizeDailyRow(row: Record<string, unknown>): DailyRawRow {
  return {
    stat_date: String(row.stat_date),
    period: row.period === "current" ? "current" : "previous",
    spend: numberValue(row.spend),
    gmv: numberValue(row.gmv),
    orders: numberValue(row.orders),
    plays: numberValue(row.plays),
    engagements: numberValue(row.engagements),
    active_materials: numberValue(row.active_materials),
  };
}

function normalizeMaterialRow(row: Record<string, unknown>): MaterialRawRow {
  return {
    material_id: String(row.material_id),
    material_name: String(row.material_name),
    material_source: String(row.material_source),
    spend: numberValue(row.spend),
    gmv: numberValue(row.gmv),
    orders: numberValue(row.orders),
    plays: numberValue(row.plays),
    engagements: numberValue(row.engagements),
  };
}

function toQueryAudit(
  query: { id: string; title: string },
  sql: string,
  result: McpQueryResult,
): QueryAudit {
  return {
    id: query.id,
    title: query.title,
    database: QC_DATABASE,
    table: QC_SOURCE_TABLE,
    sql,
    rowCount: result.row_count,
    durationMs: result.duration_ms,
    truncated: result.truncated,
  };
}

function formatMetric(value: number, formula: BusinessFormula): string {
  if (formula.unit === "currency") {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      notation: value >= 100_000 ? "compact" : "standard",
      maximumFractionDigits: formula.precision,
    }).format(value);
  }
  if (formula.unit === "ratio") return value.toFixed(formula.precision);
  if (formula.unit === "percent") return `${(value * 100).toFixed(formula.precision)}%`;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: formula.precision }).format(value);
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
