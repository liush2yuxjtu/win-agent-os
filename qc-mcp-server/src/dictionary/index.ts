/**
 * In-memory index over the parsed data dictionary: keyword search across
 * table names, Chinese names, descriptions, domains and field names, plus a
 * lightweight business-question → table recommendation.
 */
import type { DatabaseName, TableDoc } from "../types.js";

export interface SearchHit {
  table: string;
  chineseName: string;
  database: DatabaseName;
  businessDomain?: string;
  primaryKey?: string;
  description: string;
  /** Fields whose name/chineseName/description matched. */
  matchedFields: string[];
  score: number;
}

export interface RecommendHit extends SearchHit {
  reasons: string[];
}

interface TokenWeights {
  table: number; // exact table name token
  chinese: number; // Chinese name token
  domain: number; // business domain
  description: number; // description text
  field: number; // field name / chinese field
}

const WEIGHTS: TokenWeights = {
  table: 10,
  chinese: 6,
  domain: 3,
  description: 2,
  field: 1,
};

/** Split text into searchable tokens (alnum runs, CJK handled per-char). */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // latin/digit words
  const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  tokens.push(...words);
  // CJK characters (2+ runs kept as substrings later; per-char here is noisy,
  // so keep runs of CJK as whole substrings).
  const cjk = text.match(/[一-鿿]+/g) ?? [];
  tokens.push(...cjk);
  return tokens.filter((t) => t.length > 0);
}

/** Normalize a query into tokens; CJK runs also yield sliding bigrams. */
export function normalizeQuery(query: string): string[] {
  const tokens = tokenize(query);
  const expanded: string[] = [];
  for (const t of tokens) {
    if (/^[一-鿿]+$/.test(t)) {
      expanded.push(t);
      if (t.length > 1) {
        // sliding 2-char bigrams so "找竞品素材" also matches "竞品"/"素材"
        for (let i = 0; i + 2 <= t.length; i++) expanded.push(t.slice(i, i + 2));
      }
    } else {
      expanded.push(t);
    }
  }
  return [...new Set(expanded)];
}

export class DictionaryIndex {
  private readonly tables: TableDoc[];
  /** table name (upper) -> doc */
  private readonly byName: Map<string, TableDoc>;
  private readonly allTokens: string[];

  constructor(tables: TableDoc[]) {
    this.tables = tables;
    this.byName = new Map();
    for (const t of tables) this.byName.set(t.table.toUpperCase(), t);
    this.allTokens = tokenize(tables.map((t) => t.table).join(" "));
  }

  get size(): number {
    return this.tables.length;
  }

  all(database?: DatabaseName): TableDoc[] {
    if (!database) return this.tables;
    return this.tables.filter((t) => t.database === database);
  }

  /** Exact table lookup (case-insensitive); returns undefined if absent. */
  getByName(table: string): TableDoc | undefined {
    return this.byName.get(table.toUpperCase().trim());
  }

  /**
   * Keyword search across table + field metadata. Returns ranked hits.
   * Scoring: per-token weight sum where table/chinese/domain exact-substring
   * hits weigh most.
   */
  search(query: string, limit = 10): SearchHit[] {
    const terms = normalizeQuery(query);
    if (terms.length === 0) return [];
    const results: SearchHit[] = [];

    for (const t of this.tables) {
      let score = 0;
      const matchedFields: string[] = [];
      const hayTable = t.table.toUpperCase();
      const hayChinese = t.chineseName.toLowerCase();
      const hayDomain = (t.businessDomain ?? "").toLowerCase();
      const hayDesc = (t.description ?? "").toLowerCase();
      const hayFieldNames = t.fields.map((f) => f.name.toUpperCase());
      const hayFieldChinese = t.fields.map((f) => (f.chineseName ?? "").toLowerCase());

      for (const term of terms) {
        const upper = term.toUpperCase();
        if (hayTable.includes(upper)) score += WEIGHTS.table;
        if (hayChinese.includes(term)) score += WEIGHTS.chinese;
        if (hayDomain.includes(term)) score += WEIGHTS.domain;
        if (hayDesc.includes(term)) score += WEIGHTS.description;
        // field-level
        for (let i = 0; i < t.fields.length; i++) {
          const f = t.fields[i];
          const nm = hayFieldNames[i];
          const cn = hayFieldChinese[i];
          if (nm.includes(upper)) {
            score += WEIGHTS.field;
            if (!matchedFields.includes(f.name)) matchedFields.push(f.name);
          } else if (cn.includes(term)) {
            score += WEIGHTS.field * 0.8;
            if (!matchedFields.includes(f.name)) matchedFields.push(f.name);
          }
        }
      }

      if (score > 0) {
        results.push({
          table: t.table,
          chineseName: t.chineseName,
          database: t.database,
          businessDomain: t.businessDomain,
          primaryKey: t.primaryKey,
          description: t.description,
          matchedFields,
          score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Recommend tables for a natural-language business question. Scores tables
   * whose description / domain / field-chinese share tokens with the question,
   * and surfaces the top reasons per table.
   */
  recommend(question: string, topK = 5): RecommendHit[] {
    const terms = normalizeQuery(question);
    if (terms.length === 0) return [];
    const results: RecommendHit[] = [];

    for (const t of this.tables) {
      let score = 0;
      const reasons: string[] = [];
      const corpus: Array<{ weight: number; text: string; label: string; segs?: string[] }> = [
        { weight: WEIGHTS.description, text: (t.description ?? "").toLowerCase(), label: "描述" },
        { weight: WEIGHTS.domain, text: (t.businessDomain ?? "").toLowerCase(), label: "业务域" },
        { weight: WEIGHTS.chinese, text: t.chineseName.toLowerCase(), label: "中文名" },
        { weight: WEIGHTS.table, text: t.table.toUpperCase(), label: "表名" },
      ];
      for (const f of t.fields) {
        const segs = f.name.toLowerCase().split("_");
        corpus.push({
          weight: WEIGHTS.field,
          text: (f.chineseName ?? "").toLowerCase(),
          label: `字段 ${f.name}`,
          segs,
        });
      }
      for (const term of terms) {
        const upper = term.toUpperCase();
        for (const item of corpus) {
          const hit =
            item.segs
              ? item.segs.some((s) => s === term || s.includes(term) || s.includes(upper))
              : item.text.includes(term) || item.text.includes(upper);
          if (hit) {
            score += item.weight;
            const why = `${item.label}「${term}」`;
            if (!reasons.includes(why)) reasons.push(why);
          }
        }
      }
      if (score > 0) {
        results.push({
          table: t.table,
          chineseName: t.chineseName,
          database: t.database,
          businessDomain: t.businessDomain,
          primaryKey: t.primaryKey,
          description: t.description,
          matchedFields: [],
          score,
          reasons: reasons.slice(0, 6),
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}
