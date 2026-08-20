import { defineTool } from "eve/tools";
import { z } from "zod";
import { addCard } from "dsh-shared";
import { readServerDashboardSpec, configureDashboardSpecPath } from "dsh-shared/platform-web/dashboard-spec-file";

import extension from "../extension";

/**
 * 看板 CRUD · Create：在用户当前看板上加一张新卡。
 *
 * 看板结构层工具（dashboard_*）：先读当前 spec（服务端副本），在它之上增量
 * 加卡，返回新 spec。拿到新 spec 后必须调 render_ui 预览，用户点「应用到
 * 看板」确认后生效——本工具不直接落盘，保持人审闭环。
 */
export default defineTool({
  description:
    "在用户当前看板上新增一个 json-render 元素，返回含新元素的整体 spec。先读当前看板（dashboard__read 语义自动内置），在其上追加，不会覆盖已有卡片。柱状图直接用 type=BarChart，并把 dataRef、xKey、series 放进 props；不要先建 Card 或引用未定义的 children。数据用 dataRef 或 ${/kpis/N/...} 模板，绝不写死数值。拿到返回的 spec 后立即调用 render_ui 预览。",
  inputSchema: z.object({
    type: z.string().describe("新元素类型：Card / Table / BarChart / Heading / Separator / Badge / Alert / Text / Stack / Grid"),
    props: z
      .record(z.string(), z.unknown())
      .describe(
        "新卡 props：Card 用 { title, description, maxWidth }；Table 用 { title, columns, rows }（数据建议 dataRef: { queryId, field: 'rows' }）；Heading 用 { text, level }。绝不写死业务数值。",
      ),
    key: z.string().optional().describe("可选：卡片在 spec.elements 里的 key（缺省自动生成 card/card1/…）"),
  }),
  async execute({ type, props, key }) {
    // 宿主路径由 extension.config 注入（config 在工具运行时才绑定），每次 execute 前配置（幂等）
    configureDashboardSpecPath(extension.config.dashboardSpecPath);
    const current = readServerDashboardSpec();
    const result = addCard(current, { key, type, props });
    if (!result.ok || !result.spec) {
      return { ok: false, error: result.error ?? "添加卡片失败" };
    }
    return { ok: true, spec: result.spec, hint: "调用 render_ui 渲染此 spec 供用户预览确认" };
  },
});
