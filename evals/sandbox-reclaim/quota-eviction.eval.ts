import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";
import { decideQuotaEvictions, MAX_SANDBOXES_PER_USER } from "../../agent/lib/sandbox-reclaim";

/**
 * 沙盒配额回收决策（纯逻辑回归，回归 98898a5）：
 * 每用户最多 MAX_SANDBOXES_PER_USER 个沙盒；同用户已满时新会话到来，
 * 按最后活动时间升序回收最久未活动的会话为新会话腾位。
 */
export default defineEval({
  description: "沙盒配额回收决策:同用户满 3 个时按最后活动时间回收最旧的",
  tags: ["sandbox", "reclaim"],
  async test(t) {
    const now = 1_000_000;
    const sessions = [
      { sessionId: "s1", userId: "u1", lastActivityAt: now - 900_000 }, // 最久未活动
      { sessionId: "s2", userId: "u1", lastActivityAt: now - 500_000 },
      { sessionId: "s3", userId: "u1", lastActivityAt: now - 100_000 },
    ];

    // 同用户已有 3 个（达到上限），再来新会话 → 回收最旧的 s1
    t.check(decideQuotaEvictions(sessions), equals(["s1"]));

    // 已满且现有 4 个（异常堆积）→ 回收最旧的 2 个（4 - 3 + 1）
    const four = [...sessions, { sessionId: "s4", userId: "u1", lastActivityAt: now }];
    t.check(decideQuotaEvictions(four), equals(["s1", "s2"]));

    // 未满时不回收
    t.check(decideQuotaEvictions(sessions.slice(1)), equals([]));

    // 不同用户互不影响：函数接收「同用户」会话列表（调用方 sandbox.ts 按
    // userId 过滤后传入）；u1 满额时 u2 的最旧会话不在列表内、不影响 u1 决策
    const withOther = [...sessions, { sessionId: "s9", userId: "u2", lastActivityAt: now - 999_999 }];
    const u1Sessions = withOther.filter((s) => s.userId === "u1");
    t.check(decideQuotaEvictions(u1Sessions), equals(["s1"]));

    // 空列表不回收
    t.check(decideQuotaEvictions([]), equals([]));

    // 上限为 1 时：任意 1 个现有会话即触发回收该会话（严格硬上限）
    t.check(decideQuotaEvictions([{ sessionId: "s1", userId: "u1", lastActivityAt: now }], 1), equals(["s1"]));

    // 上限常量可读（供文档/告警引用）
    t.check(MAX_SANDBOXES_PER_USER, equals(3));
  },
});
