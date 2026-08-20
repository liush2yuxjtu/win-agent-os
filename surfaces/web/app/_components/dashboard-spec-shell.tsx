"use client";

import { autoFixSpec, validateSpec } from "@json-render/core";
import { Component, useEffect, useState, type ReactNode } from "react";
import { ChatJsonRender } from "@/lib/json-render/chat-renderer";
import type { QueryResultData } from "dsh-shared";
import { buildDefaultDashboardSpec, injectKpiState } from "dsh-shared";
import { subscribeDashboardSpecPreview, takePendingDashboardSpec } from "@/lib/dashboard-spec/events";
import {
  clearDashboardSpec,
  isElementTreeSpec,
  loadDashboardSpec,
  saveDashboardSpec,
} from "@/lib/dashboard-spec/storage";
import { CircleAlert, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";

/**
 * 整页可配置看板渲染器：整个看板（口径横幅/KPI/走势图/规则洞察/素材明细/数据质量）
 * 都由 json-render spec 驱动（基础款 = 内置 spec，客户确认合并后存 localStorage
 * 成为自定义款）。页面标题与「复原基础款」操作条与 spec 无关，始终由本组件渲染。
 * 状态机：
 *
 *  - 预览：聊天 render_ui 生成新 spec → 横幅提示，客户点【确定】才合并（保存并生效）
 *  - smoke 校验：合并前 validateSpec，结构错误自动拒绝（提示，不应用）
 *  - 运行期修复：渲染崩溃时自动回滚基础款并清除损坏的自定义 spec
 *  - 一键复原基础款：清除自定义，回退内置布局
 */
export function DashboardSpecShell({
  kpis,
  title = "我的看板",
  dataMap,
}: {
  readonly kpis: readonly { label: string; value: string; change: string }[];
  readonly title?: string;
  /** 服务端注入的 dataRef 查询结果：传入后客户端不再异步拉取，SSR 与首渲染一致。 */
  readonly dataMap?: Record<string, QueryResultData>;
}) {
  // 首渲染统一用基础款：自定义款存 localStorage（客户端才有），若在 useState 初始化器
  // 里读取，SSR 渲染基础款而 hydration 渲染自定义款 → spec 不同 → hydration mismatch。
  // 改为：SSR/hydration 都用基础款（一致），客户端挂载后再加载自定义款无缝切换。
  const [spec, setSpec] = useState<unknown>(() => buildDefaultDashboardSpec());
  const [preview, setPreview] = useState<unknown | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // 客户端加载已保存的自定义款（localStorage 仅客户端可读）
  useEffect(() => {
    const saved = loadDashboardSpec();
    if (saved) setSpec(saved);
  }, []);

  // 聊天侧「应用到看板」→ 进入待确认预览态
  useEffect(() => subscribeDashboardSpecPreview((next) => {
    if (isElementTreeSpec(next)) setPreview(next);
  }), []);

  // 跨页接力：独立页（/chat/<id>、/chat/new）点「应用到看板」时把 spec 暂存
  // sessionStorage 再跳回首页，这里恢复为待确认预览态（取出即消费，一次性）。
  useEffect(() => {
    const pending = takePendingDashboardSpec();
    if (pending && isElementTreeSpec(pending)) setPreview(pending);
  }, []);

  function applyPreview() {
    if (!preview) return;
    // 结构校验：合法直接应用；不合法先尝试 autoFixSpec 无损修复（如字段错位、
    // 悬空 children 引用），修复后可用则应用修复版；有损修复（裁剪内容）或
    // 修复后仍不合法 → 拒绝应用并给出具体问题清单。
    const { valid, issues } = validateSpec(preview as never);
    if (valid) {
      saveDashboardSpec(preview);
      setSpec(preview);
      setNotice("看板已更新，已保存为你的自定义款。");
    } else {
      const { spec: fixed, fixDetails } = autoFixSpec(preview as never, { lossy: false });
      const repaired = fixDetails.length > 0;
      const recheck = repaired ? validateSpec(fixed as never) : { valid: false as const };
      if (repaired && recheck.valid) {
        saveDashboardSpec(fixed);
        setSpec(fixed);
        setNotice(`看板已自动修复 ${fixDetails.length} 处小问题后应用（${fixDetails.map((f) => f.message).join("；")}）。`);
      } else {
        // 报错面向用户（业务角色）：说明结果 + 下一步可操作，不展示开发者视角的
        // 技术 issue 码（issues 仅作诊断保留，用户语言由 notice 承载）。
        void issues;
        setNotice("新布局没有被应用，你当前的看板没有变化。可以重新描述你的需求，或让 AI 调整一下布局再试。");
      }
    }
    setPreview(null);
  }

  function resetToDefault() {
    clearDashboardSpec();
    setSpec(buildDefaultDashboardSpec());
    setPreview(null);
    setNotice("已复原基础款看板。");
    setVersion((v) => v + 1);
  }

  function handleRenderError() {
    // 运行期 smoke error 自动修复：清除损坏自定义，回退基础款
    clearDashboardSpec();
    setSpec(buildDefaultDashboardSpec());
    setNotice("看板渲染出错，已自动复原基础款。");
    setVersion((v) => v + 1);
  }

  return (
    <div className="mx-auto max-w-[1180px] space-y-5 px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold tracking-[-0.02em] text-black/80">{title}</p>
        <button
          className="flex h-7 items-center gap-1.5 rounded-full border border-black/7 bg-white/70 px-2.5 text-[10px] font-medium text-black/60 transition hover:border-black/15 hover:text-black"
          onClick={resetToDefault}
          title="恢复为内置基础款布局"
          type="button"
        >
          <RotateCcw className="size-3" /> 复原基础款
        </button>
      </div>

      {notice ? (
        <div className="flex items-start gap-2 rounded-xl border border-[#d8cba4] bg-[#fbf6e8] px-3 py-2.5 text-[10px] text-[#7a6433]">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>{notice}</span>
          <button aria-label="关闭提示" className="ml-auto text-black/40 hover:text-black" onClick={() => setNotice(null)} type="button">✕</button>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <SpecBoundary key={version} onError={handleRenderError}>
          <ChatJsonRender spec={injectKpiState(spec, kpis)} dataMap={dataMap} />
        </SpecBoundary>
      </div>

      {preview ? (
        <div className="fixed bottom-6 left-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2">
          <div className="rounded-2xl border border-black/10 bg-[#20241f]/95 p-4 text-[#f2f3ed] shadow-[0_24px_64px_rgba(20,23,18,.35)] backdrop-blur-xl">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#d7ff5f] text-[#20241f]">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">AI 生成了新的看板布局</p>
                <p className="mt-0.5 text-[10px] text-white/60">确认后立即应用并保存，随时可一键复原基础款。</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#d7ff5f] text-[11px] font-semibold text-[#20241f] transition hover:brightness-95"
                onClick={applyPreview}
                type="button"
              >
                <ShieldCheck className="size-3.5" /> 确定应用
              </button>
              <button
                className="flex h-8 flex-1 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[11px] font-medium text-white/80 transition hover:bg-white/10"
                onClick={() => setPreview(null)}
                type="button"
              >
                放弃
              </button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[9px] text-white/50">
              <CircleAlert className="size-3" /> 结构校验不通过时会自动拒绝应用，渲染异常会自动复原基础款。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 渲染错误边界：spec 运行期崩溃 → onError（自动回滚）。 */
class SpecBoundary extends Component<{ onError: (error: unknown) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
