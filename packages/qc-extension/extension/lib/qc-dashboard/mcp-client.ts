import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import extension from "../../extension";

export interface McpQueryResult {
  database: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  truncated: boolean;
  duration_ms: number;
}

/**
 * 与 QC MCP bridge 的共享连接与只读查询。
 * 地址/令牌由 extension config 注入（mount 时可覆盖），
 * 未注入时回退 process.env，最后回退默认本地地址。
 */
export async function createQcClient(): Promise<Client> {
  const url = new URL(
    extension.config.mcpBridgeUrl ?? process.env.QC_MCP_BRIDGE_URL ?? "http://127.0.0.1:7331/mcp",
  );
  const token = extension.config.mcpBridgeToken ?? process.env.QC_MCP_BRIDGE_TOKEN;
  const client = new Client({ name: "qc-dashboard", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

export async function queryDatabase(
  client: Client,
  sql: string,
  maxRows: number,
  database = "WIN_DOUYIN",
): Promise<McpQueryResult> {
  const result = await client.callTool({
    name: "qc_query_database",
    arguments: { database, query: sql, max_rows: maxRows },
  });
  if (result.isError || !result.structuredContent) {
    const first = Array.isArray(result.content) ? result.content[0] : undefined;
    const detail = first && "text" in first ? first.text : "未知错误";
    throw new Error(`固定 SQL 查询失败：${detail}`);
  }
  return result.structuredContent as McpQueryResult;
}
