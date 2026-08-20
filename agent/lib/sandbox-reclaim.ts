/**
 * 沙盒回收机制纯逻辑（sandbox.ts 的决策部分，与 eve 运行时解耦，可单测）。
 *
 * 语义（2026-08-20 定稿）：
 *  - 闲置回收：「最近一次活动后 IDLE_MS 无活动」才到期回收（活动包括
 *    agent/用户任何 turn/step/工具调用/子代理，见 hooks/sandbox-idle.ts）。
 *  - 按用户配额：每用户最多 MAX_SANDBOXES_PER_USER 个沙盒；新会话到来时
 *    同用户已满则按 lastActivityAt 升序回收最久未活动的会话（stop() 后
 *    eve 下次活动自动重开沙盒，宿主侧对话状态不受影响）。
 */

/** 闲置回收窗口：最近一次活动后 10 分钟无活动即回收。 */
export const IDLE_MS = 10 * 60_000;

/** 每用户最大沙盒数，超过按最后活动时间回收最旧的。 */
export const MAX_SANDBOXES_PER_USER = 3;

/** 会话活动记录（配额/闲置决策的最小输入）。 */
export interface SandboxActivity {
  sessionId: string;
  userId: string;
  lastActivityAt: number;
}

/**
 * 配额回收决策：给定同用户的现有会话（不含新会话），返回需要回收的
 * sessionId 列表——同用户会话数 >= maxPerUser 时，按最后活动时间升序
 * 回收最久未活动的 (现有数 - maxPerUser + 1) 个，为新会话腾位。
 */
export function decideQuotaEvictions(
  userSessions: SandboxActivity[],
  maxPerUser: number = MAX_SANDBOXES_PER_USER,
): string[] {
  if (userSessions.length < maxPerUser) return [];
  const sorted = [...userSessions].sort((a, b) => a.lastActivityAt - b.lastActivityAt);
  return sorted.slice(0, userSessions.length - maxPerUser + 1).map((s) => s.sessionId);
}

/**
 * 闲置到期判定：「最近一次活动后 idleMs 无活动」即到期（now 为判定时刻，
 * 默认取调用方传入的当前时间，便于测试固定时钟）。
 */
export function isIdleExpired(
  lastActivityAt: number,
  now: number,
  idleMs: number = IDLE_MS,
): boolean {
  return now - lastActivityAt >= idleMs;
}
