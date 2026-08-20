import { ClipboardCheck } from "lucide-react";
import { DashboardNavigation } from "@/app/_components/dashboard-navigation";
import { DualModeShell } from "@/app/_components/dual-mode";
import { getSkillSuggestions, listSkills } from "@/lib/skills/registry";
import { EvalsWorkspace } from "./evals-workspace";

/** /evals：技能评估工作台（选技能 → 运行对照评估 → 人工评审 Outputs / 对照统计 Benchmark）。 */
export default async function EvalsPage() {
  const [skills, suggestions] = await Promise.all([listSkills(), getSkillSuggestions()]);

  return (
    <DualModeShell
      navigation={<DashboardNavigation />}
      suggestions={suggestions}
      dashboard={
        <main className="min-w-0 overflow-y-auto">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-black/7 bg-[#f4f1ea]/92 px-5 backdrop-blur-xl sm:px-8">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/60">技能评估</p>
              <h1 className="mt-0.5 font-semibold text-[22px] tracking-[-0.04em]">评估工作台</h1>
            </div>
            <span className="hidden items-center gap-2 rounded-xl border border-black/8 bg-white/55 px-3 py-2 text-[10px] text-black/64 sm:flex">
              <ClipboardCheck className="size-3.5 text-[#66894e]" />
              对照实验 · 人工评审 · 反馈闭环
            </span>
          </header>
          <div className="mx-auto max-w-[1180px] space-y-5 px-5 py-6 sm:px-8 sm:py-8">
            <EvalsWorkspace skills={skills.map((skill) => skill.name)} />
          </div>
        </main>
      }
    />
  );
}
