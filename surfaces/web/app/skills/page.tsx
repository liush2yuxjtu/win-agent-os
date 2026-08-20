import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  FileCode2,
  FolderTree,
  ShieldCheck,
  Sparkles,
  ToggleRight,
} from "lucide-react";
import { DashboardNavigation } from "@/app/_components/dashboard-navigation";
import { DualModeShell } from "@/app/_components/dual-mode";
import { SkillToggle } from "@/app/_components/skill-toggle";
import { getSkillRegistry, getSkillSuggestions } from "@/lib/skills/registry";
import type { SkillRecord } from "@agent/lib/skills/types";

/** 技能形态的中文展示名。 */
const KIND_LABELS: Record<SkillRecord["kind"], string> = {
  packaged: "内置",
  flat: "自定义",
  module: "自定义",
};

/** 技术检查项名称 → 业务文案。 */
const CHECK_LABELS: Record<string, string> = {
  "技能目录扫描": "技能清单完整性",
  "技能目录存在": "技能清单完整性",
  "frontmatter 完整性": "技能配置合法",
  "包内文件完整": "技能文件齐全",
};

/** 将检查明细 / 警告中的技术词汇替换为业务中文。 */
function toBusinessText(text: string): string {
  return text
    .replace(/agent\/skills[^\s，。、）)]*/g, "技能目录")
    .replace(/缺 description frontmatter（eve 要求必填）/g, "缺少描述信息")
    .replace(/frontmatter/g, "配置")
    .replace(/packaged 技能 /g, "内置技能 ")
    .replace(/个技能已发现/g, "个技能已收录")
    .replace(/\s+/g, "");
}

export default async function SkillsPage() {
  const [registry, skillSuggestions] = await Promise.all([getSkillRegistry(), getSkillSuggestions()]);
  const enabledCount = registry.skills.filter((skill) => skill.enabled).length;
  const packagedCount = registry.skills.filter((skill) => skill.kind === "packaged").length;

  return (
    <DualModeShell
      navigation={<DashboardNavigation />}
      suggestions={skillSuggestions}
      dashboard={
        <main className="min-w-0 overflow-y-auto">
          <SkillsHeader registryMissing={registry.skills.length === 0} />
          <div className="mx-auto max-w-[1180px] space-y-5 px-5 py-6 sm:px-8 sm:py-8">
            <SkillsIntro />
            <SkillsSummary
              total={registry.skills.length}
              enabled={enabledCount}
              packaged={packagedCount}
              auditStatus={registry.audit.status}
              generatedAt={registry.generatedAt}
            />
            <SkillsTable skills={registry.skills} />
            <AuditPanel checks={registry.audit.checks} warnings={registry.audit.warnings} generatedAt={registry.generatedAt} />
          </div>
        </main>
      }
    />
  );
}

function SkillsHeader({ registryMissing }: { readonly registryMissing: boolean }) {
  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-black/7 bg-[#f4f1ea]/92 px-5 backdrop-blur-xl sm:px-8">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/60">技能中心</p>
        <h1 className="mt-0.5 font-semibold text-[22px] tracking-[-0.04em]">技能管理</h1>
      </div>
      <span
        className={`hidden items-center gap-2 rounded-xl border px-3 py-2 text-[10px] sm:flex ${
          registryMissing ? "border-[#b66a4b]/30 bg-[#fff5ee] text-[#a75c3e]" : "border-black/8 bg-white/55 text-black/64"
        }`}
      >
        <span className={`size-1.5 rounded-full ${registryMissing ? "bg-[#c0673f]" : "bg-[#6f9a50]"}`} />
        {registryMissing ? "技能列表暂不可用，请稍后刷新" : "信息约每 15 分钟更新一次"}
      </span>
    </header>
  );
}

function SkillsIntro() {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/7 bg-[#fbfaf6] px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-xl bg-[#e8f2d9] text-[#4d7138]">
          <BookOpen className="size-4" />
        </span>
        <div>
          <p className="text-xs font-semibold">技能由平台统一维护，此页展示最新技能清单与启停状态</p>
          <p className="mt-0.5 text-[10px] text-black/58">
            启停状态保存于平台配置；部分技能的实际生效将在后续版本支持。
          </p>
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f0dc] px-2.5 py-1 text-[9px] font-semibold text-[#4d6d39]">
        <Sparkles className="size-3" /> 让对话助手帮你创建技能
      </span>
    </section>
  );
}

function SkillsSummary({
  total,
  enabled,
  packaged,
  auditStatus,
  generatedAt,
}: {
  readonly total: number;
  readonly enabled: number;
  readonly packaged: number;
  readonly auditStatus: "passed" | "warning";
  readonly generatedAt: string;
}) {
  const items = [
    { label: "技能总数", value: String(total), icon: FolderTree },
    { label: "已启用", value: String(enabled), icon: ToggleRight },
    { label: "内置技能", value: String(packaged), icon: FileCode2 },
    { label: "配置状态", value: auditStatus === "passed" ? "通过" : "有警告", icon: ShieldCheck },
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="技能摘要">
      {items.map(({ label, value, icon: Icon }) => (
        <article className="rounded-[18px] border border-black/7 bg-[#fbfaf6] p-4 shadow-[0_1px_0_rgba(255,255,255,.9)_inset,0_8px_30px_rgba(35,38,31,.035)]" key={label}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-black/64">{label}</p>
            <Icon className="size-4 text-black/40" />
          </div>
          <p className="mt-4 truncate font-semibold text-[25px] tracking-[-0.055em]">{value}</p>
          <p className="mt-1 text-[9px] text-black/50">更新于 {generatedAt ? generatedAt.slice(0, 10) : "—"}</p>
        </article>
      ))}
    </section>
  );
}

function SkillsTable({ skills }: { readonly skills: SkillRecord[] }) {
  return (
    <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] shadow-[0_12px_40px_rgba(35,38,31,.035)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/7 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.025em]">已注册技能</h2>
          <p className="mt-0.5 text-[10px] text-black/58">技能清单由平台扫描生成，启停状态保存在平台配置中</p>
        </div>
        <span className="rounded-full bg-[#edf3e4] px-2.5 py-1 text-[9px] font-semibold text-[#4f6b3d]">{skills.length} 个技能</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left">
          <thead className="border-b border-black/7 text-[9px] uppercase tracking-[0.08em] text-black/55">
            <tr>
              <th className="px-6 py-3 font-medium">技能</th>
              <th className="px-3 py-3 font-medium">形态</th>
              <th className="px-3 py-3 font-medium">描述</th>
              <th className="px-3 py-3 text-right font-medium">文件数</th>
              <th className="px-3 py-3 text-right font-medium">更新</th>
              <th className="px-6 py-3 text-right font-medium">启用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/6 text-[11px]">
            {skills.length === 0 ? (
              <tr>
                <td className="px-6 py-10 text-center text-black/50" colSpan={6}>
                  暂无可用技能，请稍后刷新或联系管理员
                </td>
              </tr>
            ) : (
              skills.map((skill, index) => (
                // key 用 folder：同一技能可同时存在于启用区与停用区（name 会重复）
                <tr className="hover:bg-black/[0.018]" key={skill.folder}>
                  <td className="max-w-[240px] px-6 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#ece9df] font-mono text-[9px] text-black/60">{index + 1}</span>
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={skill.name}>{skill.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                      skill.kind === "packaged" ? "bg-[#e7f0db] text-[#466536]" : "bg-[#f1ecdf] text-[#7a6a42]"
                    }`}>{KIND_LABELS[skill.kind]}</span>
                  </td>
                  <td className="max-w-[300px] px-3 py-3 text-black/62">
                    <p className="line-clamp-2" title={skill.description}>{skill.description}</p>
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{skill.files.length}</td>
                  <td className="px-3 py-3 text-right font-mono text-black/55">{skill.mtime.slice(0, 10)}</td>
                  <td className="px-6 py-3 text-right">
                    <SkillToggle enabled={skill.enabled} name={skill.name} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-black/7 px-5 py-4 sm:px-6">
        <details className="rounded-xl border border-black/7 bg-black/[0.018] px-3 py-2.5 text-[9px] text-black/60">
          <summary className="cursor-pointer select-none font-medium text-black/66">启停说明</summary>
          <p className="mt-2 leading-relaxed">说明：技能启停为平台配置，暂不影响 AI 运行时的技能加载，相关能力将在后续版本提供。</p>
        </details>
      </div>
    </section>
  );
}

function AuditPanel({
  checks,
  warnings,
  generatedAt,
}: {
  readonly checks: readonly { label: string; passed: boolean; detail: string }[];
  readonly warnings: readonly string[];
  readonly generatedAt: string;
}) {
  return (
    <section className="rounded-[20px] border border-black/7 bg-[#fbfaf6] p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-black/62">平台配置</p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.035em]">配置状态说明</h2>
        </div>
        <ShieldCheck className="size-5 text-[#66894e]" />
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {checks.map((check) => (
          <div className="rounded-xl border border-black/6 bg-white/50 p-3" key={check.label}>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold">
              {check.passed ? <CheckCircle2 className="size-3 text-[#66894e]" /> : <CircleAlert className="size-3 text-[#a27635]" />}
              {CHECK_LABELS[check.label] ?? check.label}
            </p>
            <p className="mt-1 text-[9px] text-black/55">{toBusinessText(check.detail)}</p>
          </div>
        ))}
      </div>
      {warnings.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {warnings.map((warning) => (
            <li className="flex items-start gap-1.5 text-[9px] text-[#8b642f]" key={warning}>
              <CircleAlert className="mt-0.5 size-2.5 shrink-0" /> {toBusinessText(warning)}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-[9px] text-black/55">更新于 {generatedAt || "—"}</p>
    </section>
  );
}
