import { defineTool } from "eve/tools";
import { z } from "zod";
import { createSandbox, destroySandbox, runCommand, safeMessage, writeFileToSandbox } from "../lib/agentbay/client";
import { createQcClient, queryDatabase } from "../lib/qc-dashboard/mcp-client";
import { createQueryWindow, DASHBOARD_QUERIES } from "../lib/qc-dashboard/queries";

/**
 * 方案 A 数据桥接：沙盒内运行 QC 数据分析脚本（design-protocol: agentBayDemo）。
 *
 * 数据流：agent 查询 QC（MCP bridge，内网）→ 结果写入沙盒 /tmp/qc_data.json
 *        → 沙盒执行分析脚本（约定从 /tmp/qc_data.json 读、写 /tmp/qc_out.json）
 *        → agent 读回结果 → 销毁沙盒。
 *
 * 沙盒全程不直连内网（架构边界）：数据由 agent 侧桥接进出。
 * 脚本约定：
 *   - 输入：/tmp/qc_data.json（{ columns, rows, queryId, title, database }）
 *   - 输出（可选）：/tmp/qc_out.json（脚本写任意 JSON，agent 读回）
 */
export default defineTool({
  description:
    "在隔离云端环境运行数据分析（方案 A 数据桥接：agent 查 QC → 数据写入沙盒 → 脚本分析 → 读回）。\n\n何时使用：用户要「分析/计算/统计/排名/排序/聚合/拆解」类需求时——如投产比排名、ROI 排序、素材对比、数据统计、复杂指标计算、需要跑脚本的计算。仅查单个数字（如昨天成交多少）用 qc__fixed_query。\n\n脚本约定：从 /tmp/qc_data.json 读取 { columns, rows, queryId, title, database }，结果写 /tmp/qc_out.json。面向用户的回复禁止提及沙盒/脚本等实现细节，只给结论与建议。",
  inputSchema: z.object({
    queryId: z
      .enum(["anchor", "daily", "topMaterials"])
      .describe("QC 固定查询：anchor（最新数据日期）/ daily（近 14 日汇总）/ topMaterials（近 7 日高消耗素材）"),
    script: z
      .string()
      .optional()
      .describe("可选 python 脚本：从 /tmp/qc_data.json 读数据，分析结果写 /tmp/qc_out.json；省略则只返回数据预览"),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(60_000)
      .describe("脚本执行超时（毫秒），默认 60000"),
  }),
  async execute({ queryId, script, timeoutMs }) {
    const startedAt = Date.now();
    let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;
    try {
      // 1. QC 查询（内网侧，agent 执行）
      const client = await createQcClient();
      const anchorResult = await queryDatabase(client, DASHBOARD_QUERIES.anchor.sql, 2);
      const anchorDate = String(anchorResult.rows[0]?.anchor_date ?? "");
      if (!anchorDate) throw new Error("QC 数据源没有返回最新数据日期，无法确定查询窗口");

      const sql =
        queryId === "anchor"
          ? DASHBOARD_QUERIES.anchor.sql
          : DASHBOARD_QUERIES[queryId].sql(createQueryWindow(anchorDate));
      const maxRows = queryId === "daily" ? 30 : queryId === "topMaterials" ? 20 : 2;
      const result = await queryDatabase(client, sql, maxRows);

      // 2. 建沙盒 + 数据写入（沙盒侧）
      sandbox = await createSandbox({});
      const dataJson = JSON.stringify({
        queryId,
        title: DASHBOARD_QUERIES[queryId].title,
        database: result.database ?? undefined,
        columns: result.columns,
        rows: result.rows,
        rowCount: result.row_count,
      });
      await writeFileToSandbox(sandbox, "/tmp/qc_data.json", dataJson);

      // 3. 可选：执行分析脚本
      let scriptOutput: string | undefined;
      let resultJson: string | undefined;
      if (script?.trim()) {
        await writeFileToSandbox(sandbox, "/tmp/analysis.py", script);
        const run = await runCommand(sandbox, "python3 /tmp/analysis.py", { timeoutMs });
        scriptOutput = run.output;
        const out = await sandbox.fileSystem.readFile("/tmp/qc_out.json");
        if (out.success && out.content) resultJson = out.content.slice(0, 12_000);
      }

      // 4. 销毁沙盒（协议：执行后必须销毁）
      await destroySandbox(sandbox);
      sandbox = undefined;

      return {
        ok: true,
        queryId,
        title: DASHBOARD_QUERIES[queryId].title,
        anchorDate,
        rowCount: result.row_count,
        truncated: result.truncated,
        dataPreview: JSON.stringify(result.rows).slice(0, 4_000),
        scriptOutput: scriptOutput === undefined ? undefined : scriptOutput.slice(0, 12_000),
        resultJson,
        durationMs: Date.now() - startedAt,
        sandbox: "agentbay",
        note: "面向用户的回复禁止提及沙盒/脚本等实现细节，只给结论与建议",
      };
    } catch (error) {
      return {
        ok: false,
        queryId,
        error: safeMessage(error),
        durationMs: Date.now() - startedAt,
        note: "QC 桥接或 AgentBay 沙盒不可用时不要尝试在本地执行脚本（协议禁止本地 fallback）",
      };
    } finally {
      if (sandbox) {
        try {
          await destroySandbox(sandbox);
        } catch {
          // 销毁失败不阻断（AgentBay idle 兜底自动释放）
        }
      }
    }
  },
});
