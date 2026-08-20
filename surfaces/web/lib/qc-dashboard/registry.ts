// 注意：不用 `import "server-only"` —— eve 的 agent 工具加载器（eve dev）不带
// react-server condition，server-only 会抛 "This module cannot be imported..."，
// 导致 qc_query_save 工具加载失败。本模块只被服务端消费（eve 工具 + app/api/query），
// 不会被 client bundle 引用。
import "./shared-init"; // 先注入 dsh-shared 的 user-queries/spec 落盘路径
import {
  createQcClient,
  queryDatabase,
  createQueryWindow,
  DASHBOARD_QUERIES,
} from "dsh-shared";
import {
  isReadOnlySql,
  readUserRegistry,
  saveUserQuery,
  userQueryMaxRows,
  USER_PREFIX,
  type SaveUserQueryResult,
  type UserQueryRecord,
  type UserQueryRegistry,
} from "dsh-shared/qc-dashboard/user-queries";

/**
 * Query Registry —— Generative UI 的数据源层。
 *
 * queryId 两类：
 *  - `fixed:<name>`：预置固定脚本（lib/qc-dashboard/queries.ts），服务端只读；
 *  - `user:<slug>`：用户在会话中保存的自定义只读 SQL（持久化于
 *    <项目根>/data/dashboard-queries.json）。
 *
 * 消费方（data-binding 层）只依赖 resolveQuery 的返回形状：
 * { rows?, title?, description?, value? }。QC 不可达或查询失败一律返回 null，
 * 不抛错。
 */

export interface ResolvedQuery {
  rows?: unknown[];
  title?: string;
  description?: string;
  value?: string;
}

const FIXED_PREFIX = "fixed:";

const FIXED_QUERY_NAMES = ["anchor", "daily", "topMaterials", "insights"] as const;
type FixedQueryName = (typeof FIXED_QUERY_NAMES)[number];

const FIXED_MAX_ROWS: Record<FixedQueryName, number> = {
  anchor: 2,
  daily: 30,
  topMaterials: 20,
  insights: 30, // 洞察 = daily（近 7 日 ROI 对比）需要完整 30 行
};

/** 全部可用 queryId：fixed 三件套 + 用户注册表里的 user:<slug>。 */
export function listQueryIds(): string[] {
  const fixed = FIXED_QUERY_NAMES.map((name) => `${FIXED_PREFIX}${name}`);
  let userSlugs: string[] = [];
  try {
    userSlugs = Object.keys(readUserRegistry().queries).map((slug) => `${USER_PREFIX}${slug}`);
  } catch {
    // 注册表文件缺失/损坏时，固定脚本仍然可用。
  }
  return [...fixed, ...userSlugs];
}

/**
 * 按 queryId 解析并执行查询，返回最新数据。
 * 未知 queryId、QC 不可达、SQL 执行失败均返回 null，不抛错。
 */
export async function resolveQuery(queryId: string): Promise<ResolvedQuery | null> {
  if (queryId.startsWith(FIXED_PREFIX)) {
    return resolveFixedQuery(queryId.slice(FIXED_PREFIX.length) as FixedQueryName);
  }
  if (queryId.startsWith(USER_PREFIX)) {
    return resolveUserQuery(queryId.slice(USER_PREFIX.length));
  }
  return null;
}

async function resolveFixedQuery(name: FixedQueryName): Promise<ResolvedQuery | null> {
  if (!FIXED_QUERY_NAMES.includes(name)) return null;

  const client = await createQcClient().catch(() => null);
  if (!client) return null;
  try {
    if (name === "anchor") {
      const result = await queryDatabase(client, DASHBOARD_QUERIES.anchor.sql, FIXED_MAX_ROWS.anchor);
      return {
        rows: result.rows,
        title: DASHBOARD_QUERIES.anchor.title,
        description: "QC 数据源最新可用数据日期",
        value: String(result.rows[0]?.anchor_date ?? ""),
      };
    }

    // daily / topMaterials / insights 先取最新数据日期，再按窗口执行（与 data.ts 同一口径）。
    const anchorResult = await queryDatabase(client, DASHBOARD_QUERIES.anchor.sql, 2);
    const anchorDate = String(anchorResult.rows[0]?.anchor_date ?? "");
    if (!anchorDate) return null;

    const window = createQueryWindow(anchorDate);

    if (name === "insights") {
      // 洞察 = daily（current/previous 两期 ROI 对比）+ topMaterials（ROI 最高素材）拼装。
      const [dailyResult, topMaterialsResult] = await Promise.all([
        queryDatabase(client, DASHBOARD_QUERIES.daily.sql(window), FIXED_MAX_ROWS.insights),
        queryDatabase(client, DASHBOARD_QUERIES.topMaterials.sql(window), FIXED_MAX_ROWS.topMaterials),
      ]);
      return buildInsights(dailyResult.rows, topMaterialsResult.rows);
    }

    const sql = name === "daily" ? DASHBOARD_QUERIES.daily.sql(window) : DASHBOARD_QUERIES.topMaterials.sql(window);
    const result = await queryDatabase(client, sql, FIXED_MAX_ROWS[name]);

    return {
      rows: result.rows,
      title: DASHBOARD_QUERIES[name].title,
      description: `窗口 ${window.currentStart} ~ ${window.windowEnd}，基于最新数据日期 ${anchorDate}`,
    };
  } catch {
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * 规则洞察：对比近 7 日（current）与前 7 日（previous）两期的支付 ROI
 * （gmv/spend，与 formulas.ts 的 ROI_7D 同一口径），并从高消耗素材中挑出
 * ROI 最高的一项。任一步缺数据返回 null，与 fixed 查询失败语义一致。
 */
function buildInsights(
  dailyRows: Array<Record<string, unknown>>,
  materialRows: Array<Record<string, unknown>>,
): ResolvedQuery | null {
  const currentRows = dailyRows.filter((row) => row.period === "current");
  const previousRows = dailyRows.filter((row) => row.period === "previous");
  if (currentRows.length === 0 || previousRows.length === 0) return null;

  const sumField = (rows: Array<Record<string, unknown>>, field: "spend" | "gmv") =>
    rows.reduce((total, row) => total + toNumber(row[field]), 0);

  const currentRoi = safeDivide(sumField(currentRows, "gmv"), sumField(currentRows, "spend"));
  const previousRoi = safeDivide(sumField(previousRows, "gmv"), sumField(previousRows, "spend"));

  let bestName = "";
  let bestRoi = -1;
  for (const row of materialRows) {
    const roi = safeDivide(toNumber(row.gmv), toNumber(row.spend));
    if (roi > bestRoi) {
      bestRoi = roi;
      bestName = String(row.material_name ?? "未命名素材");
    }
  }
  if (!bestName) return null;

  return {
    title: currentRoi >= previousRoi ? "ROI 较前 7 日提升。" : "ROI 较前 7 日回落。",
    description: `当前支付 ROI 为 ${currentRoi.toFixed(2)}；高消耗素材中 ROI 最高的是"${bestName}"，ROI ${bestRoi.toFixed(2)}。`,
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDivide(left: number, right: number): number {
  return right === 0 ? 0 : left / right;
}

async function resolveUserQuery(slug: string): Promise<ResolvedQuery | null> {
  let record: UserQueryRecord;
  try {
    record = readUserRegistry().queries[slug];
  } catch {
    return null;
  }
  if (!record) return null;
  // 防御：即使文件被手工改坏，也只执行只读 SELECT/WITH。
  if (!isReadOnlySql(record.sql)) return null;

  const client = await createQcClient().catch(() => null);
  if (!client) return null;
  try {
    const result = await queryDatabase(client, record.sql, userQueryMaxRows());
    return {
      rows: result.rows,
      title: record.title ?? slug,
      description: `用户保存的自定义查询，创建于 ${record.createdAt}`,
    };
  } catch {
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}

// saveUserQuery / readUserRegistry / isReadOnlySql 实现见 ./user-queries
// （不含 server-only，eve agent 工具模块共用）
