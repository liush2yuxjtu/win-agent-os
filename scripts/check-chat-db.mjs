/**
 * 聊天历史 db 完整性检查（临时工具）：
 * 用法:node scripts/check-chat-db.mjs [sessionId 前缀]
 * 不带参数 = 检查最新会话;带参数 = 按 sessionId 前缀匹配。
 * 判定:最后一条 assistant 消息必须无工具名且长度 > 50(含完整文本回复)。
 */
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("surfaces/web/data/chat-sessions.db");
const prefix = process.argv[2];
let sessions;
if (prefix) {
  // 支持完整 ID 或末尾片段（会话 ID 长，通常只看到末尾几位）
  sessions = db
    .prepare("SELECT session_id, title, last_at FROM chat_sessions WHERE session_id LIKE ? OR session_id LIKE ? ORDER BY last_at DESC LIMIT 3")
    .all(`${prefix}%`, `%${prefix}`);
} else {
  sessions = db.prepare("SELECT session_id, title, last_at FROM chat_sessions ORDER BY last_at DESC LIMIT 1").all();
}
if (sessions.length === 0) {
  console.log("未找到会话");
  process.exit(1);
}
let ok = true;
for (const s of sessions) {
  const rows = db.prepare("SELECT seq, role, tool_name, content, length(content) len FROM chat_messages WHERE session_id = ? ORDER BY seq").all(s.session_id);
  console.log(`\n=== ${s.session_id.slice(-8)} | ${s.title} | ${s.last_at} | 消息 ${rows.length} 条`);
  for (const r of rows) {
    // 完整判定：最后一条 assistant 消息的 parts 里须有 done 的 text（最终回复）。
    // 注意不能只看 tool_name——含工具的 assistant 消息可能同时携带完整文本。
    let hasDoneText = false;
    try {
      const parts = JSON.parse(r.content);
      hasDoneText = Array.isArray(parts) && parts.some((p) => p.type === "text" && p.state === "done" && typeof p.text === "string" && p.text.length > 0);
    } catch {}
    console.log(`  seq ${r.seq} ${r.role.padEnd(9)} ${r.tool_name ?? ""} len ${r.len} ${hasDoneText ? "含完整文本" : ""}`);
    if (r.role === "assistant" && hasDoneText) {
      console.log("  ✅ 最终文本完整落库");
      ok = ok && true;
    } else if (r.role === "assistant") {
      console.log("  ❌ assistant 消息缺 done 文本");
      ok = false;
    }
  }
  const hasAssistant = rows.some((r) => r.role === "assistant");
  if (!hasAssistant) {
    console.log("  ❌ 无 assistant 消息（turn 进行中或同步未发生）");
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
