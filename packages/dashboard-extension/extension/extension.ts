/**
 * 看板（dashboard）extension：把看板 spec 的读/增/删/改/验证工具与
 * edit-dashboard 技能从平台 agent 迁出，作为可复用包挂载。
 *
 * config 注入宿主路径（工具/模块一律读 extension.config，禁止 import 平台）：
 *  - dashboardSpecPath：看板 spec 服务端副本文件绝对路径（agent 侧 dashboard__read
 *    的数据源，前端保存看板时同步写入）
 *  - userQueriesPath：用户自定义只读 SQL 注册表 json 文件绝对路径
 *    （dashboard__query_save 持久化目标）
 */
import { defineExtension } from "eve/extension";
import { z } from "zod";

export default defineExtension({
  config: z.object({
    dashboardSpecPath: z.string().describe("看板 spec 服务端副本文件绝对路径"),
    userQueriesPath: z.string().describe("用户自定义查询注册表 json 文件绝对路径"),
  }),
});
