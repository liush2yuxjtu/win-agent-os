import type { EveEvalContext } from "eve/evals";

/**
 * 发送消息并自动应答 agent 的 ask_question（HITL）：
 * eval 是无人值守的，agent 若用 ask_question 确认方向，用自由文本回答
 * （eve 支持 follow-up 文本命中选项自动解析）。
 */
export async function sendAndAnswer(t: EveEvalContext, text: string, answer = "触发准确性"): Promise<void> {
  let turn = await t.send(text);
  for (let attempt = 0; turn.inputRequests.length > 0 && attempt < 5; attempt += 1) {
    turn = await t.respond(turn.inputRequests.map((req) => ({ text: answer, requestId: req.requestId })));
  }
}
