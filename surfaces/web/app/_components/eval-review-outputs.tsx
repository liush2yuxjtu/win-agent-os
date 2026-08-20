"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy } from "lucide-react";
import { saveEvalFeedback } from "@/lib/skill-evals/actions";
import type { BenchmarkRun, BenchmarkSummary, EvalConfiguration } from "@agent/lib/skill-evals/types";

/** configuration 徽章：with_skill 绿 / without_skill 灰 / new_skill 蓝 / old_skill 橙。 */
const CONFIG_ORDER: EvalConfiguration[] = ["with_skill", "without_skill", "new_skill", "old_skill"];

const CONFIG_META: Record<EvalConfiguration, { label: string; badge: string }> = {
  with_skill: { label: "With Skill", badge: "bg-[#e7f0db] text-[#466536]" },
  without_skill: { label: "Without Skill", badge: "bg-[#eceae3] text-[#67665c]" },
  new_skill: { label: "New Skill", badge: "bg-[#e3ecf5] text-[#3d5a7d]" },
  old_skill: { label: "Old Skill", badge: "bg-[#f8ead9] text-[#8a5a2a]" },
};

interface ReviewGroup {
  evalId: string;
  runs: BenchmarkRun[];
}

interface EvalReviewOutputsProps {
  skillName: string;
  summary: BenchmarkSummary;
  /** 既有评审反馈（页面 SSR 时经 loadEvalFeedback 读入），key = evalId。 */
  initialFeedback?: Record<string, string>;
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** 找同一 evalId 的对照对：优先 new_skill vs old_skill，其次 with vs without。 */
function findPair(runs: BenchmarkRun[]): [BenchmarkRun, BenchmarkRun] | null {
  const find = (c: EvalConfiguration) => runs.find((r) => r.configuration === c);
  const newRun = find("new_skill");
  const oldRun = find("old_skill");
  if (newRun && oldRun) return [newRun, oldRun];
  const withRun = find("with_skill");
  const withoutRun = find("without_skill");
  if (withRun && withoutRun) return [withRun, withoutRun];
  return null;
}

/** 对照输出列（Previous Output 对比面板内）。 */
function OutputColumn({ run, highlighted }: { run: BenchmarkRun; highlighted: boolean }) {
  const meta = CONFIG_META[run.configuration];
  return (
    <div className={`rounded-lg border bg-white/60 ${highlighted ? "border-[#a27635]/45" : "border-black/7"}`}>
      <div className="flex items-center gap-1.5 border-b border-black/6 px-2.5 py-1.5">
        <span className={`rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold ${meta.badge}`}>{meta.label}</span>
        <span className="text-[8.5px] text-black/45">Run {run.runNumber}</span>
      </div>
      <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[10px] leading-relaxed text-black/78">{run.output}</pre>
    </div>
  );
}

export function EvalReviewOutputs({ skillName, summary, initialFeedback = {} }: EvalReviewOutputsProps) {
  // 按 evalId 分组；组内按 configuration 固定序 × runNumber 排序
  const groups = useMemo<ReviewGroup[]>(() => {
    const map = new Map<string, BenchmarkRun[]>();
    for (const run of summary.runs) {
      const list = map.get(run.evalId);
      if (list) list.push(run);
      else map.set(run.evalId, [run]);
    }
    const sorted: ReviewGroup[] = [];
    for (const [evalId, runs] of map) {
      runs.sort((a, b) => {
        const ca = CONFIG_ORDER.indexOf(a.configuration);
        const cb = CONFIG_ORDER.indexOf(b.configuration);
        if (ca !== cb) return ca - cb;
        return a.runNumber - b.runNumber;
      });
      sorted.push({ evalId, runs });
    }
    return sorted;
  }, [summary.runs]);

  const [groupIndex, setGroupIndex] = useState(0);
  const [runIndex, setRunIndex] = useState(0);

  // 评审反馈（key = evalId），初始回显既有反馈
  const [feedback, setFeedback] = useState<Record<string, string>>(initialFeedback);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [copyState, setCopyState] = useState<string | null>(null);

  // debounce 保存：pending 存 ref，切换 evalId / 卸载时 flush
  const pendingRef = useRef<{ evalId: string; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const doSave = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!mountedRef.current) return;
    setSaveState("saving");
    const result = await saveEvalFeedback(skillName, pending.evalId, pending.text);
    if (!mountedRef.current) return;
    if (result.ok) {
      setSaveState("saved");
    } else {
      setSaveState("error");
      setSaveError(result.error);
    }
  }, [skillName]);

  const scheduleSave = useCallback(
    (evalId: string, text: string) => {
      pendingRef.current = { evalId, text };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void doSave(), 800);
    },
    [doSave],
  );

  const flushFeedback = useCallback(() => {
    if (!pendingRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void doSave();
  }, [doSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 卸载前落盘未保存的草稿（fire-and-forget，不再 setState）
      if (pendingRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        void saveEvalFeedback(skillName, pendingRef.current.evalId, pendingRef.current.text);
      }
    };
  }, [skillName]);

  // props 变化时夹取索引
  useEffect(() => {
    if (groups.length === 0) return;
    if (groupIndex >= groups.length) setGroupIndex(groups.length - 1);
    const group = groups[groupIndex];
    if (group && runIndex >= group.runs.length) setRunIndex(group.runs.length - 1);
  }, [groups, groupIndex, runIndex]);

  // 键盘导航（挂载后 window 级监听；焦点在输入框时跳过，避免干扰打字）
  const groupsRef = useRef(groups);
  const groupIndexRef = useRef(groupIndex);
  const runIndexRef = useRef(runIndex);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  useEffect(() => {
    groupIndexRef.current = groupIndex;
  }, [groupIndex]);
  useEffect(() => {
    runIndexRef.current = runIndex;
  }, [runIndex]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const gi = groupIndexRef.current;
      const ri = runIndexRef.current;
      const group = groupsRef.current[gi];
      if (!group) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (ri < group.runs.length - 1) setRunIndex(ri + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (ri > 0) setRunIndex(ri - 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (gi < groupsRef.current.length - 1) {
          flushFeedback(); // 换 evalId，先落盘当前反馈
          setGroupIndex(gi + 1);
          setRunIndex(Math.min(ri, groupsRef.current[gi + 1].runs.length - 1));
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (gi > 0) {
          flushFeedback();
          setGroupIndex(gi - 1);
          setRunIndex(Math.min(ri, groupsRef.current[gi - 1].runs.length - 1));
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flushFeedback]);

  // 切换用例（按钮用）：换 evalId 先落盘反馈
  const moveTo = useCallback(
    (gi: number, ri: number) => {
      flushFeedback();
      setGroupIndex(gi);
      setRunIndex(ri);
    },
    [flushFeedback],
  );

  function handleFeedbackChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const evalId = groups[groupIndex]?.evalId;
    if (!evalId) return;
    const text = event.target.value;
    setFeedback((prev) => ({ ...prev, [evalId]: text }));
    setSaveState("idle");
    setSaveError("");
    scheduleSave(evalId, text);
  }

  async function handleCopyFeedback() {
    const lines = Object.entries(feedback)
      .filter(([, text]) => text.trim())
      .map(([evalId, text]) => `- ${evalId}: ${text.trim()}`);
    if (lines.length === 0) {
      setCopyState("暂无反馈");
      setTimeout(() => setCopyState(null), 1600);
      return;
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyState(`已复制 ${lines.length} 条反馈`);
    } catch {
      setCopyState("复制失败");
    }
    setTimeout(() => setCopyState(null), 2000);
  }

  if (groups.length === 0) {
    return (
      <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] p-8 text-center text-[11px] text-black/50">
        暂无评测运行数据，请先在「Benchmark」页运行一次评估。
      </section>
    );
  }

  const currentGroup = groups[Math.min(groupIndex, groups.length - 1)];
  const currentRun = currentGroup.runs[Math.min(runIndex, currentGroup.runs.length - 1)];
  const runMeta = CONFIG_META[currentRun.configuration];
  const pair = findPair(currentGroup.runs);
  const feedbackCount = Object.values(feedback).filter((t) => t.trim()).length;
  const currentFeedback = feedback[currentGroup.evalId] ?? "";

  return (
    <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] shadow-[0_12px_40px_rgba(35,38,31,.035)]">
      {/* 头部：用例导航 + 复制反馈 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/7 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.025em]">Outputs · 逐 run 评审</h2>
          <p className="mt-0.5 text-[10px] text-black/58">
            用例 <span className="font-mono">{currentGroup.evalId}</span>（{groupIndex + 1}/{groups.length}）· 已反馈{" "}
            {feedbackCount}/{groups.length}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            aria-label="上一个用例"
            className="inline-flex items-center gap-1 rounded-lg border border-black/8 bg-white/70 px-2 py-1.5 text-[9px] text-black/64 hover:border-black/15 disabled:opacity-40"
            disabled={groupIndex === 0}
            onClick={() => moveTo(Math.max(0, groupIndex - 1), 0)}
            type="button"
          >
            <ChevronLeft className="size-2.5" /> 上一个
          </button>
          <button
            aria-label="下一个用例"
            className="inline-flex items-center gap-1 rounded-lg border border-black/8 bg-white/70 px-2 py-1.5 text-[9px] text-black/64 hover:border-black/15 disabled:opacity-40"
            disabled={groupIndex >= groups.length - 1}
            onClick={() => moveTo(Math.min(groups.length - 1, groupIndex + 1), 0)}
            type="button"
          >
            下一个 <ChevronRight className="size-2.5" />
          </button>
          <button
            aria-label="复制全部反馈"
            className="inline-flex items-center gap-1 rounded-lg bg-[#20241f] px-2.5 py-1.5 text-[9px] font-medium text-white transition hover:bg-black"
            onClick={() => void handleCopyFeedback()}
            type="button"
          >
            {copyState ? <Check className="size-2.5" /> : <ClipboardCopy className="size-2.5" />}
            {copyState ?? `复制反馈${feedbackCount > 0 ? `（${feedbackCount}）` : ""}`}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        {/* 当前 run 主面板 */}
        <div className="rounded-xl border border-black/7 bg-white/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${runMeta.badge}`}>{runMeta.label}</span>
              <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[9px] text-black/55">
                Run {currentRun.runNumber}/{summary.runsPerConfiguration}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                  currentRun.pass ? "bg-[#e0efe6] text-[#2f6b4a]" : "bg-[#f7e5dc] text-[#8b4a36]"
                }`}
              >
                {currentRun.pass ? "通过" : "未过"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                aria-label="上一个 run"
                className="inline-flex size-6 items-center justify-center rounded-lg border border-black/8 bg-white/70 text-black/64 hover:border-black/15 disabled:opacity-40"
                disabled={runIndex === 0}
                onClick={() => setRunIndex(Math.max(0, runIndex - 1))}
                type="button"
              >
                <ChevronLeft className="size-3" />
              </button>
              <button
                aria-label="下一个 run"
                className="inline-flex size-6 items-center justify-center rounded-lg border border-black/8 bg-white/70 text-black/64 hover:border-black/15 disabled:opacity-40"
                disabled={runIndex >= currentGroup.runs.length - 1}
                onClick={() => setRunIndex(Math.min(currentGroup.runs.length - 1, runIndex + 1))}
                type="button"
              >
                <ChevronRight className="size-3" />
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-black/45">Prompt</p>
              <div className="mt-1 rounded-lg border border-black/7 bg-white/60 px-3 py-2 text-[10px] leading-relaxed text-black/78">
                <span className="whitespace-pre-wrap break-words">{currentRun.input}</span>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-black/45">Output</p>
              <pre className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-black/7 bg-white/60 px-3 py-2 font-mono text-[10px] leading-relaxed text-black/78">
                {currentRun.output}
              </pre>
            </div>
            {currentRun.evidence.length > 0 ? (
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-black/45">Evidence</p>
                <ul className="mt-1 space-y-1">
                  {currentRun.evidence.map((item, i) => (
                    <li className="flex gap-1.5 text-[10px] leading-relaxed text-black/70" key={i}>
                      <span className="text-black/35">•</span>
                      <span className="min-w-0">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="flex flex-wrap gap-3 text-[9px] text-black/45">
              <span>耗时 {formatDuration(currentRun.durationMs)}</span>
              <span>{currentRun.tokens.toLocaleString("en-US")} tokens</span>
              <span className="ml-auto hidden sm:inline">← → 切换 run · ↑ ↓ 切换用例（输入框内不生效）</span>
            </p>
          </div>
        </div>

        {/* Previous Output 对比（同用例 new vs old / with vs without） */}
        {pair ? (
          <details className="group rounded-xl border border-black/7 bg-white/40">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2.5 text-[10px] font-medium text-black/65">
              <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
              Previous Output 对比
              <span className="text-black/40">（{CONFIG_META[pair[0].configuration].label} vs {CONFIG_META[pair[1].configuration].label}）</span>
            </summary>
            <div className="grid gap-3 border-t border-black/7 p-3 md:grid-cols-2">
              <OutputColumn
                highlighted={currentRun.configuration === pair[0].configuration}
                run={pair[0]}
              />
              <OutputColumn
                highlighted={currentRun.configuration === pair[1].configuration}
                run={pair[1]}
              />
            </div>
          </details>
        ) : null}

        {/* 评审反馈（key = evalId，自动保存） */}
        <div className="rounded-xl border border-black/7 bg-white/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold">评审反馈</p>
            <span className="font-mono text-[9px] text-black/45">key: {currentGroup.evalId}</span>
          </div>
          <textarea
            className="mt-2 min-h-24 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[11px] leading-relaxed outline-none focus:border-black/25"
            onChange={handleFeedbackChange}
            placeholder="针对该用例写下改进反馈（自动保存，供 agent 改进技能）…"
            value={currentFeedback}
          />
          <div className="mt-1.5 flex items-center justify-between text-[9px]">
            <span className="text-black/45">自动保存 · 上次反馈已回显</span>
            <span className={saveState === "error" ? "text-[#a75c3e]" : "text-black/45"}>
              {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "error" ? `保存失败：${saveError}` : ""}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
