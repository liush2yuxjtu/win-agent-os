/**
 * 客户自定义看板的持久化：spec 存 localStorage（纯前端，无需重启服务端即可生效）。
 *
 * 「客户保存自己想要的 UI 一直用」= 确认合并后写入此处，刷新后继续渲染；
 * 「一键复原基础款」= 清除此处，回退内置默认 spec。
 */

const STORAGE_KEY = "qc.dashboard.spec.v1";

export type DashboardKpi = {
  readonly label: string;
  readonly value: string;
  readonly change: string;
  readonly changeUp: boolean;
  readonly status: "passed" | "pending";
};

/** element-tree spec 的最小形状校验（与 chat-renderer 一致）。 */
export function isElementTreeSpec(value: unknown): value is { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.root === "string" && typeof v.elements === "object" && v.elements !== null;
}

/**
 * 看板类 spec 判定：布局中存在（1）Card 的 title/description 引用 `/kpis/` 数据模板
 * （见 default-spec.ts 的 $template 约定），或（2）任意元素 props 带 dataRef 查询引用
 * （见 lib/json-render/data-binding.ts，queryId 引用由渲染时拉取注入）。
 * 普通表单/清单等非看板 spec 返回 false，用于决定聊天里是否显示「应用到看板」按钮。
 */
export function isDashboardSpec(value: unknown): boolean {
  if (!isElementTreeSpec(value)) return false;
  return Object.values(value.elements).some((el) => {
    if (typeof el !== "object" || el === null) return false;
    const props = (el as Record<string, unknown>).props as Record<string, unknown> | undefined;
    if (!props) return false;
    const hasKpiTemplate = ["title", "description"].some((key) => {
      const tpl = (props[key] as { $template?: string } | undefined)?.$template;
      return typeof tpl === "string" && tpl.includes("/kpis/");
    });
    const ref = props.dataRef as { queryId?: unknown } | undefined;
    const hasDataRef = typeof ref?.queryId === "string" && ref.queryId.length > 0;
    return hasKpiTemplate || hasDataRef;
  });
}

/** 读取客户保存的看板 spec；无自定义或损坏时返回 null。 */
export function loadDashboardSpec(): unknown | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isElementTreeSpec(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 保存客户自定义看板 spec（合并确认后调用）。 */
export function saveDashboardSpec(spec: unknown): void {
  if (typeof window === "undefined" || !isElementTreeSpec(spec)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(spec));
  } catch {
    // localStorage 不可用时静默失败，本次不持久化。
  }
  // 同步服务端副本（fire-and-forget）：agent 的 dashboard_read 靠它知道
  // 当前看板长什么样，从而在聊天里做增量 CRUD。
  void fetch("/api/dashboard-spec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  }).catch(() => {});
}

/** 清除自定义看板（一键复原基础款）。 */
export function clearDashboardSpec(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  // 同步清服务端副本，避免 agent 读到已删除的旧看板。
  void fetch("/api/dashboard-spec", { method: "DELETE" }).catch(() => {});
}
