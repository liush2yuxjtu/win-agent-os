import { defineExtension } from "eve/extension";
import { z } from "zod";

/**
 * glossarizer — 通用语义层引擎（零业务知识）。
 *
 * 所有「什么是 ROI、什么是产出」都来自挂载方注入的 config：
 *   - glossaryPath: 术语词典 JSON（物理字段 → 业务术语，含聚合语义）
 *   - rulesPath:    业务规则 JSON（业务专家用术语组合的规则）
 *
 * 同一引擎可被不同域以不同 config 挂载（qc / crm / ...），工具名自动加挂载前缀。
 */
export default defineExtension({
  config: z.object({
    glossaryPath: z.string().describe("术语词典 JSON 路径（相对挂载项目的根目录）"),
    rulesPath: z.string().describe("业务规则 JSON 路径（相对挂载项目的根目录）"),
    dialect: z
      .enum(["sqlserver", "mysql", "oceanbase"])
      .default("sqlserver")
      .describe("目标数据库方言，用于 SQL 渲染"),
    tenants: z
      .record(
        z.string(),
        z.object({
          glossaryPath: z.string().describe("该租户的术语词典路径"),
          rulesPath: z.string().describe("该租户的规则库路径"),
        }),
      )
      .optional()
      .describe("多租户词典映射：tenant 名 → 各自的词典/规则；缺省租户用顶层 glossaryPath/rulesPath"),
  }),
});
