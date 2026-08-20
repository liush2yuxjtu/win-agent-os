import { Archive, FileText, FolderOpen, Radio } from "lucide-react";
import Link from "next/link";
import { DashboardNavigation } from "@/app/_components/dashboard-navigation";
import { ReportArchiveButton } from "@/app/_components/report-archive-button";
import { ReportDeleteButton } from "@/app/_components/report-delete-button";
import { DualModeShell } from "@/app/_components/dual-mode";
import { listReports, scanReportsDir } from "@agent/lib/platform/web/report-store/db";
import type { ReportMeta } from "@agent/lib/platform/web/report-store/db";

/** 视图：active 只显示进行中（默认），archived 只显示已归档，all 全部。 */
type ReportView = "active" | "archived" | "all";

const VIEW_OPTIONS: Array<{ key: ReportView; label: string }> = [
  { key: "active", label: "进行中" },
  { key: "archived", label: "已归档" },
  { key: "all", label: "全部" },
];

function parseView(raw: string | undefined): ReportView {
  return raw === "archived" || raw === "all" ? raw : "active";
}

/** 大小格式化：B → KB → MB。 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ViewTabs({ view, counts }: { readonly view: ReportView; readonly counts: Record<ReportView, number> }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-black/8 bg-white/60 p-1">
      {VIEW_OPTIONS.map(({ key, label }) => {
        const active = view === key;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] transition ${
              active ? "bg-[#20241f] font-medium text-[#d7ff5f] shadow-sm" : "text-black/55 hover:text-black/80"
            }`}
            href={key === "active" ? "/reports" : `/reports?view=${key}`}
            key={key}
          >
            {label}
            <span className={`rounded-full px-1.5 text-[9px] ${active ? "bg-white/12 text-[#d7ff5f]" : "bg-black/6 text-black/50"}`}>
              {counts[key]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function ReportsHeader({ total, view, counts }: { readonly total: number; readonly view: ReportView; readonly counts: Record<ReportView, number> }) {
  return (
    <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-[#20241f] text-[#d7ff5f]">
          <FolderOpen className="size-4" />
        </span>
        <div className="flex-1">
          <p className="text-xs font-medium text-black/62">报告中心</p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-[-0.035em]">已生成报告</h1>
        </div>
        <div className="flex items-center gap-2">
          <ViewTabs view={view} counts={counts} />
          <span className="rounded-full bg-[#edf3e4] px-2.5 py-1 text-[9px] font-semibold text-[#4f6b3d]">
            {total} 份报告
          </span>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-black/55">
        报告由 AI 对话生成后自动登记（public/reports/，落盘即入册）。带
        <span className="mx-1 inline-flex items-center gap-1 rounded-full bg-[#f3e9d2] px-1.5 py-0.5 text-[9px] font-semibold text-[#8b642f]">
          <Radio className="size-2.5" />LIVE
        </span>
        标记的报告每次刷新自动从数据库拉取最新数字；其余为生成时定格的静态报告。
      </p>
    </section>
  );
}

function ReportCard({ report }: { readonly report: ReportMeta }) {
  return (
    <article
      className={`group relative flex flex-col rounded-2xl border p-4 shadow-sm transition ${
        report.archived
          ? "border-black/5 bg-white/35 opacity-70 hover:opacity-90"
          : "border-black/7 bg-[#fbfaf6] hover:-translate-y-0.5 hover:shadow-md"
      }`}
    >
      <a className="flex flex-1 flex-col" href={report.path} key={report.id} target="_blank">
        <div className="flex items-start justify-between gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#ece9df] text-black/60">
            <FileText className="size-4" />
          </span>
          <span className="inline-flex items-center gap-1">
            {report.archived ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/6 px-2 py-0.5 text-[9px] font-semibold text-black/50">
                <Archive className="size-2.5" />已归档
              </span>
            ) : null}
            {report.dynamic ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f3e9d2] px-2 py-0.5 text-[9px] font-semibold text-[#8b642f]">
                <Radio className="size-2.5" />LIVE
              </span>
            ) : null}
          </span>
        </div>
        <p className="mt-3 line-clamp-2 min-h-[2.4em] text-[13px] font-medium leading-snug text-black/86" title={report.title}>
          {report.title}
        </p>
        <p className="mt-1 truncate font-mono text-[9px] text-black/45" title={report.path}>
          {report.path}
        </p>
        <div className="mt-auto flex items-center justify-between pt-3 text-[9px] text-black/50">
          <span>{formatSize(report.sizeBytes)}</span>
          <span>{formatTime(report.updatedAt)}</span>
        </div>
      </a>
      <div className="mt-2 flex items-center justify-between border-t border-black/6 pt-2">
        <ReportArchiveButton id={report.id} archived={report.archived} />
        <ReportDeleteButton id={report.id} />
      </div>
    </article>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ view?: string }>;
}) {
  // 每次访问先扫描目录补录（覆盖 DB 缺失的存量/外部写入文件），再读清单。
  const added = scanReportsDir();
  const all = listReports();
  const { view: rawView } = await searchParams;
  const view = parseView(rawView);
  const reports = view === "active" ? all.filter((r) => !r.archived) : view === "archived" ? all.filter((r) => r.archived) : all;
  const counts: Record<ReportView, number> = {
    active: all.filter((r) => !r.archived).length,
    archived: all.filter((r) => r.archived).length,
    all: all.length,
  };
  const dynamicCount = reports.filter((r) => r.dynamic && !r.archived).length;

  return (
    <DualModeShell
      navigation={<DashboardNavigation />}
      dashboard={
        <main className="min-w-0 overflow-y-auto">
          <ReportsHeader total={all.length} view={view} counts={counts} />
          <div className="mx-auto max-w-[1180px] space-y-5 px-5 py-6 sm:px-8 sm:py-8">
            {reports.length === 0 ? (
              <section className="rounded-[20px] border border-dashed border-black/15 bg-white/40 p-12 text-center">
                <p className="text-sm font-medium text-black/70">
                  {view === "archived" ? "暂无已归档报告" : view === "all" ? "暂无报告" : "暂无进行中的报告"}
                </p>
                <p className="mt-2 text-[11px] text-black/50">
                  {view === "archived"
                    ? "在报告卡片上点「归档」即可收起，点「恢复」可重新显示"
                    : "在 AI 对话里说「生成一份 XX 报告」即可产出报告，并自动出现在这里"}
                </p>
              </section>
            ) : (
              <>
                <div className="flex items-center gap-2 text-[10px] text-black/55">
                  <span className="rounded-full bg-[#edf3e4] px-2.5 py-1 font-semibold text-[#4f6b3d]">{dynamicCount} 份动态</span>
                  <span className="rounded-full bg-[#ece9df] px-2.5 py-1 font-semibold text-black/55">
                    {reports.length - dynamicCount} 份静态
                  </span>
                  <span className="ml-auto text-black/40">{added > 0 ? `本次补录 ${added} 份` : "清单已同步"}</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {reports.map((report) => (
                    <ReportCard key={report.id} report={report} />
                  ))}
                </div>
              </>
            )}
          </div>
        </main>
      }
    />
  );
}
