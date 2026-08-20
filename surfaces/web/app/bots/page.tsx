import { Bot, CircleAlert } from "lucide-react";
import { BotBindings } from "@/app/_components/bot-bindings";
import { DashboardNavigation } from "@/app/_components/dashboard-navigation";
import { DualModeShell } from "@/app/_components/dual-mode";
import { listBindingViews } from "@agent/lib/platform/web/bot-bindings/db";
import { getSkillSuggestions } from "@/lib/skills/registry";

export default async function BotsPage() {
  const [botBindings, skillSuggestions] = await Promise.all([listBindingViews(), getSkillSuggestions()]);
  const connectedCount = botBindings.filter((b) => b.status === "active" && b.connectionStatus === "connected").length;

  return (
    <DualModeShell
      navigation={<DashboardNavigation />}
      suggestions={skillSuggestions}
      dashboard={
        <main className="min-w-0 overflow-y-auto">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-black/7 bg-[#f4f1ea]/92 px-5 backdrop-blur-xl sm:px-8">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/60">Bot bindings</p>
              <h1 className="mt-0.5 font-semibold text-[22px] tracking-[-0.04em]">机器人接入</h1>
            </div>
            <span className="hidden items-center gap-2 rounded-xl border border-black/8 bg-white/55 px-3 py-2 text-[10px] text-black/64 sm:flex">
              <span className="size-1.5 rounded-full bg-[#6f9a50]" /> {connectedCount} 个已连接
            </span>
          </header>
          <div className="mx-auto max-w-[1180px] space-y-5 px-5 py-6 sm:px-8 sm:py-8">
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/7 bg-[#fbfaf6] px-4 py-3 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-xl bg-[#e8f2d9] text-[#4d7138]">
                  <Bot className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold">绑定微信或企业微信机器人，直接在聊天软件里使用分析助手</p>
                  <p className="mt-0.5 text-[10px] text-black/58">新绑定或解绑后需重启服务生效（本地：重启 npm run dev；生产：重新部署）</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f7ead7] px-2.5 py-1 text-[9px] font-semibold text-[#8b642f]">
                <CircleAlert className="size-3" /> 凭据仅保存在本机数据库
              </span>
            </section>
            <BotBindings initial={botBindings} />
          </div>
        </main>
      }
    />
  );
}
