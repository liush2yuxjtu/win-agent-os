import type { EveMessagePart } from "eve/react";

/**
 * 归一化 assistant 消息的 parts 顺序（修复 eve 客户端 reducer 的乱序 bug）。
 *
 * 背景：eve 的 message-reducer（`upsertRun`）在同 step 的 reasoning part 已
 * `done`（`reasoning.completed` 已到达）后，若模型仍输出残余 reasoning delta
 * （deepseek 推理流与文本流交错，reasoning 流未严格先于文本流结束），会把新
 * delta 当作**新 part 追加到数组末尾**——最终 parts 里 reasoning 出现在文本
 * 之后，渲染时 thinking 块就挂在回答（表格）下方。
 *
 * 规则（幂等，对正常顺序零副作用）：
 * 1. 同 stepIndex 的多个 reasoning part 合并为一个（按到达顺序拼接文本，
 *    保留第一个的 state）；
 * 2. 每个 step 的 reasoning 前移到该 step 第一个非 reasoning part 之前
 *    （紧跟 step-start 之后）。
 *
 * 其他 part（text / dynamic-tool / file / authorization）的相对顺序不动——
 * 工具调用顺序是语义重要的，不在此重排。
 */
export function normalizeMessageParts(
  parts: readonly EveMessagePart[],
): EveMessagePart[] {
  if (parts.length < 2) return [...parts];

  // 1. 合并同 step 的 reasoning：首次出现时入队，后续 delta 拼接进第一个。
  const merged: EveMessagePart[] = [];
  const stepToIndex = new Map<number, number>();
  for (const part of parts) {
    if (part.type !== "reasoning") {
      merged.push(part);
      continue;
    }
    const step = part.stepIndex ?? 0;
    const existing = stepToIndex.get(step);
    if (existing === undefined) {
      stepToIndex.set(step, merged.length);
      merged.push(part);
    } else {
      const prev = merged[existing];
      if (prev.type === "reasoning") {
        // 保留首个 part 的 state/stepIndex，文本拼接保持原始增量顺序。
        merged[existing] = {
          ...prev,
          state: prev.state ?? part.state,
          text: prev.text + part.text,
        };
      }
    }
  }

  // 2. reasoning 前置：输出时跳过 reasoning，在所属 step 的第一个其他 part
  //    之前插入合并后的 reasoning（紧跟 step-start）。
  const output: EveMessagePart[] = [];
  const stepToReasoning = new Map<
    number,
    Extract<EveMessagePart, { type: "reasoning" }>
  >();
  for (const part of merged) {
    if (part.type === "reasoning") {
      stepToReasoning.set(part.stepIndex ?? 0, part);
    }
  }
  const emittedSteps = new Set<number>();
  for (const part of merged) {
    if (part.type === "reasoning") continue;
    if (part.type === "step-start") {
      // step-start 不携带 stepIndex，本身是锚点，直接输出；所属 step 的
      // reasoning 会在下一个非 step-start part 前插入。
      output.push(part);
      continue;
    }
    const step = part.stepIndex ?? 0;
    if (!emittedSteps.has(step)) {
      const reasoning = stepToReasoning.get(step);
      if (reasoning) output.push(reasoning);
      emittedSteps.add(step);
    }
    output.push(part);
  }
  // 兜底：只有 reasoning 没有其他 part 的 step（如被取消的 turn），追加到末尾
  // 保证思考内容不丢失。
  for (const [step, reasoning] of stepToReasoning) {
    if (!emittedSteps.has(step)) output.push(reasoning);
  }
  return output;
}
