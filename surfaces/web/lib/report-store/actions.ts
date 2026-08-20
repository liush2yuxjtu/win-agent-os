"use server";

import { revalidatePath } from "next/cache";
import { archiveReport } from "@agent/lib/platform/web/report-store/db";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

/**
 * 归档/恢复报告（用户自助操作）。
 * 只改 DB 标记，不动 HTML 文件——归档后文件仍可通过原链接打开，
 * 仅从报告中心默认列表隐藏。
 */
export async function toggleReportArchived(
  id: string,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!NAME_PATTERN.test(id)) return { ok: false, error: "非法报告名" };
  archiveReport(id, archived);
  revalidatePath("/reports");
  return { ok: true };
}
