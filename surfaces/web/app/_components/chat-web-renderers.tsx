"use client";

import { LayoutDashboardIcon } from "lucide-react";
import type { ChatRenderers } from "@chat-surface-ui/core";
import { ToolOutput } from "@chat-surface-ui/core";
import { useChatContext } from "./chat-context";
import { renderToolVisual } from "./agent-tool-visual";
import { ChatJsonRender, parseRenderUiOutput } from "@/lib/json-render/chat-renderer";
import { dispatchDashboardSpecPreview, savePendingDashboardSpec } from "@/lib/dashboard-spec/events";
import { isDashboardSpec } from "@/lib/dashboard-spec/storage";

/**
 * web surface 的工具产物渲染器：
 * - render_ui：ChatJsonRender + 「应用到看板」；
 * - qc_fixed_query / qc_query_database / qc_*：QcResultTable；
 * - run_skill_evals：EvalInlineReview。
 * standalone surface 不注入本模块 → 包内回退到默认 JSON 展示。
 */
export const webChatRenderers: ChatRenderers = {
  renderPartExtra({ part, message, canRespond, onInputResponses }) {
    if (part.toolName === "render_ui") {
      return <RenderUiVisual errorText={part.errorText} output={part.output} />;
    }

    if (part.state === "output-available") {
      return renderToolVisual(part.toolName, part.output, part.partial, {
        canRespond,
        message,
        onInputResponses,
      });
    }

    return null;
  },
};

/** render_ui 工具产物：解析出合法 spec 则渲染 json-render 界面，否则回退普通工具输出。 */
function RenderUiVisual({ errorText, output }: { readonly errorText?: string; readonly output: unknown }) {
  const { mode, setMode, isStandalone } = useChatContext();
  const spec = parseRenderUiOutput(output);
  if (!spec) {
    return <ToolOutput errorText={errorText} output={output} />;
  }
  const isDashboard = isDashboardSpec(spec);

  // 全屏聊天模式下 DashboardSpecShell 未挂载（无订阅者），预览事件会丢失。
  // 先切回 dashboard 模式，等壳挂载订阅后再派发。
  const handleApplyToDashboard = () => {
    if (isStandalone) {
      // 独立页（/chat/<id>、/chat/new）没有看板布局，就地广播无人订阅。
      // 暂存待确认 spec 并跳回首页，DashboardSpecShell 挂载时恢复预览态，
      // 客户在横幅点【确定应用】才生效 —— 确认环节不因全屏丢失。
      savePendingDashboardSpec(spec);
      window.location.href = "/";
      return;
    }
    if (mode !== "dashboard") {
      setMode("dashboard");
      setTimeout(() => dispatchDashboardSpecPreview(spec), 120);
    } else {
      dispatchDashboardSpecPreview(spec);
    }
  };
  return (
    <div className="rounded-xl border border-black/7 bg-white/50 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-black/50">
          {isDashboard ? "AI 生成界面 · 看板布局" : "AI 生成界面"}
        </span>
        {/* 选择性触发：只有看板类 spec（引用 /kpis/ 数据模板）才显示「应用到看板」，
            普通表单/清单界面不提供该入口。 */}
        {isDashboard ? (
          <button
            className="flex h-6 items-center gap-1 rounded-full bg-[#20241f] px-2.5 text-[9px] font-semibold text-[#eef0e8] transition hover:bg-black/85"
            onClick={handleApplyToDashboard}
            type="button"
          >
            <LayoutDashboardIcon className="size-3" /> 应用到看板
          </button>
        ) : null}
      </div>
      <ChatJsonRender spec={spec} />
    </div>
  );
}
