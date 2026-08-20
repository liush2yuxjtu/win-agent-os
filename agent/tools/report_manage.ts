import fs from "node:fs";
import path from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { archiveReport, deleteReport, listReports } from "../lib/platform/web/report-store/db";
import { getAgentPaths } from "../platform";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * 报告管理工具：让对话里的用户也能管理报告中心的报告（归档/恢复/删除/列清单），
 * 与网页报告中心（app/reports/）同一套 SQLite 元数据库，操作即时同步。
 *
 *  - list：列出全部报告（含 LIVE/归档标记）
 *  - archive / unarchive：只改归档标记，HTML 文件保留、原链接仍可打开
 *  - delete：移除 HTML 文件 + DB 记录（不可恢复，删除前需用户明确确认）
 */
export default defineTool({
  description:
    "管理已生成的报告（与网页报告中心同一套库，操作即时同步）：list 列出全部报告；archive/unarchive 归档或恢复（只标记，文件与链接保留）；delete 删除（移除 HTML 文件与记录，不可恢复，务必先向用户确认）。当用户要求「看看有哪些报告/把 XX 报告归档/删掉 XX 报告」时使用。归档/删除目标报告时，先用 list 确认报告名（name），再操作。",
  inputSchema: z.object({
    action: z.enum(["list", "archive", "unarchive", "delete"]).describe("操作类型"),
    name: z
      .string()
      .optional()
      .describe("报告文件名（不含扩展名，如 investment-summary-2026-08）；archive/unarchive/delete 时必填"),
  }),
  async execute({ action, name }) {
    if (action === "list") {
      const reports = listReports();
      return {
        ok: true,
        reports: reports.map((r) => ({
          name: r.id,
          title: r.title,
          path: r.path,
          sizeBytes: r.sizeBytes,
          dynamic: r.dynamic,
          archived: r.archived,
          updatedAt: r.updatedAt,
        })),
      };
    }
    if (!name) {
      return { ok: false, error: "archive/unarchive/delete 操作必须提供 name（报告文件名）" };
    }
    if (!NAME_PATTERN.test(name)) {
      return { ok: false, error: "报告名仅允许字母、数字、下划线、连字符，1-64 字符" };
    }
    if (action === "archive") {
      archiveReport(name, true);
      return { ok: true, message: `已归档「${name}」（文件保留，可在报告中心「已归档」视图恢复）` };
    }
    if (action === "unarchive") {
      archiveReport(name, false);
      return { ok: true, message: `已恢复「${name}」` };
    }
    // delete：删除文件 + DB 记录
    try {
      const reportsDir = getAgentPaths().reportsDir;
      const filePath = path.join(reportsDir, `${name}.html`);
      if (path.resolve(filePath).startsWith(path.resolve(reportsDir) + path.sep)) {
        fs.rmSync(filePath, { force: true });
      }
      deleteReport(name);
      return { ok: true, message: `已删除「${name}」（文件与记录均已移除，不可恢复）` };
    } catch (error) {
      return { ok: false, error: `删除失败：${error instanceof Error ? error.message : String(error)}` };
    }
  },
});
