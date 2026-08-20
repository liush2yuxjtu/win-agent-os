import { NextResponse } from "next/server";
import { readRegistryFile } from "@agent/lib/skills/registry-file";

/**
 * 技能注册表快照 API（winbrain 静态原型真实数据源之一）。
 *
 * GET /api/skills → { ok, skills: [{name, folder, kind, description, enabled}] }
 * 数据源：lib/skills/registry.json（git 提交的技能快照，只读）。
 * 复用 agent/lib/skills/registry-file.ts（纯 fs 读取，无 server-only / Next 依赖），
 * 供 surfaces/web/public/winbrain/index.html 的 EXPERTS / QUICK 重映射使用。
 *
 * 注意：web 面的技能注册表 UI（/skills）走 surfaces/web/lib/skills/ 的
 * server-only 层；本路由刻意只用 agent 侧纯文件读取，避免引入 server-only 依赖。
 */
export async function GET() {
  try {
    const registry = readRegistryFile();
    const skills = (registry.skills ?? []).map((s) => ({
      name: s.name,
      folder: s.folder,
      kind: s.kind,
      description: s.description,
      enabled: s.enabled,
    }));
    return NextResponse.json({ ok: true, skills });
  } catch {
    // 快照缺失/解析失败 → 空清单（渲染端降级为离线 mockup，不炸界面）
    return NextResponse.json({ ok: true, skills: [] });
  }
}
