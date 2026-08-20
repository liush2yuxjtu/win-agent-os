"use client";

import type { BaseComponentProps } from "@json-render/react";
import { z } from "zod";

/**
 * json-render 自定义组件库（渲染层）。
 *
 * BarChart：自绘柱状图（纯 div + inline style，不依赖第三方图表库），风格对齐
 * 看板「近 7 日成交与消耗」走势图——横向 flex 分组柱、柱高 = value/max*100%、
 * hover 悬浮提示 label+value、底部图例（series label + color 方块）。
 * 颜色由 spec 的 series 提供，组件不写死业务色。
 */

export type BarChartSeries = { key: string; color: string; label: string };
export type BarChartRow = Record<string, unknown>;

export type BarChartProps = {
  rows?: BarChartRow[] | null;
  xKey?: string | null;
  series?: BarChartSeries[] | null;
  height?: number | null;
  /** 可选行过滤（如走势图只画 current 期：{ key: "period", value: "current" }）。 */
  filter?: { key: string; value: string } | null;
};

/** catalog 定义：rows 对象数组原样注入（见 data-binding.ts），height 可空，无 slots。 */
export const barChartDefinition = {
  props: z.object({
    rows: z.array(z.record(z.string(), z.unknown())),
    xKey: z.string(),
    series: z.array(z.object({ key: z.string(), color: z.string(), label: z.string() })),
    height: z.nullable(z.number()),
    filter: z.nullable(z.object({ key: z.string(), value: z.string() })),
  }),
  slots: [] as string[],
  description: "柱状图",
  example: {
    rows: [
      { d: "08-10", v: 120 },
      { d: "08-11", v: 200 },
    ],
    xKey: "d",
    series: [{ key: "v", color: "#20241f", label: "成交金额" }],
  },
};

/** 任意值转数值，非法值按 0 处理（柱高安全下限）。 */
function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 数值展示（千分位），字符串原样透出。 */
function formatValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("zh-CN");
  return String(value ?? "");
}

/** 柱高百分比 = value / max * 100，夹取到 [0, 100]。 */
function barPercent(value: number, max: number): number {
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/**
 * 横向 flex 柱状图。每个 x 轴分组内按 series 顺序叠放柱子，
 * 柱高为 value/max 比例；hover 分组显示 x 标签 + 各 series 的 label 与值；
 * 底部图例列出 series 的 color 方块与 label。
 */
export function BarChart({ props }: BaseComponentProps<BarChartProps>) {
  const rawRows = Array.isArray(props.rows) ? props.rows : [];
  const rows = props.filter
    ? rawRows.filter((row) => row[props.filter!.key] === props.filter!.value)
    : rawRows;
  const xKey = typeof props.xKey === "string" ? props.xKey : "";
  const series = Array.isArray(props.series) ? props.series : [];
  const height =
    typeof props.height === "number" && Number.isFinite(props.height) && props.height > 0
      ? props.height
      : 208;

  // 全部 series 中的最大值作为柱高基准（空数据时为 1，避免除零）。
  const max = Math.max(1, ...rows.flatMap((row) => series.map((s) => toNumber(row[s.key]))));

  return (
    <div className="w-full">
      <div
        className="flex items-end gap-2 border-b border-black/10"
        role="img"
        aria-label="柱状图"
        style={{ height }}
      >
        {rows.map((row, i) => (
          <div
            key={i}
            className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-1"
          >
            {series.map((s) => {
              const value = toNumber(row[s.key]);
              return (
                <div
                  key={s.key}
                  className="w-[38%] rounded-t-[4px]"
                  style={{ height: `${barPercent(value, max)}%`, backgroundColor: s.color }}
                />
              );
            })}
            <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 hidden w-max -translate-x-1/2 rounded-lg bg-[#20241f] p-2 text-[9px] leading-relaxed text-white shadow-xl group-hover:block">
              <p>{String(row[xKey] ?? "")}</p>
              {series.map((s) => (
                <p key={s.key}>
                  {s.label} {formatValue(row[s.key])}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {rows.map((row, i) => (
          <span key={i} className="min-w-0 flex-1 truncate text-center text-[9px] text-black/55">
            {String(row[xKey] ?? "")}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[10px] text-black/62">
            <span className="size-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
