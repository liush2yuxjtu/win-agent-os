import { defineTool } from "eve/tools";
import { z } from "zod";
import { createQcClient, queryDatabase, createQueryWindow, DASHBOARD_QUERIES, QC_DATABASE } from "dsh-shared";

/**
 * 预置固定 SQL 脚本的优先入口（只读）。
 * 挂载为 qc__fixed_query。
 *
 * 路由规则：能由固定脚本覆盖的查询先走本工具；固定脚本不支持或执行失败时，
 * 回退到 qc 连接的 `qc_query_database` 自由查询。失败信息会说明回退路径，
 * 由模型决定是否调用 qc 连接。
 */
export default defineTool({
  description:
    "运行预置的固定只读 SQL 脚本（优先使用）。支持 queryId: anchor（最新数据日期）、daily（近 14 日经营汇总）、topMaterials（近 7 日高消耗素材）。若请求的查询不在固定脚本内或脚本执行失败，返回明确错误，此时应改用 qc 连接的 qc_query_database 自由查询。",
  inputSchema: z.object({
    queryId: z.enum(["anchor", "daily", "topMaterials"]).describe("固定脚本标识"),
  }),
  async execute({ queryId }) {
    const client = await createQcClient();
    try {
      const anchorResult = await queryDatabase(client, DASHBOARD_QUERIES.anchor.sql, 2);
      const anchorDate = String(anchorResult.rows[0]?.anchor_date ?? "");
      if (!anchorDate) {
        throw new Error("QC 数据源没有返回最新数据日期，无法确定查询窗口");
      }

      const sql =
        queryId === "anchor"
          ? DASHBOARD_QUERIES.anchor.sql
          : DASHBOARD_QUERIES[queryId].sql(createQueryWindow(anchorDate));
      const maxRows = queryId === "daily" ? 30 : queryId === "topMaterials" ? 20 : 2;
      const result = await queryDatabase(client, sql, maxRows);

      return {
        queryId: DASHBOARD_QUERIES[queryId].id,
        title: DASHBOARD_QUERIES[queryId].title,
        sql,
        database: QC_DATABASE,
        anchorDate,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.row_count,
        truncated: result.truncated,
        durationMs: result.duration_ms,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      return {
        ok: false,
        queryId,
        error: `${detail} 固定脚本不可用或失败，请改用 qc 连接的 qc_query_database 完成查询。`,
      };
    } finally {
      await client.close();
    }
  },
});
