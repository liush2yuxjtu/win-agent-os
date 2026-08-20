---
name: st_05_slog_optimization
description: "查询和优化 ARO Ship-To 的 SLOG 档位、目标及凑单策略。读取配置和执行整单 SLOG 计算使用 run_slog；设置具体目标或偏好品应使用对应写入 Skill 和工具。"
---

# ST-05 SLOG 凑单优化（Order Padding to SLOG Thresholds）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-05 SLOG 凑单优化 |
| **ID** | `ST-05` |
| **Category** | Order Economics / 订单经济 |
| **Layer** | Optimization |
| **Tags** | `SLOG`, `threshold`, `padding`, `800-2000-3500`, `凑单` |
| **Description** | 在不超过业务约束前提下，对订单金额或体积进行 **padding（凑单）**，使总额跨越 SLOG 阶梯阈值 **800 / 2000 / 3500**（单位以合同为准，如 RMB），以获取运费或返利档位，同时最小化冗余采购。 |

## 2. Execution Logic

### Steps

1. 计算当前 basket 金额 `subtotal`（或按体积/重量折算的 scoring metric）。
2. 识别下一档阈值：`next_tier ∈ {800, 2000, 3500}`，`gap = next_tier - subtotal`。
3. 在可选 SKU 集合（同供应商、同波次、允许凑单标记）中做 knapsack / 贪心：优先高周转、低呆滞风险 SKU，增量加到满足 `gap` 或达 MOQ/pack 约束。
4. 若无法精确凑满，输出 **nearest feasible** 方案与剩余 gap。
5. 记录 `tier_achieved`, `padding_skus`, `marginal_cost` 供审核。

### Tools Used

- 价格主数据、汇率（若多币别）
- 规则引擎：禁止凑单黑名单、品类限制
- 可选：OR 求解器或启发式

### Constraints

- 不得违反 **allotment**（ST-06）与 **max line count**。
- Padding 不得引入负毛利 SKU（若配置 margin guard）。

### Expected Output

- 原单 + 建议追加行；`slog_tier_before/after`, `padded_amount`。

### 关联 Skills

- 必须在 **ST-06** 之后或与之联算，避免凑单突破 **quota**；**ST-12** 输出 **SLOG achievement**。
- **ST-15** 解释中应标明是否经 SLOG **padding** 及追加 SKU 列表。

### 异常与降级

- 无法在合理 SKU 集内达标：返回 `tier_partial` 与最小成本近似解。
- 价格失效：跳过该 SKU 并提示刷新 **price master**。

## 3. Prompt Injection

输出契约：解释 SLOG 的 **padding** 与 **tier** 概念；阈值来自实际配置，不虚构价格表或目标。
