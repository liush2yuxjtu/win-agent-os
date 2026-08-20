---
name: st_29_chronic_risk
description: "查询 ARO SKU 的连续缺货、空仓和低库存快照风险，尤其是核心分销 SKU；只陈述系统快照事实，不写入业务数据。"
---

# ST-29 持续异常监测（Chronic / Persistent Risk）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-29 持续异常监测 |
| **ID** | `ST-29` |
| **Category** | Monitoring / 监控 |
| **Layer** | Analytics + Narrative |
| **Tags** | `chronic`, `persistent`, `out-of-stock`, `empty-shelf`, `low-stock`, `core-distribution` |
| **Description** | 识别**连续多天**处于 **缺货 / 空仓 / 低库存（<7 天）** 的 SKU×门店，尤其是**核心分销**。区别于单日异常：关注"昨天也缺、今天也缺、持续在缺"的反复问题点，优先驱动补货与到货排查。 |

## 2. 数据与事实来源（不要自己算"连续"）

"连续天数"由系统每日落库的 `chronic_risk_snapshot` 快照计算，**不要让模型逐日推断**。直接调用工具拿事实：

- **工具**：`get_chronic_risk_skus`
- **入参**：`soldto_code`（必填，或可由上下文解析）、可选 `min_streak`（默认 2 天）、`lookback_days`（默认 14 天）、`core_distribution`、`shipto_code`、`category`、`bar_code`。
- **返回**：
  - `summary`：`latest_snapshot`(最近快照日)、`snapshot_days`(可用快照天数)、`chronic_count`、`core_chronic_count`、`persistent_oos/empty/low7`。
  - `items[]`：每个 `shipto_code` × `bar_code` 的 `sku_name`、`is_core`、`oos_streak`、`empty_streak`、`low7_streak`、`max_streak`、`kinds`(命中类型)、`stock_days`、`oos_rate`。

## 3. Execution Logic

### Steps

1. 调 `get_chronic_risk_skus` 获取 `items` 与 `summary`。
2. **优先级排序**：核心分销（`is_core=true`）优先；其次 `max_streak` 越大越紧急；缺货(`oos_streak`)>空仓(`empty_streak`)>低库存(`low7_streak`)。
3. **冷启动判断**：若 `snapshot_days < min_streak`，说明历史快照不足，明确说明"数据积累中，尚无法判定持续性"，不要臆造连续天数。
4. 生成话术：点名 SKU + 门店 + 已连续天数 + 类型，给出补货/到货核查建议。
5. 与 ST-03 补货、ST-09 单日异常联动：持续异常应触发补货建议复核，而非简单告警。

### Constraints

- 只陈述工具返回的 `*_streak` 事实，禁止虚构"连续 N 天"。
- `order_qty`(需求) 为空时 `oos_streak` 恒为 0；此时以 `empty_streak`/`low7_streak` 为主。
- 控制输出长度：默认只列 Top 8–12 个最严重点，其余给汇总数。

### Expected Output

- 摘要：`X 个核心分销 SKU 已连续≥N 天缺货/空仓/低库存`。
- 明细：`SKU 名 @门店 — 连续 M 天 缺货/空仓/低库存（库存天数 d）`。
- 建议：优先补货/核对在途到货/检查上下架与配送。

## 4. 关联 Skills

- ST-03 补货计算（持续缺货 → 复核补货建议）
- ST-09 异常检测（单日 vs 持续，互补）
- ST-12 KPI 分析（持续异常拉低履约/分销 KPI 的归因）
