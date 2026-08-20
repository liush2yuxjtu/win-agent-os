import { defineMcpClientConnection } from "eve/connections";

const apiKey = process.env.EXA_API_KEY;

/**
 * Exa 联网搜索：搜索最新信息/新闻/行业动态，抓取网页正文做摘要与引用。
 * 与 Claude Code 侧同源的官方 MCP（https://mcp.exa.ai/mcp），key 走
 * .env.local 的 EXA_API_KEY（本机 ~/.claude.json 的 mcpServers.exa 同源）。
 */
export default defineMcpClientConnection({
  url: apiKey ? `https://mcp.exa.ai/mcp?exaApiKey=${apiKey}` : "https://mcp.exa.ai/mcp",
  description:
    "Exa 联网搜索与网页读取。用于搜索外部最新信息、新闻、行业动态、资料引用；web_fetch_exa 抓取指定 URL 的正文做摘要或核对引用。结果须附来源链接，不确定的信息如实说明。",
  tools: {
    allow: ["web_search_exa", "web_fetch_exa"],
  },
});
