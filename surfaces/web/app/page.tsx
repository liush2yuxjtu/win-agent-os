import { CircleAlert } from "lucide-react";
import { DashboardNavigation } from "@/app/_components/dashboard-navigation";
import { DashboardSpecShell } from "@/app/_components/dashboard-spec-shell";
import { DualModeShell } from "@/app/_components/dual-mode";
import { getQcDashboardData, type QcDashboardData } from "@/lib/qc-dashboard/data";
import { resolveQuery, type ResolvedQuery } from "@/lib/qc-dashboard/registry";
import { getSkillSuggestions } from "@/lib/skills/registry";
import type { QueryResultData } from "dsh-shared";

export default async function Page() {
  const [result, skillSuggestions, insights, daily, topMaterials] = await Promise.all([
    getQcDashboardData(),
    getSkillSuggestions(),
    resolveQuery("fixed:insights"),
    resolveQuery("fixed:daily"),
    resolveQuery("fixed:topMaterials"),
  ]);

  return (
    <DualModeShell
      navigation={<DashboardNavigation />}
      suggestions={skillSuggestions}
      dashboard={
        <main className="min-w-0 overflow-y-auto">
          <DashboardHeader anchorDate={result.status === "ready" ? result.anchorDate : undefined} />
          {result.status === "ready" ? (
            <DashboardContent data={result} dataMap={buildDataMap({ insights, daily, topMaterials })} />
          ) : (
            <UnavailableState message={result.message} />
          )}
        </main>
      }
    />
  );
}

function DashboardHeader({ anchorDate }: { readonly anchorDate?: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-black/7 bg-[#f4f1ea]/92 px-5 backdrop-blur-xl sm:px-8">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/60">QC 素材经营数据</p>
        <h1 className="mt-0.5 font-semibold text-[22px] tracking-[-0.04em]">素材经营驾驶舱</h1>
      </div>
      <div className="flex items-center gap-2">
        {anchorDate ? (
          <span className="hidden items-center gap-2 rounded-xl border border-black/8 bg-white/55 px-3 py-2 text-[10px] text-black/64 sm:flex">
            <span className="size-1.5 rounded-full bg-[#6f9a50]" /> 数据截至 {formatDate(anchorDate)}
          </span>
        ) : null}
      </div>
    </header>
  );
}

/**
 * 看板整页由 json-render spec 渲染（基础款 = 内置 spec；聊天可 CRUD 布局，
 * 预览→确定应用，可一键复原基础款）。数据仍由服务端拉取后注入 KPI state，
 * 并把 dataRef 查询结果（走势图/洞察/素材明细）一并注入 dataMap：服务端与
 * 客户端首渲染一致，避免 hydration mismatch（此前 dataRef 仅客户端异步拉取，
 * 服务端渲染空表 → Table 容器树不一致 → React 报错并重生成子树）。
 * spec 渲染失败时 SpecBoundary 自动回滚基础款，不会白屏。
 */
function buildDataMap(queries: {
  insights: ResolvedQuery | null;
  daily: ResolvedQuery | null;
  topMaterials: ResolvedQuery | null;
}): Record<string, QueryResultData> {
  const dataMap: Record<string, QueryResultData> = {};
  if (queries.daily?.rows) dataMap["fixed:daily"] = { rows: queries.daily.rows };
  if (queries.topMaterials?.rows) dataMap["fixed:topMaterials"] = { rows: queries.topMaterials.rows };
  if (queries.insights) {
    dataMap["fixed:insights"] = {
      title: queries.insights.title,
      description: queries.insights.description,
    };
  }
  return dataMap;
}

function DashboardContent({
  data,
  dataMap,
}: {
  readonly data: QcDashboardData;
  readonly dataMap: Record<string, QueryResultData>;
}) {
  return (
    <DashboardSpecShell
      kpis={data.metrics.map((metric) => ({
        label: metric.label,
        value: metric.formattedValue,
        change: metric.formattedChange,
      }))}
      dataMap={dataMap}
    />
  );
}

function UnavailableState({ message }: { readonly message: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <div className="rounded-3xl border border-[#b66a4b]/20 bg-[#fff8f2] p-8 shadow-sm"><CircleAlert className="size-8 text-[#a75c3e]" /><h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em]">真实数据暂不可用</h2><p className="mt-3 text-sm leading-relaxed text-black/62">仪表盘不会用演示数字替代真实结果。数据暂不可用，请稍后刷新；如持续出现请联系数据管理员。</p><details className="mt-5 rounded-xl bg-black/5 p-3 text-[10px] text-black/65"><summary className="cursor-pointer select-none font-medium">详细信息</summary><p className="mt-2 leading-relaxed">{message}</p></details></div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
