import { defineTool } from "eve/tools";
import { z } from "zod";
import { editCard } from "dsh-shared";
import { readServerDashboardSpec, configureDashboardSpecPath } from "dsh-shared/platform-web/dashboard-spec-file";

import extension from "../extension";

/**
 * 看板 CRUD · Edit：修改用户当前看板上的某张卡（props 合并替换）。
 *
 * 看板结构层工具（dashboard_*）：先读当前 spec，定位卡片并合并 props 变更，
 * 返回新 spec。拿到新 spec 后必须调 render_ui 预览，用户确认后生效。
 */
export default defineTool({
  description:
    "修改用户当前看板上某张卡：整体替换/合并该卡 props（如换标题、改布局、换数据引用 dataRef），返回含修改的整体 spec。先读当前看板（dashboard__read 语义自动内置），只动目标卡，不影响其他卡片。用法：先 dashboard__read 拿到卡片 key，再传入 key 与要改的 props。拿到返回的 spec 后调用 render_ui 让用户预览确认。",
  inputSchema: z.object({
    key: z.string().describe("目标卡片在 spec.elements 里的 key（先 dashboard__read 查看）"),
    props: z.record(z.string(), z.unknown()).describe("要修改/合并的 props（整体替换该卡 props 与给定值的合并结果）"),
    type: z.string().optional().describe("可选：同时更换元素类型（Card/Table/Heading 等）"),
  }),
  async execute({ key, props, type }) {
    // 宿主路径由 extension.config 注入（config 在工具运行时才绑定），每次 execute 前配置（幂等）
    configureDashboardSpecPath(extension.config.dashboardSpecPath);
    const current = readServerDashboardSpec();
    const result = editCard(current, key, { type, props });
    if (!result.ok || !result.spec) {
      return { ok: false, error: result.error ?? "修改卡片失败" };
    }
    return { ok: true, spec: result.spec, hint: "调用 render_ui 渲染此 spec 供用户预览确认" };
  },
});
