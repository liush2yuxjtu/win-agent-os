import fs from "node:fs";
import path from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { getAgentPaths } from "../platform";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
/** 返回上限：避免把超大 HTML 灌进上下文。 */
const MAX_BYTES = 25_000;

/**
 * 读取已生成的报告 HTML（宿主 public/reports/），供对话参考版式/口径后
 * 生成同款（例如照旧月报的板块与风格搓一份 LIVE 版）。
 * 沙箱隔离无法访问宿主文件，本工具在宿主进程直接读取。
 */
export default defineTool({
  description:
    "读取已生成的报告 HTML 内容（public/reports/ 下，如 touliu-monthly-report-2026-08），返回完整 HTML（超 25KB 截断）。当用户要求「照之前那份报告的样子/风格再生成一份」「参考 XX 报告的版式」「看看那份报告里有什么」时使用。先确认报告名：可用 report_manage list 查看。",
  inputSchema: z.object({
    name: z.string().describe("报告文件名（不含扩展名，如 touliu-monthly-report-2026-08）"),
  }),
  async execute({ name }) {
    if (!NAME_PATTERN.test(name)) {
      return { ok: false, error: "报告名仅允许字母、数字、下划线、连字符，1-64 字符" };
    }
    const filePath = path.join(getAgentPaths().reportsDir, `${name}.html`);
    if (!fs.existsSync(filePath)) {
      const available = fs.readdirSync(getAgentPaths().reportsDir).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
      return { ok: false, error: `报告「${name}」不存在。现有报告：${available.join("、")}` };
    }
    const html = fs.readFileSync(filePath, "utf8");
    const truncated = Buffer.byteLength(html, "utf8") > MAX_BYTES;
    return {
      ok: true,
      name,
      path: `/reports/${name}.html`,
      truncated,
      truncatedAt: truncated ? MAX_BYTES : undefined,
      html: truncated ? Buffer.from(html, "utf8").subarray(0, MAX_BYTES).toString("utf8") + "\n<!-- …截断… -->" : html,
    };
  },
});
