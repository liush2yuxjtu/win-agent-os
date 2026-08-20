---
name: video-additional-delivery-candidate
description: 视频追投候选、追投异常与追投效果诊断。用户问”哪些素材该追投/达到门槛””追投候选/名单/盘点””正常追投/违规追投/漏追投/错误追投””基础消耗与追投消耗””追投消耗占比/排名””推直播与推商品追投差异””追投 ROI/成交/订单/1 小时净成交口径”时都应触发，即使没有说 skill 名。只读查询生产 SQL Server：先动态发现最新已回填日期和有效周窗口，再按 CONTROL_TYPE 统计真实状态、列异常素材、拆基础与追投消耗、比较 GLOBAL_TYPE 与 1h assist 指标，并按品线动态门槛盘点候选；绝不硬编码历史日期、执行投放或写库。
suggest: 盘点达到追投门槛的素材候选
compatibility: 需要生产 SQL Server（video-managmenet-chat 的 DB.md 连接）与 tsx；脚本 scripts/candidate-diagnosis.ts 一键执行。
---

# 追投候选诊断（Additional-Delivery Candidate）

本 Skill 是 `video-media-decision` 的最小切片：只做**追投状态统计 + 候选盘点**，不做停投/预算/金额建议。

## 目标

1. **追投状态与异常诊断**（真实口径）：按 `CONTROL_TYPE` 统计正常/违规/漏/未追投，列出违规追投和漏追投的素材级证据。
2. **追投效果拆解**：比较基础消耗与追投消耗、追投消耗占比/排名、推直播与推商品差异，以及支付 ROI 与 1 小时净成交 assist 口径。
3. **候选盘点**（启发式）：给定**品牌或品线 + 观察窗口**（默认最近 1 个完整周窗口），盘点达到动态品线门槛的唯一素材候选。
4. 所有结果都先做数据就绪诊断，并把“正式 `CONTROL_TYPE` 状态”与“ROI+消耗启发式候选”分开说明。

## 数据路径（全部已验证可查，含跨库）

| 表 | 用途 | 关键列 |
| --- | --- | --- |
| `WIN_DOUYIN.dbo.千川素材数据_素材列表`（**外部表，跨库可访问**） | 真实追投状态、消耗、产出（正式口径） | `ADVERTISER_ID` `MATERIAL_ID` `STAT_TIME` `GLOBAL_TYPE` `CONTROL_TYPE` `STAT_COST_FOR_ROI2` `BASIC_STAT_COST_FOR_ROI2` `ADDITIONAL_DELIVERY_*_ASSIST` 及小写 `additional_delivery_*_1h_assist` |
| `QC_MONTAGE_PRODUCT` | 品线及追投门槛配置 | `PROD_ID` `PROD_NAME` `BRAND_ID` `STATE`(=1 启用) `ROI_QUALIFIED_BASELINE`(ROI 基线) `DAILY_SPEND_BASELINE`(日消耗基线) |
| `QC_HOT_REMAKE_PROMO` | 素材周窗口表现 | `DATA_ID`(→MATERIAL_VIDEO_DATA.ID) `PROD_ID` `STAT_START_TIME/STAT_END_TIME`(周窗口) `COST` `ROI` `CTR` `CVR` `FIN_RATE` |
| `QC_MONTAGE_VIDEO_PROD_TAG` | 素材—品线归属 | `VIDEO_ID` `PROD_ID` `STATE`(=1 有效) |
| `QC_MONTAGE_MATERIAL_VIDEO_DATA` | 素材台账 | `ID` `ADVERTISER_ID` `MATERIAL_ID` `V_ID` `FILENAME` |

## 必读：口径事实（先读 `references/tables.md` 再动手）

1. **外部表可跨库直接查询**：`SELECT ... FROM WIN_DOUYIN.dbo.千川素材数据_素材列表`（不需要 INFORMATION_SCHEMA 探测——它不会出现在当前库的 INFORMATION_SCHEMA 里，但跨库 SELECT 可用）。`CONTROL_TYPE` 按批次回填，日期和覆盖量会持续变化。**每次都先查最大有效日期及最近 7 天覆盖，绝不复述文档里的历史日期/样本量。**
2. **`QC_HOT_REMAKE_PROMO` 是周窗口快照**，不是逐日也不是“至今”。多个窗口并存；动态选择最新完整窗口，并排除 `STAT_END_TIME >= '2999-01-01'` 的 open 记录。窗口首尾日期都计入天数：例如 07-20~07-26 是 7 天，不是 6 天。
3. `DATA_ID → QC_MONTAGE_MATERIAL_VIDEO_DATA.ID` 与品线归属并非天然 100%。**必须现场计算覆盖率**；`QC_MONTAGE_VIDEO_PROD_TAG` 可能存在重复有效标签，关联前先 `SELECT DISTINCT VIDEO_ID, PROD_ID`，候选按 `DATA_ID + PROD_ID + 窗口` 去重。
4. `ROI_QUALIFIED_BASELINE`（如 5 / 3.5 / 2）与 `DAILY_SPEND_BASELINE`（如 100）是**品线配置**，不是自动授权。候选名单必须带上阈值来源（品线名 + 数值）。
5. 历史窗口数据不得包装成"今天"：先查最大窗口/最大日期并如实标注事实截止日。

## 执行步骤

### 1. 数据就绪诊断（先做，占输出首屏）

- 查 `QC_HOT_REMAKE_PROMO` 的 `MAX(STAT_START_TIME)` 确定最近窗口；列出窗口粒度。
- **动态查外部表最大有效日期**：`SELECT MAX(STAT_TIME) ... WHERE CONTROL_TYPE IS NOT NULL`；再查该日及最近 7 天 `CONTROL_TYPE` 非空行数/总行数。只报告本次查询结果，不沿用 SKILL.md、annotation 或旧 benchmark 里的历史日期。
- 查候选集的 `COST>0` 覆盖、`DATA_ID`→台账关联率、品线归属率。
- 若品线无配置、窗口无数据或覆盖率过低：输出 **BLOCKED** + 原因，不生成名单。

### 2. 追投状态、异常与效果分析（真实口径，外部表）

优先运行 `scripts/status-analysis.ts`，它一次性生成六类只读视图；按用户问题可用 `--view=status|exceptions|cost|global-type|top|one-hour` 缩小输出。

- **状态分布**：四个 `CONTROL_TYPE` 的样本量、基础消耗、追投消耗和追投消耗占比。
- **违规/漏追投清单**：`CONTROL_TYPE=2` 按追投消耗降序；`CONTROL_TYPE=3` 按基础消耗降序，必须列素材 ID、广告主、名称、场景与证据指标。
- **基础 vs 追投**：以 `BASIC_STAT_COST_FOR_ROI2` 与 `ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST` 拆分；不要把整体消耗、基础消耗、追投消耗混为同一字段。
- **GLOBAL_TYPE**：按生产库真实存储值分组。注解写 0/1 枚举，但生产数据可能存“推直播/推商品”中文值；现场数据优先，并注明差异。
- **追投 Top N**：按追投消耗降序，同时给 `追投消耗/(基础消耗+追投消耗)`；不要借用云图 `COST_RANK` 冒充千川追投排名。
- **1 小时口径**：区分整体 `TOTAL_PREPAY_AND_PAY_SETTLE_OVERALL_ROI2_1H` 与小写追投字段 `additional_delivery_*_1h_assist`。ROI 聚合使用对应消耗加权，不使用简单平均。

正式状态来自 `CONTROL_TYPE`，无需反推其判定公式；annotation 没有证明“达到标准”只由哪个单一阈值决定。

#### 基础状态 SQL

```sql
SELECT CONTROL_TYPE, COUNT_BIG(*) AS n,
       SUM(BASIC_STAT_COST_FOR_ROI2) AS base_cost,
       SUM(ADDITIONAL_DELIVERY_STAT_COST_FOR_ROI2_ASSIST) AS add_cost
FROM WIN_DOUYIN.dbo.千川素材数据_素材列表
WHERE STAT_TIME = @latestDateWithCtrlType
  AND CONTROL_TYPE IS NOT NULL
GROUP BY CONTROL_TYPE;
-- CONTROL_TYPE: 1=正常追投 2=违规追投 3=漏追投 4=未追投
```

给出各状态样本量与基础/追投消耗汇总，并注明口径来源与日期。

### 3. 确定启发式候选门槛

- 按给定品线取 `ROI_QUALIFIED_BASELINE`、`DAILY_SPEND_BASELINE`（`STATE='1'`）；品牌级则遍历其下品线。
- 周窗口消耗 ≥ `DAILY_SPEND_BASELINE × 包含首尾日的窗口天数`（例如 07-20~07-26 共 7 天，即 ×7）。

### 4. 候选盘点（核心 SQL，单条只读 CTE）

```sql
SELECT p.BRAND_ID, p.PROD_ID, p.PROD_NAME,
       h.DATA_ID, m.ADVERTISER_ID, m.MATERIAL_ID, h.FILENAME,
       h.STAT_START_TIME, h.STAT_END_TIME,
       h.COST, h.ROI, h.CTR, h.CVR, h.FIN_RATE,
       p.ROI_QUALIFIED_BASELINE AS roi_baseline,
       p.DAILY_SPEND_BASELINE AS daily_spend_baseline
FROM dbo.QC_HOT_REMAKE_PROMO h
JOIN (
    SELECT DISTINCT VIDEO_ID, PROD_ID
    FROM dbo.QC_MONTAGE_VIDEO_PROD_TAG
    WHERE STATE = '1'
) t ON h.DATA_ID = t.VIDEO_ID
JOIN dbo.QC_MONTAGE_PRODUCT p ON t.PROD_ID = p.PROD_ID AND p.STATE = '1'
LEFT JOIN dbo.QC_MONTAGE_MATERIAL_VIDEO_DATA m ON h.DATA_ID = m.ID
WHERE p.BRAND_ID = @brandId            -- 或 t.PROD_ID = @prodId
  AND h.STAT_START_TIME >= @windowStart -- 最近周窗口
  AND h.STAT_START_TIME <  @windowEnd
  AND h.ROI >= p.ROI_QUALIFIED_BASELINE
  AND h.COST >= p.DAILY_SPEND_BASELINE * @windowDays
  AND h.COST > 0
ORDER BY h.COST DESC;
```

可用 `scripts/candidate-diagnosis.ts` 一键执行（含窗口发现与断言）。

### 5. 输出

先给 **可决策 / BLOCKED**，再给：

- 事实截止日（周窗口结束日 + 外部表 CONTROL_TYPE 最大有效日期）+ 窗口样本量 + COST>0 覆盖 + 归属覆盖率
- 追投状态分布（外部表 CONTROL_TYPE 各状态样本量与基础/追投消耗）
- 候选清单（唯一素材）：`品线 | 素材ID | 广告主 | ROI(基线) | 消耗(门槛) | CTR/CVR/完播率`
- 阈值来源（品线 + ROI_QUALIFIED_BASELINE + DAILY_SPEND_BASELINE）
- 缺口与风险：关联缺口、CONTROL_TYPE 回填滞后
- 结尾注明：候选需人工确认，非自动追投授权。

## 安全

- 仅执行生产 SQL Server 的**单条只读 `SELECT`/CTE**；不 `UPDATE`/`DELETE`/`EXEC`/DDL。
- 不调用外部投放接口、不展示凭据、不把密码/连接串写入输出。
- 只做诊断，追投动作一律人工。

## 已知边界（明说，不掩盖）

- 外部表 `CONTROL_TYPE` 是持续回填字段，最新日期和覆盖率会变化；统计时必须现场发现并标注，旧文档数字只可作为历史证据。
- `QC_HOT_REMAKE_PROMO` 的台账关联和品线归属需现场计算；重复有效标签会放大行数，必须先去重。
- `GLOBAL_TYPE` 的注解枚举（0/1）与生产存储值（可能是中文标签）可能不一致，报告真实值并标注契约漂移。
- 启发式候选（ROI 达标 + 消耗达标）与正式 `CONTROL_TYPE` 判定是两套口径，可对照使用但不可混为一谈。
- annotation 没有给出违规/漏追投的自动处置规则，也没有证明 `CONTROL_TYPE` 的“达到标准”只由单一基线决定；不要编造规则或自动动作。
