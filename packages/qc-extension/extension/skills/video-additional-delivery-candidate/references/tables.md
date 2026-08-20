# 追投候选诊断 · 数据契约与口径（已实测验证）

验证时间：2026-08-10（生产 SQL Server 直连实测）。

## 表契约

### QC_MONTAGE_PRODUCT（品线及追投门槛配置，114 行）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| PROD_ID | numeric | 品线 ID（1=T5桃桃, 2=T6小森林, 3=T6.6深睡…） |
| PROD_NAME | nvarchar | 品线名 |
| BRAND_ID | numeric | 品牌 ID（1=好奇, 3=高洁丝…） |
| STATE | nvarchar | '1'=启用 |
| ROI_QUALIFIED_BASELINE | decimal | ROI 合格基线（如 5 / 3.5 / 2） |
| DAILY_SPEND_BASELINE | decimal | 日消耗基线（如 100） |
| DEFAUT_ADVERTISER_ID | numeric | 默认广告主 |

### QC_HOT_REMAKE_PROMO（素材周期表现，6,764 行；周窗口快照）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| ID | numeric | 主键 |
| DATA_ID | numeric | → QC_MONTAGE_MATERIAL_VIDEO_DATA.ID（关联率 ~75%，5045/6764） |
| PROD_ID | numeric | 品线（存在 PROD_ID=0 未归属行） |
| FILENAME / VIDEO_OSS_URL | nvarchar | 素材名 / OSS 地址 |
| MATERIAL_TYPE | nvarchar | '0'/'1' |
| STAT_START_TIME / STAT_END_TIME | datetime | 周窗口（如 2026-07-20 ~ 07-26）；偶见 2999-12-31 open 记录，样本极少 |
| COST | numeric | 窗口消耗 |
| ROI / CTR / CVR / FIN_RATE / FIN_RATE_3 | numeric | 窗口表现指标 |

**窗口分布实测（2026-08-10）**：最新窗口 2026-07-20~07-26（1,326 行）；历史窗口 06-08~07-19 各 491~919 行。open(2999) 记录在好奇品牌下仅 9 行且 ROI 达标为 0 → **默认只用周窗口**。

### QC_MONTAGE_VIDEO_PROD_TAG（素材—品线归属，70,652 行）

ID / VIDEO_ID（→素材 ID）/ PROD_ID / STATE（'1'=有效）。HOT_REMAKE 归属率 ~77%（5177/6764）。

### QC_MONTAGE_MATERIAL_VIDEO_DATA（素材台账，111,919 行）

ID / ADVERTISER_ID / MATERIAL_ID / V_ID / FILENAME / CREATE_TIME / IS_CUT / PROD_TAGS / PROD_TAG_CONFIG / …

## 口径要点

1. 候选 = ROI ≥ ROI_QUALIFIED_BASELINE **且** COST ≥ DAILY_SPEND_BASELINE × 包含首尾日的窗口天数 **且** COST > 0；候选按 DATA_ID + PROD_ID + 窗口去重。
2. 最近窗口：`MAX(STAT_START_TIME)`；事实截止日 = 该窗口 `MAX(STAT_END_TIME)`。
3. 关联/归属非 100%，输出必须报覆盖率。
4. 正式追投状态 = 外部表 `WIN_DOUYIN.dbo.千川素材数据_素材列表` 的 CONTROL_TYPE（1 正常/2 违规/3 漏/4 未追投），需先找 `MAX(STAT_TIME) WHERE CONTROL_TYPE IS NOT NULL` 再统计。回填会持续推进，历史文档里的日期不能当作当前事实。

## 追投效果字段与业务术语

| 业务术语 | 字段 | 说明 |
| --- | --- | --- |
| 整体消耗 | `STAT_COST_FOR_ROI2` | 素材整体投放消耗；不要直接当作基础消耗 |
| 基础消耗 | `BASIC_STAT_COST_FOR_ROI2` | 不含追投调控的基础投放消耗 |
| 追投消耗 | `ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST` | 追投调控消耗 |
| 追投支付 ROI | `ADDITIONAL_DELIVERY_TOTAL_PREPAY_AND_PAY_ORDER_ROI2_ASSIST` | 追投支付口径 ROI，非 1h 净成交 ROI |
| 追投成交金额 | `ADDITIONAL_DELIVERY_TOTAL_PAY_ORDER_GMV_INCLUDE_COUPON_FOR_ROI2_ASSIST` | 含优惠券的追投成交金额 |
| 追投成交订单数 | `ADDITIONAL_DELIVERY_TOTAL_PAY_ORDER_COUNT_FOR_ROI2_ASSIST` | 追投支付口径订单数 |
| 整体净成交 ROI（1h） | `TOTAL_PREPAY_AND_PAY_SETTLE_OVERALL_ROI2_1H` | 整体 1 小时净成交口径 |
| 追投净成交金额（1h） | `additional_delivery_total_order_settle_amount_for_roi2_1h_assist` | 小写字段，容易漏检 |
| 追投净成交 ROI（1h） | `additional_delivery_total_prepay_and_pay_settle_roi2_1h_assist` | 小写字段，ROI 聚合需按追投消耗加权 |
| 追投净成交订单数（1h） | `additional_delivery_total_order_settle_count_for_roi2_1h_assist` | 小写字段 |
| 追投转化率（1h） | `additional_delivery_convert_rate_for_roi2_1h_assist` | 小写字段 |
| 投放场景 | `GLOBAL_TYPE` | 注解写 0=推直播/1=推商品；生产数据可能存中文值，查询结果优先 |

追投消耗占比由 `追投消耗 / (基础消耗 + 追投消耗)` 现场计算。千川表没有现成的追投排名字段；不要使用云图 `COST_RANK` 冒充追投排名。

## Gold 对照（现有资产）

- business-terms.csv #44：追投状态与追投消耗 = 描述素材是否追加投放，基础/追加投放规模的运营指标；标准口径按追投状态分组比较基础消耗与追加消耗。
- schema-fields.csv 697-708：CONTROL_TYPE 枚举（1 正常追投 / 2 违规 / 3 漏 / 4 未追投）、ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST（追投调控消耗）、BASIC_STAT_COST_FOR_ROI2（基础消耗）等，全 VERIFIED_DOCUMENT。
- 生产口径：materia-analytics `MontageConsumptionDetailsReportHandler` 拆分 base_cost / add_cost，算 1d/3d/7d 平均追投成本与 ROI。
- DB Gold：SQL-M02/M04/M11-M14/M23 共 7 条曾标 BLOCKED；**实测 SQL-M23（追投状态与追投消耗）跨库可查，应可解封**，其余 6 条需逐一验证。

## 验证 SQL（可复跑）

```sql
-- 最近窗口
SELECT MAX(STAT_START_TIME) FROM dbo.QC_HOT_REMAKE_PROMO;
-- 候选盘点（好奇品牌, 最新周窗口）
SELECT p.PROD_NAME, h.DATA_ID, h.FILENAME, h.ROI, h.COST,
       p.ROI_QUALIFIED_BASELINE, p.DAILY_SPEND_BASELINE
FROM dbo.QC_HOT_REMAKE_PROMO h
JOIN dbo.QC_MONTAGE_VIDEO_PROD_TAG t ON h.DATA_ID = t.VIDEO_ID AND t.STATE='1'
JOIN dbo.QC_MONTAGE_PRODUCT p ON t.PROD_ID = p.PROD_ID AND p.STATE='1'
WHERE p.BRAND_ID = 1
  AND h.STAT_START_TIME = (SELECT MAX(STAT_START_TIME) FROM dbo.QC_HOT_REMAKE_PROMO)
  AND h.ROI >= p.ROI_QUALIFIED_BASELINE
  AND h.COST >= p.DAILY_SPEND_BASELINE * 7
  AND h.COST > 0
ORDER BY h.COST DESC;
```
