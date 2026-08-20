/**
 * qc extension 挂载：QC 数据业务（MCP bridge 连接 + 固定查询工具 + 追投诊断技能）。
 * 连接配置在此处注入，extension 包本身不读平台环境。
 */
import qc from "qc-extension";

export default qc({
  mcpBridgeUrl: process.env.QC_MCP_BRIDGE_URL ?? "http://127.0.0.1:7331/mcp",
  mcpBridgeToken: process.env.QC_MCP_BRIDGE_TOKEN,
});
