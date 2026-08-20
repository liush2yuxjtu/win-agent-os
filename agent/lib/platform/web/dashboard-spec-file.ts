/**
 * 看板 spec 服务端副本（agent 侧 dashboard_read 的数据源）。
 *
 * 看板 spec 的权威存储是浏览器 localStorage（每浏览器独立、即时生效）；
 * 服务端副本用于让 eve agent 工具（dashboard_read / 未来 dashboard_mutate）
 * 能读到「用户当前看板长什么样」——agent 在服务端执行，无法访问 localStorage。
 * 前端每次保存/清除看板时同步写/清服务端副本（fire-and-forget）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentPaths } from "../../../platform";

// 路径由消费方进程配置一次（平台挂载 / 前端初始化），包内不 import 平台。
let specPath = "";
/** 配置看板 spec 服务端副本路径（进程级，必须在首次读写前调用）。 */
export function configureDashboardSpecPath(p: string): void {
  specPath = p;
}

function serverSpecPath(): string {
  if (!specPath) throw new Error("看板 spec 路径未配置：请先调用 configureDashboardSpecPath()");
  return specPath;
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
