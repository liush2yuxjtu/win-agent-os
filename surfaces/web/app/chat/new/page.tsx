import { SessionNewPage } from "@/app/_components/session-chat-page";

/**
 * 新对话深链：/chat/new 打开即全屏新聊天（无历史水合），支持 ?prompt= 预填自动发送。
 * 静态路由优先于 [sessionId] 动态路由，不会把它当成会话 ID。
 */
export default async function NewChatPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt } = await searchParams;
  return <SessionNewPage prompt={prompt || undefined} />;
}
