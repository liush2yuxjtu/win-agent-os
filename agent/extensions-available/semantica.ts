import semantica from "semantica-extension";

export default semantica({
  mcpUrl: process.env.SEMANTICA_MCP_URL ?? "http://127.0.0.1:7333/mcp",
  mcpToken: process.env.SEMANTICA_MCP_TOKEN,
});
