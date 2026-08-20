"use client";

import type { ReactNode } from "react";
import type { EveMessage } from "eve/react";
import { QcResultTable } from "@/components/qc/qc-result-table";
import { EvalInlineReview } from "@/app/_components/eval-inline-review";
import type { AgentInputResponse } from "./agent-message";

/** 工具输出渲染上下文：让内联交互组件（评审卡片）能回答 agent 挂起的
 *  input.requested 询问（ask_question 的 requestId 从 message 的 parts 里找）。 */
export type ToolVisualContext = {
  readonly canRespond: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (responses: readonly AgentInputResponse[]) => void | Promise<void>;
};

type QcQueryResult = {
  readonly columns?: readonly unknown[];
  readonly database?: string;
  readonly duration_ms?: number;
  readonly rows?: readonly Record<string, unknown>[];
  readonly row_count?: number;
  readonly truncated?: boolean;
  // qc__fixed_query 返回 camelCase 变体
  readonly durationMs?: number;
  readonly rowCount?: number;
};

/**
 * Generative UI registry：把已知工具的 output 渲染为结构化交互组件。
 *
 * 命中时返回渲染结果；未命中（或流式中间输出）返回 null，由调用方回退到
 * 默认的 JSON 展示。dashboard 与聊天内表格共用同一数据模型（columns/rows）。
 */
export function renderToolVisual(
  toolName: string,
  output: unknown,
  partial?: true,
  ctx?: ToolVisualContext,
): ReactNode | null {
  if (partial || typeof output !== "object" || output === null) {
    return null;
  }

  switch (toolName) {
    case "qc_query_database":
    case "qc__fixed_query":
      return renderQueryResult(output);
    case "qc_list_tables":
    case "qc_search_table_docs":
    case "qc_recommend_table":
      return renderTableList(output);
    case "run_skill_evals":
      return renderSkillEvals(output, ctx);
    default:
      return null;
  }
}

/** 技能评估输出：聊天内联评审（专家反馈 Trigger/Functional）+ 完整报告折叠。 */
function renderSkillEvals(output: unknown, ctx?: ToolVisualContext): ReactNode | null {
  const result = output as {
    readonly ok?: boolean;
    readonly skillName?: string;
    readonly summary?: string;
    readonly triggerHtml?: string;
    readonly functionalHtml?: string;
    readonly triggerCases?: readonly {
      readonly prompt: string;
      readonly expectedTrigger: boolean;
      readonly predictedTrigger: boolean;
      readonly reason: string;
      readonly pass: boolean;
    }[];
    readonly functionalCases?: readonly {
      readonly input: string;
      readonly output: string;
      readonly verdict: "pass" | "partial" | "fail";
      readonly reason: string;
      readonly expected?: string;
    }[];
    readonly error?: string;
  };
  if (!result.ok) {
    return (
      <div className="rounded-xl border border-[#b66a4b]/25 bg-[#fff5ee] px-3 py-2.5 text-[11px] text-[#a75c3e]">
        技能评估失败：{result.error ?? "未知错误"}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-black/7 bg-white/60 px-3 py-2 text-[11px]">
        <span className="size-1.5 rounded-full bg-[#6f9a50]" />
        <span className="font-medium">{result.skillName}</span>
        <span className="text-black/55">评估完成——请给出你的评审意见（触发与功能）</span>
      </div>
      {result.triggerCases && result.functionalCases && ctx ? (
        <EvalInlineReview
          canRespond={ctx.canRespond}
          functionalCases={[...result.functionalCases]}
          message={ctx.message}
          onInputResponses={ctx.onInputResponses}
          skillName={result.skillName ?? ""}
          triggerCases={[...result.triggerCases]}
        />
      ) : null}
      <EvalFrame title="完整报告 · 触发准确性 Trigger" html={result.triggerHtml} />
      <EvalFrame title="完整报告 · 功能正确性 Functional" html={result.functionalHtml} />
    </div>
  );
}

function EvalFrame({ title, html }: { readonly title: string; readonly html?: string }) {
  if (!html) return null;
  return (
    <details className="rounded-xl border border-black/7 bg-white/70" open>
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-black/70">{title}</summary>
      <iframe
        className="h-[420px] w-full rounded-b-xl border-t border-black/7 bg-white"
        sandbox=""
        srcDoc={html}
        title={title}
      />
    </details>
  );
}

function renderQueryResult(output: unknown): ReactNode | null {
  const result = output as QcQueryResult;
  const columns = toStringList(result.columns);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  if (columns.length === 0 || rows.length === 0) {
    return null;
  }
  return (
    <QcResultTable
      columns={columns}
      meta={{
        database: result.database,
        durationMs: typeof result.duration_ms === "number" ? result.duration_ms : result.durationMs,
        rowCount: typeof result.row_count === "number" ? result.row_count : result.rowCount,
        truncated: result.truncated === true,
      }}
      rows={rows}
      title="查询结果"
    />
  );
}

function renderTableList(output: unknown): ReactNode | null {
  const record = output as Record<string, unknown>;
  const candidates = ["rows", "tables", "results", "data"];
  const list = candidates
    .map((key) => record[key])
    .find((value) => Array.isArray(value) && value.length > 0);
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }

  const columns = collectColumns(list);
  if (columns.length === 0) {
    return null;
  }

  return (
    <QcResultTable
      columns={columns}
      meta={{ rowCount: list.length }}
      rows={list as readonly Record<string, unknown>[]}
      title="数据表目录"
    />
  );
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list = value.map((item) => (item === null || item === undefined ? null : String(item)));
  return list.every((item) => item !== null) ? (list as string[]) : [];
}

function collectColumns(rows: readonly unknown[]): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    if (typeof row === "object" && row !== null) {
      for (const key of Object.keys(row)) {
        columns.add(key);
      }
    }
  }
  return [...columns];
}
