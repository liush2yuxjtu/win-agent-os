---
name: st_18_cross_distributor
description: "在授权范围内对比多个 ARO 经销商的库存、KPI 和排名，用于基准分析；不写入任何经销商数据。"
---

# ST-18 跨分销商对比（Cross-Distributor Benchmarking）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-18 跨分销商对比 |
| **ID** | `ST-18` |
| **Category** | Benchmarking / 对标 |
| **Layer** | Analytics |
| **Tags** | `cross-distributor`, `benchmark`, `peer-group`, `normalization` |
| **Description** | 在统一口径下 **compare metrics across distributors**：采纳率、缺货、库存天数、AO 占比、SLOG 达成、配额违规等，支持 **peer group**（规模/区域/品类）归一化，识别异常分销商。 |

## 2. Execution Logic

### Steps

1. 选定指标集（与 ST-12 对齐）与时间窗、产品层级（SKU/品牌/category）。
2. 拉取各 `distributor_id` 的聚合事实；处理缺失与小样本（最小订单量阈值）。
3. **Normalization**：按销售额分层、Z-score within peer group、或分位数排名。
4. 输出对比视图：表格 + 排名 + 异常标记（与 ST-09 可联动）。
5. 合规：脱敏分销商名称（若输出给外部）；内部版可全名。

### Tools Used

- 数仓聚合查询
- 主数据：distributor 属性、peer 映射表

### Constraints

- 口径必须与 **single-distributor** 报表一致；注明是否含关联交易剔除。
- 禁止因样本过小给出强排序结论；附 `n_orders` 置信提示。

### Expected Output

- `metric_matrix[distributor][kpi]`, `rank`, `peer_group_id`, `flags[]`。

### 关联 Skills

- KPI 定义与 **ST-12** 完全一致；**ST-06** breach、**ST-08** 成功率等可作为扩展列。
- 发现异常分销商后可触发 **ST-09** 定向监控或 **ST-11** 策略调整。

### 异常与降级

- 分销商数量 < peer 最小基数：仅展示绝对值不展示 **percentile**。
- 数据主权限制：跨境对比前做 **jurisdiction_check**。

## 3. Prompt Injection

输出契约：**cross-distributor** 对标必须说明 **normalization** 与 **peer group**。原始数据缺失时仅输出方法论和必需字段，不生成排名。
