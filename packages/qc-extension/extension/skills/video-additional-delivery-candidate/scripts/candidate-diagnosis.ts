#!/usr/bin/env -S npx tsx
/**
 * 追投候选诊断 —— 只读盘点"达到追投门槛的素材候选" + 追投状态统计 + 数据就绪诊断。
 * 用法:
 *   tsx skills/video-additional-delivery-candidate/scripts/candidate-diagnosis.ts --brand 1            # 好奇品牌, 最新 1 个周窗口
 *   tsx skills/video-additional-delivery-candidate/scripts/candidate-diagnosis.ts --prod 1 --weeks 2   # 品线 1, 最近 2 个周窗口
 *   tsx skills/video-additional-delivery-candidate/scripts/candidate-diagnosis.ts --status             # 外部表 CONTROL_TYPE 追投状态分布(真实口径)
 *   tsx skills/video-additional-delivery-candidate/scripts/candidate-diagnosis.ts --list               # 列出品线/品牌
 */
import { executeReadonlyQuery, closeDb } from "../../../src/db.js";

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((a) => /^--/.test(a))
		.map((a) => {
			const m = a.match(/^--(\w+)(?:=(.*))?$/);
			return m ? [m[1], m[2] ?? true] : null;
		})
		.filter((e) => e !== null),
);

interface Threshold {
	brandId: number;
	prodId: number;
	prodName: string;
	roiBaseline: number;
	dailySpendBaseline: number;
}

function argInt(key: string, fallback: number): number {
	const v = args[key];
	return v === undefined ? fallback : Number(v);
}

async function main() {
	// 追投状态统计（外部表真实口径）
	if (args.status !== undefined) {
		const latest = (
			await executeReadonlyQuery(
				`SELECT MAX(STAT_TIME) AS d FROM WIN_DOUYIN.dbo.千川素材数据_素材列表 WHERE CONTROL_TYPE IS NOT NULL`,
				{},
				500,
				{ allowCrossDb: ["WIN_DOUYIN"] },
			)
		)[0]?.d;
		const byDay = await executeReadonlyQuery(
			`SELECT STAT_TIME, COUNT_BIG(*) AS total,
                    SUM(CASE WHEN CONTROL_TYPE IS NOT NULL THEN 1 ELSE 0 END) AS has_ct
               FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
              WHERE STAT_TIME >= DATEADD(day, -6, @d) AND STAT_TIME <= @d
              GROUP BY STAT_TIME ORDER BY STAT_TIME DESC`,
			{ d: latest as string },
			500,
			{ allowCrossDb: ["WIN_DOUYIN"] },
		);
		const dist = await executeReadonlyQuery(
			`SELECT CONTROL_TYPE, COUNT_BIG(*) AS n,
                    SUM(BASIC_STAT_COST_FOR_ROI2) AS base_cost,
                    SUM(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST) AS add_cost
               FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
              WHERE STAT_TIME = @d AND CONTROL_TYPE IS NOT NULL
              GROUP BY CONTROL_TYPE ORDER BY CONTROL_TYPE`,
			{ d: latest as string },
			500,
			{ allowCrossDb: ["WIN_DOUYIN"] },
		);
		console.log(
			JSON.stringify(
				{
					status: latest ? "READY" : "BLOCKED",
					latestCtrlTypeDate: latest,
					last7Days: byDay,
					distribution: dist,
					note: "CONTROL_TYPE: 1=正常追投 2=违规追投 3=漏追投 4=未追投; 口径 WIN_DOUYIN.dbo.千川素材数据_素材列表",
				},
				null,
				2,
			),
		);
		await closeDb();
		return;
	}

	if (args.list !== undefined) {
		const rows = await executeReadonlyQuery(
			`SELECT p.BRAND_ID, p.PROD_ID, p.PROD_NAME, p.STATE, p.ROI_QUALIFIED_BASELINE, p.DAILY_SPEND_BASELINE
         FROM dbo.QC_MONTAGE_PRODUCT p WHERE p.STATE='1' ORDER BY p.BRAND_ID, p.PROD_ID`,
		);
		console.log(JSON.stringify(rows, null, 2));
		await closeDb();
		return;
	}

	const prodId = args.prod ? argInt("prod", 0) : 0;
	const brandId = args.brand ? argInt("brand", 0) : 0;
	const weeks = Math.max(1, argInt("weeks", 1));
	if (!prodId && !brandId)
		throw new Error("需要 --brand <id> 或 --prod <id>（--list 可看品线）");
	const scopeId = prodId || brandId;

	// 1) 最近周窗口（最多 weeks 个，按 start 升序；取最早 start .. 最晚 end 为诊断窗）
	const win = await executeReadonlyQuery(
		`SELECT TOP (@weeks) STAT_START_TIME AS [start], STAT_END_TIME AS [end], COUNT_BIG(*) AS rows_n
       FROM dbo.QC_HOT_REMAKE_PROMO
      WHERE STAT_END_TIME < '2999-01-01'
        AND STAT_END_TIME >= STAT_START_TIME
      GROUP BY STAT_START_TIME, STAT_END_TIME
      ORDER BY STAT_START_TIME DESC`,
		{ weeks },
	);
	if (!win.length) throw new Error("QC_HOT_REMAKE_PROMO 无窗口数据");
	const wStart = win[win.length - 1].start as string;
	const wEnd = win[0].end as string;
	// STAT_START_TIME / STAT_END_TIME 都是包含端点的业务日期。
	// 例如 07-20~07-26 是 7 天，不能只取时间差 6 天。
	const days = Math.max(
		1,
		Math.floor(
			(new Date(wEnd as string).getTime() -
				new Date(wStart as string).getTime()) /
				86400000,
		) + 1,
	);
	const wStartIso = new Date(wStart as string).toISOString();
	const wEndIso = new Date(wEnd as string).toISOString();

	// 2) 门槛（品线级或品牌级）
	const thresholds = (await executeReadonlyQuery(
		`SELECT p.BRAND_ID AS brandId, p.PROD_ID AS prodId, p.PROD_NAME AS prodName,
                p.ROI_QUALIFIED_BASELINE AS roiBaseline, p.DAILY_SPEND_BASELINE AS dailySpendBaseline
           FROM dbo.QC_MONTAGE_PRODUCT p
          WHERE ${prodId ? "p.PROD_ID" : "p.BRAND_ID"} = @id AND p.STATE='1'`,
		{ id: scopeId },
	)) as unknown as Threshold[];
	if (!thresholds.length)
		throw new Error(
			`未找到${prodId ? "品线" : "品牌"}(id=${scopeId})的 STATE='1' 配置`,
		);

	// 3) 候选盘点
	const candidates = await executeReadonlyQuery(
		`SELECT DISTINCT p.BRAND_ID, p.PROD_ID, p.PROD_NAME,
            h.DATA_ID,
            CONVERT(varchar(30), m.ADVERTISER_ID) AS ADVERTISER_ID,
            CONVERT(varchar(30), m.MATERIAL_ID) AS MATERIAL_ID,
            h.FILENAME,
            h.STAT_START_TIME, h.STAT_END_TIME,
            h.COST AS cost, h.ROI AS roi, h.CTR AS ctr, h.CVR AS cvr, h.FIN_RATE AS fin_rate,
            p.ROI_QUALIFIED_BASELINE AS roi_baseline,
            p.DAILY_SPEND_BASELINE AS daily_spend_baseline
       FROM dbo.QC_HOT_REMAKE_PROMO h
       JOIN (
            SELECT DISTINCT VIDEO_ID, PROD_ID
              FROM dbo.QC_MONTAGE_VIDEO_PROD_TAG
             WHERE STATE='1'
       ) t ON h.DATA_ID = t.VIDEO_ID
       JOIN dbo.QC_MONTAGE_PRODUCT p ON t.PROD_ID = p.PROD_ID AND p.STATE='1'
       LEFT JOIN dbo.QC_MONTAGE_MATERIAL_VIDEO_DATA m ON h.DATA_ID = m.ID
      WHERE ${prodId ? "t.PROD_ID" : "p.BRAND_ID"} = @id
        AND h.STAT_START_TIME >= @start AND h.STAT_START_TIME < @end
        AND h.ROI >= p.ROI_QUALIFIED_BASELINE
        AND h.COST >= p.DAILY_SPEND_BASELINE * @days
        AND h.COST > 0
      ORDER BY h.COST DESC`,
		{ id: scopeId, start: wStartIso, end: wEndIso, days },
	);

	// 4) 就绪诊断：窗口内覆盖 + 台账关联率
	const cov = await executeReadonlyQuery(
		`WITH scoped AS (
            SELECT DISTINCT h.DATA_ID, t.PROD_ID, h.COST
              FROM dbo.QC_HOT_REMAKE_PROMO h
              JOIN (
                   SELECT DISTINCT VIDEO_ID, PROD_ID
                     FROM dbo.QC_MONTAGE_VIDEO_PROD_TAG
                    WHERE STATE='1'
              ) t ON h.DATA_ID = t.VIDEO_ID
              JOIN dbo.QC_MONTAGE_PRODUCT p ON t.PROD_ID = p.PROD_ID AND p.STATE='1'
             WHERE ${prodId ? "t.PROD_ID" : "p.BRAND_ID"} = @id
               AND h.STAT_START_TIME >= @start AND h.STAT_START_TIME < @end
       )
       SELECT COUNT_BIG(*) AS total,
              SUM(CASE WHEN s.COST>0 THEN 1 ELSE 0 END) AS cost_pos,
              SUM(CASE WHEN d.ID IS NOT NULL THEN 1 ELSE 0 END) AS matched
         FROM scoped s
         LEFT JOIN dbo.QC_MONTAGE_MATERIAL_VIDEO_DATA d ON s.DATA_ID = d.ID`,
		{ id: scopeId, start: wStartIso, end: wEndIso },
	);

	await closeDb();

	const total = Number(cov[0]?.total ?? 0);
	const costPos = Number(cov[0]?.cost_pos ?? 0);
	const matched = Number(cov[0]?.matched ?? 0);

	// 5) 断言自检
	const asserts = [
		{ name: "窗口非空", pass: win.length > 0 },
		{
			name: "候选每条达标(ROI>=基线, 消耗>=日基线×天数, COST>0)",
			pass: candidates.every(
				(r) =>
					Number(r.roi) >= Number(r.roi_baseline) &&
					Number(r.cost) >= Number(r.daily_spend_baseline) * days &&
					Number(r.cost) > 0,
			),
		},
		{
			name: "候选命中诊断窗口",
			pass: candidates.every(
				(r) =>
					new Date(r.STAT_START_TIME as string) >= new Date(wStart as string),
			),
		},
		{
			name: "门槛配置齐全",
			pass: thresholds.every(
				(t) => t.roiBaseline != null && t.dailySpendBaseline != null,
			),
		},
	];

	const out = {
		status: total === 0 ? "BLOCKED" : "READY",
		diagnosis: {
			windowStart: wStart,
			windowEnd: wEnd,
			windowDays: days,
			scopedRows: total,
			costPositiveRows: costPos,
			dataTableMatchRate: total ? +((matched / total) * 100).toFixed(1) : 0,
			thresholdsCount: thresholds.length,
		},
		thresholds,
		candidates: candidates.map((r) => ({
			prodId: Number(r.PROD_ID),
			prodName: r.PROD_NAME,
			dataId: Number(r.DATA_ID),
			advertiserId: r.ADVERTISER_ID ?? null,
			materialId: r.MATERIAL_ID ?? null,
			filename: r.FILENAME ?? null,
			windowStart: r.STAT_START_TIME,
			windowEnd: r.STAT_END_TIME,
			cost: Number(r.cost),
			roi: Number(r.roi),
			ctr: r.ctr,
			cvr: r.cvr,
			finRate: r.fin_rate,
			roiBaseline: Number(r.roi_baseline),
			dailySpendBaseline: Number(r.daily_spend_baseline),
		})),
		asserts,
		allAssertsPass: asserts.every((a) => a.pass),
		note: "启发式候选（本地周窗口口径）；正式追投状态可用 --status 查外部表 千川素材数据_素材列表。",
	};
	console.log(JSON.stringify(out, null, 2));
	process.exit(out.allAssertsPass ? 0 : 2);
}

main().catch((e) => {
	console.error("ERR:", e instanceof Error ? e.message.split("\n")[0] : e);
	process.exit(1);
});
