"use client";

import { useState } from "react";
import { ClipboardCheck, Loader2, Play, TriangleAlert } from "lucide-react";
import { runEvalBenchmark, runTriggerEvals } from "@/lib/skill-evals/actions";
import type { BenchmarkSummary, TriggerCaseResult } from "@agent/lib/skill-evals/types";
import type { FeedbackMap } from "@agent/lib/platform/web/skill-evals/feedback";
import { EvalBenchmarkView } from "@/app/_components/eval-benchmark-view";
import { EvalTriggerReview } from "@/app/_components/eval-trigger-review";
import { EvalReviewOutputs } from "@/app/_components/eval-review-outputs";

type TabKey = "outputs" | "trigger" | "benchmark";

const TAB_ITEMS: readonly { key: TabKey; label: string }[] = [
  { key: "outputs", label: "人工评审 Outputs" },
  { key: "trigger", label: "Trigger 评审" },
  { key: "benchmark", label: "对照统计 Benchmark" },
];

/**
 * /evals 工作台：选技能 → 运行对照评估 → 双 Tab 查看（人工评审 Outputs / 对照统计 Benchmark）。
 * 评估结果存在本地 state，切换技能即清空（重新运行）。
 */
export function EvalsWorkspace({ skills }: { readonly skills: readonly string[] }) {
  const [selected, setSelected] = useState(skills[0] ?? "");
  const [tab, setTab] = useState<TabKey>("outputs");
  const [summary, setSummary] = useState<BenchmarkSummary | null>(null);
  const [triggerCases, setTriggerCases] = useState<TriggerCaseResult[] | null>(null);
  const [skillDescription, setSkillDescription] = useState("");
  const [feedback, setFeedback] = useState<FeedbackMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    if (!selected || loading) return;
    setLoading(true);
    setError(null);
    // 并行：对照评估（功能）+ Trigger 评估（路由）
    const [bench, trig] = await Promise.allSettled([runEvalBenchmark(selected), runTriggerEvals(selected)]);
    if (bench.status === "fulfilled" && bench.value.ok) {
      setSummary(bench.value.summary);
      setFeedback(bench.value.feedback);
    }
    if (trig.status === "fulfilled") {
      const r = trig.value;
      if (r.ok) {
        setTriggerCases(r.run.cases);
        setSkillDescription(r.skillDescription);
        setFeedback((prev) => ({ ...(prev ?? {}), ...r.feedback }));
      }
    }
    const failed = [bench, trig].filter((r) => r.status === "fulfilled" && !r.value.ok) as Array<{ value: { error: string } }>;
    if (failed.length > 0) {
      setError(failed.map((f) => f.value.error).join("；"));
    } else if (bench.status === "rejected" && trig.status === "rejected") {
      setError("评估运行失败");
    }
    setLoading(false);
  }

  function handleSelect(name: string) {
    setSelected(name);
    setSummary(null); // 新技能尚未评估 → 回到空态
    setTriggerCases(null);
    setFeedback(null);
    setError(null);
  }

  const noSkills = skills.length === 0;

  return (
    <div className="space-y-5">
      {/* 工具栏：技能选择 + 运行评估 */}
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/7 bg-[#fbfaf6] px-4 py-3 shadow-sm">
        <div className="flex min-w-[240px] flex-1 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#e8f2d9] text-[#4d7138]">
            <ClipboardCheck className="size-4" />
          </span>
          <label className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium text-black/58">评估技能</span>
            <select
              aria-label="选择要评估的技能"
              className="mt-1 w-full max-w-[300px] rounded-xl border border-black/8 bg-white/70 px-3 py-1.5 text-xs font-medium text-[#1e211d] outline-none transition focus:border-[#6f9a50]"
              disabled={noSkills}
              onChange={(event) => handleSelect(event.target.value)}
              value={selected}
            >
              {skills.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#20241f] px-4 py-2 text-xs font-semibold text-[#eef0e8] transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={noSkills || loading || !selected}
          onClick={() => void handleRun()}
          type="button"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {loading ? "评估运行中…" : summary ? "重新运行评估" : "运行评估"}
        </button>
      </section>

      {/* 运行失败 */}
      {error ? (
        <section className="flex items-center gap-2.5 rounded-xl border border-[#b66a4b]/30 bg-[#fff5ee] px-4 py-3 text-[11px] text-[#a75c3e]">
          <TriangleAlert className="size-4 shrink-0" /> 评估运行失败：{error}
        </section>
      ) : null}

      {/* 空态引导 */}
      {!summary && !triggerCases ? (
        <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] px-6 py-14 text-center shadow-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#ece9df] text-black/40">
            <ClipboardCheck className="size-6" />
          </span>
          <h2 className="mt-4 text-sm font-semibold tracking-[-0.025em]">
            {noSkills ? "暂无可用技能" : "尚未运行评估"}
          </h2>
          <p className="mx-auto mt-1.5 max-w-[440px] text-[11px] leading-relaxed text-black/58">
            {noSkills
              ? "技能清单暂不可用，请稍后刷新页面。"
              : "选择技能后点击「运行评估」，将执行对照实验（使用/不使用技能、新/旧技能多轮对比），生成统计报告与人工评审材料。"}
          </p>
        </section>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-xl border border-black/7 bg-[#fbfaf6] p-1 shadow-sm" role="tablist" aria-label="评估结果视图">
            {TAB_ITEMS.map(({ key, label }) => (
              <button
                aria-selected={tab === key}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition ${
                  tab === key ? "bg-[#20241f] text-[#eef0e8] shadow-sm" : "text-black/60 hover:bg-black/[0.04] hover:text-black/80"
                }`}
                key={key}
                onClick={() => setTab(key)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab 内容 */}
          {tab === "outputs" ? (
            summary ? (
              <EvalReviewOutputs initialFeedback={feedback ?? {}} skillName={summary.skillName} summary={summary} />
            ) : (
              <p className="rounded-xl border border-dashed border-black/10 bg-black/[0.015] px-4 py-6 text-center text-[10px] text-black/50">
                对照评估未运行——请点击「运行评估」。
              </p>
            )
          ) : tab === "trigger" ? (
            triggerCases ? (
              <EvalTriggerReview
                cases={triggerCases}
                description={skillDescription}
                initialFeedback={feedback ?? {}}
                skillName={selected}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-black/10 bg-black/[0.015] px-4 py-6 text-center text-[10px] text-black/50">
                Trigger 评估未运行——请点击「运行评估」。
              </p>
            )
          ) : summary ? (
            <EvalBenchmarkView summary={summary} />
          ) : (
            <p className="rounded-xl border border-dashed border-black/10 bg-black/[0.015] px-4 py-6 text-center text-[10px] text-black/50">
              对照评估未运行——请点击「运行评估」。
            </p>
          )}
        </>
      )}
    </div>
  );
}
