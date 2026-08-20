import { notFound } from "next/navigation";
import { SessionChatPage } from "@/app/_components/session-chat-page";
import { getChatSession } from "@agent/lib/platform/web/chat-sessions/db";

/**
 * 会话深链路由：/chat/<sessionId> 打开即恢复对应聊天记录。
 * 服务端直查 SQLite 拿会话清单信息（标题/游标/存档标记），
 * 找不到返回 404；找到后由 SessionChatPage 挂载即恢复。
 */
export const dynamic = "force-dynamic"; // 每次实时查库，不做静态优化

export default async function ChatSessionPage({
  params,
}: {
  readonly params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const entry = getChatSession(sessionId);
  if (!entry) {
    notFound();
  }
  return <SessionChatPage entry={entry} />;
}
