import { access } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const host = process.env.QC_MCP_BRIDGE_HOST ?? "127.0.0.1";
const port = Number(process.env.QC_MCP_BRIDGE_PORT ?? "7331");
const token = process.env.QC_MCP_BRIDGE_TOKEN;
const nodeBin = process.env.QC_NODE_BIN ?? process.execPath;
const qcRoot = process.env.QC_MCP_CWD ?? "/Users/liushiyuwin/MCP_source";
const serverEntry = process.env.QC_MCP_SERVER ?? path.join(qcRoot, "dist/index.js");
const rawFilesDir = process.env.QC_RAW_FILES_DIR ?? path.join(qcRoot, "raw_files");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`QC_MCP_BRIDGE_PORT 非法：${process.env.QC_MCP_BRIDGE_PORT}`);
}
if (!loopbackHosts.has(host) && !token) {
  throw new Error("非 loopback bridge 必须设置 QC_MCP_BRIDGE_TOKEN");
}

await access(serverEntry);
await access(rawFilesDir);

const upstream = new Client({ name: "qc-mcp-http-bridge", version: "1.0.0" });
const upstreamTransport = new StdioClientTransport({
  command: nodeBin,
  args: [serverEntry],
  cwd: qcRoot,
  env: {
    ...process.env,
    QC_RAW_FILES_DIR: rawFilesDir,
  },
  stderr: "inherit",
});
await upstream.connect(upstreamTransport);

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
    const listed = await upstream.listTools();
    res.json({
      status: "ok",
      transport: "streamable-http",
      upstream: "stdio",
      tools: listed.tools.map((tool) => tool.name),
    });
  } catch (error) {
    res.status(503).json({ status: "error", error: String(error) });
  }
});

app.post("/mcp", async (req, res) => {
  const proxy = new Server(
    { name: "qc-mcp-http-bridge", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "只读 QC 数据工具。先搜索或读取表文档，再执行受保护的 SELECT/WITH 查询。",
    },
  );

  proxy.setRequestHandler(ListToolsRequestSchema, async (request) =>
    upstream.listTools(request.params),
  );
  proxy.setRequestHandler(CallToolRequestSchema, async (request) =>
    upstream.callTool(request.params),
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await proxy.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("QC MCP bridge request failed", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal bridge error" },
        id: null,
      });
    }
  } finally {
    res.on("close", () => {
      void transport.close();
      void proxy.close();
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
  console.log(`QC MCP bridge listening at http://${host}:${port}/mcp`);
  console.log(`QC MCP upstream: ${nodeBin} ${serverEntry}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`QC MCP bridge shutting down (${signal})`);
  httpServer.close();
  await upstream.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
