import { defineMcpClientConnection } from "eve/connections";

import extension from "../extension";

const token = extension.config.mcpBridgeToken ?? process.env.QC_MCP_BRIDGE_TOKEN;

export default defineMcpClientConnection({
  url: extension.config.mcpBridgeUrl,
  description:
    "QC 业务数据与表字典。用于搜索和推荐业务表、读取字段与表关系文档，并对 video_management 或 WIN_DOUYIN 执行只读 SQL 查询。",
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  tools: {
    allow: [
      "qc_search_table_docs",
      "qc_get_table_doc",
      "qc_list_tables",
      "qc_query_database",
      "qc_recommend_table",
    ],
  },
});
