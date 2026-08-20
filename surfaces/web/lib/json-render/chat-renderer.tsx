"use client";

import { defineCatalog, type Spec } from "@json-render/core";
import { createStateStore, defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions, shadcnComponents } from "@json-render/shadcn";
import { useEffect, useRef, useState } from "react";
import { BarChart, barChartDefinition } from "./custom-components";
import { collectDataRefs, normalizeTableProps, resolveDataRefs, type QueryResultData } from "dsh-shared";

/**
 * 主应用 json-render 渲染器：把 agent render_ui 工具输出的 element-tree spec
 * 渲染为 shadcn/ui 交互界面（与 glossary MCP 的 render-ui 同 catalog，见 mcp-server/server.ts）。
 * 自定义组件（BarChart 等）见 custom-components.tsx，与 shadcn 定义合并进同一 catalog/registry。
 */

const catalog = defineCatalog(schema, {
  components: { ...shadcnComponentDefinitions, BarChart: barChartDefinition },
  actions: {},
});

const { registry } = defineRegistry(catalog, {
  components: { ...shadcnComponents, BarChart },
});

/** element-tree spec 的最小形状校验：root + elements（state 可选）。 */
function isElementTreeSpec(value: unknown): value is { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.root === "string" && typeof v.elements === "object" && v.elements !== null;
}

type ElementTreeSpec = { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> };

/**
 * Grid 列数按容器宽度降级（窄 → 少列，从宽到窄匹配首个断点）。
 * 聊天消息容器 ~280px 时 columns=5 会把卡片压成 ~55px 竖条（"被挤压的很扁"），
 * 收敛到 2/1 列后卡片恢复可读；看板区域（~1028px）不触发，spec 保持原样。
 */
const GRID_COLUMN_BREAKPOINTS: readonly { readonly maxWidth: number; readonly columns: number }[] = [
  { maxWidth: 320, columns: 1 },
  { maxWidth: 560, columns: 2 },
];

/** 追加/合并一个 className 到组件 props（保留原有类）。 */
function withClass(props: Record<string, unknown>, extra: string): Record<string, unknown> {
  const existing = typeof props.className === "string" ? props.className : "";
  return existing.includes(extra) ? props : { ...props, className: `${existing} ${extra}`.trim() };
}

function downgradeGridColumns(spec: ElementTreeSpec, containerWidth: number): ElementTreeSpec {
  let maxColumns = 5;
  for (const bp of GRID_COLUMN_BREAKPOINTS) {
    if (containerWidth < bp.maxWidth) {
      maxColumns = bp.columns;
      break;
    }
  }
  if (maxColumns >= 5) return spec;

  // 浅拷贝元素树，只改写 Grid 的 columns；不改动原 spec 对象。
  const elements: Record<string, unknown> = {};
  for (const [key, rawEl] of Object.entries(spec.elements)) {
    if (typeof rawEl !== "object" || rawEl === null) {
      elements[key] = rawEl;
      continue;
    }
    const el = rawEl as Record<string, unknown>;
    if (el.type === "Grid") {
      const props =
        typeof el.props === "object" && el.props !== null ? { ...(el.props as Record<string, unknown>) } : {};
      const current = typeof props.columns === "number" ? props.columns : 1;
      props.columns = Math.min(current, maxColumns);
      // Grid 本身不带 w-full，在 items-start 的 Stack 下宽度会塌缩成内容宽，
      // 补 w-full 让列占满容器（卡片随之拉伸）。
      elements[key] = { ...el, props: withClass(props, "w-full") };
    } else {
      elements[key] = el;
    }
  }
  // root 元素同样可能缺 w-full（Stack 默认 items-start），补上以撑满容器。
  const rootRaw = elements[spec.root];
  if (typeof rootRaw === "object" && rootRaw !== null) {
    const rootEl = rootRaw as Record<string, unknown>;
    const props =
      typeof rootEl.props === "object" && rootEl.props !== null
        ? { ...(rootEl.props as Record<string, unknown>) }
        : {};
    elements[spec.root] = { ...rootEl, props: withClass(props, "w-full") };
  }
  return { ...spec, elements };
}

/**
 * 渲染一个 json-render spec。spec 不合法（缺 root/elements）时静默返回 null，
 * 聊天消息回退为普通文本/工具卡片展示，不炸渲染树。
 *
 * 传入 dataMap（Query Registry 查询结果，key 为 queryId）时，渲染前先解析
 * 元素 props 里的 dataRef 引用（见 data-binding.ts）；不传则原样渲染，保持
 * 向后兼容（现有写死 KPI 模板流程不受影响）。
 */
export function ChatJsonRender({
  spec,
  dataMap,
}: {
  readonly spec: unknown;
  readonly dataMap?: Record<string, QueryResultData>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  // 未显式传 dataMap 时，自动按 spec 里的 dataRef 引用从 /api/query 拉取。
  const [autoDataMap, setAutoDataMap] = useState<Record<string, QueryResultData> | null>(null);

  const specShape = isElementTreeSpec(spec) ? spec : null;
  const refs = specShape ? collectDataRefs(specShape) : [];

  // 客户端测量容器宽度：初次渲染宽度未知时不降级（看板/SSR 场景），
  // ResizeObserver 立即回调一次得到真实宽度，窄容器则降级 Grid 列数重渲染。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // dataRef 自动拉取：无引用时零开销；拉取失败/查询不存在时该项不注入（渲染降级）。
  useEffect(() => {
    if (!refs.length) return;
    let cancelled = false;
    const uniqueIds = [...new Set(refs.map((r) => r.queryId))];
    Promise.all(
      uniqueIds.map((queryId) =>
        fetch(`/api/query?queryId=${encodeURIComponent(queryId)}`)
          .then((r) => (r.ok ? (r.json() as Promise<QueryResultData | null>) : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, QueryResultData> = {};
      uniqueIds.forEach((queryId, i) => {
        if (results[i]) map[queryId] = results[i];
      });
      setAutoDataMap(map);
    });
    return () => {
      cancelled = true;
    };
    // refs 每次渲染都是新数组，用 JSON 摘要做依赖，避免无限重拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(refs)]);

  if (!specShape) return null;
  const resolvedMap = dataMap ?? autoDataMap;
  // 始终先解析 dataRef：无数据时传空 map 仅剥离 dataRef 字段（组件渲染 undefined
  // props 无害），避免 { dataRef } 对象被当成渲染值报错；数据到达后注入真实值重渲染。
  const dataBoundSpec = resolveDataRefs(specShape, resolvedMap ?? {}).spec;
  // 模型生成的 Table 常带对象数组 rows/data 与 {key,label} columns（json-render
  // Table 期望数组的数组 + 字符串数组），在此归一化，避免渲染异常（空表/row.map 崩）。
  const normalizedSpec = normalizeTableProps(dataBoundSpec);
  const effectiveSpec =
    containerWidth !== null ? downgradeGridColumns(normalizedSpec, containerWidth) : normalizedSpec;
  // 宽松校验通过后按 Spec 渲染；组件 props 细节校验交给 shadcn 组件运行时容错。
  return (
    <div ref={containerRef} className="w-full">
      <JSONUIProvider registry={registry} store={createStateStore(effectiveSpec.state ?? {})}>
        <Renderer spec={effectiveSpec as unknown as Spec} registry={registry} />
      </JSONUIProvider>
    </div>
  );
}

/** render_ui 工具产物解析：工具返回 { ok, spec? }，spec 为 JSON 字符串。 */
export function parseRenderUiOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null) return null;
  const v = output as Record<string, unknown>;
  if (v.ok !== true || typeof v.spec !== "string") return null;
  try {
    return JSON.parse(v.spec) as unknown;
  } catch {
    return null;
  }
}
