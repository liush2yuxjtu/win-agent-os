/**
 * 内置「基础款」看板 spec：横幅口径说明 + KPI 五卡 + 近 7 日走势图 +
 * 规则洞察结论 + 高消耗素材明细 + 数据质量/来源口径说明。
 *
 * 布局结构与数据解耦：
 *  - KPI 卡片值通过 ${/kpis/N/...} 模板引用注入 state（injectKpiState 每次渲染
 *    合并，客户改布局不固化数据，刷新后数值仍更新）；
 *  - 走势图/洞察/明细通过元素 props.dataRef 引用 Query Registry（fixed:daily /
 *    fixed:insights / fixed:topMaterials），渲染时由 data-binding 层拉取注入。
 */

const KPI_COUNT = 5;

/** ${/path} 模板表达式（interpolateString 支持同一模板内多个 ${} 引用）。 */
const tpl = (template: string) => ({ $template: template });

/**
 * 卡片视觉统一（对齐原静态版看板质感）：暖米白底 + 20px 圆角 + 半透明黑细边 +
 * 柔和投影。json-render 的 cn 是 tailwind-merge，className 最后合并会覆盖
 * shadcn 默认的 rounded-xl/border/bg-card/shadow。
 */
const CARD_STYLE =
  "rounded-[20px] border-black/7 bg-[#fbfaf6] shadow-[0_12px_40px_rgba(35,38,31,.04)]";

/** 基础款 spec：Stack 纵向布局，banner/KPI/走势/结论/明细/质量/口径全区块。 */
export function buildDefaultDashboardSpec(): unknown {
  const cards: Record<string, unknown> = {};
  for (let i = 0; i < KPI_COUNT; i += 1) {
    // KPI 卡分层：muted 小字 label → h2 大数字 → outline 变化徽标（比平铺 title/description 层级更清晰）。
    const id = `k${i}`;
    cards[id] = {
      type: "Card",
      props: { maxWidth: "full", className: CARD_STYLE },
      children: [`${id}Body`],
    };
    cards[`${id}Body`] = {
      type: "Stack",
      props: { direction: "vertical", gap: "sm" },
      children: [`${id}Label`, `${id}Value`, `${id}Delta`],
    };
    cards[`${id}Label`] = {
      type: "Text",
      props: { variant: "muted", text: tpl(`\${/kpis/${i}/label}`) },
      children: [],
    };
    cards[`${id}Value`] = {
      type: "Heading",
      props: { level: "h2", text: tpl(`\${/kpis/${i}/value}`) },
      children: [],
    };
    cards[`${id}Delta`] = {
      type: "Badge",
      props: { variant: "outline", text: tpl(`\${/kpis/${i}/change}`) },
      children: [],
    };
  }
  return {
    root: "main",
    elements: {
      main: {
        type: "Stack",
        // w-full：Stack 组件默认不占满父宽（flex 容器宽度 = 内容宽度），
        // 嵌套 Grid/卡在 items-start 下会塌缩成内容宽（曾出现 KPI 卡 50px）。
        props: { direction: "vertical", gap: "md", className: "w-full" },
        children: ["banner", "kpiGrid", "chartCard", "insightsCard", "topTable", "qualityRow"],
      },
      banner: {
        type: "Card",
        props: {
          title: "数据口径",
          description: "所有数字来自经营数据仓库的固定汇总，计算规则统一维护，展示前不做临时改动。",
          maxWidth: "full",
          className: CARD_STYLE,
        },
        children: [],
      },
      kpiGrid: {
        type: "Grid",
        // w-full：Grid 组件同样不占满父宽（见 main 注释），5 列才不会被压成内容宽。
        props: { columns: 5, gap: "md", className: "w-full" },
        children: Array.from({ length: KPI_COUNT }, (_, i) => `k${i}`),
      },
      ...cards,
      chartCard: {
        type: "Card",
        props: {
          title: "近 7 日成交与消耗",
          description: "每日原始汇总走势",
          maxWidth: "full",
          className: CARD_STYLE,
        },
        children: ["chart"],
      },
      chart: {
        type: "BarChart",
        props: {
          dataRef: { queryId: "fixed:daily", field: "rows" },
          xKey: "stat_date",
          // 走势图只画 current 期（近 7 日）；daily 查询含 previous 期共 14 行，
          // 与原来静态版走势图口径一致（filter 由 BarChart 组件支持）。
          filter: { key: "period", value: "current" },
          series: [
            { key: "gmv", color: "#20241f", label: "成交金额" },
            { key: "spend", color: "#a7b58d", label: "广告消耗" },
          ],
        },
        children: [],
      },
      insightsCard: {
        type: "Card",
        props: {
          title: "规则洞察 · 可复核结论",
          maxWidth: "full",
          className: CARD_STYLE,
        },
        children: ["insightsTitle", "insightsDesc"],
      },
      insightsTitle: {
        type: "Heading",
        props: { dataRef: { queryId: "fixed:insights", field: "title" }, level: "h3" },
        children: [],
      },
      insightsDesc: {
        type: "Text",
        props: { dataRef: { queryId: "fixed:insights", field: "description" }, variant: "muted" },
        children: [],
      },
      topTable: {
        type: "Card",
        props: {
          title: "高消耗素材明细",
          description: "近 7 日按广告消耗排序；ROI 与单均成本按统一口径计算",
          maxWidth: "full",
          className: CARD_STYLE,
        },
        children: ["topTableInner"],
      },
      topTableInner: {
        type: "Table",
        props: { dataRef: { queryId: "fixed:topMaterials", field: "rows" } },
        children: [],
      },
      qualityRow: {
        type: "Stack",
        props: { direction: "horizontal", gap: "md", align: "stretch", className: "w-full" },
        children: ["qualityCard", "queryCard"],
      },
      qualityCard: {
        type: "Card",
        props: {
          title: "数据质量",
          description: "数据校验明细（固定脚本 + 统一口径）",
          maxWidth: "full",
          className: `flex-1 ${CARD_STYLE}`,
        },
        children: [],
      },
      queryCard: {
        type: "Card",
        props: {
          title: "数据来源与口径",
          description: "数据来自经营数据仓库固定汇总脚本",
          maxWidth: "full",
          className: `flex-1 ${CARD_STYLE}`,
        },
        children: [],
      },
    },
    state: {},
  };
}

/** 把服务端 KPI 数据注入 spec state（每次渲染合并，保证数值实时）。 */
export function injectKpiState(spec: unknown, kpis: readonly { label: string; value: string; change: string }[]): unknown {
  if (typeof spec !== "object" || spec === null) return spec;
  return {
    ...(spec as Record<string, unknown>),
    state: { ...((spec as { state?: Record<string, unknown> }).state ?? {}), kpis },
  };
}
