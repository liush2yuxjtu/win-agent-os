/**
 * 跨进程轮询互斥守卫：冷启动 channel 与热绑定共用。
 *
 * 启动一个 bot 的长轮询前调用 acquirePoller(botKey)：
 * - 成功 → 本进程获得该 bot 的唯一轮询权，自动挂起心跳（60s）与进程退出释放
 * - 失败 → 已被其他进程的 poller 占用（如热绑定实例与冷启动 channel 并存），
 *   调用方必须跳过启动，否则同一条消息被拉两次、各回一次（双回复）。
 *
 * 互斥记录在 SQLite bot_pollers 表（见 ./db），进程内热重载由调用方各自的
 * globalThis Set 兜底（同 pid 重复 claim 会放行，Set 挡住重复 initialize）。
 */
import { claimPoller, heartbeatPoller, releasePoller } from "./db";

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** 尝试获取 bot_key 的轮询权；成功返回 true 并托管心跳与退出释放。 */
export function acquirePoller(botKey: string): boolean {
  if (!claimPoller(botKey)) return false;
  const timer = setInterval(() => heartbeatPoller(botKey), HEARTBEAT_INTERVAL_MS);
  // unref：心跳定时器不阻止进程退出（exit 钩子负责释放）
  timer.unref?.();
  process.once("exit", () => releasePoller(botKey));
  return true;
}
