"use client";

import { ArchiveIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChatHistoryEntry } from "@/lib/chat-history";
import { AgentChat } from "./agent-chat";
import { useChatContext } from "./chat-context";
import { ChatRoot, useChatRoot } from "./chat-root";

/**
 * 会话深链页（/chat/<sessionId>）：
 * RSC 从 SQLite 查到会话清单信息后传入，ChatRoot 挂载即自动恢复
 * （重放服务端事件 → 水合历史消息），全屏聊天。
 * 恢复失败（服务端会话已过期）时退化为全新会话，仍保持可聊天。
 */
export function SessionChatPage({ entry }: { readonly entry: ChatHistoryEntry }) {
  return (
    <ChatRoot initialEntry={entry} standalone>
      <SessionLayout entry={entry} />
    </ChatRoot>
  );
}

/**
 * 新对话深链页（/chat/new、/chat）：全屏新聊天，无历史水合。
 * 发首条消息后 session 创建，URL 自动同步为 /chat/<sessionId>。
 *
 * `prompt`：URL 深链预填（?prompt=…）——新会话就绪后自动发送一次，
 * 用于分享"打开即执行某个问题"的链接。
 */
export function SessionNewPage({ prompt }: { readonly prompt?: string }) {
  return (
    <ChatRoot standalone>
      <AgentChat variant="fullscreen" standalone />
      {prompt ? <AutoSubmitPrompt prompt={prompt} /> : null}
    </ChatRoot>
  );
}

/**
 * URL prompt 自动发送：等会话就绪（status ready 且非忙碌）后发送一次。
 *
 * StrictMode 陷阱：dev 下 effect 会挂载→卸载→重挂，useEveAgent 在卸载时
 * detach store 会 abort 当前 turn（首发的 fetch 被丢弃，只剩乐观投影）。
 * 因此跳过第一次挂载（mountCount < 2），只在稳定挂载后发送；status 未就绪
 * 时依赖变化会触发重试，最终必然发出。生产环境单次挂载直接发送。
 */
function AutoSubmitPrompt({ prompt }: { readonly prompt: string }) {
  const { agent, handleSubmit, isBusy } = useChatContext();
  const sentRef = useRef(false);
  const mountCountRef = useRef(0);

  useEffect(() => {
    mountCountRef.current += 1;
    if (mountCountRef.current < 2) return; // dev StrictMode 第一次挂载跳过
    if (sentRef.current) return;
    if (agent.status !== "ready" || isBusy) return; // 等新会话就绪（变化会重试）
    sentRef.current = true;
    void handleSubmit({ files: [], text: prompt }).catch(() => {
      sentRef.current = false; // 发送失败允许重试
    });
  }, [agent.status, isBusy, prompt, handleSubmit]);

  return null;
}

function SessionLayout({ entry }: { readonly entry: ChatHistoryEntry }) {
  const { restoring } = useChatRoot();

  return (
    <div className="relative h-dvh bg-[#fbfaf6]">
      {restoring ? <RestoringView /> : <AgentChat variant="fullscreen" standalone />}
      {entry.archived ? (
        <div className="pointer-events-none absolute inset-x-0 top-[84px] z-40 flex justify-center px-4">
          <span className="flex items-center gap-1.5 rounded-full border border-black/8 bg-white/90 px-3 py-1.5 text-[10px] text-black/58 shadow-sm backdrop-blur">
            <ArchiveIcon className="size-3" />
            历史存档会话 · 服务端会话已过期时开启新会话（清单文本记录仍可读）
          </span>
        </div>
      ) : null}
    </div>
  );
}

function RestoringView() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="size-5 animate-spin rounded-full border-2 border-black/12 border-t-[#7cad58]" />
        <p className="text-xs text-black/55">正在恢复历史会话…</p>
      </div>
    </div>
  );
}
