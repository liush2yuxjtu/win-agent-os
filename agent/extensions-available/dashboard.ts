/**
 * dashboard extension 挂载：看板增删查改 + 数据源管理。
 * 宿主路径在平台侧解析（getAgentPaths），注入 extension，包内不 import 平台。
 */
import path from "node:path";
import dashboard from "dashboard-extension";
import { getAgentPaths, getUserQueriesPath } from "../platform";

const paths = getAgentPaths();

export default dashboard({
  dashboardSpecPath: paths.dashboardSpecPath,
  userQueriesPath: getUserQueriesPath(paths),
});
