/**
 * Tool registration for the QC data dictionary MCP server.
 *
 * Registered tools:
 *  - qc_search_table_docs   keyword search over the data dictionary
 *  - qc_get_table_doc       full structure of one table
 *  - qc_list_tables         paginated table listing by database
 *  - qc_query_database      read-only SQL query (SELECT/WITH only)
 *  - qc_recommend_table     business-question → table recommendation
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DATABASES, CHARACTER_LIMIT } from "../constants.js";
import type { DictionaryIndex } from "../dictionary/index.js";
import { runQuery } from "../services/mssql.js";
import { searchMarkdown, tableDocMarkdown } from "./format.js";

const databaseSchema = z
	.enum(DATABASES)
	.describe(
		"目标数据库：video_management（混剪主库）或 WIN_DOUYIN（竞品数据源）",
	);

/** Tool error → text result (never a protocol-level throw). */
function errorText(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	return `Error: ${msg}`;
}

export function registerTools(
	server: McpServer,
	index: DictionaryIndex,
): string[] {
	const names: string[] = [];
	// ---- qc_search_table_docs ----
	names.push("qc_search_table_docs");
	server.registerTool(
		"qc_search_table_docs",
		{
			title: "搜索 QC 数据字典",
			description: `按业务词、中文名、表名或字段名搜索 QC 数据字典（37 张表，覆盖 video_management 与 WIN_DOUYIN）。先用它定位要用的表。

Args:
  - query (string): 搜索关键词，如「品线」「切片」「竞品素材」「ROI」「CTR」
  - limit (number): 返回结果上限，1-20（默认 10）

Returns:
  - 命中列表：表名、中文名、所属库、业务域、说明摘要、命中的字段名

Examples:
  - 查品线相关表 -> query="品线"
  - 查含 CTR 字段的表 -> query="CTR"
  - 想找竞品素材爬虫表 -> query="竞品 云图"
`,
			inputSchema: {
				query: z
					.string()
					.min(1, "查询词不能为空")
					.max(200, "查询词过长")
					.describe("搜索关键词"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.default(10)
					.describe("返回结果上限"),
			},
			outputSchema: {
				query: z.string().describe("搜索关键词"),
				count: z.number().describe("命中数量"),
				results: z
					.array(
						z.object({
							table: z.string().describe("表名"),
							chinese_name: z.string().describe("中文表名"),
							database: z.enum(DATABASES).describe("所属数据库"),
							business_domain: z.string().nullable().describe("业务域，可能为 null"),
							primary_key: z.string().nullable().describe("主键，可能为 null"),
							matched_fields: z.array(z.string()).describe("命中的字段名"),
						}),
					)
					.describe("命中表列表"),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ query, limit }) => {
			const hits = index.search(query, limit);
			const structured = hits.map((h) => ({
				table: h.table,
				chinese_name: h.chineseName,
				database: h.database,
				business_domain: h.businessDomain ?? null,
				primary_key: h.primaryKey ?? null,
				matched_fields: h.matchedFields,
			}));
			return {
				content: [{ type: "text", text: searchMarkdown(hits, limit) }],
				structuredContent: {
					query,
					count: structured.length,
					results: structured,
				},
			};
		},
	);

	// ---- qc_get_table_doc ----
	names.push("qc_get_table_doc");
	server.registerTool(
		"qc_get_table_doc",
		{
			title: "读取 QC 表结构",
			description: `读取指定表的字段、类型、主键、中文释义、样例值、枚举与关联表。表名不区分大小写；找不到时给出相近表名建议。

Args:
  - table (string): 表名，如 QC_MONTAGE_PRODUCT 或 QC_MONTAGE_CUT_UNIQUE（支持缩写，会模糊匹配）
  - include_raw (boolean): 是否同时返回原始 markdown 文档（默认 false）

Returns:
  - 表元数据、字段清单（类型/可空/主键/中文名/说明/样例/枚举）、关联表、已知问题

Examples:
  - 看品线表结构 -> table="QC_MONTAGE_PRODUCT"
  - 看唯一切片表的指标字段 -> table="cut_unique"
`,
			inputSchema: {
				table: z
					.string()
					.min(1)
					.max(200)
					.describe("表名（不区分大小写，支持缩写）"),
				include_raw: z
					.boolean()
					.default(false)
					.describe("是否包含原始 markdown"),
			},
			outputSchema: {
				table: z.string().nullable().describe("表名，未找到时为 null"),
				chinese_name: z.string().nullable().describe("中文表名，未找到时为 null"),
				database: z.enum(DATABASES).nullable().describe("所属数据库，未找到时为 null"),
				schema: z.string().nullable().describe("Schema，未找到时为 null"),
				description: z.string().nullable().describe("表说明，未找到时为 null"),
				primary_key: z.string().nullable().describe("主键，可能为 null"),
				business_domain: z.string().nullable().describe("业务域，可能为 null"),
				fields: z
					.array(
						z.object({
							name: z.string().describe("字段名"),
							type: z.string().describe("数据类型"),
							nullable: z.boolean().describe("是否可空"),
							is_primary_key: z.boolean().describe("是否主键"),
							chinese_name: z.string().nullable().describe("字段中文名"),
							description: z.string().nullable().describe("字段说明"),
							sample: z.string().nullable().describe("样例值"),
							status: z.string().nullable().describe("字段状态"),
							enum: z.record(z.string(), z.string()).nullable().describe("枚举映射 code=label"),
						}),
					)
					.describe("字段清单"),
				relations: z
					.array(
						z.object({
							target: z.string().describe("关联表名"),
							cardinality: z.string().optional().describe("基数"),
							joinKey: z.string().optional().describe("关联键"),
							description: z.string().optional().describe("关联说明"),
						}),
					)
					.describe("关联表"),
				known_issues: z.array(z.string()).describe("已知问题"),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ table, include_raw }) => {
			// exact match first, then fuzzy: contains or prefix
			let doc = index.getByName(table);
			if (!doc) {
				const upper = table.toUpperCase().trim();
				doc =
					index.all().find((t) => t.table.toUpperCase().includes(upper)) ??
					index.all().find((t) => t.chineseName.includes(table));
			}
			if (!doc) {
				const suggestions = index
					.search(table, 5)
					.map((h) => `${h.table}（${h.chineseName}）`)
					.join("；");
				const text = `Error: 找不到表 ${table}。${suggestions ? `相近表：${suggestions}` : "请用 qc_list_tables 查看全部表。"}`;
				return {
					content: [{ type: "text", text }],
					structuredContent: {
						table: null,
						chinese_name: null,
						database: null,
						schema: null,
						description: null,
						primary_key: null,
						business_domain: null,
						fields: [],
						relations: [],
						known_issues: [],
					},
				};
			}
			const text = tableDocMarkdown(doc);
			const structured = {
				table: doc.table,
				chinese_name: doc.chineseName,
				database: doc.database,
				schema: doc.schema,
				description: doc.description,
				primary_key: doc.primaryKey ?? null,
				business_domain: doc.businessDomain ?? null,
				fields: doc.fields.map((f) => ({
					name: f.name,
					type: f.type,
					nullable: f.nullable,
					is_primary_key: f.isPrimaryKey,
					chinese_name: f.chineseName ?? null,
					description: f.description ?? null,
					sample: f.sample ?? null,
					status: f.status ?? null,
					enum: f.enum ?? null,
				})),
				relations: doc.relations,
				known_issues: doc.knownIssues,
			};
			const content = [{ type: "text" as const, text }];
			if (include_raw && doc.raw) {
				content.push({
					type: "text" as const,
					text: `\n\n--- RAW MARKDOWN ---\n${doc.raw}`,
				});
			}
			return { content, structuredContent: structured };
		},
	);

	// ---- qc_list_tables ----
	names.push("qc_list_tables");
	server.registerTool(
		"qc_list_tables",
		{
			title: "列出 QC 数据表",
			description: `分页列出数据字典收录的表，可按 video_management 或 WIN_DOUYIN 数据库筛选。

Args:
  - database (enum, optional): 数据库过滤
  - limit (number): 每页数量 1-50（默认 30）
  - offset (number): 分页偏移（默认 0）

Returns:
  - total 总数、count 当前页条数、offset、has_more、next_offset、tables 列表
`,
			inputSchema: {
				database: databaseSchema.optional().describe("数据库过滤"),
				limit: z.number().int().min(1).max(50).default(30).describe("每页数量"),
				offset: z.number().int().min(0).default(0).describe("分页偏移"),
			},
			outputSchema: {
				total: z.number().describe("总表数"),
				count: z.number().describe("当前页条数"),
				offset: z.number().describe("偏移"),
				limit: z.number().describe("每页数量"),
				has_more: z.boolean().describe("是否还有更多"),
				next_offset: z.number().optional().describe("下一页偏移，无更多时为 undefined"),
				tables: z
					.array(
						z.object({
							table: z.string().describe("表名"),
							chinese_name: z.string().describe("中文表名"),
							database: z.enum(DATABASES).describe("所属数据库"),
							primary_key: z.string().nullable().describe("主键，可能为 null"),
							field_count: z.number().describe("字段数"),
						}),
					)
					.describe("当前页表列表"),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ database, limit, offset }) => {
			const all = index.all(database);
			const page = all.slice(offset, offset + limit);
			const tables = page.map((t) => ({
				table: t.table,
				chinese_name: t.chineseName,
				database: t.database,
				primary_key: t.primaryKey ?? null,
				field_count: t.fields.length,
			}));
			const hasMore = offset + page.length < all.length;
			let text: string;
			if (tables.length === 0) {
				const scope = database ? `数据库 ${database} ` : "";
				text = `没有匹配${scope}的表。`;
			} else {
				const rows = tables.map((table) => {
					const primaryKey = table.primary_key
						? `, 主键 ${table.primary_key}`
						: "";
					return `- **${table.table}** · ${table.chinese_name} (\`${table.database}\`${primaryKey}, ${table.field_count} 字段)`;
				});
				const more = hasMore
					? `还有更多，使用 offset=${offset + limit} 继续。`
					: "";
				text = [
					`共 ${all.length} 张表（显示 ${offset + 1}-${offset + page.length}）`,
					"",
					...rows,
					"",
					more,
				]
					.filter(Boolean)
					.join("\n");
			}
			return {
				content: [{ type: "text", text }],
				structuredContent: {
					total: all.length,
					count: tables.length,
					offset,
					limit,
					has_more: hasMore,
					next_offset: hasMore ? offset + limit : undefined,
					tables,
				},
			};
		},
	);

	// ---- qc_query_database ----
	names.push("qc_query_database");
	server.registerTool(
		"qc_query_database",
		{
			title: "只读查询 QC 数据库",
			description: `对 video_management 或 WIN_DOUYIN 执行单条只读 SELECT/CTE 查询。仅在问题需要真实数据库数据时使用；先查字典了解表结构再写 SQL。

Args:
  - database (enum): 目标数据库
  - query (string): 只读 SQL，必须以 SELECT 或 WITH 开头；禁止 INSERT/UPDATE/DELETE/DDL/EXEC
  - max_rows (number): 结果行数上限 1-500（默认 100）

Returns:
  - 对齐文本表格 + columns/rows 结构化数据

Examples:
  - 查品线 -> database="video_management", query="SELECT TOP 5 PROD_ID, PROD_NAME FROM QC_MONTAGE_PRODUCT"
  - 查竞品素材 -> database="WIN_DOUYIN", query="SELECT TOP 3 vid, title FROM 云图创意元素洞察_素材详情"
`,
			inputSchema: {
				database: databaseSchema.describe("目标数据库"),
				query: z
					.string()
					.min(6, "查询太短")
					.max(20000, "查询过长")
					.describe("只读 SELECT/CTE 语句"),
				max_rows: z
					.number()
					.int()
					.min(1)
					.max(500)
					.default(100)
					.describe("结果行数上限"),
			},
			outputSchema: {
				database: z.enum(DATABASES).describe("目标数据库"),
				columns: z.array(z.string()).describe("列名"),
				rows: z.array(z.record(z.string(), z.unknown())).describe("数据行"),
				row_count: z.number().describe("行数"),
				truncated: z.boolean().describe("是否被行数上限截断"),
				duration_ms: z.number().describe("执行耗时毫秒"),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ database, query, max_rows }) => {
			try {
				const result = await runQuery(database, query, max_rows);
				let text = result.text;
				if (result.truncated) text += `\n(已达 ${max_rows} 行上限，结果被截断)`;
				text += `\n(${result.rowCount} 行, ${result.durationMs}ms)`;
				return {
					content: [{ type: "text", text }],
					structuredContent: {
						database: result.database,
						columns: result.columns,
						rows: result.rows,
						row_count: result.rowCount,
						truncated: result.truncated,
						duration_ms: result.durationMs,
					},
				};
			} catch (e) {
				const text = errorText(e);
				// Guard against extremely long error text
				return {
					content: [
						{
							type: "text",
							text:
								text.length > CHARACTER_LIMIT
									? text.slice(0, CHARACTER_LIMIT)
									: text,
						},
					],
					isError: true,
				};
			}
		},
	);

	// ---- qc_recommend_table ----
	names.push("qc_recommend_table");
	server.registerTool(
		"qc_recommend_table",
		{
			title: "推荐 QC 表",
			description: `根据业务问题推荐最合适的 QC 表，并给出命中理由（描述/业务域/字段）。适合在不确定用哪张表时先用它定位，再用 qc_get_table_doc 看结构。

Args:
  - question (string): 业务问题，如「护舒宝品线每天的消耗和 ROI」
  - top_k (number): 返回候选数 1-10（默认 5）

Returns:
  - 候选表（含理由）、关联表提示
`,
			inputSchema: {
				question: z.string().min(2).max(1000).describe("业务问题描述"),
				top_k: z.number().int().min(1).max(10).default(5).describe("候选数"),
			},
			outputSchema: {
				question: z.string().describe("业务问题"),
				count: z.number().describe("推荐数"),
				recommendations: z
					.array(
						z.object({
							table: z.string().describe("表名"),
							chinese_name: z.string().describe("中文表名"),
							database: z.enum(DATABASES).describe("所属数据库"),
							reasons: z.array(z.string()).describe("推荐理由"),
							relations: z.array(z.string()).describe("关联表名"),
						}),
					)
					.describe("推荐表列表"),
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ question, top_k }) => {
			const recs = index.recommend(question, top_k);
			if (recs.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "无法根据该问题推荐表，试试换种描述或用 qc_search_table_docs 搜索。",
						},
					],
					structuredContent: { question, count: 0, recommendations: [] },
				};
			}
			const text = [
				`根据问题「${question}」推荐的表：`,
				"",
				...recs.map((r, i) => {
					const rels = index
						.getByName(r.table)
						?.relations?.map((rel) => rel.target)
						.filter((t) => t !== "—")
						.slice(0, 3);
					const relNote = rels?.length ? ` 关联:${rels.join("、")}` : "";
					return `${i + 1}. **${r.table}** · ${r.chineseName} (\`${r.database}\`)\n   - 理由: ${r.reasons.join("；")}${relNote}`;
				}),
			].join("\n");
			return {
				content: [{ type: "text", text }],
				structuredContent: {
					question,
					count: recs.length,
					recommendations: recs.map((r) => ({
						table: r.table,
						chinese_name: r.chineseName,
						database: r.database,
						reasons: r.reasons,
						relations:
							index.getByName(r.table)?.relations?.map((rel) => rel.target) ??
							[],
					})),
				},
			};
		},
	);

	return names;
}
