#!/usr/bin/env node
/**
 * L1 agent 冒烟测试:真实 eve invoke 一个便宜 prompt,校验 turn 完成。
 *
 * 用法:
 *   node scripts/agent-smoke.mjs                                  # 连 http://127.0.0.1:3000
 *   node scripts/agent-smoke.mjs --url http://127.0.0.1:3000      # 显式指定 dev server
 *   node scripts/agent-smoke.mjs --profile standalone             # 标注目标 profile(信息性)
 *
 * 成功:exit 0,stdout 打印一行 JSON(ok/outcome/completed 摘要)。
 * 失败:exit 1,stdout 打印 JSON 诊断(含原始输出尾部)。
 *
 * 说明:
 * - 连接现有 dev server(eve dev)时带 `Authorization: Bearer local-dev`
 *   —— localDev() 认证只要求进程是 eve dev,不校验 token 值,但 invoke CLI
 *   需要显式 header 才会跳过 Vercel deployment 解析。
 * - `--profile` 是信息性标注(web|standalone|headless):真实 profile 由
 *   agent/platform.ts 在服务器进程启动时决定,客户端调用不改变它;
 *   不同 profile 的行为差异需分别以对应 profile 启动 dev server 后验证。
 */
import { spawnSync } from "node:child_process";

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const url = argValue(process.argv.slice(2), "--url") || process.env.EVE_AGENT_ORIGIN || "http://127.0.0.1:3000";
const profile = argValue(process.argv.slice(2), "--profile") || "web";
const prompt = argValue(process.argv.slice(2), "--prompt") || "请只回复四个字:收到,好的";

const summary = {
  ok: false,
  profile,
  url,
  prompt,
  outcome: null,
  message: null,
  startedAt: new Date().toISOString(),
  durationMs: null,
  error: null,
  outputTail: null,
};

const startedAt = Date.now();
const result = spawnSync(
  "npx",
  ["eve", "invoke", prompt, "-u", url, "-H", "Authorization: Bearer local-dev"],
  { encoding: "utf8", timeout: 120_000 },
);
summary.durationMs = Date.now() - startedAt;

if (result.error) {
  summary.error = String(result.error);
  summary.outputTail = (result.stdout || "").slice(-400);
} else {
  const out = result.stdout || "";
  try {
    const parsed = JSON.parse(out);
    summary.outcome = parsed.outcome;
    summary.message = parsed.outcome?.message ?? null;
    summary.ok = result.status === 0 && parsed.outcome?.status === "completed";
  } catch {
    summary.error = "stdout 不是有效 JSON";
    summary.outputTail = out.slice(-400);
  }
}

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
