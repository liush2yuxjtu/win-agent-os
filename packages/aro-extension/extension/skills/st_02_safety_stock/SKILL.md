---
name: st_02_safety_stock
description: "查询并计算 ARO SKU 的 COV、K 因子和安全库存天数，用于解释安全库存结果；该 Skill 只读，不修改安全库存配置或订单。"
---

# SafetyStockSkill — 安全库存计算（COC 方法）

> Canonical Rule: `backend/app/rules/aro/safety_stock.md`。本 Skill 负责工具编排与交互；规则冲突时以该 Rule 文档为准。

## === Layer 1: 架构约束（架构师负责，修改需评审）===

### 工具权限
- 可调用: `aro__query_cov` / `aro__lookup_k_factor` / `aro__calc_safety_days` / `aro__query_safety_metrics` / `aro__query_stock`
- 禁止: 直接修改 k_risk_factor 表, 直接修改生产数据库
- **重要(平台接线要求)**: 查询安全库存必须先有建议订单画像上下文 —— 调用 `aro__query_safety_metrics` 等查询工具时必须携带 `po_number`(从现有建议订单获取);用户未提供订单号时,先查该客户/门店的建议订单列表(query_order_items / query_orders 取 po_number),仍无则明确询问用户,不要直接调 query_safety_metrics(backend 会拒绝:订单方案上下文缺失)。

### 工具选择
- 查询整体、Ship-To 或单 SKU 已落库的安全库存天数、平均值、最小值、最大值和分布：调用 `aro__query_safety_metrics`。平均值必须读取 `summary.avg_safety_stock_day`。
- 解释某个 SKU 为什么是某个安全库存天数：先调用 `aro__query_safety_metrics`(bar_code=...)` 获取已落库结果；需要展开 COV/K/参数链路时再调用 `aro__query_cov`、`aro__lookup_k_factor` 或 `aro__calc_safety_days`。
- COC 方法说明直接使用本 Skill 公式；具体 SKU 数据代入才需要计算工具。
- 最大安全库存天数、服务水平、提前期属于配置含义，使用当前客户配置，不改写为平均值查询。
- `sku_calc_metric.safety_quantity` 是数量，不是天数。禁止用它回答安全库存天数。
- 已有正式工具能够返回的安全库存指标，不要再自行编写 SQL 或进行二次汇总。

### 输出格式
返回 JSON:
```json
{"shiptoCode":"...","items":[{"barCode":"...","safetyStockDay":N,"kValue":N,"cov":N,"reason":"..."}]}
```

### 安全红线
- safety_stock_day 不得为负数
- safety_stock_day 不得超过 max_safety_days（按 sold-to 配置，默认 14 天）
- 不在此步计算 safety_quantity — SS qty 由 demand forecast × safety_days 得出，属于 ST-03 补货计算范畴
- 单次批量计算 SKU 数不得超过 5000

## === Layer 2: 业务逻辑（业务专家负责，可自主编辑）===

### 核心公式链（COC 方法）

本技能采用 P&G COC（Customer Order Cycle）标准方法计算安全库存天数。

#### 第 1 步：计算 COV（需求波动系数）
- 取过去 **26 周**的门店订单数据（store order），按周汇总每个 SKU 的销量
- 没有销量的周**零填充**（计入 0），确保 26 个数据点
- `COV = σ_weekly / μ_weekly`（周销量标准差 / 周销量均值）
- COV = 0 表示需求完全稳定，safety_days = 0
- COV 越大表示需求波动越大，需要更多安全库存

#### 第 2 步：计算 n(k)-k·N(-k) 目标值（target_nk）
```
target_nk = (1 - CFR) × CT / (COV × sqrt(NRLT))
```
**注意：target_nk 分母中 NRLT 必须先开根号（sqrt），不是直接乘 NRLT！**
- **CFR**（Case Fill Rate）：箱满足率（目标值），按 sold-to 配置
- **CT**（Cycle Time）：订货周期，按 sold-to 配置
- **NRLT**（Net Replenishment Lead Time）：净补货提前期（天），按 sold-to 配置
- 示例：CFR=0.95, CT=1, COV=1.27, NRLT=2 天 → target_nk = 0.05 / (1.27 × √2) ≈ 0.02784

#### 第 3 步：查 K-Risk Factor 表
- 在 `k_risk_factor` 表中，找到 `nk_value` 最接近 target 的那一行
- 读取对应的 `k_value` 即为 K
- K 不得为负数（floor at 0）
- n(k)-k·N(-k) 是 K 的递减函数：target 越小 → K 越大 → 安全库存越多

#### 第 4 步：计算安全库存天数
```
safety_days = K × COV × sqrt(7 × NRLT)
```
**注意：安全库存天数公式使用 `sqrt(7 × NRLT)`，7 是周到天的换算因子；以 `aro__calc_safety_days`.formula` 和 `raw_safety_days` 返回值为准。**
- 结果 cap 到 `[0, max_safety_days]` 范围（max_safety_days 按 sold-to 配置）

### 重要：safety_quantity 的计算不在此技能中
- `safety_quantity = demand_forecast × safety_days`（不是 day_avg × safety_days）
- demand_forecast 来自 ST-01 需求预测的结果
- safety_quantity 的实际计算在 ST-03 补货量计算 中完成

### 特殊场景
- **COV = 0**（完全稳定品）：safety_days = 0，需求完全可预测无需安全库存
- **无销量 SKU**：safety_days = 0，不计算
- **新品无历史数据**：回退至 min_safety_days（默认 3 天）
- **K-Risk Factor 表越界**：target 超出表范围时取边界值

### 关联 Skills
- **ST-01** 提供 demand forecast，需在 ST-03 中与 safety_days 结合算出 safety_quantity
- **ST-03** 消费 safety_days 计算补货量
- **ST-16** 可根据 CFR 达成反馈调整 CFR 目标或 max_safety_days

## === Layer 3: 运营参数（运营人员可调）===

### 参数配置（均按 sold-to 维度配置于 plant_code_mapping 表）
- CFR（箱满足率目标）: **0.95**（范围 0.80 ~ 0.99，配置表字段 `service_cfr`）
- NRLT（净补货提前期）: **2** 天（范围 1 ~ 30，配置表字段 `safety_day_leadtime`）
- CT（订货周期）: **1**（范围 1 ~ 7，配置表字段 `quotaion_day`）
- max_safety_days（安全天数上限）: **14**（范围 7 ~ 30，配置表字段 `safety_day_top`）
- COV 计算周期: **26** 周（配置表字段 `calc_cov_week_num`）
- COV 零填充: 是（固定）
- K-Risk Factor 表: 154 行查找表（K 范围 -5 ~ 38.8）
- day_avg 回溯天数: **90**（配置表字段 `past_day_num`，与 ST-03 统一口径）
- day_avg 地板除数: **0.001**（防除零）
