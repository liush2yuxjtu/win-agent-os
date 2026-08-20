import { defineTool } from "eve/tools";
import { z } from "zod";
import { baseSpec } from "dsh-shared";
import { readServerDashboardSpec, configureDashboardSpecPath } from "dsh-shared/platform-web/dashboard-spec-file";

import extension from "../extension";

/**
 * 读当前看板 spec（服务端副本；无自定义时返回真实基础款 spec，而不是 null）。
 *
 * 看板结构层工具（dashboard_*）：让 agent 知道「用户当前看板长什么样」，
 * 以便在聊天里做增量增删查改（先读当前 spec → 在它上面加/删/改卡片 → render_ui
 * 生成新 spec → 用户应用到看板）。服务端副本由前端保存看板时同步（宿主路径
 * 经 extension.config.dashboardSpecPath 注入，见 dsh-shared 的 dashboard-spec-file）。
 *
 * 重要：无自定义看板时**返回基础款 spec 而非 null** —— agent 在沙箱里看不到
 * 项目文件（/workspace 为空），拿不到 ${/kpis/N/...} 的真实定义；返回完整
 * spec 后 agent 直接基于它增删改，不必（也不应该）用文件系统工具探索代码。
 *
 * 与数据源层工具（qc__fixed_query / dashboard__query_save）的分工：qc_* 管数据从哪来，
 * dashboard_* 管看板长什么样。
 */
export default defineTool({
  description:
    "读取用户当前看板 spec（element-tree JSON，含现有卡片与布局）。在对看板做增删查改之前先调用本工具拿到当前 spec，在它之上增量修改（加/删/改卡片），而不是从零生成——否则会覆盖用户之前的自定义。无自定义看板时返回基础款 spec（Grid 5 列 × 5 张 KPI 卡，卡片值引用 ${/kpis/N/...} 模板），不会返回 null。拿到 spec 后直接使用，不要用文件系统工具（grep/glob/bash）去探索代码。",
  inputSchema: z.object({}),
  async execute() {
    // 宿主路径由 extension.config 注入（config 在工具运行时才绑定），每次 execute 前配置（幂等）
    configureDashboardSpecPath(extension.config.dashboardSpecPath);
    const current = readServerDashboardSpec();
    return { ok: true, spec: baseSpec(current) };
  },
});
