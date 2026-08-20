import type { EveMessage } from "eve/react";
import type { SessionSnapshot } from "eve/client";

/**
 * 聊天历史记录入口（Phase 2 的 history adapter）。
 *
 * 覆盖现有 lib/chat-history.ts 的全部能力：
 * - list：会话清单（服务端 DB 优先，本地缓存回退由实现方决定）；
 * - record：记录/更新一次会话（双写）；
 * - syncMessages：同步消息本体（幂等）；
 * - remove：删除单条会话；
 * - clear：清空本地/全部会话记录；
 * - fetchSnapshot：从 eve 运行时重放会话完整历史（restore 用）。
 */
export type ChatHistoryEntry = {
  readonly sessionId: string;
  /** 上次已知的会话事件游标（恢复时用于 attach）。 */
  readonly streamIndex: number;
  /** 第一条用户消息的文本摘要。 */
  readonly title: string;
  /** 最后活跃时间（epoch ms）。 */
  readonly lastAt: number;
  /** 用户消息条数。 */
  readonly userMessages: number;
  /** 历史存档：服务端 eve session 已过期，仅 DB 文本记录（导入的旧会话）。 */
  readonly archived?: boolean;
};

export interface ChatHistoryAdapter {
  /** 会话清单：优先服务端 DB（跨端口一致），失败回退本地缓存。 */
  list(): Promise<ChatHistoryEntry[]>;
  /** 记录/更新一次会话（双写：本地缓存 + 服务端 DB）。 */
  record(
    session: { readonly sessionId: string; readonly streamIndex: number },
    meta: { readonly title: string; readonly userMessages: number },
  ): void;
  /** 同步会话消息本体（幂等：seq 去重）。 */
  syncMessages(sessionId: string, messages: readonly EveMessage[]): void;
  /** 删除单条会话记录。 */
  remove(sessionId: string): Promise<void>;
  /** 清空全部本地会话记录（不影响服务端持久化数据，由实现方定义语义）。 */
  clear(): void;
  /**
   * 从 eve 运行时重放一个会话的完整历史。
   * attach 后 snapshot() 从事件 0 读到持久化尾部，返回 events + 精确游标。
   * 会话不存在或已过期（服务端 404/流错误）时返回 null。
   */
  fetchSnapshot(sessionId: string): Promise<SessionSnapshot | null>;
}
