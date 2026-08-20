/**
 * dsh-shared 宿主路径注入（进程级，必须先于读写调用）。
 *
 * dsh-shared 包不 import agent/platform，user-queries 注册表与看板 spec 服务端副本
 * 的落盘路径由消费方进程注入。本模块是 surfaces/web 服务端的注入点：按
 * process.cwd() 探测仓库布局（思路同 agent/platform.ts resolveWebSurfaceRoot）：
 *  - dev（嵌入式 Next.js + eve dev）时 cwd 是仓库根 → <cwd>/surfaces/web/data/…
 *  - 部署/单独启动时 cwd 即 surfaces/web → <cwd>/data/…
 *  - env SURFACE_WEB_ROOT 覆盖 web root（相对 cwd，语义同 platform.ts）。
 *
 * 只被服务端模块 import（registry.ts / app/api/dashboard-spec/route.ts），
 * 不会被 client bundle 引用（模块里有 node:fs）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { configureDashboardSpecPath } from "dsh-shared/platform-web/dashboard-spec-file";
import { configureUserQueriesPath } from "dsh-shared/qc-dashboard/user-queries";

function resolveWebRoot(): string {
  const override = process.env.SURFACE_WEB_ROOT?.trim();
  if (override) return path.resolve(process.cwd(), override);

  // dev：cwd 是仓库根，web 根在 <cwd>/surfaces/web
  const fromRepo = path.join(process.cwd(), "surfaces", "web");
  if (fs.existsSync(path.join(fromRepo, "package.json"))) return fromRepo;

  // 部署/单独启动：cwd 本身是 web 根（package.json + data/ 目录双特征）
  if (fs.existsSync(path.join(process.cwd(), "package.json")) && fs.existsSync(path.join(process.cwd(), "data"))) {
    return process.cwd();
  }

  // 兜底：仍按仓库根布局解析，读写时由文件系统报错暴露
  return fromRepo;
}

const webRoot = resolveWebRoot();
configureUserQueriesPath(path.join(webRoot, "data", "dashboard-queries.json"));
configureDashboardSpecPath(path.join(webRoot, "data", "dashboard-spec.json"));
