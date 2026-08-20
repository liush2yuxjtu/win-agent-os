import { defineTool } from "eve/tools";
import { z } from "zod";
import { listChatMessages, listChatSessions } from "../lib/platform/web/chat-sessions/db";

/**
 * 搜索网页聊天历史（lib/chat-sessions SQLite 库），找到历史对话里的关键内容
 * ——如过去生成报告时用过的 SQL 查询、口径说明、用户原话。消息体是事件流
 * JSONL，这里按会话扫描并提取可读文本（text 字段 + 工具调用里的 sql）。
 */
function extractReadable(content: string, maxLen = 600): string {
  const parts: string[] = [];
  const textRe = /"text":\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = textRe.exec(content)) && parts.length < 3) {
    const t = m[1].replace(/\\n/g, " ").replace(/\\"/g, '"');
    if (t.trim().length > 2) parts.push(t.trim());
  }
  const sqlRe = /"sql":\s*"((?:[^"\\]|\\.){40,})"/;
  const s = sqlRe.exec(content);
  if (s) parts.push("SQL: " + s[1].replace(/\\n/g, " ").slice(0, maxLen));
  const text = parts.join(" | ").slice(0, maxLen);
  return text || content.slice(0, maxLen);
}

export default defineTool({
  description:
    "搜索网页聊天历史（SQLite），按关键词找到过去对话的内容——常用于「查一下之前生成月报时用的 SQL」「那次报告是怎么做的」。返回命中的会话标题、角色、时间与内容摘要。当用户要求查聊天记录/历史对话/之前用的查询时使用。",
  inputSchema: z.object({
    keyword: z.string().describe("搜索关键词，如「月报」「ROI」「追投」或 SQL 片段"),
    maxHits: z.number().int().min(1).max(10).default(5).describe("最多返回的命中条数"),
  }),
  async execute({ keyword, maxHits }) {
    const kw = keyword.toLowerCase();
    const hits: Array<{ sessionTitle: string; role: string; time: string; excerpt: string }> = [];
    for (const session of listChatSessions(50)) {
      if (hits.length >= maxHits) break;
      for (const msg of listChatMessages(session.sessionId, 300)) {
        if (hits.length >= maxHits) break;
        if (msg.content.toLowerCase().includes(kw)) {
          hits.push({
            sessionTitle: session.title,
            role: msg.role,
            time: msg.createdAt,
            excerpt: extractReadable(msg.content),
          });
        }
      }
    }
    return {
      ok: true,
      keyword,
      hits,
      note: hits.length === 0 ? "未找到匹配的历史消息" : `共 ${hits.length} 条命中`,
    };
  },
});
