#!/usr/bin/env node
/**
 * toolchain-mcp 冒烟：healthz + 三个工具的 initialize/调用验证。
 * 用法：先启动 server（npm start），再跑 npm run smoke。
 */
const BASE = process.env.TOOLCHAIN_MCP_URL ?? "http://127.0.0.1:7332";

async function call(name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e6),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const data = text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6))
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .find((d) => d && d.result);
  return data?.result ?? { raw: text.slice(0, 300) };
}

const hz = await fetch(`${BASE}/healthz`);
console.log("healthz:", hz.status, await hz.text());

console.log("git_op status:", JSON.stringify((await call("git_op", { op: "status", args: ["--short"] })).structuredContent ?? {}).slice(0, 200));
console.log("git_op log -1:", JSON.stringify((await call("git_op", { op: "log", args: ["--oneline", "-1"] })).structuredContent ?? {}).slice(0, 200));
console.log("python_script echo:", JSON.stringify((await call("python_script", { path: "scripts/ping.py" })).structuredContent ?? {}).slice(0, 200));
