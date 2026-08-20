/**
 * 聊天 → 看板的预览事件通道。
 *
 * agent 的 render_ui 工具结果渲染在聊天消息里时（agent-message.tsx 的
 * RenderUiVisual），用户点「应用到看板」→ 把 spec 通过 window 事件广播；
 * DashboardSpecShell 监听后进入「待确认」预览态（客户点【确定】才合并）。
 */

export const DASHBOARD_SPEC_PREVIEW_EVENT = "qc:dashboard-spec-preview";

/** 跨页待确认 spec 的 sessionStorage key（deep link 全屏页 → 看板页跳转接力用）。 */
const PENDING_SPEC_KEY = "qc:dashboard-spec-pending";

/** 广播一个新生成的看板 spec 供 DashboardSpecShell 预览。 */
export function dispatchDashboardSpecPreview(spec: unknown): void {
  window.dispatchEvent(new CustomEvent(DASHBOARD_SPEC_PREVIEW_EVENT, { detail: spec }));
}

/** 订阅预览事件；返回取消订阅函数。 */
export function subscribeDashboardSpecPreview(onPreview: (spec: unknown) => void): () => void {
  const handler = (event: Event) => {
    onPreview((event as CustomEvent).detail);
  };
  window.addEventListener(DASHBOARD_SPEC_PREVIEW_EVENT, handler);
  return () => window.removeEventListener(DASHBOARD_SPEC_PREVIEW_EVENT, handler);
}

/**
 * 待确认 spec 跨页接力：全屏独立页（/chat/<id>、/chat/new）没有看板横幅，
 * 点「应用到看板」时把 spec 暂存 sessionStorage 并跳转首页；DashboardSpecShell
 * 挂载时恢复为预览态，客户点【确定应用】/【放弃】后清除。
 */
export function savePendingDashboardSpec(spec: unknown): void {
  try {
    sessionStorage.setItem(PENDING_SPEC_KEY, JSON.stringify(spec));
  } catch {
    // 隐私模式等不可用时静默放弃 —— 预览事件仍可走同页广播。
  }
}

/** 取出并清除待确认 spec（一次性的：取出即消费）。 */
export function takePendingDashboardSpec(): unknown | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SPEC_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(PENDING_SPEC_KEY);
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
