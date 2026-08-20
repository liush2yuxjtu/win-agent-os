#!/usr/bin/env -S npx tsx
/**
 * 追投状态深度分析 —— 只读输出六类追投业务视图。
 *
 * 用法：
 *   tsx .../status-analysis.ts                         # 全部视图
 *   tsx .../status-analysis.ts --view=status           # 四态分布
 *   tsx .../status-analysis.ts --view=exceptions       # 违规/漏追投清单
 *   tsx .../status-analysis.ts --view=cost             # 基础 vs 追投消耗
 *   tsx .../status-analysis.ts --view=global-type      # 推直播/推商品拆分
 *   tsx .../status-analysis.ts --view=top              # 追投消耗 Top N
 *   tsx .../status-analysis.ts --view=one-hour         # 1 小时净成交口径
 *   tsx .../status-analysis.ts --view=all --top=20
 */
import { executeReadonlyQuery, closeDb } from "../../../src/db.js";

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((arg) => arg.startsWith("--"))
		.map((arg) => {
			const match = arg.match(/^--([\w-]+)(?:=(.*))?$/);
			return match ? [match[1], match[2] ?? true] : null;
		})
		.filter((entry) => entry !== null),
);

const view = String(args.view ?? "all");
const top = Math.min(100, Math.max(1, Number(args.top ?? 20) || 20));
const options = { allowCrossDb: ["WIN_DOUYIN"] };

async function query(
	sql: string,
	parameters: Record<string, string | number | boolean | null> = {},
) {
	return executeReadonlyQuery(sql, parameters, 500, options);
}

async function main() {
	const latestCtrlTypeDate = (
		await query(
			`SELECT MAX(STAT_TIME) AS d
			   FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
			  WHERE CONTROL_TYPE IS NOT NULL`,
		)
	)[0]?.d;

	if (!latestCtrlTypeDate) {
		console.log(
			JSON.stringify(
				{
					status: "BLOCKED",
					reason: "外部表没有 CONTROL_TYPE 已回填日期",
				},
				null,
				2,
			),
		);
		await closeDb();
		return;
	}

	const readiness = await query(
		`SELECT STAT_TIME, COUNT_BIG(*) AS total,
		        SUM(CASE WHEN CONTROL_TYPE IS NOT NULL THEN 1 ELSE 0 END) AS has_control_type
		   FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
		  WHERE STAT_TIME BETWEEN DATEADD(day, -6, @d) AND @d
		  GROUP BY STAT_TIME
		  ORDER BY STAT_TIME DESC`,
		{ d: latestCtrlTypeDate as string },
	);

	const output: Record<string, unknown> = {
		status: "READY",
		latestCtrlTypeDate,
		readiness,
		controlTypeDictionary: {
			1: "正常追投（达到标准且已追投）",
			2: "违规追投（未达到标准但追投）",
			3: "漏追投（达到标准但未追投）",
			4: "未追投（未达到标准且未追投）",
		},
	};

	if (view === "all" || view === "status" || view === "cost") {
		const distribution = await query(
			`SELECT CONTROL_TYPE, COUNT_BIG(*) AS material_rows,
			        SUM(COALESCE(STAT_COST_FOR_ROI2, 0)) AS overall_cost,
			        SUM(COALESCE(BASIC_STAT_COST_FOR_ROI2, 0)) AS base_cost,
			        SUM(COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0)) AS additional_cost,
			        CASE WHEN SUM(COALESCE(BASIC_STAT_COST_FOR_ROI2, 0) + COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0)) > 0
			             THEN SUM(COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0)) /
			                  SUM(COALESCE(BASIC_STAT_COST_FOR_ROI2, 0) + COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0))
			        END AS additional_cost_share
			   FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
			  WHERE STAT_TIME = @d AND CONTROL_TYPE IS NOT NULL
			  GROUP BY CONTROL_TYPE
			  ORDER BY CONTROL_TYPE`,
			{ d: latestCtrlTypeDate as string },
		);
		output.statusDistribution = distribution;
		output.costComparison = distribution;
	}

	if (view === "all" || view === "exceptions") {
		const exceptionColumns = `
		        CONVERT(varchar(30), ADVERTISER_ID) AS ADVERTISER_ID,
		        CONVERT(varchar(30), MATERIAL_ID) AS MATERIAL_ID,
		        MATERIAL_NAME, GLOBAL_TYPE, CONTROL_TYPE,
		        BASIC_STAT_COST_FOR_ROI2 AS base_cost,
		        ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST AS additional_cost,
		        TOTAL_PREPAY_AND_PAY_ORDER_ROI2 AS overall_pay_roi,
		        ADDITIONAL_DELIVERY_TOTAL_PREPAY_AND_PAY_ORDER_ROI2_ASSIST AS additional_pay_roi`;
		const violations = await query(
			`SELECT TOP (@top) ${exceptionColumns}
			   FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
			  WHERE STAT_TIME = @d AND CONTROL_TYPE = 2
			  ORDER BY COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0) DESC`,
			{ d: latestCtrlTypeDate as string, top },
		);
		const missed = await query(
			`SELECT TOP (@top) ${exceptionColumns}
			   FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
			  WHERE STAT_TIME = @d AND CONTROL_TYPE = 3
			  ORDER BY COALESCE(BASIC_STAT_COST_FOR_ROI2, 0) DESC`,
			{ d: latestCtrlTypeDate as string, top },
		);
		output.exceptionCandidates = {
			violationsOrdering: "CONTROL_TYPE=2，按追投消耗降序",
			violations,
			missedOrdering: "CONTROL_TYPE=3，按基础消耗降序",
			missed,
		};
	}

	if (view === "all" || view === "global-type") {
		output.globalTypeBreakdown = await query(
			`SELECT COALESCE(NULLIF(LTRIM(RTRIM(GLOBAL_TYPE)), ''), '<NULL>') AS global_type,
			        CONTROL_TYPE, COUNT_BIG(*) AS material_rows,
			        SUM(COALESCE(BASIC_STAT_COST_FOR_ROI2, 0)) AS base_cost,
			        SUM(COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0)) AS additional_cost
			   FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
			  WHERE STAT_TIME = @d AND CONTROL_TYPE IS NOT NULL
			  GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(GLOBAL_TYPE)), ''), '<NULL>'), CONTROL_TYPE
			  ORDER BY global_type, CONTROL_TYPE`,
			{ d: latestCtrlTypeDate as string },
		);
		output.globalTypeNote =
			"注解枚举写 0=推直播、1=推商品，但生产表当前存储中文值；报告真实存储值，不强行改码。";
	}

	if (view === "all" || view === "top") {
		output.topAdditionalCost = await query(
			`SELECT TOP (@top)
			        CONVERT(varchar(30), ADVERTISER_ID) AS ADVERTISER_ID,
			        CONVERT(varchar(30), MATERIAL_ID) AS MATERIAL_ID,
			        MATERIAL_NAME, GLOBAL_TYPE, CONTROL_TYPE,
			        BASIC_STAT_COST_FOR_ROI2 AS base_cost,
			        ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST AS additional_cost,
			        CASE WHEN COALESCE(BASIC_STAT_COST_FOR_ROI2, 0) + COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0) > 0
			             THEN COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0) /
			                  (COALESCE(BASIC_STAT_COST_FOR_ROI2, 0) + COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0))
			        END AS additional_cost_share
			   FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
			  WHERE STAT_TIME = @d AND CONTROL_TYPE IS NOT NULL
			  ORDER BY COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0) DESC`,
			{ d: latestCtrlTypeDate as string, top },
		);
	}

	if (view === "all" || view === "one-hour") {
		output.oneHourSettlement = await query(
			`SELECT CONTROL_TYPE, COUNT_BIG(*) AS material_rows,
			        SUM(CASE WHEN additional_delivery_total_prepay_and_pay_settle_roi2_1h_assist IS NOT NULL THEN 1 ELSE 0 END) AS has_additional_roi_1h,
			        SUM(CASE WHEN TOTAL_PREPAY_AND_PAY_SETTLE_OVERALL_ROI2_1H IS NOT NULL THEN 1 ELSE 0 END) AS has_overall_roi_1h,
			        SUM(COALESCE(additional_delivery_total_order_settle_amount_for_roi2_1h_assist, 0)) AS additional_settle_amount_1h,
			        SUM(COALESCE(additional_delivery_total_order_settle_count_for_roi2_1h_assist, 0)) AS additional_settle_orders_1h,
			        CASE WHEN SUM(COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0)) > 0
			             THEN SUM(COALESCE(additional_delivery_total_prepay_and_pay_settle_roi2_1h_assist, 0) * COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0)) /
			                  SUM(COALESCE(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST, 0))
			        END AS weighted_additional_roi_1h,
			        CASE WHEN SUM(COALESCE(STAT_COST_FOR_ROI2, 0)) > 0
			             THEN SUM(COALESCE(TOTAL_PREPAY_AND_PAY_SETTLE_OVERALL_ROI2_1H, 0) * COALESCE(STAT_COST_FOR_ROI2, 0)) /
			                  SUM(COALESCE(STAT_COST_FOR_ROI2, 0))
			        END AS weighted_overall_roi_1h
			   FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
			  WHERE STAT_TIME = @d AND CONTROL_TYPE IS NOT NULL
			  GROUP BY CONTROL_TYPE
			  ORDER BY CONTROL_TYPE`,
			{ d: latestCtrlTypeDate as string },
		);
		output.oneHourNote =
			"ROI 使用对应消耗加权，避免用简单 AVG 夸大低消耗样本；小写 additional_delivery_*_1h_assist 字段不可漏掉。";
	}

	output.safety = "只读 SELECT；结果是诊断和人工复核依据，不执行追投、不写库。";
	console.log(JSON.stringify(output, null, 2));
	await closeDb();
}

main().catch(async (error) => {
	console.error(
		"ERR:",
		error instanceof Error ? error.message.split("\n")[0] : error,
	);
	await closeDb().catch(() => undefined);
	process.exit(1);
});
