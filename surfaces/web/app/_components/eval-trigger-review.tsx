"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ClipboardCopy, Sparkles } from "lucide-react";
import { saveEvalFeedback } from "@/lib/skill-evals/actions";
import type { TriggerCaseResult } from "@agent/lib/skill-evals/types";

/** Trigger 反馈的 key 约定：trigger:<提问前 24 字符>（与 functional 的 evalId 区分）。 */
export function triggerFeedbackKey(prompt: string): string {
  return `trigger:${prompt.replace(/\s+/g, " ").slice(0, 24)}`;
}

/**
 * Trigger 评审区：专家逐例确认「是否应该触发」，纠正模型判定 + 备注，
 * 反馈保存到技能包 evals/feedback.json（agent 改进 description 时读取）。
 */
export function EvalTriggerReview({
  skillName,
  description,
  cases,
  initialFeedback,
}: {
  readonly skillName: string;
  readonly description: string;
  readonly cases: TriggerCaseResult[];
  readonly initialFeedback: Record<string, string>;
}) {
  const [index, setIndex] = useState(0);
  const [agree, setAgree] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = cases[index];
  const key = current ? triggerFeedbackKey(current.prompt) : "";
  const existing = initialFeedback[key] ?? "";
  const corrected = agree ?? current?.predictedTrigger;

  // 切换用例时初始化反馈状态
  useEffect(() => {
    setAgree(null);
    setNote(initialFeedback[key] ?? "");
    setSaved("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function persist(text: string) {
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    setSaved("saving");
    timer.current = setTimeout(() => {
      void saveEvalFeedback(skillName, key, text)
        .then((r) => setSaved(r.ok ? "saved" : "failed"))
        .catch(() => setSaved("failed"));
    }, 600);
  }

  function handleAgree(value: boolean) {
    setAgree(value);
    // 反馈文本：纠正结论 + 备注
    const text = `${value === current.expectedTrigger ? "确认" : "纠正"}：${value ? "应触发" : "不应触发"}${note.trim() ? `；${note.trim()}` : ""}`;
    persist(text);
  }

  function handleNote(value: string) {
    setNote(value);
    const base = agree === null ? (current.predictedTrigger === current.expectedTrigger ? "确认" : "纠正") : "";
    const conclusion = agree === null ? "" : `${agree ? "应触发" : "不应触发"}；`;
    persist(`${base}${conclusion}${value.trim()}`);
  }

  if (cases.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-black/10 bg-black/[0.015] px-4 py-6 text-center text-[10px] text-black/50">
        暂无 Trigger 用例——请先运行评估。
      </div>
    );
  }

  const acc = Math.round((cases.filter((c) => c.pass).length / cases.length) * 100);
  const feedbackCount = Object.keys(initialFeedback).filter((k) => k.startsWith("trigger:")).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/7 bg-white/60 px-3 py-2 text-[11px]">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-[#8b6e4e]" />
          <span className="font-medium">{skillName}</span>
          <span className="text-black/55">· 路由命中 {acc}%</span>
        </div>
        <span className="text-black/50">已反馈 {feedbackCount}/{cases.length} 例 · 键盘 ←/→ 切换</span>
      </div>

      <div className="rounded-xl border border-black/7 bg-white/50 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-black/50">
            用例 {index + 1}/{cases.length}
          </p>
          <div className="flex gap-1.5">
            <button
              className="rounded-lg border border-black/10 bg-white px-2 py-1 text-[10px] text-black/65 hover:border-black/25 disabled:opacity-40"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              type="button"
            >
              ← 上一条
            </button>
            <button
              className="rounded-lg border border-black/10 bg-white px-2 py-1 text-[10px] text-black/65 hover:border-black/25 disabled:opacity-40"
              disabled={index >= cases.length - 1}
              onClick={() => setIndex((i) => Math.min(cases.length - 1, i + 1))}
              type="button"
            >
              下一条 →
            </button>
          </div>
        </div>

        <p className="mt-3 text-sm font-medium leading-relaxed">{current.prompt}</p>

        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full bg-[#eef0e4] px-2 py-0.5 font-semibold text-[#4d6b3a]">
            期望：{current.expectedTrigger ? "应触发" : "不应触发"}
          </span>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${current.pass ? "bg-[#e7f0db] text-[#466536]" : "bg-[#f7e5dc] text-[#8b4a36]"}`}>
            模型判定：{current.predictedTrigger ? "触发" : "不触发"} {current.pass ? "✓" : "✗"}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-black/55">{current.reason}</p>

        {/* 专家纠正 */}
        <div className="mt-4 rounded-xl border border-black/6 bg-[#fbfaf6] p-3">
          <p className="text-[10px] font-semibold text-black/65">你的判断（是否应该触发此技能）</p>
          <div className="mt-2 flex gap-2">
            <button
              className={`rounded-lg px-3 py-1.5 text-[10px] font-medium border transition ${
                corrected === true ? "bg-[#e7f0db] border-[#9db98a] text-[#466536]" : "border-black/10 bg-white text-black/60 hover:border-black/25"
              }`}
              onClick={() => handleAgree(true)}
              type="button"
            >
              应触发
            </button>
            <button
              className={`rounded-lg px-3 py-1.5 text-[10px] font-medium border transition ${
                corrected === false ? "bg-[#f7e5dc] border-[#d8a08e] text-[#8b4a36]" : "border-black/10 bg-white text-black/60 hover:border-black/25"
              }`}
              onClick={() => handleAgree(false)}
              type="button"
            >
              不应触发
            </button>
            <span className="ml-auto text-[9px] text-black/45">
              {saved === "saving" ? "保存中…" : saved === "saved" ? "已保存 ✓" : saved === "failed" ? "保存失败" : "点击即自动保存"}
            </span>
          </div>
          <textarea
            className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-[11px] outline-none focus:border-black/25"
            onChange={(e) => handleNote(e.target.value)}
            placeholder="备注：这个用例该不该触发、description 缺什么关键词……"
            rows={2}
            value={note}
          />
        </div>
      </div>

      {/* 复制汇总反馈 */}
      <div className="flex items-center justify-between rounded-xl border border-black/7 bg-white/60 px-3 py-2">
        <p className="text-[10px] text-black/55">反馈已保存到技能包 evals/feedback.json——粘贴给助手即可改进 description</p>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[10px] font-medium text-black/70 hover:border-black/25"
          onClick={() => {
            const entries = Object.entries(initialFeedback).filter(([k]) => k.startsWith("trigger:"));
            const text = entries.map(([, v]) => `- ${v}`).join("\n");
            if (!text) return;
            void navigator.clipboard.writeText(text).then(() => setSaved("saved")).catch(() => setSaved("failed"));
          }}
          type="button"
        >
          <ClipboardCopy className="size-3" /> 复制 Trigger 反馈
        </button>
      </div>
    </div>
  );
}
