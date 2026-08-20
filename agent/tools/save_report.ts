import fs from "node:fs";
import path from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAgentPaths } from "../platform";
// 注意：import 自 report-store（无 server-only），不要引入带 server-only 的模块——
// server-only 模块会让 eve build 的模块评估报 RSC 边界错误。
import { registerReport } from "../lib/platform/web/report-store/db";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * 把 HTML 报告保存到宿主 public/reports/，返回浏览器可直接打开的 URL。
 *
 * 为什么必须用本工具而不是写沙箱 /workspace/：
 *  - 沙箱与宿主文件系统隔离（/workspace 是 VM 内路径），用户浏览器访问不到；
 *  - 沙箱 10 分钟无响应自动回收，VM 内文件会随回收永久丢失。
 *  - 本工具 execute 在宿主进程执行，直接写宿主 Next.js 静态目录 public/reports/，
 *    保存后立即通过 http://localhost:<port>/reports/<name>.html 访问。
 */
export default defineTool({
  description:
    "把 HTML 报告/图表保存为宿主可访问的文件（public/reports/），返回相对路径 path（如 /reports/xxx.html），配置了 APP_URL 时额外返回完整公网 url。当用户要求「生成 HTML 报告/图表页面/导出为网页」、或你生成了可视化 HTML（纯 SVG 图表、自包含单文件）时使用。HTML 内若包含 window.REPORT_SOURCES 数据契约（声明 queryId + fetch /api/query 渲染），保存后自动标记为 LIVE 动态报告——报告中心显示 LIVE 徽章，每次刷新自动从数据库拉取最新数字（数字不写死）；否则为静态快照。给用户链接：优先用返回的 url（公网部署时）；只有 path 时直接把 path 给用户（前端会自动补全为当前访问地址，任何部署都能打开）。严禁写死 localhost 端口；严禁把交付文件写入沙箱 /workspace/ 后给用户沙箱路径——沙箱与宿主隔离且会回收，用户无法访问。",
  inputSchema: z.object({
    name: z
      .string()
      .describe("报告文件名（不含扩展名，字母/数字/下划线/连字符，如 investment-summary-2026-08）"),
    html: z.string().describe("完整 HTML 内容（自包含单文件，内联 CSS/SVG，浏览器可直接打开）"),
  }),
  async execute({ name, html }) {
    if (!NAME_PATTERN.test(name)) {
      return { ok: false, error: "文件名仅允许字母、数字、下划线、连字符，1-64 字符" };
    }
    if (html.length > 5_000_000) {
      return { ok: false, error: "HTML 内容过大（>5MB），请精简后重试" };
    }
    try {
      const dir = getAgentPaths().reportsDir;
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${name}.html`);
      fs.writeFileSync(filePath, html, "utf8");
      // 注意：不要用 process.env.PORT 拼 URL —— eve dev 子进程的 PORT 是 eve
      // dev server 端口（如 62096），不是用户访问的 web 端口。返回相对路径，
      // 由 agent 按当前环境拼完整链接（dev 用 http://localhost:3000，生产用部署域名）。
      const urlPath = `/reports/${name}.html`;
      // 登记进报告库（SQLite）——报告中心页面从此处读列表；落盘即入册。
      // DB 登记失败不影响报告交付（文件已落盘，下次扫描目录会补录）。
      try {
        registerReport(`${name}.html`, html);
      } catch (dbError) {
        console.warn("[save_report] 报告库登记失败（不影响交付，目录扫描将补录）：", dbError);
      }
      // 部署无关的链接策略：
      //  - 配置了 APP_URL（公网部署域名）→ 返回完整公网 URL，任何人都能打开；
      //  - 未配置（本地 dev）→ 只返回相对路径，前端渲染时自动补全当前访问 origin
      //    （localhost:3000 / 内网 IP / 部署域名都正确），绝不锁死端口。
      const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
      const url = base ? `${base}${urlPath}` : undefined;
      console.log(`[save_report] 报告已保存：${filePath}（路径 ${urlPath}${url ? `，完整链接 ${url}` : ""}）`);
      return { ok: true, path: urlPath, ...(url ? { url } : {}) };
    } catch (error) {
      return { ok: false, error: `保存失败：${error instanceof Error ? error.message : String(error)}` };
    }
  },
});
