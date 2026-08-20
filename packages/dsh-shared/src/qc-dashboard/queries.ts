export const QC_DATABASE = "WIN_DOUYIN" as const;
export const QC_SOURCE_TABLE = "dbo.[千川素材数据_素材列表]";

export const DASHBOARD_QUERIES = {
  anchor: {
    id: "qc.anchor-date.v1",
    title: "最新可用数据日期",
    sql: `SELECT TOP 1
  CONVERT(varchar(10), STAT_TIME, 23) AS anchor_date
FROM ${QC_SOURCE_TABLE}
WHERE STAT_TIME IS NOT NULL
ORDER BY STAT_TIME DESC`,
  },
  daily: {
    id: "qc.daily-performance.v1",
    title: "近 14 日经营原始汇总",
    sql: ({ currentStart, windowStart, windowEnd }: QueryWindow) => `SELECT
  CONVERT(varchar(10), STAT_TIME, 23) AS stat_date,
  CASE WHEN STAT_TIME >= '${currentStart}' THEN 'current' ELSE 'previous' END AS period,
  SUM(COALESCE(STAT_COST_FOR_ROI2, 0)) AS spend,
  SUM(COALESCE(TOTAL_PAY_ORDER_GMV_INCLUDE_COUPON_FOR_ROI2, 0)) AS gmv,
  SUM(COALESCE(TOTAL_PAY_ORDER_COUNT_FOR_ROI2, 0)) AS orders,
  SUM(COALESCE(VIDEO_PLAY_COUNT_FOR_ROI2_V2, 0)) AS plays,
  SUM(
    COALESCE(VIDEO_LIKE_COUNT_FOR_ROI2, 0)
    + COALESCE(VIDEO_COMMENT_COUNT_FOR_ROI2_V2, 0)
    + COALESCE(VIDEO_FOLLOW_COUNT_FOR_ROI2, 0)
  ) AS engagements,
  COUNT(DISTINCT MATERIAL_ID) AS active_materials
FROM ${QC_SOURCE_TABLE}
WHERE STAT_TIME >= '${windowStart}' AND STAT_TIME < '${windowEnd}'
GROUP BY
  STAT_TIME,
  CASE WHEN STAT_TIME >= '${currentStart}' THEN 'current' ELSE 'previous' END
ORDER BY STAT_TIME`,
  },
  topMaterials: {
    id: "qc.top-materials.v1",
    title: "近 7 日高消耗素材原始汇总",
    sql: ({ currentStart, windowEnd }: QueryWindow) => `SELECT TOP 8
  CAST(MATERIAL_ID AS varchar(30)) AS material_id,
  MAX(COALESCE(NULLIF(MATERIAL_NAME, ''), '未命名素材')) AS material_name,
  MAX(COALESCE(NULLIF(MATERIAL_SOURCE, ''), '未知来源')) AS material_source,
  SUM(COALESCE(STAT_COST_FOR_ROI2, 0)) AS spend,
  SUM(COALESCE(TOTAL_PAY_ORDER_GMV_INCLUDE_COUPON_FOR_ROI2, 0)) AS gmv,
  SUM(COALESCE(TOTAL_PAY_ORDER_COUNT_FOR_ROI2, 0)) AS orders,
  SUM(COALESCE(VIDEO_PLAY_COUNT_FOR_ROI2_V2, 0)) AS plays,
  SUM(
    COALESCE(VIDEO_LIKE_COUNT_FOR_ROI2, 0)
    + COALESCE(VIDEO_COMMENT_COUNT_FOR_ROI2_V2, 0)
    + COALESCE(VIDEO_FOLLOW_COUNT_FOR_ROI2, 0)
  ) AS engagements
FROM ${QC_SOURCE_TABLE}
WHERE STAT_TIME >= '${currentStart}' AND STAT_TIME < '${windowEnd}'
GROUP BY MATERIAL_ID
HAVING SUM(COALESCE(STAT_COST_FOR_ROI2, 0)) > 0
ORDER BY spend DESC`,
  },
} as const;

export interface QueryWindow {
  anchorDate: string;
  currentStart: string;
  previousStart: string;
  windowStart: string;
  windowEnd: string;
}

export function createQueryWindow(anchorDate: string): QueryWindow {
  const anchor = parseIsoDate(anchorDate);
  return {
    anchorDate,
    currentStart: shiftDate(anchor, -6),
    previousStart: shiftDate(anchor, -13),
    windowStart: shiftDate(anchor, -13),
    windowEnd: shiftDate(anchor, 1),
  };
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`QC 返回了非法日期：${value}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function shiftDate(date: Date, days: number): string {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * 看板数据契约：fixed:<name> 查询 ID 的单一来源。
 * dashboard default-spec 与前端注册表统一引用此处，业务包解耦查询实现。
 */
export const FIXED_QUERY_IDS = {
  anchor: "fixed:anchor",
  daily: "fixed:daily",
  topMaterials: "fixed:topMaterials",
  insights: "fixed:insights",
} as const;
