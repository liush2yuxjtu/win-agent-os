import type { MessageStreamEvent } from "eve/client";

/**
 * 会话事件流轻量投影（区别于 useEveAgent 的 message reducer）：
 * 供外围 surface 快速判断会话处于哪个阶段、最后活跃 turn、工具调用次数、
 * 是否产出了看板 spec、还有哪些挂起的 HITL 输入。
 */
export type SessionProjection = {
  readonly phase: "idle" | "running" | "waiting" | "completed" | "failed";
  readonly lastTurn: {
    readonly turnId: string;
    readonly status: "started" | "completed" | "cancelled" | "failed";
  } | null;
  readonly toolCount: number;
  readonly hasDashboardSpec: boolean;
  readonly pendingInputs: readonly PendingInput[];
};

export type PendingInput = {
  readonly requestId: string;
  readonly prompt?: string;
};

/** 从 action.result 里识别 render_ui 产出（轻量判断，不依赖 web 模块）。 */
function isDashboardSpecLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.spec !== "string") return false;
  try {
    const spec: unknown = JSON.parse(record.spec);
    if (typeof spec !== "object" || spec === null) return false;
    const root = spec as Record<string, unknown>;
    if (typeof root.root !== "string" || typeof root.elements !== "object" || root.elements === null) {
      return false;
    }
    const elements = root.elements as Record<string, unknown>;
    return Object.values(elements).some((el) => {
      if (typeof el !== "object" || el === null) return false;
      const props = (el as Record<string, unknown>).props as
        | Record<string, unknown>
        | undefined;
      if (!props) return false;
      const hasKpiTemplate = ["title", "description"].some((key) => {
        const tpl = (props[key] as { $template?: unknown } | undefined)
          ?.$template;
        return typeof tpl === "string" && tpl.includes("/kpis/");
      });
      const ref = props.dataRef as { queryId?: unknown } | undefined;
      return hasKpiTemplate || (typeof ref?.queryId === "string" && ref.queryId.length > 0);
    });
  } catch {
    return false;
  }
}

/**
 * 输入 eve 流事件，输出轻量 projection：
 * - phase：最后一个阶段事件决定（turn 级事件转 running，session.waiting
 *   转 waiting，session.completed/failed 为终态）。
 * - lastTurn：最后一条 turn.* 事件携带的 turnId 与状态。
 * - toolCount：actions.requested 中 kind === "tool-call" 的累计数量。
 * - hasDashboardSpec：任意 action.result 产出 render_ui 看板 spec。
 * - pendingInputs：input.requested 中出现且尚未 approval.settled 的请求。
 */
export function projectSessionEvents(
  events: readonly MessageStreamEvent[],
): SessionProjection {
  let phase: SessionProjection["phase"] = "idle";
  let lastTurn: SessionProjection["lastTurn"] = null;
  let toolCount = 0;
  let hasDashboardSpec = false;
  const pending = new Map<string, PendingInput>();
  const settled = new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case "turn.started":
        phase = "running";
        lastTurn = { turnId: event.data.turnId, status: "started" };
        break;
      case "turn.completed":
        phase = "running";
        lastTurn = { turnId: event.data.turnId, status: "completed" };
        break;
      case "turn.cancelled":
        phase = "running";
        lastTurn = { turnId: event.data.turnId, status: "cancelled" };
        break;
      case "turn.failed":
        phase = "failed";
        lastTurn = { turnId: event.data.turnId, status: "failed" };
        break;
      case "session.waiting":
        phase = "waiting";
        break;
      case "session.completed":
        phase = "completed";
        break;
      case "session.failed":
        phase = "failed";
        break;
      case "actions.requested":
        for (const action of event.data.actions) {
          if (action.kind === "tool-call") toolCount += 1;
        }
        break;
      case "action.result":
        if (!hasDashboardSpec && isDashboardSpecLike(event.data.result)) {
          hasDashboardSpec = true;
        }
        break;
      case "input.requested":
        for (const request of event.data.requests) {
          if (!settled.has(request.requestId)) {
            pending.set(request.requestId, {
              requestId: request.requestId,
              prompt:
                typeof request.prompt === "string" ? request.prompt : undefined,
            });
          }
        }
        break;
      case "approval.settled":
        settled.add(event.data.requestId);
        pending.delete(event.data.requestId);
        break;
      case "approval.candidate":
        // candidate 只表示某个 responder 的候选状态，不删除请求；
        // settled 才是终态。
        break;
      default:
        break;
    }
  }

  return {
    phase,
    lastTurn,
    toolCount,
    hasDashboardSpec,
    pendingInputs: [...pending.values()],
  };
}
