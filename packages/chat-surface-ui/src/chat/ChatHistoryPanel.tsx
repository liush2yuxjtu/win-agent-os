"use client";

import { Check, History, Link2, Loader2, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { defaultNavigationAdapter, noopHistoryAdapter } from "../adapters/defaults";
import type { ChatHistoryEntry } from "../adapters/history";
import { useEveChatAdapters } from "../core/contexts";
import { cn } from "../lib/cn";
import { useChatContext } from "../core/chat-context";

/** 删除前的二次确认窗口（避免误删本地会话记录）。 */
const CONFIRM_DELETE_MS = 2200;

/**
 * 聊天头部「历史会话」按钮 + 下拉面板：列出本浏览器发起过的会话，
 * 点击恢复（重放服务端事件 → 重新挂载到该 durable session），支持逐条删除与新建对话。
 */
export function ChatHistoryPanel({ compact = false }: { readonly compact?: boolean }) {
  const { agent, isBusy, restoreSession, startNewSession, restoring } = useChatContext();
  const { history = noopHistoryAdapter, navigation = defaultNavigationAdapter } =
    useEveChatAdapters();
  const [open, setOpen] = useState(false);
  const [historyList, setHistoryList] = useState<ChatHistoryEntry[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 打开面板或会话身份变化（恢复/新建）时刷新会话清单（服务端 DB 优先）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void history.list().then((entries) => {
      if (!cancelled) setHistoryList(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [open, agent.session?.sessionId, history]);

  useEffect(() => () => {
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
  }, []);

  function handleDelete(sessionId: string) {
    if (pendingDelete === sessionId) {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      void history.remove(sessionId).then(() => history.list().then(setHistoryList));
      setPendingDelete(null);
      return;
    }
    setPendingDelete(sessionId);
    deleteTimer.current = setTimeout(() => setPendingDelete(null), CONFIRM_DELETE_MS);
  }

  /** 复制会话深链（/chat/<sessionId>），短暂显示 ✓ 反馈。 */
  function copySessionLink(sessionId: string) {
    const url = `${window.location.origin}/chat/${encodeURIComponent(sessionId)}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(sessionId);
      setTimeout(() => setCopiedId((cur) => (cur === sessionId ? null : cur)), 1500);
    });
  }

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label="历史会话"
        className={cn(
          "flex h-8 items-center rounded-full border border-black/7 bg-white/70 font-medium text-black/62 transition hover:border-black/15 hover:text-black disabled:cursor-not-allowed disabled:opacity-55",
          compact
            ? "w-8 justify-center text-[10px]"
            : "gap-1.5 px-3 text-[10px]",
        )}
        disabled={restoring}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {restoring ? <Loader2 className="size-3.5 animate-spin" /> : <History className="size-3.5" />}
        {compact ? null : "历史会话"}
      </button>

      {open ? (
        <>
          {/* 点击外部关闭 */}
          <button aria-label="关闭历史会话面板" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} type="button" />
          <div className="absolute right-0 top-[calc(100%+24px)] z-40 flex w-[330px] flex-col overflow-hidden rounded-2xl border border-black/8 bg-[#fbfaf6]/82 shadow-[0_24px_64px_rgba(32,36,31,.18)] backdrop-blur-2xl">
            {/* 面板头部 */}
            <div className="flex items-center justify-between border-b border-black/6 px-4 py-3">
              <div className="flex items-center gap-2">
                <History className="size-3.5 text-black/55" />
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-black/60">历史会话</h3>
              </div>
              {historyList.length > 0 ? (
                <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[9px] font-medium tabular-nums text-black/55">
                  {historyList.length}
                </span>
              ) : null}
            </div>

            {/* 会话列表 */}
            <div className="max-h-[360px] overflow-y-auto overscroll-contain px-1.5 py-1.5">
              {historyList.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                  <span className="grid size-10 place-items-center rounded-2xl bg-[#eeece3] text-black/35">
                    <MessageSquareText className="size-4" />
                  </span>
                  <p className="text-xs font-medium text-black/70">还没有历史会话</p>
                  <p className="max-w-[220px] text-[10px] leading-relaxed text-black/48">
                    发送一条消息后，对话会出现在这里，可随时恢复继续。
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-black/[0.04]">
                  {historyList.map((entry) => {
                    const isDeleting = pendingDelete === entry.sessionId;
                    return (
                      <li className="group relative" key={entry.sessionId}>
                        <button
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 pr-16 text-left transition-colors",
                            "hover:bg-black/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7cad58]/40",
                            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                          )}
                          disabled={isBusy || restoring}
                          onClick={() => {
                            void restoreSession(entry);
                            // URL 同步由 EveChatProvider 统一处理（sessionId 变化即同步）。
                            setOpen(false);
                          }}
                          type="button"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-[#1e211d]">{entry.title}</span>
                              {entry.archived ? (
                                <span className="shrink-0 rounded-full bg-[#f1ecdf] px-1.5 py-0.5 text-[8px] font-semibold text-[#7a6a42]">存档</span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-black/48">
                              <span className="tabular-nums">{entry.userMessages}</span> 条消息 · {formatRelativeTime(entry.lastAt)}
                              {entry.archived ? " · 历史导入（仅文本记录）" : ""}
                            </span>
                          </span>
                        </button>
                        {/* 复制链接按钮（会话深链，可分享/收藏） */}
                        <button
                          aria-label="复制会话链接"
                          className={cn(
                            "absolute right-9 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-lg transition-all",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#51713b]/50",
                            copiedId === entry.sessionId
                              ? "bg-[#edf4de] text-[#51713b] opacity-100"
                              : "bg-black/[0.045] text-black/40 opacity-0 hover:text-[#51713b] group-hover:opacity-100",
                          )}
                          onClick={() => copySessionLink(entry.sessionId)}
                          type="button"
                        >
                          {copiedId === entry.sessionId ? (
                            <Check className="size-3" />
                          ) : (
                            <Link2 className="size-3" />
                          )}
                        </button>
                        {/* 独立删除按钮（悬浮在恢复按钮上层，避免嵌套 button） */}
                        <button
                          aria-label={isDeleting ? "再次点击确认删除该会话" : "删除该会话"}
                          className={cn(
                            "absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded-lg transition-all",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b05a3c]/50",
                            isDeleting
                              ? "bg-[#b05a3c] px-1.5 text-white opacity-100 hover:bg-[#9c4f35]"
                              : "grid size-6 place-items-center bg-black/[0.045] text-black/40 opacity-0 hover:text-[#b05a3c] group-hover:opacity-100",
                          )}
                          disabled={isBusy}
                          onClick={() => handleDelete(entry.sessionId)}
                          type="button"
                        >
                          {isDeleting ? <span className="text-[9px] font-semibold">确认</span> : <Trash2 className="size-3" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* 新建对话 */}
            <div className="border-t border-black/6 p-2.5">
              <button
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#20241f] px-3 py-2 text-[10px] font-semibold text-[#eef0e8] transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-55"
                disabled={isBusy}
                onClick={() => {
                  startNewSession();
                  // 新会话与 URL 解绑：回首页，刷新不再恢复上一个深链会话。
                  navigation.push("/");
                  setOpen(false);
                }}
                type="button"
              >
                <Plus className="size-3.5" /> 新建对话
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 超过一周显示日期。 */
function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}
