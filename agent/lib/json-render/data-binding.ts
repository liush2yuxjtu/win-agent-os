/**
 * json-render spec 数据绑定层（server-agnostic 纯函数，不依赖 react）。
 *
 * 机制：spec 元素 props 可含 `dataRef: { queryId, field? }`，渲染前用
 * `resolveDataRefs` 把引用替换为 Query Registry 提供的实际数据（data 形状见
 * `QueryResultData`，本模块只消费该形状，不关心数据来源）。
 *
 *   - field="rows"        → props.rows = data.rows（Table 行数据，默认）
 *   - field="title"       → props.title = data.title
 *   - field="description" → props.description = data.description
 *   - field="value"       → props.description = data.value（KPI 卡描述即数值）
 *
 * 解析后 dataRef 字段被删除；原 spec 对象不被修改（返回新 spec）。
 */

/** Query Registry 提供的数据形状。 */
export type QueryResultData = {
  rows?: unknown[];
  title?: string;
  description?: string;
  value?: string;
};

/** dataRef 取值：field 缺省时按 "rows" 处理。 */
export type DataRef = {
  queryId: string;
  field?: "rows" | "title" | "description" | "value";
};

/** element-tree spec 的最小形状：root + elements（state 可选）。 */
export type ElementTreeSpec = {
  root: string;
  elements: Record<string, unknown>;
  state?: Record<string, unknown>;
};

/** element-tree spec 的最小形状校验：root + elements（state 可选）。 */
export function isElementTreeSpec(value: unknown): value is ElementTreeSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.root === "string" && typeof v.elements === "object" && v.elements !== null;
}

const DATA_REF_FIELDS: ReadonlySet<string> = new Set(["rows", "title", "description", "value"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 形状合法的 dataRef：queryId 为字符串，field（可选）属于约定的四个取值。 */
function isDataRef(value: unknown): value is DataRef {
  if (!isPlainRecord(value)) return false;
  if (typeof value.queryId !== "string") return false;
  if (value.field === undefined) return true;
  return typeof value.field === "string" && DATA_REF_FIELDS.has(value.field);
}

/**
 * 递归遍历元素树（元素级 props、内联子元素统一递归；不进入 state）。
 *
 * 命中三种位置的 dataRef（模型生成位置不稳定，逐一兼容）：
 *   1. 约定形态：`props.dataRef`（顶层，规范位置）
 *   2. 元素级：`record.dataRef`（模型把 dataRef 写在元素对象上而非 props 里）
 *   3. 嵌套形态：props 其他字段值本身就是 `{dataRef: {...}}` 形状（模型把
 *      dataRef 塞进 title/description/content 等字段值里）——不处理的话该对象
 *      会被 shadcn 组件当 children 渲染，React 报 "Objects are not valid as a
 *      React child"，console 出现 `{dataRef}` 渲染错误。
 *
 * visited 按对象引用去重：同一个 dataRef 对象（如顶层形态 + 递归到 props 内部
 * 时再次遇到）只 visit 一次。
 */
function walkElementTree(
  spec: ElementTreeSpec,
  visit: (el: Record<string, unknown>, props: Record<string, unknown>, ref: DataRef) => void,
): void {
  const visited = new Set<object>();
  const walk = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (!visited.has(record)) {
      visited.add(record);
      if (isPlainRecord(record.props) && isDataRef(record.props.dataRef)) {
        // 1. 约定形态：props.dataRef 顶层（ref 对象本身也标记，递归 props 时跳过）
        visited.add(record.props.dataRef);
        visit(record, record.props, record.props.dataRef);
      } else if (isDataRef(record.dataRef) && isPlainRecord(record.props)) {
        // 2. 元素级：record.dataRef（按 props.dataRef 语义处理）
        visited.add(record.dataRef);
        visit(record, record.props, record.dataRef);
      } else if (isDataRef(record)) {
        // 3. 嵌套形态：值本身是 dataRef 形状（props 字段值、slot 值等任意位置）
        visit(record, record, record);
      }
    }
    for (const [key, v] of Object.entries(record)) {
      if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (isPlainRecord(v)) {
        walk(v); // props / slots / repeat 等结构对象与内联子元素统一递归
      }
    }
  };
  for (const el of Object.values(spec.elements)) walk(el);
}

/**
 * 收集 spec 中所有 dataRef 引用（渲染前批量拉数用）。
 * 返回每个引用一次出现（含嵌套内联元素）；field 缺省时归一化为 "rows"。
 */
export function collectDataRefs(spec: ElementTreeSpec): { queryId: string; field: string }[] {
  const refs: { queryId: string; field: string }[] = [];
  walkElementTree(spec, (_el, _props, ref) => {
    refs.push({ queryId: ref.queryId, field: ref.field ?? "rows" });
  });
  return refs;
}

/**
 * 把 dataRef 形状的值替换为数据（嵌套形态专用）。
 *
 * 返回哨兵 DROP 表示「queryId 无数据」——对象场景由调用方删除该键（宁可缺失
 * 也不把 {dataRef} 对象留给组件渲染，那会触发 React "Objects are not valid
 * as a React child"）；数组场景替换为 null。
 */
const DROP: unique symbol = Symbol("dataRef-drop");

function resolveNestedDataRefs(
  value: unknown,
  dataMap: Record<string, QueryResultData>,
  usedQueryIds: string[],
): unknown {
  if (isDataRef(value)) {
    const ref = value;
    const data = dataMap[ref.queryId];
    if (data === undefined) return DROP;
    if (!usedQueryIds.includes(ref.queryId)) usedQueryIds.push(ref.queryId);
    switch (ref.field ?? "rows") {
      case "rows":
        return data.rows ?? [];
      case "title":
        return data.title;
      case "description":
        return data.description;
      case "value":
        return data.value;
      default:
        return data.rows ?? [];
    }
  }
  if (Array.isArray(value)) {
    const mapped = value.map((v) => {
      const resolved = resolveNestedDataRefs(v, dataMap, usedQueryIds);
      return resolved === DROP ? null : resolved;
    });
    const same = mapped.every((m, i) => m === value[i]);
    return same ? value : mapped;
  }
  if (isPlainRecord(value)) {
    // 包装结构 {dataRef: {...}}（模型把 dataRef 对象整体包在字段值里）：
    // 整个字段的意图是「来自查询」，解包为数据值本身，避免残留 {dataRef: 值}。
    const wrappedRef = value.dataRef;
    if (isDataRef(wrappedRef) && Object.keys(value).length === 1) {
      return resolveNestedDataRefs(wrappedRef, dataMap, usedQueryIds);
    }
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(value)) {
      const resolved = resolveNestedDataRefs(v, dataMap, usedQueryIds);
      if (resolved === DROP) {
        changed = true; // 数据未到：删除键，避免 {dataRef} 对象被当渲染值
        continue;
      }
      next[k] = resolved;
      if (resolved !== v) changed = true;
    }
    return changed ? next : value;
  }
  return value;
}

/**
 * 把每个元素的 props.dataRef 替换为 dataMap 中的实际数据，返回新 spec 对象
 * （原 spec 不被修改）。dataMap 缺该 queryId 时跳过注入（dataRef 仍被删除）。
 * usedQueryIds 为去重后的引用 queryId 列表，供调用方预取数据。
 *
 * 兼容三种 dataRef 位置（与 walkElementTree 对称）：
 *   1. 约定形态 props.dataRef（含 Table 行数据规范化）
 *   2. 元素级 record.dataRef（按 props.dataRef 语义处理）
 *   3. props 其他字段值里的嵌套 dataRef 形状对象（resolveNestedDataRefs 递归，
 *      无数据时删除该键——消除 {dataRef} 被当渲染值的报错路径）
 */
export function resolveDataRefs(
  spec: ElementTreeSpec,
  dataMap: Record<string, QueryResultData>,
): { spec: ElementTreeSpec; usedQueryIds: string[] } {
  const usedQueryIds: string[] = [];

  const resolveElement = (el: unknown): unknown => {
    if (typeof el !== "object" || el === null) return el;
    const record = el as Record<string, unknown>;

    let result: Record<string, unknown> = record;
    let mutated = false;

    const rawProps = record.props;
    const topLevelRef =
      isPlainRecord(rawProps) && isDataRef(rawProps.dataRef) ? rawProps.dataRef : undefined;
    const elementLevelRef = topLevelRef === undefined && isDataRef(record.dataRef) ? record.dataRef : undefined;
    const ref = topLevelRef ?? elementLevelRef;

    if (ref !== undefined) {
      const data = dataMap[ref.queryId];
      const baseProps = isPlainRecord(rawProps) ? rawProps : {};
      const newProps: Record<string, unknown> = { ...baseProps };
      delete newProps.dataRef;
      switch (ref.field ?? "rows") {
        case "rows": {
          // 按目标元素 type 分支（record 即元素 record，含 type）：
          //  - Table 期望 rows 为「数组的数组」（每行是单元格数组），而 Query
          //    Registry 返回的是对象数组（列名 → 值）。在此规范化：
          //    - 数据未到达/缺失时给空数组（Table 对 undefined rows 会崩 row.map）；
          //    - 对象数组按首个对象的 key 序转成值数组，并把 key 作为默认 columns
          //      （spec 显式给了 columns 时优先 spec 的，值按索引对齐）。
          //  - 其他组件（如 BarChart）期望 rows 为对象数组：原样注入，不转数组的数组。
          const rawRows = data?.rows ?? [];
          if (record.type === "Table") {
            const rows: unknown[][] = [];
            let defaultColumns: string[] | undefined;
            if (Array.isArray(rawRows)) {
              for (const row of rawRows) {
                if (Array.isArray(row)) {
                  rows.push(row);
                } else if (isPlainRecord(row)) {
                  if (defaultColumns === undefined) defaultColumns = Object.keys(row);
                  rows.push(Object.values(row));
                }
              }
            }
            newProps.rows = rows;
            if (defaultColumns !== undefined && !Array.isArray(newProps.columns)) {
              newProps.columns = defaultColumns;
            }
          } else {
            newProps.rows = rawRows;
          }
          break;
        }
        case "title":
          if (data !== undefined) newProps.title = data.title;
          break;
        case "description":
          if (data !== undefined) newProps.description = data.description;
          break;
        case "value":
          if (data !== undefined) newProps.description = data.value;
          break;
      }
      let next: Record<string, unknown> = { ...record, props: newProps };
      if (elementLevelRef !== undefined) delete next.dataRef; // 元素级引用提升进 props 后清掉原键
      result = next;
      mutated = true;
      if (!usedQueryIds.includes(ref.queryId)) usedQueryIds.push(ref.queryId);
    }

    // props 深递归：处理嵌套 dataRef 形状对象（位置 3）。注入后的业务数据
    // （行对象等）不含 queryId 键，不会被误判替换。
    const finalProps = result.props;
    if (isPlainRecord(finalProps)) {
      const resolvedProps = resolveNestedDataRefs(finalProps, dataMap, usedQueryIds);
      if (resolvedProps !== finalProps) {
        result = { ...result, props: resolvedProps };
        mutated = true;
      }
    }

    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result)) {
      if (key === "props") {
        next[key] = value;
      } else if (Array.isArray(value)) {
        const mapped = value.map((entry) => resolveElement(entry));
        const same = mapped.every((m, i) => m === value[i]);
        next[key] = same ? value : mapped;
        if (!same) mutated = true;
      } else if (isPlainRecord(value)) {
        const resolved = resolveElement(value);
        next[key] = resolved;
        if (resolved !== value) mutated = true;
      } else {
        next[key] = value;
      }
    }
    return mutated ? next : result;
  };

  const elements: Record<string, unknown> = {};
  for (const [key, el] of Object.entries(spec.elements)) {
    elements[key] = resolveElement(el);
  }

  return { spec: { ...spec, elements }, usedQueryIds };
}

/**
 * 把模型生成的 Table 元素 props 规范化到 json-render Table 组件期望的形态：
 *   rows = 数组的数组（每行是单元格数组），columns = 字符串数组（列标题）。
 *
 * 模型常见三种输出：
 *   1. rows: 数组的数组 + columns: string[]（json-render 原生形态，原样通过）
 *   2. rows: 对象数组 + columns: [{key, label|header}]（本会话 render_ui 实际输出）
 *   3. data: 对象数组 + columns: [{key, header}]（模型把行数据放 data 字段）
 * 均在此归一化；无法识别时保留原样（渲染端容错）。
 */
export function normalizeTableProps(spec: ElementTreeSpec): ElementTreeSpec {
  let mutated = false;
  const elements: Record<string, unknown> = {};

  for (const [key, rawEl] of Object.entries(spec.elements)) {
    if (typeof rawEl !== "object" || rawEl === null) {
      elements[key] = rawEl;
      continue;
    }
    const el = rawEl as Record<string, unknown>;
    if (el.type !== "Table") {
      elements[key] = el;
      continue;
    }
    const props =
      typeof el.props === "object" && el.props !== null ? { ...(el.props as Record<string, unknown>) } : {};

    // 1. columns：{key, label|header} 对象数组 → 字符串数组（取 label ?? header ?? key）。
    let columns: unknown = props.columns;
    if (Array.isArray(columns) && columns.length > 0 && isPlainRecord(columns[0])) {
      columns = columns.map((c) => {
        const col = c as Record<string, unknown>;
        return String(col.label ?? col.header ?? col.key ?? "");
      });
      mutated = true;
    }

    // 2. 行数据：优先 rows，其次 data（模型常用 data 字段，json-render Table 不认识它）。
    const rawRows = Array.isArray(props.rows) ? props.rows : Array.isArray(props.data) ? props.data : null;
    let rows: unknown = props.rows;

    if (rawRows !== null) {
      const colKeys = Array.isArray(props.columns)
        ? props.columns
            .map((c) => (isPlainRecord(c) ? (c as Record<string, unknown>).key : undefined))
            .filter((k): k is string => typeof k === "string")
        : [];

      const isRowArrayOfArrays = Array.isArray(rawRows[0]);
      if (isRowArrayOfArrays) {
        rows = rawRows;
      } else if (isPlainRecord(rawRows[0])) {
        rows = rawRows.map((row) => {
          const record = row as Record<string, unknown>;
          if (colKeys.length > 0) {
            return colKeys.map((k) => record[k] ?? "");
          }
          return Object.values(record);
        });
        mutated = true;
      }
    }

    const nextProps: Record<string, unknown> = { ...props };
    if (mutated) {
      nextProps.rows = rows;
      nextProps.columns = columns;
      if (props.data !== undefined) delete nextProps.data;
    }
    elements[key] = { ...el, props: nextProps };
  }

  return mutated ? { ...spec, elements } : spec;
}
