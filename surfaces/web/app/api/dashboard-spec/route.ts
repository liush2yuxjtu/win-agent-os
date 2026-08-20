import { NextResponse } from "next/server";
import "@/lib/qc-dashboard/shared-init"; // 先注入 dsh-shared 的 spec 落盘路径
import {
  clearServerDashboardSpec,
  readServerDashboardSpec,
  writeServerDashboardSpec,
} from "dsh-shared/platform-web/dashboard-spec-file";

/**
 * 看板 spec 服务端副本的读写接口。
 *
 * 用途：eve agent 工具（dashboard_read / 未来 dashboard_mutate）在服务端执行，
 * 无法访问浏览器 localStorage；前端保存看板时 POST 到这里留副本，
 * agent 读这里的 GET 即可知道「用户当前看板长什么样」，从而做增量 CRUD。
 * 权威存储仍是前端 localStorage，本接口只是 agent 侧的同步镜像。
 */
export async function GET() {
  return NextResponse.json(readServerDashboardSpec());
}

export async function POST(request: Request) {
  try {
    const spec: unknown = await request.json();
    writeServerDashboardSpec(spec);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "spec 必须是合法 JSON" }, { status: 400 });
  }
}

export async function DELETE() {
  clearServerDashboardSpec();
  return NextResponse.json({ ok: true });
}
