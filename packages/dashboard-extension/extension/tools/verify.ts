import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * 看板 CRUD 验证 · Verify：截图 + openCV/DOM 断言看板渲染质量。
 *
 * 看板结构层工具（dashboard_*）：用户在聊天里说「验证看板/看板正常吗」时触发。
 * 服务端调用 /api/dashboard-verify（执行 scripts/dashboard-verify.py：Playwright
 * 全页截图 + openCV 轮廓检测 + DOM computed style 断言），返回结构化结果。
 *
 * 与 dashboard__read 的分工：read 看 spec 结构（有没有这张卡），verify 看渲染
 * 质量（卡片数量、圆角/米白底/阴影、底部双卡不塌缩、console 无错误）。
 */
export default defineTool({
  description:
    "验证用户当前看板的渲染质量：截图并用 openCV/DOM 断言（卡片数量 ≥ 6、卡片应用 20px 圆角/米白底/柔和阴影、底部质量/口径双卡等宽不塌缩、页面无 console 错误）。用户说「验证看板」「看板渲染正常吗」时调用。返回 { ok, cardCount, cards, fails, screenshot }。失败时把 fails 逐条告诉用户，并按需用 dashboard__create/edit/remove 修复。",
  inputSchema: z.object({}),
  async execute() {
    const base = process.env.APP_URL?.trim() || "http://localhost:3000";
    try {
      const res = await fetch(`${base}/api/dashboard-verify`, { signal: AbortSignal.timeout(95_000) });
      const data: unknown = await res.json();
      return { ok: true, result: data };
    } catch (error) {
      return {
        ok: false,
        error: `验证看板失败（无法访问 ${base}/api/dashboard-verify）：${String(error).slice(0, 200)}`,
      };
    }
  },
});
