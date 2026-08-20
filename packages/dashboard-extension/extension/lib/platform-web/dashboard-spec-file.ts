/**
 * 看板 spec 服务端副本（agent 侧 dashboard__read 的数据源）。
 *
 * 看板 spec 的权威存储是浏览器 localStorage（每浏览器独立、即时生效）；
 * 服务端副本用于让 eve agent 工具（dashboard__read / 未来 dashboard__mutate）
 * 能读到「用户当前看板长什么样」——agent 在服务端执行，无法访问 localStorage。
 * 前端每次保存/清除看板时同步写/清服务端副本（fire-and-forget）。
 *
 * 本文件是 extension 副本：宿主路径由 extension.config.dashboardSpecPath 注入
 * （挂载时配置），禁止 import 平台 getAgentPaths。前端 api/dashboard-spec/
 * route.ts 引用的是 agent 侧副本（agent/lib/platform/web/dashboard-spec-file.ts，
 * 原样保留）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import extension from "../../extension";

function serverSpecPath(): string {
  return extension.config.dashboardSpecPath;
}

/** 读取服务端副本；不存在/损坏时返回 null（调用方回退基础款或默认值）。 */
export function readServerDashboardSpec(): unknown | null {
  try {
    const raw = fs.readFileSync(serverSpecPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

/** 写入服务端副本（前端保存看板后同步）。 */
export function writeServerDashboardSpec(spec: unknown): void {
  try {
    fs.mkdirSync(path.dirname(serverSpecPath()), { recursive: true });
    fs.writeFileSync(serverSpecPath(), JSON.stringify(spec, null, 2), "utf8");
  } catch {
    // 写失败不影响主流程（localStorage 仍是权威）
  }
}

/** 清除服务端副本（前端复原基础款后同步）。 */
export function clearServerDashboardSpec(): void {
  try {
    if (fs.existsSync(serverSpecPath())) {
      fs.unlinkSync(serverSpecPath());
    }
  } catch {
    // ignore
  }
}
