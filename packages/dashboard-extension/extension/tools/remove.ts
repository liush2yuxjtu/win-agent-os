import { defineTool } from "eve/tools";
import { z } from "zod";
import { removeCard } from "dsh-shared";
import { readServerDashboardSpec, configureDashboardSpecPath } from "dsh-shared/platform-web/dashboard-spec-file";

import extension from "../extension";

/**
 * 看板 CRUD · Remove：从用户当前看板上删掉一张卡。
 *
 * 看板结构层工具（dashboard_*）：先读当前 spec，移除目标卡片并从 root
 * children 摘除，返回新 spec。拿到新 spec 后必须调 render_ui 预览，
 * 用户确认后生效。
 */
export default defineTool({
  description:
    "从用户当前看板上删除一张卡（按 spec.elements 的 key），返回删卡后的整体 spec。先读当前看板（dashboard__read 语义自动内置），只删目标卡，其他卡片不受影响。用法：先 dashboard__read 拿到要删的卡片 key 再传入。拿到返回的 spec 后调用 render_ui 让用户预览确认。",
  inputSchema: z.object({
    key: z.string().describe("要删除的卡片在 spec.elements 里的 key（先 dashboard__read 查看）"),
  }),
  async execute({ key }) {
    // 宿主路径由 extension.config 注入（config 在工具运行时才绑定），每次 execute 前配置（幂等）
    configureDashboardSpecPath(extension.config.dashboardSpecPath);
    const current = readServerDashboardSpec();
    const result = removeCard(current, key);
    if (!result.ok || !result.spec) {
      return { ok: false, error: result.error ?? "删除卡片失败" };
    }
    return { ok: true, spec: result.spec, hint: "调用 render_ui 渲染此 spec 供用户预览确认" };
  },
});
