export type DataSetName = "daily" | "topMaterials";
export type FilterValue = string | number;

export interface FormulaContext {
  daily: Array<Record<string, unknown>>;
  topMaterials: Array<Record<string, unknown>>;
}

export type FormulaNode =
  | { op: "field"; dataset: DataSetName; field: string; filter?: { field: string; equals: FilterValue } }
  | { op: "sum" | "average" | "max"; value: FormulaNode }
  | { op: "divide" | "subtract"; left: FormulaNode; right: FormulaNode; fallback?: number }
  | { op: "percentChange"; current: FormulaNode; previous: FormulaNode; fallback?: number }
  | { op: "literal"; value: number };

export interface BusinessFormula {
  id: string;
  label: string;
  description: string;
  unit: "currency" | "number" | "percent" | "ratio";
  precision: number;
  expression: FormulaNode;
}

const current = (field: string): FormulaNode => ({
  op: "field",
  dataset: "daily",
  field,
  filter: { field: "period", equals: "current" },
});
const previous = (field: string): FormulaNode => ({
  op: "field",
  dataset: "daily",
  field,
  filter: { field: "period", equals: "previous" },
});
const sum = (value: FormulaNode): FormulaNode => ({ op: "sum", value });
const average = (value: FormulaNode): FormulaNode => ({ op: "average", value });
const divide = (left: FormulaNode, right: FormulaNode, fallback = 0): FormulaNode => ({
  op: "divide",
  left,
  right,
  fallback,
});
const percentChange = (now: FormulaNode, before: FormulaNode): FormulaNode => ({
  op: "percentChange",
  current: now,
  previous: before,
  fallback: 0,
});

export const BUSINESS_FORMULAS = {
  gmv: {
    id: "GMV_7D",
    label: "近 7 日成交金额",
    description: "当前 7 个数据日的成交金额直接求和。",
    unit: "currency",
    precision: 0,
    expression: sum(current("gmv")),
  },
  spend: {
    id: "SPEND_7D",
    label: "近 7 日广告消耗",
    description: "当前 7 个数据日的整体消耗直接求和。",
    unit: "currency",
    precision: 0,
    expression: sum(current("spend")),
  },
  roi: {
    id: "ROI_7D",
    label: "近 7 日支付 ROI",
    description: "成交金额除以广告消耗；消耗为 0 时返回 0。",
    unit: "ratio",
    precision: 2,
    expression: divide(sum(current("gmv")), sum(current("spend"))),
  },
  orders: {
    id: "ORDERS_7D",
    label: "近 7 日成交订单",
    description: "当前 7 个数据日的成交订单数直接求和。",
    unit: "number",
    precision: 0,
    expression: sum(current("orders")),
  },
  activeMaterials: {
    id: "ACTIVE_MATERIALS_AVG_7D",
    label: "日均活跃素材",
    description: "当前 7 个数据日的去重活跃素材数取平均。",
    unit: "number",
    precision: 0,
    expression: average(current("active_materials")),
  },
  gmvChange: {
    id: "GMV_WOW",
    label: "成交金额环比",
    description: "本期成交金额相对前 7 日的变化率。",
    unit: "percent",
    precision: 1,
    expression: percentChange(sum(current("gmv")), sum(previous("gmv"))),
  },
  spendChange: {
    id: "SPEND_WOW",
    label: "广告消耗环比",
    description: "本期广告消耗相对前 7 日的变化率。",
    unit: "percent",
    precision: 1,
    expression: percentChange(sum(current("spend")), sum(previous("spend"))),
  },
  roiChange: {
    id: "ROI_WOW",
    label: "支付 ROI 环比",
    description: "本期 ROI 相对前 7 日 ROI 的变化率。",
    unit: "percent",
    precision: 1,
    expression: percentChange(
      divide(sum(current("gmv")), sum(current("spend"))),
      divide(sum(previous("gmv")), sum(previous("spend"))),
    ),
  },
  ordersChange: {
    id: "ORDERS_WOW",
    label: "成交订单环比",
    description: "本期成交订单数相对前 7 日的变化率。",
    unit: "percent",
    precision: 1,
    expression: percentChange(sum(current("orders")), sum(previous("orders"))),
  },
} satisfies Record<string, BusinessFormula>;

export function evaluateFormula(formula: BusinessFormula, context: FormulaContext): number {
  const result = evaluateNode(formula.expression, context);
  return Array.isArray(result) ? result.reduce((total, value) => total + value, 0) : result;
}

export function formulaToExcel(formula: BusinessFormula): string {
  return `=${renderNode(formula.expression)}`;
}

export function evaluateMaterialFormula(
  formula: "roi" | "costPerOrder" | "engagementRate",
  row: Record<string, unknown>,
): number {
  const spend = toNumber(row.spend);
  const gmv = toNumber(row.gmv);
  const orders = toNumber(row.orders);
  const plays = toNumber(row.plays);
  const engagements = toNumber(row.engagements);

  if (formula === "roi") return safeDivide(gmv, spend);
  if (formula === "costPerOrder") return safeDivide(spend, orders);
  return safeDivide(engagements, plays);
}

export const MATERIAL_FORMULAS = {
  roi: "=IFERROR([@gmv]/[@spend],0)",
  costPerOrder: "=IFERROR([@spend]/[@orders],0)",
  engagementRate: "=IFERROR([@engagements]/[@plays],0)",
} as const;

function evaluateNode(node: FormulaNode, context: FormulaContext): number | number[] {
  if (node.op === "literal") return node.value;
  if (node.op === "field") {
    const rows = context[node.dataset];
    return rows
      .filter((row) => !node.filter || row[node.filter.field] === node.filter.equals)
      .map((row) => toNumber(row[node.field]));
  }
  if (node.op === "sum" || node.op === "average" || node.op === "max") {
    const values = asArray(evaluateNode(node.value, context));
    if (values.length === 0) return 0;
    if (node.op === "sum") return values.reduce((total, value) => total + value, 0);
    if (node.op === "average") return values.reduce((total, value) => total + value, 0) / values.length;
    return Math.max(...values);
  }
  if (node.op === "divide") {
    return safeDivide(asNumber(evaluateNode(node.left, context)), asNumber(evaluateNode(node.right, context)), node.fallback);
  }
  if (node.op === "subtract") {
    return asNumber(evaluateNode(node.left, context)) - asNumber(evaluateNode(node.right, context));
  }

  if (node.op === "percentChange") {
    const previousValue = asNumber(evaluateNode(node.previous, context));
    if (previousValue === 0) return node.fallback ?? 0;
    const currentValue = asNumber(evaluateNode(node.current, context));
    return (currentValue - previousValue) / Math.abs(previousValue);
  }

  const aggregate = node as Extract<FormulaNode, { op: "sum" | "average" | "max" }>;
  return asNumber(evaluateNode(aggregate.value, context));
}

function renderNode(node: FormulaNode): string {
  if (node.op === "literal") return String(node.value);
  if (node.op === "field") {
    const range = `${node.dataset}[${node.field}]`;
    return node.filter
      ? `FILTER(${range},${node.dataset}[${node.filter.field}]="${node.filter.equals}")`
      : range;
  }
  if (node.op === "sum") return `SUM(${renderNode(node.value)})`;
  if (node.op === "average") return `AVERAGE(${renderNode(node.value)})`;
  if (node.op === "max") return `MAX(${renderNode(node.value)})`;
  if (node.op === "divide") return `IFERROR(${renderNode(node.left)}/${renderNode(node.right)},${node.fallback ?? 0})`;
  if (node.op === "subtract") return `${renderNode(node.left)}-${renderNode(node.right)}`;
  if (node.op === "percentChange") {
    return `IFERROR((${renderNode(node.current)}-${renderNode(node.previous)})/ABS(${renderNode(node.previous)}),${node.fallback ?? 0})`;
  }
  return "0";
}

function safeDivide(left: number, right: number, fallback = 0): number {
  return right === 0 ? fallback : left / right;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asArray(value: number | number[]): number[] {
  return Array.isArray(value) ? value : [value];
}

function asNumber(value: number | number[]): number {
  return Array.isArray(value) ? value.reduce((total, item) => total + item, 0) : value;
}
