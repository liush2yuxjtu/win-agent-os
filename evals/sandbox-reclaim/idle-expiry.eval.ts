import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";
import { isIdleExpired, IDLE_MS } from "../../agent/lib/sandbox-reclaim";

/**
 * 沙盒闲置到期判定（纯逻辑回归，回归 98898a5）：
 * 「最近一次活动后 IDLE_MS 无活动」才到期回收——活动会重置计时器
 * （hooks/sandbox-idle.ts 多事件续命），不是对话开始后固定 10 分钟。
 */
export default defineEval({
  description: "沙盒闲置回收判定:最近活动后 10 分钟无活动才到期",
  tags: ["sandbox", "reclaim"],
  async test(t) {
    const lastActivityAt = 1_000_000;

    // 窗口内活动过 → 未到期（差 1ms 也不回收）
    t.check(isIdleExpired(lastActivityAt, lastActivityAt + IDLE_MS - 1), equals(false));

    // 满 10 分钟无活动 → 到期
    t.check(isIdleExpired(lastActivityAt, lastActivityAt + IDLE_MS), equals(true));

    // 超时 → 到期
    t.check(isIdleExpired(lastActivityAt, lastActivityAt + IDLE_MS + 5_000), equals(true));

    // 刚活动 → 未到期
    t.check(isIdleExpired(lastActivityAt, lastActivityAt), equals(false));
    t.check(isIdleExpired(lastActivityAt, lastActivityAt + 1), equals(false));

    // 窗口可配置（测试/调参用）
    t.check(isIdleExpired(lastActivityAt, lastActivityAt + 60_000, 60_000), equals(true));
    t.check(isIdleExpired(lastActivityAt, lastActivityAt + 59_999, 60_000), equals(false));

    // 窗口常量可读
    t.check(IDLE_MS, equals(600_000));
  },
});
