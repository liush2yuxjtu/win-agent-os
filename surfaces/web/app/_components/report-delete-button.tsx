"use client";

import { useState } from "react";
import { CircleAlert, Trash2 } from "lucide-react";

/** 删除按钮：确认后调 DELETE /api/reports，删除文件与记录，成功后刷新列表。 */
export function ReportDeleteButton({ id }: { readonly id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm(`确定删除报告「${id}」吗？HTML 文件与记录都会被移除，不可恢复。`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports?name=${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "删除失败");
        setBusy(false);
        return;
      }
      // 删除成功：刷新列表（server 页面重新渲染）
      window.location.reload();
    } catch {
      setError("网络错误，请重试");
      setBusy(false);
    }
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
        aria-label={`删除报告 ${id}`}
        className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-[10px] text-black/55 transition hover:border-[#b66a4b]/30 hover:bg-[#fff5ee] hover:text-[#a75c3e]"
        disabled={busy}
        onClick={() => void handleDelete()}
      >
        <Trash2 className="size-3" />
        删除
      </button>
    </span>
  );
}
