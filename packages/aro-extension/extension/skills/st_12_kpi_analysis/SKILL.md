---
name: st_12_kpi_analysis
description: "查询并解读 ARO 经销商 KPI、趋势、排名和运营仪表盘指标；该 Skill 只读，不修改订单、库存或业务参数。"
---

# ST-12 KPI 分析（7 Core KPIs）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-12 KPI 分析 |
| **ID** | `ST-12` |
| **Category** | Analytics / 分析 |
| **Layer** | Reporting + Metrics |
| **Tags** | `KPI`, `adoption`, `SKU-deviation`, `POOS`, `DFC`, `AO-ratio`, `SLOG`, `quota-breach` |
| **Description** | 计算并解读 **7 项核心 KPI**：**adoption rate**（采纳率）、**SKU deviation**（SKU 偏差）、**POOS**、**DFC**、**AO ratio**、**SLOG achievement**、**quota breach**，支持按分销商/品类/时间切片。 |

## 2. Execution Logic

### Steps

1. **Adoption rate**：系统建议被采纳的比例 = accepted lines / suggested lines（口径需冻结）。
2. **SKU deviation**：建议量 vs 实订量绝对或相对偏差分布（MAPE/MAE）。
3. **POOS**：product out of stock 或政策定义缺货率，按门店或 SKU。
4. **DFC**：按 ARO ontology 定义（如 distribution fulfillment cost 或 days forward cover，以配置为准）计算并同比。
5. **AO ratio**：advance order 量占品类采购或销售额比。
6. **SLOG achievement**：订单跨越目标 SLOG 档位的比例或金额加权达成率。
7. **Quota breach**：ST-06 触发的 breach 次数或金额占比。
8. 输出 dashboard dataset + 自然语言摘要模板。

### Tools Used

- 数据仓库事实表（orders, inventory, suggestions）
- 维度表（distributor, sku, calendar）

### Constraints

- 每项 KPI 须在元数据中注册 **definition_version**，避免跨期不可比。
- 缺失数据展示为 `N/A` 而非零。

### Expected Output

- `kpi_name`, `value`, `prev_period`, `delta`, `grain`, `definition_version`。

### 关联 Skills

- 数据依赖 **ST-06**（quota breach）、**ST-04**（AO ratio）、**ST-05**（SLOG）、**ST-11**（adoption）等；**ST-13** 嵌入同款指标。
- **ST-18** 在分销商维度复用本定义做对标。

### 异常与降级

- 定义版本混用：查询层强制 `definition_version` filter，否则拒绝出数。
- 小样本周期：返回 `insufficient_sample` 而非误导性百分比。

## 3. Prompt Injection

输出契约：覆盖 **adoption rate**, **SKU deviation**, **POOS**, **DFC**, **AO ratio**, **SLOG achievement**, **quota breach**。指标名保留英文，解释用中文；DFC 定义缺失时声明采用 ARO 配置口径或返回澄清问题。
