import { defineEval } from "eve/evals";

/**
 * 看板基础款 KPI 分层设计回归：恢复基础款后 KPI 卡必须是
 * 「muted label → h2 大数字 → outline Badge」分层结构。
 *
 * 覆盖：default-spec(KPI 卡分层改造)不被未来改动回归为平铺 title/description；
 * dataRef 契约(FIXED_QUERY_IDS)在 spec 中生效。
 */
export default defineEval({
	description: "看板基础款 KPI 分层结构(dashboard__read 返回分层卡)",
	async test(t) {
		await t.send(
			"无论当前布局是否已是基础款，都直接读取基础款 spec 并调用 render_ui 预览，不要追问",
		);

		t.succeeded();
		t.calledTool("dashboard__read");

		// 渲染出的基础款 spec 必须含分层元素(k0Value Heading 大数字 + k0Delta Badge)
		t.calledTool("render_ui", {
			input: {
				spec: (value) => {
					const spec = String(value);
					const layeredKpi =
						/k0Value/.test(spec) &&
						/"type":\s*"Heading"/.test(spec) &&
						/k0Delta/.test(spec) &&
						/"type":\s*"Badge"/.test(spec);
					const noFlatTitle =
						!/"title":\s*\{\s*"\$template":\s*"\$\{?\/kpis\/0\/value/.test(
							spec,
						);
					const contractQueryId =
						/fixed:anchor|fixed:daily|fixed:topMaterials|fixed:insights/.test(
							spec,
						);
					return layeredKpi && noFlatTitle && contractQueryId;
				},
			},
		});
		t.noFailedActions();
	},
});
