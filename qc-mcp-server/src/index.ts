#!/usr/bin/env node
/**
 * QC 数据字典 MCP Server (qc-mcp-server)
 *
 * Serves the QC data dictionary parsed from raw_files/*.md and provides
 * read-only SQL querying of video_management / WIN_DOUYIN.
 *
 * 单进程 Streamable HTTP server：Eve 的 MCP client connection 只接受
 * HTTP/SSE URL，因此本 server 直接暴露 :7331/mcp，不再需要 bridge 转发层。
 *
 * Usage:
 *   node dist/index.js                 # Streamable HTTP server (default)
 *   node dist/index.js --stdio         # stdio MCP server（调试用）
 *   node dist/index.js --self-test     # load dictionary + list tools, then exit
 *
 * 环境变量（沿用原 bridge 的命名以保持配置兼容）：
 *   QC_MCP_BRIDGE_HOST  监听地址，默认 127.0.0.1
 *   QC_MCP_BRIDGE_PORT  监听端口，默认 7331
 *   QC_MCP_BRIDGE_TOKEN 非 loopback 监听时必填，Bearer token
 *   QC_RAW_FILES_DIR    表字典目录，默认 ./raw_files
 *   QC_MSSQL_*          SQL Server 连接配置（表字典工具不需要，查询需要）
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { rawFilesDir } from "./constants.js";
import { loadDictionary } from "./dictionary/parser.js";
import { DictionaryIndex } from "./dictionary/index.js";
import { registerTools } from "./tools/register.js";
import { closePools } from "./services/mssql.js";

const host = process.env.QC_MCP_BRIDGE_HOST ?? "127.0.0.1";
const port = Number(process.env.QC_MCP_BRIDGE_PORT ?? "7331");
const token = process.env.QC_MCP_BRIDGE_TOKEN;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

function buildServer(): { server: McpServer; toolNames: string[] } {
  const server = new McpServer({
    name: "qc-mcp-server",
    version: "1.0.0",
  });
  const dir = rawFilesDir();
  const docs = loadDictionary(dir);
  if (docs.length === 0) {
    console.error(`警告: ${dir} 下没有解析到任何 QC 表文档，字典工具将返回空结果。`);
  }
  const index = new DictionaryIndex(docs);
  const toolNames = registerTools(server, index);
  return { server, toolNames };
}

async function selfTest(): Promise<void> {
  const dir = rawFilesDir();
  const docs = loadDictionary(dir);
  const index = new DictionaryIndex(docs);
  const server = new McpServer({ name: "qc-mcp-server", version: "1.0.0" });
  const names = registerTools(server, index);
  console.log(`QC 数据字典已加载: ${docs.length} 张表 (${index.all("video_management").length} in video_management, ${index.all("WIN_DOUYIN").length} in WIN_DOUYIN)`);
  console.log(`可用工具 (${names.length}): ${names.join(", ")}`);
}

async function serveStdio(): Promise<void> {
  const { server } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("qc-mcp-server 已通过 stdio 启动");
}

async function serveHttp(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`QC_MCP_BRIDGE_PORT 非法：${process.env.QC_MCP_BRIDGE_PORT}`);
  }
  if (!loopbackHosts.has(host) && !token) {
    throw new Error("非 loopback 监听必须设置 QC_MCP_BRIDGE_TOKEN");
  }

  const { toolNames } = buildServer();
  const app = createMcpExpressApp({ host });

  if (token) {
    app.use((req, res, next) => {
      if (req.path === "/healthz") return next();
      if (req.headers.authorization === `Bearer ${token}`) return next();
      res.status(401).json({ error: "unauthorized" });
    });
  }

  app.get("/healthz", async (_req, res) => {
    try {
      res.json({
        status: "ok",
        transport: "streamable-http",
        tools: toolNames,
      });
    } catch (error) {
      res.status(503).json({ status: "error", error: String(error) });
    }
  });

  app.post("/mcp", async (req, res) => {
    // McpServer.connect 只支持单一 transport：每个 HTTP 请求都必须用
    // 独立的 server 实例 + transport，否则第二个请求 connect 会抛错 500。
    const { server } = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    } finally {
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });

  const httpServer = app.listen(port, host, () => {
    console.log(`QC MCP server listening at http://${host}:${port}/mcp`);
    console.log(`数据字典: ${rawFilesDir()}`);
  });

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`qc-mcp-server shutting down (${signal})`);
    httpServer.close();
    await closePools().catch(() => {});
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }
  if (process.argv.includes("--stdio")) {
    await serveStdio();
    return;
  }
  await serveHttp();
}

main().catch((e) => {
  console.error("启动失败:", e);
  process.exit(1);
});
