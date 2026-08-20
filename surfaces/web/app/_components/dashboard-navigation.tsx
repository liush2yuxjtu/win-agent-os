"use client";

import { Bot, FileText, Gauge, LayoutDashboard, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const navItems = [
  { label: "经营总览", icon: LayoutDashboard, href: "/" },
  { label: "报告中心", icon: FileText, href: "/reports" },
  { label: "技能管理", icon: Sparkles, href: "/skills" },
  { label: "机器人接入", icon: Bot, href: "/bots" },
];

/** 左侧业务导航：有 href 的项渲染为路由链接并按当前路径高亮，其余保持装饰按钮。 */
export function DashboardNavigation() {
  const pathname = usePathname();
  return (
    <aside className="hidden border-r border-black/8 bg-[#20241f] text-[#eef0e8] lg:flex lg:min-h-0 lg:flex-col">
      <div className="flex h-[76px] shrink-0 items-center gap-3 border-b border-white/8 px-6">
        <div className="grid size-8 place-items-center rounded-[10px] bg-[#d7ff5f] text-[#20241f] shadow-[0_0_0_1px_rgba(255,255,255,.08)]">
          <Gauge className="size-[18px]" strokeWidth={2.25} />
        </div>
        <div>
          <p className="font-semibold tracking-[-0.03em]">QC Growth</p>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/60">经营驾驶舱</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3" aria-label="主导航">
        <p className="px-3 pb-2 pt-3 text-[10px] font-medium uppercase tracking-[0.17em] text-white/55">业务空间</p>
        {navItems.map(({ label, icon: Icon, href }) => {
          const active = pathname === href;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                active ? "bg-white/10 text-white" : "text-white/72 hover:bg-white/6 hover:text-white"
              }`}
              href={href}
              key={label}
            >
              <Icon className={`size-4 ${active ? "text-[#d7ff5f]" : "text-white/60"}`} />
              {label}
              {active ? <span className="ml-auto size-1.5 rounded-full bg-[#d7ff5f]" /> : null}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-1 border-t border-white/8 p-3">
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/8 bg-black/10 p-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-[#f0dcb8] text-xs font-semibold text-[#54452c]">QC</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-white/86">经营分析空间</span>
            <span className="block truncate text-[10px] text-white/60">经销商可读 · 业务可配置</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
