import { SessionNewPage } from "@/app/_components/session-chat-page";

/**
 * /chat 入口：等同 /chat/new 的全屏新聊天，但支持 ?prompt= 深链预填——
 * 打开即自动发送该 prompt（分享"直接执行某个问题"的链接）。
 * 静态路由优先于 [sessionId]，/chat 不会被当成会话 ID。
 */
export default async function ChatPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt } = await searchParams;
  return <SessionNewPage prompt={prompt || undefined} />;
}
