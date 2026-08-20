"use client";

import { CircleAlert, CheckCircle2, FlaskConical, ListChecks, Timer } from "lucide-react";
import type { BenchmarkSummary, EvalConfiguration } from "@agent/lib/skill-evals/types";

/** 对照配置 → 中文标签。 */
const CONFIG_LABELS: Record<EvalConfiguration, string> = {
  with_skill: "使用技能",
  without_skill: "不使用技能",
  new_skill: "新技能",
  old_skill: "旧技能",
};

/** 表格固定行序（只渲染 stats 中存在的配置）。 */
const CONFIG_ORDER: readonly EvalConfiguration[] = ["with_skill", "without_skill", "new_skill", "old_skill"];

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtTime(value: number): string {
  return `${value.toFixed(1)}s`;
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("zh-CN");
}

/** 通过率着色：≥0.75 绿、≥0.4 琥珀、否则红（与 expectations 徽章同色系）。 */
function passRateTone(mean: number): string {
  if (mean >= 0.75) return "bg-[#e7f0db] text-[#466536]";
  if (mean >= 0.4) return "bg-[#f5ecd8] text-[#8b642f]";
  return "bg-[#f7e5dc] text-[#8b4a36]";
}

/**
 * Benchmark 统计视图：对照配置统计表（通过率 mean±stddev / 耗时 / tokens）+ 期望达成清单。
 */
export function EvalBenchmarkView({ summary }: { readonly summary: BenchmarkSummary }) {
  const rows = CONFIG_ORDER.filter((config) => summary.stats[config]);
  const expectations = Object.entries(summary.expectations);
  const passedCount = expectations.filter(([, exp]) => exp.passed).length;

  return (
    <div className="space-y-5">
      <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] shadow-sm" aria-label="对照统计">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/7 px-5 py-4 sm:px-6">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.025em]">
              <FlaskConical className="size-4 text-[#66894e]" /> 对照统计
            </h2>
            <p className="mt-0.5 text-[10px] text-black/58">
              每项配置跑 {summary.runsPerConfiguration} 轮，共 {summary.caseCount} 个用例；执行模型 {summary.metadata.executorModel} · 评判模型 {summary.metadata.analyzerModel}
            </p>
          </div>
          <span className="rounded-full bg-[#edf3e4] px-2.5 py-1 text-[9px] font-semibold text-[#4f6b3d]">run: {summary.metadata.evalsRun || "—"}</span>
        </div>

        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-[11px] text-black/50">暂无统计数据</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="border-b border-black/7 text-[9px] uppercase tracking-[0.08em] text-black/55">
                <tr>
                  <th className="px-6 py-3 font-medium">对照配置</th>
                  <th className="px-3 py-3 font-medium">通过率（mean ± stddev）</th>
                  <th className="px-3 py-3 text-right font-medium">平均耗时</th>
                  <th className="px-3 py-3 text-right font-medium">平均 tokens</th>
                  <th className="px-6 py-3 text-right font-medium">轮次</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/6 text-[11px]">
                {rows.map((config) => {
                  const stats = summary.stats[config];
                  if (!stats) return null;
                  return (
                    <tr className="hover:bg-black/[0.018]" key={config}>
                      <td className="px-6 py-3">
                        <span className="font-medium">{CONFIG_LABELS[config]}</span>
                        <span className="ml-2 font-mono text-[9px] text-black/40">{config}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${passRateTone(stats.passRate.mean)}`}>
                          {fmtPct(stats.passRate.mean)} ± {fmtPct(stats.passRate.stddev)}
                        </span>
                        <span className="ml-1.5 text-[9px] text-black/40">min {fmtPct(stats.passRate.min)} · max {fmtPct(stats.passRate.max)}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-black/64">{fmtTime(stats.timeSeconds.mean)}</td>
                      <td className="px-3 py-3 text-right font-mono text-black/64">{fmtInt(stats.tokens.mean)}</td>
                      <td className="px-6 py-3 text-right font-mono text-black/55">{summary.runsPerConfiguration}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] shadow-sm" aria-label="期望达成">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/7 px-5 py-4 sm:px-6">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.025em]">
              <ListChecks className="size-4 text-[#66894e]" /> 期望达成
            </h2>
            <p className="mt-0.5 text-[10px] text-black/58">每条期望由评判模型按输出证据自动判定</p>
          </div>
          <span className="rounded-full bg-[#edf3e4] px-2.5 py-1 text-[9px] font-semibold text-[#4f6b3d]">
            {passedCount}/{expectations.length} 达成
          </span>
        </div>

        {expectations.length === 0 ? (
          <p className="px-6 py-10 text-center text-[11px] text-black/50">该技能未声明期望要点（evals.json expectations）</p>
        ) : (
          <ul className="divide-y divide-black/6">
            {expectations.map(([evalId, exp]) => (
              <li className="px-5 py-4 sm:px-6" key={evalId}>
                <div className="flex items-start gap-2.5">
                  {exp.passed ? (
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e7f0db] px-2 py-0.5 text-[9px] font-semibold text-[#466536]">
                      <CheckCircle2 className="size-3" /> 通过
                    </span>
                  ) : (
                    <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-[#f7e5dc] px-2 py-0.5 text-[9px] font-semibold text-[#8b4a36]">
                      <CircleAlert className="size-3" /> 未通过
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium leading-relaxed text-black/78">{exp.text}</p>
                    <p className="mt-0.5 font-mono text-[9px] text-black/40">evalId: {evalId}</p>
                    {exp.evidence.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {exp.evidence.map((evidence) => (
                          <li className="flex items-start gap-1.5 text-[10px] leading-relaxed text-black/58" key={evidence}>
                            <span className="mt-[5px] size-1 shrink-0 rounded-full bg-black/25" />
                            {evidence}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 flex items-center gap-1 text-[9px] text-black/40">
                        <Timer className="size-3" /> 无证据记录
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
