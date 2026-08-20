---
name: st_15_decision_explain
description: "基于已有 ARO 订单快照，解释指定订单或 SKU 的补货量、库存、预测、安全库存、ABC、配额和目标库存天数。该 Skill 只读，不能重算或改写订单。"
---

# ST-15 决策解释（Replenishment Decision Chain）

## === Layer 1: 架构约束（架构师负责，修改需评审）===

### 工具权限
- 可调用: `aro__query_orders` / `aro__query_order_items` / `aro__query_filtered` / `aro__query_stock` / `aro__query_safety_metrics` / `aro__query_day_avg_sales` / `aro__forecast_demand` / `aro__calc_safety_days` / `aro__get_abc_overrides`
- 禁止: `aro__calc_replenishment`（不要重新生成订单来解释，必须查已有订单）

### 关键原则：查已有，不重算
**建议量归因是已有订单的只读解释：必须先调用 `aro__query_order_items`，以订单实际数量和参数为准。禁止使用 `aro__calc_replenishment` 或 `aro__forecast_demand` 制造新数值代替已有订单证据。**

### ABC 分类来源判断
ABC 分类来源解释**必须查看以下字段**：
- `aro__query_order_items` 返回的 `abc_source` 字段：`"user_override"` 表示**用户手动指定**，`"algorithm"` 表示**算法自动计算**
- `aro__forecast_demand` 返回的 `abc_source` 字段：同上
- 如果 abc_source = "user_override"，回答时必须明确告知用户"这是您之前手动指定的分类覆盖"
- 如有疑问，可调用 `aro__get_abc_overrides` 查看所有用户覆盖记录

### 解释流程
1. **定位订单**: 如果会话中已有建议订单（`aro__calc_replenishment` 结果），直接使用该 po_number；否则调用 `aro__query_orders` 找最近一次建议订单
2. **查明细**: 调用 `aro__query_order_items`（传 po_number + bar_code）拿到该 SKU 的实际订单行数据
3. **核对数字**: 以 `sku_quantity`（单位 CS）和 `pack_count`（每箱 EA 数）为基准，向用户解释
4. **补充背景**: 如需要，调用 `aro__query_stock` / `aro__query_safety_metrics` / `aro__query_day_avg_sales` 获取当前库存、安全天数、日均销量等上下文
5. **还原链路**: 按公式反推：缺口(EA) = safety_qty + cycle_qty - available - in_transit → ÷ pack_count → sku_quantity(CS)

### 单位说明
- `sku_quantity`: **CS（箱）** — 这是建议订单的最终数量
- 计算过程中的 forecast、safety_qty、cycle_qty：**EA（个）**
- `pack_count`: 每箱包含的 EA 数（来自 SKU 主数据）
- 转换公式: `sku_quantity(CS) = ceil(缺口EA ÷ pack_count)`

## === Layer 2: 业务逻辑 ===

### 决策链路（Decision Chain）
按以下顺序覆盖每个阶段，说明输入和输出：

1. **Forecast**: 需求预测值（STL 三档或日均销，单位 EA/天），ABC 分类决定选用档位
2. **Safety Stock**: 安全库存 = forecastQty × safety_stock_day（EA）
3. **Cycle Stock**: 周转量 = 到货前置期（`ti_leadtime`）× forecastQty（EA）。解释已有订单时优先使用 `aro__query_order_items`.calc_reason` 里的“到货前置期N×forecast”；不要用 `plant_code_mapping.otd` 或默认 OTD=3 反推。
4. **Gap**: 缺口 = 安全库存 + 周转量 − 库存扣减基数 − 在途库存（EA）。库存扣减基数默认是可卖库存；仅当订单 `calc_reason` 明确包含“北京临时库存口径: 总库存XEA”时使用该总库存值。没有标记的历史订单不得按客户代码追溯改口径。
5. **Unit Conversion**: 建议量 = ceil(缺口 ÷ pack_count)（CS）
6. **Constraints**: Allotment cap / AKBD guard（如适用）

### AKBD 约束解释口径
> 当前实现口径：AKBD 是费用预算约束，不是库存可用性约束。配额约束（AllotmentGuard）仍按原规则先决定上限；AKBD 只在配额之后控制费用。AKBD 费用充足时，正常补到目标库存；AKBD 费用不足时，按净库存判断，净库存 = 可卖库存 + 在途库存，AO 在途不参与 AKBD 净库存判断。

| AKBD 场景 | 判断口径 | 系统处理 |
| --- | --- | --- |
| 费用充足 | 本次下单费用 ≤ 剩余费用 | 正常补到目标库存，不因净库存为负而只补到 0 |
| 费用不足且净库存 < 0 | 可卖库存 + 在途库存 < 0，不含 AO 在途 | 只补到 0：建议订单CS = min(配额后目标补货CS, ceil(abs(净库存EA) / pack_count)) |
| 费用不足且净库存 >= 0 | 可卖库存 + 在途库存 >= 0，不含 AO 在途 | 按 AKBD 剩余费用预算截断/拦截；剩余费用为 0 时拦截为 0 |

解释时不要再使用单独“可卖库存为负就豁免费用约束”的旧口径；也不要把 AO 在途加入 AKBD 净库存判断。补货缺口公式仍可扣减 AO 在途，但 AKBD 费用不足分支的净库存只看可卖库存 + 普通在途库存。

### 输出格式
用中文叙述因果关系，关键数字标明单位（EA/CS），突出影响最大的 1-3 个因子。

### 详细计算流程回答要求
计算流程类解释必须展开详细链路，不能只给结论：
- 先列关键字段：`abc_class`、`forecast_method`、`forecast_qty`、`safety_stock_day`、`pack_count`、`available_stock_total`、`in_transit_qty`、`ao_in_transit_qty`、`sku_quantity`、`confirmed_quantity`、`calc_reason`。
- 再按步骤展示：计算项、参数名、参数化公式、代入计算、结果、单位。
- 公式展示必须使用普通 Markdown 表格，推荐表格列为：`步骤 | 计算项 | 公式 | 代入 | 结果 | 处理`；只有单行公式才可用普通 Markdown 文本。禁止输出数学公式块、TeX 命令或复杂公式标记。
- 必须说明 `round`、`ceil`、`max(0, gap)`、目标库存天数截断/兜底、目标库存模式等处理；如果 `calc_reason` 已给出这些处理，以 `calc_reason` 为准。
- 必须单独展示“约束校验”小节：配额（是否有有效配额、剩余额度、是否截断）、AKBD（是否命中机制、机制名、窗口期、折扣、费用池、达成率、剩余费用、本次下单费用、是否截断）。即使未触发也要写明“未配置/费用充足/未截断”的原因。
- 如果工具返回 `constraint_checks`，约束校验必须优先使用 `constraint_checks.quota` 和 `constraint_checks.akbd`，不要只根据 `sku_attribute` 推断。
- 如果工具返回 `calculation_context`，必须优先使用其中的解释口径：`day_avg_lookback_days`、`formula_family`、`ti_leadtime_days`、`arrival_otd_days`、`inventory_deduction_formula`。`arrival_otd_days` 只用于要求到货日，不要当成补货周转量前置期；`formula_family=target_stock_days` 时，目标库存天数公式优先。
- 最后解释为什么得到当前建议量/确认量，指出主导因素（例如库存充足、AO 在途抵扣、目标库存模式、箱规取整、配额/AKBD 截断）。

## === Layer 3: 运营参数 ===
- 无可调参数，本 skill 为只读解释型
