/**
 * 看板 spec 的增删改纯函数（dashboard__create / dashboard__edit / dashboard__remove
 * 三个 agent 工具共享的底层实现）。
 *
 * 原则：所有操作都在「当前 spec」之上做增量修改，返回新 spec 对象（原 spec
 * 不被修改）。agent 拿到新 spec 后再调 render_ui 预览，用户点「应用到看板」
 * 确认后前端写回 localStorage + 服务端副本——CRUD 工具本身不落盘。
 */

import { buildDefaultDashboardSpec } from "./default-spec";
import type { ElementTreeSpec } from "../json-render/data-binding";

function isElementTreeSpec(value: unknown): value is ElementTreeSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.root === "string" && typeof v.elements === "object" && v.elements !== null;
}

/** 当前看板 spec；无自定义（null）时以完整基础款起步（见 default-spec.ts）。 */
export function baseSpec(current: unknown): ElementTreeSpec {
  if (isElementTreeSpec(current)) {
    return current;
  }
  return buildDefaultDashboardSpec() as ElementTreeSpec;
}

function uniqueKey(elements: Record<string, unknown>, prefix: string): string {
  let i = 1;
  let key = prefix;
  while (key in elements) {
    key = `${prefix}${i}`;
    i += 1;
  }
  return key;
}

/**
 * 加一张卡：把 card 元素并入 elements，并挂到 root（Stack 时 append，
 * Grid 时加入 children）。返回新 spec。
 */
export function addCard(
  current: unknown,
  card: { key?: string; type: string; props?: Record<string, unknown>; children?: string[] },
): { ok: boolean; spec?: ElementTreeSpec; error?: string } {
  const spec = baseSpec(current);
  const key = card.key && !(card.key in spec.elements) ? card.key : uniqueKey(spec.elements, "card");
  const el = {
    type: card.type,
    props: card.props ?? {},
    children: card.children ?? [],
  };
  const elements = { ...spec.elements, [key]: el };

  const rootRaw = elements[spec.root];
  if (typeof rootRaw === "object" && rootRaw !== null) {
    const rootEl = rootRaw as Record<string, unknown>;
    const children = Array.isArray(rootEl.children) ? [...(rootEl.children as unknown[])] : [];
    children.push(key);
    elements[spec.root] = { ...rootEl, children };
  }
  return { ok: true, spec: { ...spec, elements } };
}

/**
 * 删一张卡：移除元素并把它从 root 的 children 里摘掉。
 * 找不到该 key 时返回 error（不静默）。
 */
export function removeCard(
  current: unknown,
  cardKey: string,
): { ok: boolean; spec?: ElementTreeSpec; error?: string } {
  const spec = baseSpec(current);
  if (!(cardKey in spec.elements)) {
    return { ok: false, error: `看板里没有卡片 ${cardKey}。可用 dashboard__read 查看当前卡片列表。` };
  }
  const elements: Record<string, unknown> = {};
  for (const [key, el] of Object.entries(spec.elements)) {
    if (key !== cardKey) elements[key] = el;
  }
  const rootRaw = elements[spec.root];
  if (typeof rootRaw === "object" && rootRaw !== null) {
    const rootEl = rootRaw as Record<string, unknown>;
    const children = Array.isArray(rootEl.children)
      ? (rootEl.children as unknown[]).filter((c) => c !== cardKey)
      : [];
    elements[spec.root] = { ...rootEl, children };
  }
  return { ok: true, spec: { ...spec, elements } };
}

/**
 * 改一张卡：整体替换该元素的 props（或仅合并部分 props）。
 * 找不到该 key 时返回 error。
 */
export function editCard(
  current: unknown,
  cardKey: string,
  patch: { type?: string; props?: Record<string, unknown>; children?: string[] },
): { ok: boolean; spec?: ElementTreeSpec; error?: string } {
  const spec = baseSpec(current);
  const rawEl = spec.elements[cardKey];
  if (typeof rawEl !== "object" || rawEl === null) {
    return { ok: false, error: `看板里没有卡片 ${cardKey}。可用 dashboard__read 查看当前卡片列表。` };
  }
  const el = rawEl as Record<string, unknown>;
  const nextProps =
    typeof el.props === "object" && el.props !== null
      ? { ...(el.props as Record<string, unknown>), ...(patch.props ?? {}) }
      : { ...(patch.props ?? {}) };
  const elements = {
    ...spec.elements,
    [cardKey]: {
      type: patch.type ?? el.type,
      props: nextProps,
      children: patch.children ?? el.children ?? [],
    },
  };
  return { ok: true, spec: { ...spec, elements } };
}
