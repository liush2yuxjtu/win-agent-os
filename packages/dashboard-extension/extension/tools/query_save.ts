import { defineTool } from "eve/tools";
import { z } from "zod";
// 注意：dsh-shared 的 user-queries 无 server-only，不要改回 registry.ts——
// server-only 模块会让 eve build 的模块评估报 RSC 边界错误。
import { saveUserQuery, configureUserQueriesPath } from "dsh-shared/qc-dashboard/user-queries";

import extension from "../extension";

/**
 * 把一次自由查询的 SQL 保存为可复用的看板数据源（queryId: user:<slug>）。
 * 之后 render_ui 可通过 dataRef: user:<slug> 拉取最新数据。
 */
export default defineTool({
  description:
    "把一次自由查询的 SQL 保存为可复用的看板数据源 queryId（user:<slug>），供后续 render_ui 的 dataRef 引用。SQL 必须是只读查询（以 SELECT 或 WITH 开头，拒绝 DROP/INSERT/UPDATE/DELETE/ALTER/TRUNCATE/GRANT），slug 仅允许小写字母、数字、下划线、连字符（1-40 字符）。保存成功后返回 user:<slug>，渲染 UI 时作为数据源引用。",
  inputSchema: z.object({
    slug: z.string().describe("数据源标识（仅小写字母/数字/下划线/连字符，1-40 字符）"),
    sql: z.string().describe("只读 SQL 查询文本（必须以 SELECT 或 WITH 开头）"),
    title: z.string().optional().describe("展示名称，不传则用 slug"),
  }),
  async execute({ slug, sql, title }) {
    // 宿主路径由 extension.config 注入（config 在工具运行时才绑定），每次 execute 前配置（幂等）
    configureUserQueriesPath(extension.config.userQueriesPath);
    const result = await saveUserQuery(slug, sql, title ? { title } : undefined);
    if (!result.ok) {
      return { ok: false, slug, error: result.error };
    }
    return { ok: true, queryId: `user:${slug}`, title: title ?? slug };
  },
});
