"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, CircleAlert } from "lucide-react";
import { toggleReportArchived } from "@/lib/report-store/actions";

/** 归档/恢复按钮：调 server action，乐观更新，失败回滚并提示原因。 */
export function ReportArchiveButton({
  id,
  archived,
  label = "归档",
}: {
  readonly id: string;
  readonly archived: boolean;
  readonly label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(next: boolean) {
    setBusy(true);
    setError(null);
    const result = await toggleReportArchived(id, next);
    if (!result.ok) setError(result.error);
    setBusy(false);
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {error ? (
        <span className="inline-flex max-w-[140px] items-center gap-1 rounded-lg border border-[#b66a4b]/25 bg-[#fff5ee] px-2 py-1 text-[9px] text-[#a75c3e]" role="alert">
          <CircleAlert className="size-2.5 shrink-0" />
          <span className="truncate">{error}</span>
        </span>
      ) : null}
      <button
        aria-label={`${archived ? "恢复" : label}报告 ${id}`}
        className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-[10px] text-black/55 transition hover:border-black/20 hover:bg-black/4 hover:text-black/80"
        disabled={busy}
        onClick={() => void handleToggle(!archived)}
      >
        {archived ? <ArchiveRestore className="size-3" /> : <Archive className="size-3" />}
        {archived ? "恢复" : label}
      </button>
    </span>
  );
}
