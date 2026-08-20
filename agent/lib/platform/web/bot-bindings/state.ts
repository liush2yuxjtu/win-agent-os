/**
 * 机器人 channel 的 Chat SDK state 工厂。
 *
 * - 配置 REDIS_URL（如 redis://localhost:6379 或 Upstash）→ Redis 持久化
 *   （线程订阅、去重、游标跨重启存活）
 * - 未配置 → 内存态降级（重启丢失订阅，仅适合开发）
 */
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import type { StateAdapter } from "chat";

export function createChannelState(): StateAdapter {
  const url = process.env.REDIS_URL?.trim();
  if (url) {
    return createRedisState({ url, keyPrefix: "eve-qc-bots" });
  }
  console.warn("[bots] 未配置 REDIS_URL，使用内存 state（重启丢失线程订阅）；生产请配置 Redis");
  return createMemoryState();
}
