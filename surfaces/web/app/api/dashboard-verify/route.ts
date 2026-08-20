import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { NextResponse } from "next/server";
import { getAgentPaths } from "@agent/platform";

const execFileAsync = promisify(execFile);

/**
 * 看板视觉验证接口：跑 scripts/dashboard-verify.py（Playwright 截图 + openCV/DOM
 * 断言），返回结构化 JSON。eve agent 的 dashboard_verify 工具调用本接口，
 * 用户在聊天里说「验证看板」即可触发。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base") ?? "http://localhost:3000";
  const script = path.join(getAgentPaths().repoRoot, "scripts", "dashboard-verify.py");
  try {
    const { stdout } = await execFileAsync("/usr/bin/python3", [script, "--url", base, "--json"], {
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    return NextResponse.json(result);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    // 脚本失败（如 QC 不可达、浏览器异常）时尽量透出 stdout 里的 JSON；否则报错。
    if (err.stdout) {
      try {
        return NextResponse.json(JSON.parse(err.stdout), { status: 200 });
      } catch {
        // fall through
      }
    }
    return NextResponse.json(
      { ok: false, error: err.stderr?.slice(0, 500) ?? err.message?.slice(0, 500) ?? "验证脚本执行失败" },
      { status: 500 },
    );
  }
}
