"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardCopy, Send, Sparkles, Wand2 } from "lucide-react";
import type { EveMessage, EveMessageInputRequest } from "eve/react";
import { triggerSkillImprovement } from "@/lib/skill-evals/actions";
import { functionalFeedbackKey, triggerFeedbackKey } from "@agent/lib/skill-evals/keys";
import type { FunctionalCaseResult, TriggerCaseResult } from "@agent/lib/skill-evals/types";
import type { AgentInputResponse } from "./agent-message";

/**
 * 聊天内联的评估评审：专家在对话里创建/修改技能后，对评估结果直接给出
 * 反馈（Trigger：是否应该触发；Functional：功能评价）。
 *
 * 评审链路（HITL）：
 * 1. agent 跑完 run_skill_evals 后调用 ask_question 暂停（session.waiting），
 *    前端把 pending 的 input.requested 渲染在消息里（InputRequestActions）；
 * 2. 专家在本卡片上标注/备注——只存本地 state，不落盘；
 * 3. 点「提交评审」：把全部反馈汇总成结构化文本，通过 onInputResponses
 *    （即 eve agent 的 respond API，keyed by requestId）回答挂起的询问；
 * 4. agent 从暂停处恢复，收到意见后调用 submit_skill_review 落盘
 *    evals/feedback.json（key 约定见 lib/skill-evals/keys.ts）。
 * 未提交前不写任何文件——「按反馈自动改进」也只在提交评审后才可用。
 */

/** Trigger 例的评审标注（专家视角）。 */
type TriggerReview = { readonly shouldTrigger: boolean; readonly note: string } | null;
/** Functional 例的评审标注（专家视角）。 */
type FunctionalReview = { readonly verdict: "pass" | "partial" | "fail"; readonly note: string } | null;

const VERDICT_LABEL = { pass: "通过", partial: "部分达标", fail: "失败" } as const;

/** 单例 Trigger 纠正。 */
function TriggerCaseRow({
  index,
  total,
  current,
  initialFeedback,
  onReviewChange,
}: {
  readonly index: number;
  readonly total: number;
  readonly current: TriggerCaseResult;
  readonly initialFeedback: Record<string, string>;
  readonly onReviewChange: (review: TriggerReview) => void;
}) {
  const key = triggerFeedbackKey(current.prompt);
  const [agree, setAgree] = useState<boolean | null>(null);
  const [note, setNote] = useState(initialFeedback[key] ?? "");

  function handleAgree(value: boolean) {
    setAgree(value);
    onReviewChange({ shouldTrigger: value, note });
  }

  function handleNote(value: string) {
    setNote(value);
    onReviewChange(
      agree === null && !value.trim() ? null : { shouldTrigger: agree ?? current.predictedTrigger, note: value },
    );
  }

  return (
    <div className="rounded-xl border border-black/6 bg-white/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] leading-relaxed">
          <span className="mr-1.5 font-mono text-[9px] text-black/40">{index + 1}/{total}</span>
          {current.prompt}
        </p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${current.pass ? "bg-[#e7f0db] text-[#466536]" : "bg-[#f7e5dc] text-[#8b4a36]"}`}>
          {current.pass ? "判定正确" : "判定有误"}
        </span>
      </div>
      <p className="mt-1 text-[9px] text-black/50">期望：{current.expectedTrigger ? "应触发" : "不应触发"} · 模型判定：{current.predictedTrigger ? "触发" : "不触发"} · {current.reason}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className={`rounded-lg px-2.5 py-1 text-[10px] font-medium border transition ${
            (agree ?? current.predictedTrigger) === true ? "bg-[#e7f0db] border-[#9db98a] text-[#466536]" : "border-black/10 bg-white text-black/60 hover:border-black/25"
          }`}
          onClick={() => handleAgree(true)}
          type="button"
        >
          应触发
        </button>
        <button
          className={`rounded-lg px-2.5 py-1 text-[10px] font-medium border transition ${
            (agree ?? current.predictedTrigger) === false ? "bg-[#f7e5dc] border-[#d8a08e] text-[#8b4a36]" : "border-black/10 bg-white text-black/60 hover:border-black/25"
          }`}
          onClick={() => handleAgree(false)}
          type="button"
        >
          不应触发
        </button>
        <input
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-[10px] outline-none focus:border-black/25"
          onChange={(e) => handleNote(e.target.value)}
          placeholder="备注：description 缺什么关键词…"
          value={note}
        />
      </div>
    </div>
  );
}

/** 单例 Functional 评价。 */
function FunctionalCaseRow({
  index,
  total,
  current,
  initialFeedback,
  onReviewChange,
}: {
  readonly index: number;
  readonly total: number;
  readonly current: FunctionalCaseResult;
  readonly initialFeedback: Record<string, string>;
  readonly onReviewChange: (review: FunctionalReview) => void;
}) {
  const key = functionalFeedbackKey(current.input);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [note, setNote] = useState(initialFeedback[key] ?? "");

  function handleVerdict(value: string) {
    setVerdict(value);
    onReviewChange({ verdict: value as "pass" | "partial" | "fail", note });
  }

  function handleNote(value: string) {
    setNote(value);
    onReviewChange(
      verdict === null && !value.trim() ? null : { verdict: (verdict ?? current.verdict) as "pass" | "partial" | "fail", note: value },
    );
  }

  return (
    <div className="rounded-xl border border-black/6 bg-white/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] leading-relaxed">
          <span className="mr-1.5 font-mono text-[9px] text-black/40">{index + 1}/{total}</span>
          {current.input}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {current.source === "injected" ? (
            <span className="rounded-full bg-[#e8f0fa] px-2 py-0.5 text-[9px] font-semibold text-[#3a5a80]" title="该用例结果为真实 agent 执行后注入，非内部模拟">
              真实执行
            </span>
          ) : null}
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${current.verdict === "pass" ? "bg-[#e7f0db] text-[#466536]" : current.verdict === "partial" ? "bg-[#f6ecd7] text-[#7a642f]" : "bg-[#f7e5dc] text-[#8b4a36]"}`}>
            {current.verdict === "pass" ? "通过" : current.verdict === "partial" ? "部分" : "失败"}
          </span>
        </div>
      </div>
      {current.reason ? <p className="mt-1 text-[9px] text-black/50">证据：{current.reason}</p> : null}
      {current.output ? (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-[10px] leading-relaxed text-black/45">
            <span className="mr-1 font-semibold">执行产出</span>
            <span className="[overflow-wrap:anywhere]">{current.output.slice(0, 300)}{current.output.length > 300 ? "…" : ""}</span>
            {current.output.length > 300 ? "（点击展开全文）" : null}
          </summary>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] px-2 py-1.5 text-[10px] leading-relaxed text-black/70">
            {current.output}
          </pre>
        </details>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(["pass", "partial", "fail"] as const).map((v) => (
          <button
            className={`rounded-lg px-2.5 py-1 text-[10px] font-medium border transition ${
              (verdict ?? current.verdict) === v ? "bg-[#e7f0db] border-[#9db98a] text-[#466536]" : "border-black/10 bg-white text-black/60 hover:border-black/25"
            }`}
            key={v}
            onClick={() => handleVerdict(v)}
            type="button"
          >
            {v === "pass" ? "通过" : v === "partial" ? "部分达标" : "失败"}
          </button>
        ))}
        <input
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-[10px] outline-none focus:border-black/25"
          onChange={(e) => handleNote(e.target.value)}
          placeholder="备注：指令缺什么、口径问题…"
          value={note}
        />
      </div>
    </div>
  );
}

/**
 * 聊天内联评审卡片：Trigger 纠正 + Functional 评价。
 * 标注/备注只存本地，点「提交评审」后经 inputResponses/respond 回答 agent
 * 挂起的 ask_question 询问（agent 收到后经 submit_skill_review 落盘）。
 */
export function EvalInlineReview({
  canRespond,
  message,
  onInputResponses,
  skillName,
  triggerCases,
  functionalCases,
}: {
  readonly canRespond: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
  readonly skillName: string;
  readonly triggerCases: TriggerCaseResult[];
  readonly functionalCases: FunctionalCaseResult[];
}) {
  const [submitting, setSubmitting] = useState<"idle" | "submitting" | "submitted" | "failed">("idle");
  const [improving, setImproving] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [improveMsg, setImproveMsg] = useState("");
  // 行内标注变更时 tick，刷新「已标注 N 条」计数（review ref 本身不触发渲染）
  const [, setReviewTick] = useState(0);
  /** 行内标注的本地汇总（提交时组装成结构化文本；不落盘）。 */
  const reviews = useRef<{ trigger: Record<number, TriggerReview>; functional: Record<number, FunctionalReview> }>({
    trigger: {},
    functional: {},
  });

  /** 本消息里 agent 挂起的评审询问（ask_question → input.requested）。
   *  取最后一个未回复的 question（同一 turn 里 run_skill_evals 输出与
   *  ask_question 同属一条 assistant 消息）。 */
  const pendingRequest = useMemo(() => {
    let found: EveMessageInputRequest | undefined;
    for (const part of message.parts) {
      if (part.type !== "dynamic-tool") continue;
      const inputRequest = part.toolMetadata?.eve?.inputRequest;
      // ask_question 的 input.requested（kind=question）；已回复过的跳过
      if (inputRequest && inputRequest.kind === "question" && !part.toolMetadata?.eve?.inputResponse) {
        found = inputRequest;
      }
    }
    return found;
  }, [message]);

  function buildReviewText(): string {
    const lines: string[] = [];
    for (let i = 0; i < triggerCases.length; i++) {
      const review = reviews.current.trigger[i];
      if (!review) continue;
      const prompt = triggerCases[i].prompt;
      lines.push(`- ${prompt} → ${review.shouldTrigger ? "应触发" : "不应触发"}${review.note.trim() ? `（备注：${review.note.trim()}）` : ""}`);
    }
    for (let i = 0; i < functionalCases.length; i++) {
      const review = reviews.current.functional[i];
      if (!review) continue;
      const input = functionalCases[i].input;
      lines.push(`- ${input} → ${VERDICT_LABEL[review.verdict]}${review.note.trim() ? `（备注：${review.note.trim()}）` : ""}`);
    }
    return lines.join("\n");
  }

  /** 显式提交：把全部评审汇总成结构化文本，回答 agent 挂起的 ask_question。 */
  async function handleSubmitReview() {
    if (!pendingRequest || submitting === "submitting") return;
    const text = buildReviewText();
    if (!text.trim()) return;
    setSubmitting("submitting");
    try {
      // respond API：inputResponses keyed by requestId → run 从暂停处恢复
      await onInputResponses([{ requestId: pendingRequest.requestId, text }]);
      setSubmitting("submitted");
    } catch {
      setSubmitting("failed");
    }
  }

  function copyAll() {
    const text = buildReviewText();
    void navigator.clipboard.writeText(`技能 ${skillName} 评审反馈\n${text}`).catch(() => {});
  }

  /** 自动改进：起一个 eve 会话让 agent 按反馈改 SKILL.md 并重跑评估。
   *  只有提交评审后（agent 已把反馈落盘 evals/feedback.json）才可用。 */
  async function handleAutoImprove() {
    setImproving("running");
    setImproveMsg("");
    const result = await triggerSkillImprovement(skillName);
    if (result.ok) {
      setImproving("done");
      setImproveMsg(`改进会话已启动（${result.sessionId.slice(0, 12)}…）——agent 将按反馈修改技能并重跑评估，完成后可再次评估查看对比。`);
    } else {
      setImproving("failed");
      setImproveMsg(result.error);
    }
  }

  const reviewCount =
    Object.values(reviews.current.trigger).filter(Boolean).length +
    Object.values(reviews.current.functional).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-xl border border-black/7 bg-white/60 px-3 py-2 text-[11px]">
        <span className="flex items-center gap-1.5 font-medium">
          <Sparkles className="size-3.5 text-[#8b6e4e]" /> 你的评审意见（提交评审后生效）
        </span>
        <span className="text-[9px] text-black/45">已标注 {reviewCount} 条 · 提交后 agent 落盘并据此改进</span>
      </div>

      <details open>
        <summary className="cursor-pointer select-none text-[11px] font-semibold text-black/70">
          触发准确性 · 是否应该触发（{triggerCases.length} 例）
        </summary>
        <div className="mt-2 space-y-2">
          {triggerCases.map((c, i) => (
            <TriggerCaseRow
              current={c}
              index={i}
              initialFeedback={{}}
              key={c.prompt}
              onReviewChange={(review) => {
                reviews.current.trigger[i] = review;
                setReviewTick((n) => n + 1);
              }}
              total={triggerCases.length}
            />
          ))}
        </div>
      </details>

      <details open>
        <summary className="cursor-pointer select-none text-[11px] font-semibold text-black/70">
          功能正确性 · 执行质量评价（{functionalCases.length} 例）
        </summary>
        <div className="mt-2 space-y-2">
          {functionalCases.map((c, i) => (
            <FunctionalCaseRow
              current={c}
              index={i}
              initialFeedback={{}}
              key={c.input}
              onReviewChange={(review) => {
                reviews.current.functional[i] = review;
                setReviewTick((n) => n + 1);
              }}
              total={functionalCases.length}
            />
          ))}
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/7 bg-white/60 px-3 py-2">
        <div className="min-w-0">
          {submitting === "idle" ? (
            <p className="text-[9px] text-black/50">
              {pendingRequest
                ? "标注完成后点「提交评审」——意见会直接发给 agent（agent 正在等你评审）"
                : "等待 agent 询问评审意见…（评估完成后 agent 会暂停等待评审）"}
            </p>
          ) : submitting === "submitting" ? (
            <p className="text-[9px] text-black/50">提交中…</p>
          ) : submitting === "submitted" ? (
            <p className="flex items-center gap-1 text-[9px] text-[#466536]">
              <CheckCircle2 className="size-3" /> 评审已提交——agent 正在落盘反馈并继续（之后可用「按反馈自动改进」）
            </p>
          ) : (
            <p className="text-[9px] text-[#a75c3e]">提交失败——请重试，或直接在对话中回复评审意见</p>
          )}
        </div>
        <div className="flex gap-1.5">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[10px] font-medium text-black/70 hover:border-black/25"
            onClick={() => void copyAll()}
            type="button"
          >
            <ClipboardCopy className="size-3" /> 复制反馈汇总
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#466536]/30 bg-[#edf4de] px-3 py-1.5 text-[10px] font-medium text-[#466536] hover:border-[#466536]/50 disabled:opacity-50"
            disabled={!pendingRequest || submitting !== "idle" || !canRespond || reviewCount === 0}
            onClick={() => void handleSubmitReview()}
            type="button"
          >
            <Send className={`size-3 ${submitting === "submitting" ? "animate-pulse" : ""}`} />
            {submitting === "submitting" ? "提交中…" : "提交评审"}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#8b6e4e]/30 bg-[#fdf3e4] px-3 py-1.5 text-[10px] font-medium text-[#6b5434] hover:border-[#8b6e4e]/50 disabled:opacity-50"
            disabled={submitting !== "submitted" || improving === "running"}
            onClick={() => void handleAutoImprove()}
            title={submitting !== "submitted" ? "先提交评审，agent 落盘反馈后才能自动改进" : undefined}
            type="button"
          >
            <Wand2 className={`size-3 ${improving === "running" ? "animate-spin" : ""}`} />
            {improving === "running" ? "改进运行中…" : "按反馈自动改进"}
          </button>
        </div>
      </div>
      {improveMsg ? <p className="rounded-xl border border-black/7 bg-white/60 px-3 py-2 text-[10px] text-black/60">{improveMsg}</p> : null}
    </div>
  );
}

