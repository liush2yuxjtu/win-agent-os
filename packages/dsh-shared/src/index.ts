/**
 * dsh-shared：平台 / 前端 / 业务 extension 三方共享的纯 TS 库。
 *
 * 边界：包内不 import eve、不 import agent/ 平台代码、不含 server-only。
 * 需要宿主路径的模块（user-queries / dashboard-spec-file）使用 configure* 注入。
 */

// QC 数据层
export * from "./qc-dashboard/queries.ts";
export * from "./qc-dashboard/mcp-client.ts";
export * from "./qc-dashboard/formulas.ts";

// 看板 spec
export * from "./dashboard-spec/default-spec.ts";
export * from "./dashboard-spec/crud.ts";

// json-render 数据绑定
export * from "./json-render/data-binding.ts";

