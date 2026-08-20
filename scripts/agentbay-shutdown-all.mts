#!/usr/bin/env node
/**
 * AgentBay 全量停机：关闭账户当前全部 RUNNING 沙盒（释放并发配额）。
 *
 * 协议与 agentBayDemo 的 shutdown-all 一致（design-protocol）：
 *   - 列出全部 RUNNING 会话 → 逐个删除
 *   - 需要确认词：--confirm "SHUTDOWN ALL"
 *   - 输出 SHUTDOWN_ALL_PASS / PARTIAL 摘要
 *
 * 用法：
 *   npx tsx scripts/agentbay-shutdown-all.mts --confirm "SHUTDOWN ALL"
 *
 * 凭据：AGENTBAY_API_KEY（env）→ ~/.config/agentbay/api_key（文件）。
 */
import { createAgentBayClient, resolveApiKey, safeMessage } from "../agent/lib/agentbay/client";

const CONFIRMATION = "SHUTDOWN ALL";

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error("缺少 AGENTBAY_API_KEY：请设置环境变量或写入 ~/.config/agentbay/api_key");
    process.exitCode = 1;
    return;
  }

  const flag = process.argv.indexOf("--confirm");
  const confirmation = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (confirmation !== CONFIRMATION) {
    console.error(`确认失败，未关闭任何沙盒。用法：--confirm "${CONFIRMATION}"`);
    process.exitCode = 2;
    return;
  }

  const client = createAgentBayClient();
  const listed = await client.list({}, 1, 50, "RUNNING");
  if (!listed.success) {
    console.error(`AgentBay 会话列表失败：${safeMessage(listed.errorMessage || "未知错误")}`);
    process.exitCode = 1;
    return;
  }
  const sessionIds = (listed.sessionIds ?? []).map((s: { sessionId: string }) => s.sessionId);
  if (sessionIds.length === 0) {
    console.log("SHUTDOWN_ALL_PASS attempted=0 deleted=0 failed=0");
    return;
  }

  console.log(`即将关闭账户当前全部 ${sessionIds.length} 个 RUNNING AgentBay 沙盒。`);
  const failures: string[] = [];
  for (const sessionId of sessionIds) {
    try {
      const found = await client.get(sessionId);
      if (!found.success || !found.session) {
        failures.push(`${sessionId}: ${found.errorMessage || "会话不可用"}`);
        continue;
      }
      const deleted = await found.session.delete(false);
      if (!deleted.success) failures.push(`${sessionId}: ${deleted.errorMessage || "删除失败"}`);
    } catch (error) {
      failures.push(`${sessionId}: ${safeMessage(error)}`);
    }
  }
  const deleted = sessionIds.length - failures.length;
  console.log(`SHUTDOWN_ALL_${failures.length ? "PARTIAL" : "PASS"} attempted=${sessionIds.length} deleted=${deleted} failed=${failures.length}`);
  for (const failure of failures) console.error(failure);
  if (failures.length) process.exitCode = 1;
}

await main();
