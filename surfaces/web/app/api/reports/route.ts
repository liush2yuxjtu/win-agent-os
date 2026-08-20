import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { archiveReport, deleteReport, listReports, scanReportsDir } from "@agent/lib/platform/web/report-store/db";

/**
 * 报告中心 API（面向业务用户的自助管理出口）：
 *  - GET  /api/reports              → 报告清单（先补扫 public/reports/ 下未入册的文件，再读 DB）
 *  - POST /api/reports?name=xxx&archived=1|0 → 归档/恢复报告（只改 DB 标记）
 *  - DELETE /api/reports?name=xxx   → 删除单个报告（DB 行 + HTML 文件）
 */
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const REPORTS_DIR = path.resolve(process.cwd(), "public/reports");

export async function GET(): Promise<NextResponse> {
  // 每次访问先补扫目录（覆盖 DB 缺失的存量/外部写入文件），再读清单。
  scanReportsDir();
  return NextResponse.json({ reports: listReports() });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const name = request.nextUrl.searchParams.get("name");
  const archivedParam = request.nextUrl.searchParams.get("archived");
  if (!name || archivedParam == null) {
    return NextResponse.json({ ok: false, error: "缺少 name/archived 参数" }, { status: 400 });
  }
  if (!NAME_PATTERN.test(name)) {
    return NextResponse.json({ ok: false, error: "非法文件名" }, { status: 400 });
  }
  if (archivedParam !== "0" && archivedParam !== "1") {
    return NextResponse.json({ ok: false, error: "archived 仅允许 0/1" }, { status: 400 });
  }
  archiveReport(name, archivedParam === "1");
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ ok: false, error: "缺少 name 参数" }, { status: 400 });
  }
  if (!NAME_PATTERN.test(name)) {
    return NextResponse.json({ ok: false, error: "非法文件名" }, { status: 400 });
  }
  const filePath = path.join(REPORTS_DIR, `${name}.html`);
  // 防路径穿越：解析后必须仍在 REPORTS_DIR 内
  if (path.resolve(filePath).startsWith(path.resolve(REPORTS_DIR) + path.sep)) {
    fs.rmSync(filePath, { force: true });
  }
  deleteReport(name);
  return NextResponse.json({ ok: true });
}
