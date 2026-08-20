import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * glossarizer 引擎核心 — 零业务知识，全凭 config 驱动。
 *
 * 数据模型（config JSON）：
 *   glossary.json:
 *     domain, version, connections, tables, fields（物理列→术语绑定）, terms（业务术语定义）
 *   rules.json:
 *     domain, version, rules（业务专家用术语组合的规则）
 *
 * 关键设计：术语必须携带「聚合语义」（aggregation），否则「本周平均ROI」这类词
 * 无法无歧义展开成公式。加权比率（weighted_ratio）强制 SUM(分子)/SUM(分母)，
 * 禁止简单 AVERAGE(ROI)。
 */

export interface FieldBinding {
  id: string;
  table: string; // 物理表名（词典 tables 中的 name）
  column: string; // 物理列名
  term: string; // 绑定的业务术语名
  unit?: string;
  annotated_by: string; // 标注人员
  annotated_at: string;
  note?: string; // 口径注释（溯源给业务专家看）
}

export interface Term {
  name: string;
  definition: string; // 人类可读公式，如 "产出 / 消耗"
  aggregation:
    | { kind: "weighted_ratio"; numerator: string[]; denominator: string[]; window?: string }
    | { kind: "sum" | "avg" | "count"; window?: string } // 作用域 = 本术语绑定的物理字段
    | { kind: "sum_of"; parts: string[]; window?: string } // 组成：其他业务字段之和（如 整体消耗 = 基础消耗+追投调控消耗）
    | { kind: "diff_of"; parts: string[]; window?: string } // 组成：第一个减其余（如 自然成交 = 整体-追投）
    | { kind: "ratio"; window?: string }; // 配置值/单行比率（如品线基线ROI）
  grain: string; // 粒度，如 "素材|日"、"账号|周"
  version: string;
}

export interface GlossaryConfig {
  domain: string;
  version: string;
  connections?: Record<string, { dialect?: string; description?: string }>;
  tables: { name: string; database?: string; logical?: string; note?: string }[];
  fields: FieldBinding[];
  terms: Term[];
}

export interface RuleAction {
  name: string; // 动作名，如 启动追投 / 停止追投 / 人工复核
  type: "start" | "stop" | "review" | "custom"; // 动作类型（start/stop 有确定语义，review/custom 需人工）
  trigger: string; // 触发说明，如 "表达式为 TRUE 时执行"
  owner?: string; // 动作执行人/部门
  params?: Record<string, string>; // 动作参数（业务专家自定义）
}

export interface Rule {
  name: string;
  expression: string; // 业务专家写的公式，如 "IF(ROI > {品线基线ROI}, TRUE, FALSE)"
  terms: string[]; // 引用的术语名（必须都在词典里）
  owner: string;
  note?: string;
  version?: string;
  /** 业务动作：规则判定为 TRUE 时触发的动作（业务专家可编辑，一等公民） */
  action?: RuleAction;
}

export interface RulesConfig {
  domain: string;
  version: string;
  rules: Rule[];
}

export class GlossaryError extends Error {}

export class Glossary {
  private cfg: GlossaryConfig;
  private rules: RulesConfig;
  private termIndex = new Map<string, Term>();
  /** 业务字段 → 物理字段绑定列表（一个业务字段可对应多个物理来源） */
  private fieldIndex = new Map<string, FieldBinding[]>();
  private tableIndex = new Map<string, GlossaryConfig["tables"][number]>();

  constructor(
    private glossaryPath: string,
    private rulesPath: string,
    private dialect = "sqlserver",
  ) {
    this.cfg = this.loadJson<GlossaryConfig>(glossaryPath, "glossary");
    this.rules = this.loadJson<RulesConfig>(rulesPath, "rules");
    for (const t of this.cfg.terms) this.termIndex.set(t.name, t);
    for (const f of this.cfg.fields) {
      const list = this.fieldIndex.get(f.term) ?? [];
      list.push(f);
      this.fieldIndex.set(f.term, list);
    }
    for (const t of this.cfg.tables) this.tableIndex.set(t.name, t);
  }

  private loadJson<T>(p: string, kind: string): T {
    const abs = resolve(process.cwd(), p);
    let raw: string;
    try {
      raw = readFileSync(abs, "utf8");
    } catch {
      throw new GlossaryError(`无法读取${kind === "glossary" ? "术语词典" : "规则库"}: ${p}（cwd=${process.cwd()}）`);
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new GlossaryError(`${kind} JSON 解析失败: ${p}`);
    }
  }

  /** 查术语：返回完整定义 + 物理字段溯源（标注人、口径、单位） */
  resolve(name: string) {
    const term = this.termIndex.get(name);
    if (!term) throw new GlossaryError(`术语「${name}」不在词典中（${this.glossaryPath}）`);
    const bindings = this.cfg.fields.filter((f) => f.term === name);
    const sources = bindings.map((f) => {
      const table = this.tableIndex.get(f.table);
      return {
        term: f.term,
        database: table?.database,
        table: f.table,
        column: f.column,
        unit: f.unit,
        annotated_by: f.annotated_by,
        annotated_at: f.annotated_at,
        note: f.note,
      };
    });
    return { ...term, sources };
  }

  /** 把聚合术语或业务规则展开成目标语言公式（递归解析业务字段网络到物理叶子） */
  expand(name: string, target: "excel" | "sql" = "excel"): string {
    return this.expandInternal(name, target, [], true);
  }

  private expandInternal(name: string, target: "excel" | "sql", stack: string[], topLevel: boolean): string {
    const rule = this.rules.rules.find((r) => r.name === name);
    if (rule) {
      // 规则里的 {术语} 占位符 → 展开该术语的公式（递归，最深层是字段引用）
      // 内层展开剥掉 Excel 的 "=" 前缀（= 只允许出现在最外层公式开头）
      const inner = (termName: string) => {
        const t = this.termIndex.get(termName);
        if (!t) throw new GlossaryError(`规则「${name}」引用的术语「${termName}」不在词典中`);
        const expanded = this.expandInternal(termName, target, [...stack, name], false);
        return target === "excel" && expanded.startsWith("=") ? expanded.slice(1) : expanded;
      };
      return rule.expression.replace(/\{([^}]+)\}/g, (_, termName: string) => inner(termName));
    }
    const term = this.termIndex.get(name);
    if (!term) throw new GlossaryError(`术语「${name}」不在词典中`);
    if (stack.includes(name)) throw new GlossaryError(`术语循环引用: ${[...stack, name].join(" → ")}`);
    const agg = term.aggregation;
    const nextStack = [...stack, name];

    // 解析一个引用名：优先业务术语（递归），否则物理字段绑定（多绑定取第一个，note 说明来源）
    const ref = (refName: string, t: "excel" | "sql"): string => {
      if (this.termIndex.has(refName)) {
        const expanded = this.expandInternal(refName, t, nextStack, false);
        return t === "excel" && expanded.startsWith("=") ? expanded.slice(1) : expanded;
      }
      const bindings = this.fieldIndex.get(refName);
      if (!bindings || bindings.length === 0)
        throw new GlossaryError(`「${refName}」既不是业务术语也没有字段绑定，无法展开`);
      const b = bindings[0]; // 多来源默认取第一个（词典顺序）
      const table = this.tableIndex.get(b.table);
      const col = table?.database
          ? `[${table.database}].[dbo].[${b.table}].[${b.column}]`
          : `[${b.table}].[${b.column}]`;
      return t === "excel" ? `${b.table}!${b.column}` : col;
    };

    // 聚合某业务字段的所有物理绑定（多对一：多个物理列都算该业务字段）
    const aggBindings = (fieldName: string, fn: (col: string) => string) => {
      if (this.termIndex.has(fieldName)) {
        // 引用的是组合术语（如 sum_of），直接递归展开
        const expanded = this.expandInternal(fieldName, target, nextStack, false);
        return target === "excel" && expanded.startsWith("=") ? expanded.slice(1) : expanded;
      }
      const bindings = this.fieldIndex.get(fieldName);
      if (!bindings || bindings.length === 0)
        throw new GlossaryError(`「${fieldName}」既不是业务术语也没有字段绑定`);
      const cols = bindings.map((b) => {
        const table = this.tableIndex.get(b.table);
        const col = table?.database
          ? `[${table.database}].[dbo].[${b.table}].[${b.column}]`
          : `[${b.table}].[${b.column}]`;
        return target === "excel" ? `${b.table}!${b.column}` : col;
      });
      return cols.map((c) => fn(c)).join(" + ");
    };

    switch (agg.kind) {
      case "weighted_ratio": {
        const sumPart = (parts: string[]) =>
          parts.map((p) => aggBindings(p, (c) => (target === "sql" ? `SUM(${c})` : `SUM(${c})`))).join(" + ");
        if (target === "sql") {
          const num = sumPart(agg.numerator);
          const den = sumPart(agg.denominator);
          return `${num} / NULLIF(${den}, 0)`;
        }
        const num = sumPart(agg.numerator);
        const den = sumPart(agg.denominator);
        return `=(${num}) / (${den})`;
      }
      case "sum":
      case "avg":
      case "count": {
        // 聚合本术语自身的物理绑定（多对一：所有绑定列都计入）
        const bindings = this.fieldIndex.get(name);
        if (!bindings || bindings.length === 0)
          throw new GlossaryError(`术语「${name}」没有物理字段绑定，无法展开（组合字段请用 sum_of）`);
        const fn =
          agg.kind === "avg"
            ? (c: string) => (target === "sql" ? `AVG(${c})` : `AVERAGE(${c})`)
            : agg.kind === "count"
              ? (c: string) => (target === "sql" ? `COUNT_BIG(${c})` : `COUNT(${c})`)
              : (c: string) => (target === "sql" ? `SUM(${c})` : `SUM(${c})`);
        const cols = bindings.map((b) => {
          const table = this.tableIndex.get(b.table);
          const col = table?.database
          ? `[${table.database}].[dbo].[${b.table}].[${b.column}]`
          : `[${b.table}].[${b.column}]`;
          return target === "excel" ? `${b.table}!${b.column}` : `[${col}]`;
        });
        return cols.map((c) => fn(c)).join(" + ");
      }
      case "sum_of": {
        const parts = agg.parts.map((p) => aggBindings(p, (c) => (target === "sql" ? `SUM(${c})` : `SUM(${c})`)));
        return target === "sql" ? parts.join(" + ") : `=${parts.join(" + ")}`;
      }
      case "diff_of": {
        const parts = agg.parts.map((p) => aggBindings(p, (c) => (target === "sql" ? `SUM(${c})` : `SUM(${c})`)));
        const [first, ...rest] = parts;
        return target === "sql" ? `${first} - ${rest.join(" - ")}` : `=${first} - ${rest.join(" - ")}`;
      }
      case "ratio": {
        // 配置值/单行比率（如品线基线ROI）：直接引用自身绑定的物理字段，不递归。
        // SQL 聚合上下文里非聚合列必须包 MAX()（配置值是常量，MAX 恒等且合法）。
        const bindings = this.fieldIndex.get(name);
        if (!bindings || bindings.length === 0)
          throw new GlossaryError(`术语「${name}」是 ratio 类型但没有物理字段绑定`);
        const b = bindings[0];
        const table = this.tableIndex.get(b.table);
        const col = table?.database
          ? `[${table.database}].[dbo].[${b.table}].[${b.column}]`
          : `[${b.table}].[${b.column}]`;
        return target === "sql" ? `MAX(${col})` : `=${b.table}!${b.column}`;
      }
    }
    void topLevel;
  }

  /** 溯源一条规则：规则 → 术语 → 物理字段 → 标注人 */
  trace(ruleName: string) {
    const rule = this.rules.rules.find((r) => r.name === ruleName);
    if (!rule) throw new GlossaryError(`规则「${ruleName}」不在规则库中`);
    const legs = rule.terms.map((t) => {
      const term = this.resolve(t);
      return {
        term: term.name,
        definition: term.definition,
        aggregation: term.aggregation,
        fields: term.sources,
      };
    });
    return {
      rule: { name: rule.name, expression: rule.expression, owner: rule.owner, note: rule.note },
      legs,
    };
  }

  /** 全部术语（按词典顺序） */
  listTerms(): Term[] {
    return this.cfg.terms;
  }

  /** 全部规则（按规则库顺序） */
  listRules(): Rule[] {
    return this.rules.rules;
  }

  /** 全部表（按词典顺序） */
  listTables() {
    return this.cfg.tables;
  }

  /** 全部字段绑定（按词典顺序） */
  listFields(): FieldBinding[] {
    return this.cfg.fields;
  }

  /** 按租户选择 config 的工厂（供动态工具按调用者解析） */
  static forTenant(
    tenants: Record<string, { glossaryPath: string; rulesPath: string }> | undefined,
    fallback: { glossaryPath: string; rulesPath: string },
    tenant: string,
    dialect: string,
  ): Glossary {
    const t = tenants?.[tenant] ?? fallback;
    return new Glossary(t.glossaryPath, t.rulesPath, dialect);
  }

  /** 词典完整性校验：引用完整、聚合语义必填、字段唯一 */
  validate() {
    const problems: string[] = [];
    // 字段绑定本身就是最小术语单元（term = 权威中文名），无需在 terms 中重复定义。
    // 一个业务字段可对应多个物理字段（多对一合法）；但同一物理列绑到不同术语是冲突。
    const colTerm = new Map<string, string>();
    for (const f of this.cfg.fields) {
      if (!f.annotated_by) problems.push(`字段 ${f.table}.${f.column} 缺标注来源`);
      const key = `${f.table}.${f.column}`;
      const prev = colTerm.get(key);
      if (prev && prev !== f.term) problems.push(`字段 ${key} 同时绑定了「${prev}」和「${f.term}」`);
      colTerm.set(key, f.term);
    }
    const refsOf = (t: Term): string[] => {
      switch (t.aggregation.kind) {
        case "weighted_ratio":
          return [...t.aggregation.numerator, ...t.aggregation.denominator];
        case "sum_of":
        case "diff_of":
          return t.aggregation.parts;
        default:
          return [];
      }
    };
    for (const t of this.cfg.terms) {
      if (!t.definition) problems.push(`术语「${t.name}」缺 definition`);
      if (!t.aggregation) problems.push(`术语「${t.name}」缺聚合语义（必须声明 sum/avg/weighted_ratio 等，否则无法展开）`);
      else {
        for (const part of refsOf(t))
          if (!this.termIndex.has(part) && !this.fieldIndex.has(part))
            problems.push(`术语「${t.name}」的聚合引用「${part}」既不是术语也不是字段`);
        if (t.aggregation.kind === "sum" || t.aggregation.kind === "avg" || t.aggregation.kind === "count") {
          if (!this.fieldIndex.has(t.name))
            problems.push(`术语「${t.name}」是 ${t.aggregation.kind} 聚合但没有物理字段绑定`);
        }
      }
    }
    for (const r of this.rules.rules) {
      for (const t of r.terms)
        if (!this.termIndex.has(t)) problems.push(`规则「${r.name}」引用的术语「${t}」不存在`);
    }
    return {
      domain: this.cfg.domain,
      glossaryPath: this.glossaryPath,
      tables: this.cfg.tables.length,
      fields: this.cfg.fields.length,
      terms: this.cfg.terms.length,
      rules: this.rules.rules.length,
      problems,
      ok: problems.length === 0,
    };
  }
}
