#!/usr/bin/env node
/**
 * toolchain-mcp：受控二进制执行器（单进程 Streamable HTTP，仿 qc-mcp-server）。
 *
 * 工具：
 *  - run_skill_script(skill, script, args[]) → tsx 执行 agent/skills/<skill>/scripts/<script>
 *  - git_op(op, args[])                      → 受控 git 只读子集（status/show/diff/log/ls-files）
 *  - python_script(path, args[])             → 白名单目录内的 python3 执行
 *
 * 安全约束：
 *  - 所有路径 resolve 后必须位于项目根内（防 ../ 逃逸）
 *  - 工具/命令白名单；execFile 无 shell（防注入）
 *  - 非 loopback 监听必须设置 TOOLCHAIN_MCP_TOKEN（Eve 连接自动带 Bearer）
 *  - 超时 30s、输出截断 20KB
 *
 * 环境变量：
 *  TOOLCHAIN_MCP_HOST（默认 127.0.0.1）、TOOLCHAIN_MCP_PORT（默认 7332）、
 *  TOOLCHAIN_MCP_TOKEN（非 loopback 必填）
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const TSX_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "tsx");

const host = process.env.TOOLCHAIN_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.TOOLCHAIN_MCP_PORT ?? "7332");
const token = process.env.TOOLCHAIN_MCP_TOKEN;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`TOOLCHAIN_MCP_PORT 非法：${process.env.TOOLCHAIN_MCP_PORT}`);
}
if (!loopbackHosts.has(host) && !token) {
  throw new Error("非 loopback 监听必须设置 TOOLCHAIN_MCP_TOKEN");
}

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const GIT_OPS = new Set(["status", "show", "diff", "log", "ls-files"]);
/** python 脚本允许的目录（相对项目根）。 */
const PYTHON_ALLOWED_DIRS = ["scripts", "lib", "qc-mcp-server/scripts", "qc-mcp-server/evals"];
const TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 20_000;

/** resolve 后必须仍在项目根内，否则拒绝。 */
function assertInsideProject(p, label) {
  const abs = path.resolve(PROJECT_ROOT, p);
  if (abs !== PROJECT_ROOT && !abs.startsWith(PROJECT_ROOT + path.sep)) {
    throw new Error(`${label} 超出项目根：${p}`);
  }
  return abs;
}

/** 执行子进程（无 shell），返回 { stdout, stderr, exitCode, timedOut }。 */
function exec(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, timeout: TIMEOUT_MS });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => resolve({ stdout, stderr, exitCode: -1, timedOut, error: err.message }));
    child.on("timeout", () => { timedOut = true; child.kill("SIGKILL"); });
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code, timedOut }));
  });
}

function truncate(s) {
  if (s.length <= OUTPUT_LIMIT) return s;
  return s.slice(0, OUTPUT_LIMIT) + "\n…[truncated]";
}

const server = new McpServer({ name: "toolchain-mcp", version: "1.0.0" });

// ---- run_skill_script：tsx 执行技能包脚本 ----
server.registerTool(
  "run_skill_script",
  {
    title: "运行技能脚本",
    description:
      "用 tsx 执行 agent/skills/<skill>/scripts/ 下的脚本（cwd 为项目根）。技能脚本需按 qc MCP 连接取数（只读）；禁止的参数不传。",
    inputSchema: {
      skill: z.string().regex(SKILL_NAME_PATTERN).describe("技能名（agent/skills/ 目录名）"),
      script: z.string().describe("scripts/ 下的脚本文件名（.ts/.mts/.js）"),
      args: z.array(z.string()).default([]).describe("传给脚本的参数（字符串数组）"),
    },
  },
  async ({ skill, script, args }) => {
    try {
      const scriptsDir = assertInsideProject(`agent/skills/${skill}/scripts`, "scripts 目录");
      const scriptFile = path.resolve(scriptsDir, script);
      if (path.dirname(scriptFile) !== scriptsDir) throw new Error("脚本必须在 scripts/ 目录内");
      if (!/\.(ts|mts|js)$/.test(script)) throw new Error("仅支持 .ts/.mts/.js 脚本");
      const r = await exec(TSX_BIN, [scriptFile, ...(args ?? [])], PROJECT_ROOT);
      return {
        content: [{ type: "text", text: truncate(r.stdout || r.stderr || "") }],
        structuredContent: {
          ok: r.exitCode === 0 && !r.timedOut,
          exitCode: r.exitCode,
          timedOut: r.timedOut,
          stdout: truncate(r.stdout),
          stderr: truncate(r.stderr),
        },
      };
    } catch (e) {
      return { content: [{ type: "text", text: `错误：${e.message}` }], isError: true };
    }
  },
);

// ---- git_op：受控 git 只读子集 ----
server.registerTool(
  "git_op",
  {
    title: "Git 只读操作",
    description:
      "受控 git 命令（只读）：status / show / diff / log / ls-files。cwd 为项目根。禁止写操作（commit/push/reset 等）。",
    inputSchema: {
      op: z.enum([...GIT_OPS]).describe("git 子命令（只读白名单）"),
      args: z.array(z.string()).default([]).describe("git 子命令参数（字符串数组）"),
    },
  },
  async ({ op, args }) => {
    try {
      const r = await exec("git", [op, ...(args ?? [])], PROJECT_ROOT);
      return {
        content: [{ type: "text", text: truncate(r.stdout || r.stderr || "") }],
        structuredContent: {
          ok: r.exitCode === 0 && !r.timedOut,
          exitCode: r.exitCode,
          timedOut: r.timedOut,
          stdout: truncate(r.stdout),
          stderr: truncate(r.stderr),
        },
      };
    } catch (e) {
      return { content: [{ type: "text", text: `错误：${e.message}` }], isError: true };
    }
  },
);

// ---- python_script：白名单目录内的 python3 ----
server.registerTool(
  "python_script",
  {
    title: "运行 Python 脚本",
    description:
      "在白名单目录（scripts/、lib/、qc-mcp-server/scripts|evals）内执行 python3 脚本。cwd 为项目根。",
    inputSchema: {
      path: z.string().describe("相对项目根的脚本路径（白名单目录内）"),
      args: z.array(z.string()).default([]).describe("python3 参数（字符串数组）"),
    },
  },
  async ({ path: scriptPath, args }) => {
    try {
      const abs = assertInsideProject(scriptPath, "脚本路径");
      const rel = path.relative(PROJECT_ROOT, abs);
      if (!PYTHON_ALLOWED_DIRS.some((dir) => rel === dir || rel.startsWith(dir + path.sep))) {
        throw new Error(`脚本不在白名单目录：${rel}`);
      }
      const r = await exec("python3", [abs, ...(args ?? [])], PROJECT_ROOT);
      return {
        content: [{ type: "text", text: truncate(r.stdout || r.stderr || "") }],
        structuredContent: {
          ok: r.exitCode === 0 && !r.timedOut,
          exitCode: r.exitCode,
          timedOut: r.timedOut,
          stdout: truncate(r.stdout),
          stderr: truncate(r.stderr),
        },
      };
    } catch (e) {
      return { content: [{ type: "text", text: `错误：${e.message}` }], isError: true };
    }
  },
);

// ---- HTTP 面（仿 qc-mcp-server）----
const app = createMcpExpressApp({ host });

if (token) {
  app.use((req, res, next) => {
    if (req.path === "/healthz") return next();
    if (req.headers.authorization === `Bearer ${token}`) return next();
    res.status(401).json({ error: "unauthorized" });
  });
}

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", transport: "streamable-http", tools: ["run_skill_script", "git_op", "python_script"] });
});

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("toolchain-mcp request failed", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  } finally {
    res.on("close", () => void transport.close());
  }
});

app.get("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
app.delete("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));

const httpServer = app.listen(port, host, () => {
  console.log(`toolchain-mcp listening at http://${host}:${port}/mcp`);
  console.log(`项目根: ${PROJECT_ROOT}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`toolchain-mcp shutting down (${signal})`);
  httpServer.close();
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
