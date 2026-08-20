import { defineMcpClientConnection } from "eve/connections";

import extension from "../extension";

export default defineMcpClientConnection({
  url: extension.config.mcpUrl,
  description:
    "Semantica QC 知识图：同步 raw_files，并搜索表、字段、关系、路径、provenance，运行只读图分析与规则推理。",
  headers: extension.config.mcpToken
    ? { Authorization: `Bearer ${extension.config.mcpToken}` }
    : undefined,
  tools: {
    allow: [
      "semantica_sync_raw_files",
      "semantica_get_sync_status",
      "semantica_search_graph",
      "semantica_get_graph_summary",
      "semantica_get_graph_analytics",
      "semantica_get_entity",
      "semantica_get_neighbors",
      "semantica_find_path",
      "semantica_run_reasoning",
      "semantica_export_graph",
      "semantica_get_provenance",
    ],
  },
});
