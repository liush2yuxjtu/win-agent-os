import { CheckCircle2, CircleAlert, Database } from "lucide-react";

export type QcTableMeta = {
  readonly database?: string;
  readonly durationMs?: number;
  readonly rowCount?: number;
  readonly truncated?: boolean;
};

/**
 * QC 工具结果的通用表格展示（纯展示组件，无服务端依赖）。
 * dashboard 与聊天内 Generative UI 共用同一数据模型与样式。
 */
export function QcResultTable({
  columns,
  rows,
  meta,
  title,
}: {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly meta?: QcTableMeta;
  readonly title?: string;
}) {
  const isTruncated = meta?.truncated === true;
  return (
    <div className="overflow-hidden rounded-xl border border-black/7 bg-[#fbfaf6]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/7 px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-medium text-black/66">
          <Database className="size-3 text-black/50" />
          {title ?? "查询结果"}
        </p>
        <div className="flex items-center gap-2 text-[9px] text-black/55">
          {meta?.rowCount !== undefined ? <span>{meta.rowCount} 行</span> : null}
          {meta?.durationMs !== undefined ? <span>用时 {meta.durationMs}</span> : null}
          {isTruncated ? <span className="text-[#a27635]">已截断</span> : null}
          {meta?.database ? (
            <details className="group">
              <summary className="cursor-pointer list-none">口径说明</summary>
              <span className="font-mono">{meta.database}</span>
            </details>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left">
          <thead className="border-b border-black/7 text-[9px] uppercase tracking-[0.08em] text-black/55">
            <tr>
              {columns.map((column) => (
                <th className="px-4 py-2 font-medium" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/6 text-[11px]">
            {rows.map((row, index) => (
              <tr className="hover:bg-black/[0.018]" key={index}>
                {columns.map((column) => (
                  <td className="max-w-[280px] truncate px-4 py-2" key={column}>
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[10px] text-black/55">查询没有返回任何行。</p>
      ) : null}
    </div>
  );
}

export function QcResultBadge({ ok, label }: { readonly ok: boolean; readonly label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ${
        ok ? "bg-[#e7f0dc] text-[#4d6d39]" : "bg-[#f7ead7] text-[#8b642f]"
      }`}
    >
      {ok ? <CheckCircle2 className="size-2.5" /> : <CircleAlert className="size-2.5" />}
      {label}
    </span>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
      : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
