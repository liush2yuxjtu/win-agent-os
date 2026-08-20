import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.QC_MCP_BRIDGE_URL ?? "http://127.0.0.1:7331/mcp");
const token = process.env.QC_MCP_BRIDGE_TOKEN;
const client = new Client({ name: "qc-mcp-bridge-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: token
    ? { headers: { Authorization: `Bearer ${token}` } }
    : undefined,
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const expected = [
    "qc_search_table_docs",
    "qc_get_table_doc",
    "qc_list_tables",
    "qc_query_database",
    "qc_recommend_table",
  ];
  const names = tools.map((tool) => tool.name).sort();
  const missing = expected.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`缺少 QC 工具：${missing.join(", ")}`);
  }

  const listed = await client.callTool({
    name: "qc_list_tables",
    arguments: { limit: 3 },
  });
  if (listed.isError) throw new Error("qc_list_tables 返回 isError=true");

  console.log(`PASS tools=${expected.length}/5 qc_list_tables=ok`);
} finally {
  await client.close();
}
