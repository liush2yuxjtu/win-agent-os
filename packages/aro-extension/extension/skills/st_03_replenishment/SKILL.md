---
name: st_03_replenishment
description: "查询和计算 ARO 补货订单；可通过 set_target_stock_days 为指定 SKU 写入目标库存天数覆盖，并刷新当前范围订单。涉及 SKU 级目标库存天数的设置、修改或删除时，必须使用该 Skill；仅分析系统级安全库存或服务水平参数时不使用此 Skill。"
---

# ReplenishmentSkill — 补货量计算

> Canonical Rules: `backend/app/rules/aro/replenishment.md` 与 `allotment.md`。本 Skill 负责工具编排与回答格式；规则冲突时以 Rule 文档为准。

## === Layer 1: 架构约束（架构师负责，修改需评审）===

### 工具权限
- 可调用: `aro__calc_replenishment` / `aro__query_stock` / `aro__query_safety_metrics` / `aro__query_day_avg_sales` / `aro__check_allotment` / `aro__forecast_demand` / `aro__calc_safety_days` / `aro__run_abc_classification` / `aro__query_orders` / `aro__query_order_items` / `aro__query_order_analysis` / `aro__query_order_metrics` / `aro__get_target_stock_overrides` / `aro__set_target_stock_days`
- 禁止: 直接修改生产数据库

### 业务能力边界
- **SKU 目标库存天数写入**：需要设置、修改、删除或长期指定某 SKU 的目标库存天数时，必须调用 `aro__set_target_stock_days`；这是写入 `target_stock_override` 的唯一工具。
- **写入成功条件**：只有 `aro__set_target_stock_days` 返回 `ok=true` 且包含实际 `items`、`target_days` 或 `removed` 结果时，才能回复“已保存”“已更新”或“已删除”。
- **只读场景**：查询已有覆盖时使用 `aro__get_target_stock_overrides`；查询订单中实际目标库存天数时使用 `aro__query_order_metrics`。这两个工具不能写入覆盖记录。

### 追问已有订单时的处理原则
**已有订单的数量归因属于只读解释：使用 `aro__query_order_items` 查已存在的订单明细，禁止调用 `aro__calc_replenishment`。** 重新生成会产生新订单且数值可能不同。

**已有订单行优先**：当上下文中已经有 `po_number`，或用户在审单场景追问某个 SKU 的建议量、确认量、补货决策、计算依据、数量差异或决策链路时，属于解释已有订单行，必须调用 `aro__query_order_items`(po_number, bar_code)` 或使用当前订单行字段解释，禁止调用 `aro__calc_replenishment`。重新计算会使用最新预测/库存窗口并可能生成新订单，结果可能与用户正在看的订单行不一致。

**新建/重算意图**：明确要求生成新结果且不是解释已有 `po_number` 时，`aro__calc_replenishment` 可使用 `bar_code` + `shipto_code` 单 SKU 模式。`items[].calc_reason` 是权威计算链路。

**从源销售重跑模式**：该模式表示不沿用预测缓存，必须调用 `aro__calc_replenishment`(force_recompute=true, soldto_code, shipto_code)`。它先刷新目标范围 `sku_forecast`，再生成订单。`aro__run_abc_classification` 仅供只读预览；只有 `forecast_recomputed=true` 才证明持久化重算完成。

### 单位说明
- `aro__calc_replenishment` 返回的 `sku_quantity` 单位为 **CS（箱）**
- 内部计算过程中的 forecast、安全库存、周转量单位都是 **EA（个）**
- 最终转换: `sku_quantity(CS) = ceil(缺口EA ÷ pack_count)`
- `pack_count` 来自 SKU 主数据（sku_master 表）

### 输出格式
**调用 `aro__calc_replenishment` 后，回复中必须包含以下汇总信息（从工具返回的 `total_quantity_cs`、`total_amount`、`amount_unit` 字段读取）：**
1. **PO 号**（每个 ship-to 一行）
2. **SKU 数量**（共多少个 SKU）
3. **总箱数**（total_quantity_cs，单位 CS）
4. **总金额**（total_amount，单位 元(不含税)）

示例输出：
> 已为 ship-to 2002804263 生成建议订单 **PO-20250701-001**，共 **45 个 SKU**，合计 **320 箱（CS）**，总金额 **¥762,340**（不含税）。
> 本次扣减在途：分货在途 **50 箱**，AO提前单在途 **30 箱**（共 **80 箱**）。

**AO 在途说明（必须展示）：**
无论是单 SKU 查询还是全量补货，回复中都必须明确展示 AO 提前单的扣减数量：
- **单 SKU 模式**：显示"在途库存 = 分货在途 X EA + AO在途 Y EA = Z EA"，让用户清楚 AO 扣了多少
- **全量模式**：在汇总行增加"本次扣减 AO 在途合计 N 箱（涉及 M 个 SKU）"，让用户了解整体 AO 在途规模
- 若 AO 在途为 0，也应说明"AO在途：0（无未到货的提前单）"

如有凑单（slog_fill_skus），还需补充：
- 凑单 SKU 数量（slog_fill_sku_count）
- 凑单总箱数（slog_fill_total_cs）
- **凑单 SKU 名称列表**（从 slog_fill_skus 数组中读取 sku_name），示例："凑单品：XXX(5CS)、YYY(3CS)、ZZZ(2CS)"

**SKU 明细表（必须展示）：**
工具返回的 `top_items` 数组包含按建议订货量降序排列的前 20 个 SKU 明细，**必须以 Markdown 表格形式直接展示**，不得省略。表格至少包含以下列：
| 条码 | 商品名称 | 建议订货量(CS) | 补货类型 | 预测需求 | 可用库存天数 | 计算说明 |

如果 `remaining_items_count > 0`，在表格后注明"另有 N 个SKU未展示，完整明细请点下载按钮"。
**禁止**只输出汇总然后反问用户"是否需要查看明细"——用户请求生成订单即意味着需要看到明细。

返回 JSON 格式参考:
```json
{"shiptoCode":"...","items":[{"barCode":"...","skuName":"...","restockQty":N,"reason":"..."}]}
```

### 安全红线
- 补货量为负时置零，不产生退货建议

## === Layer 2: 业务逻辑（业务专家负责，可自主编辑）===

### 补货管线（Pipeline）

对于每个 SKU，依次执行以下步骤：

#### 1. 可售列表校验（Listing Check）
以 `sku_listing` 表为准，按 `shipto_code` 查询该 ship-to 下所有可售 `bar_code`。
- 在 listing 表中的 barcode = 该 ship-to 的可售品，进入后续补货计算
- 不在 listing 表中的 barcode = 不可售，不参与补货
- **所有可售品都会出现在建议订单明细中**：需要补货的有订货量，不需要补货的订货量为 0（po_item_type="不补货"）
- 下载 Excel 时包含全量可售品明细（含 qty=0 的行）

#### 2. 超储控单（MaxStockGuard）
可用库存天数 = 可用库存 ÷ 日均销量（回溯天数可配，默认 90 天）
可用库存天数 > 最大周转天数（默认 40 天）→ 标记"超储控单"，不补货

#### 3. 需求预测（Forecast）
优先使用 ST-01 需求预测工具 `aro__forecast_demand` 获取 STL 三档预测值 forecastQty
如果 forecast 不可用或为 0，降级使用 POS 日均销量

> **ABC 分类前置**：`aro__forecast_demand` 根据 `abc_class` 选取高/中/低档预测值（A→high，B→neutral，C→low，D→0）。
> 普通补货使用已持久化的 `sku_forecast`。销售源 ABC+预测重跑模式传 `force_recompute=true`；`aro__run_abc_classification` 仅用于分类预览，不刷新缓存。

#### 4. 补货量计算（核心公式）
- 安全库存量 = forecastQty × safety_stock_day（来自 ST-02 COC）
- 周转量 = 到货前置期（`ti_leadtime`）× forecastQty（EA）。注意：补货周转量使用 `plant_code_mapping.ti_leadtime`，不要使用 `plant_code_mapping.otd`；`otd` 字段仅用于要求到货日等日期口径。
- **目标库存 = 安全库存量 + 周转量**
- **目标库存天数 = 目标库存 ÷ 日均销量**
  - 若目标库存天数 > 最大周转天数（max_available_inventory_day，默认 40）→ 将目标库存下限到 最大周转天数 × 日均销
  - 若目标库存天数 < 到货前置期（ti_leadtime，默认 7）→ 将目标库存上提到 到货前置期 × 日均销
  - 如有用户反馈目标天数，则目标库存 = 用户反馈天数 × 日均销（不受上述clamp限制）
- 补货缺口 = 目标库存 − 可用库存 − 在途库存（分货在途 + AO提前单）
- 若缺口 ≤ 0，不补货

> **⚠️ AO 数据来源说明**：此处"AO提前单"在途指的是 **`ao_data` 表中已确认的 AO 订单**（ERP 实际已下达、尚未到货的提前单），**不是**系统通过 `aro__run_ao_plan` 生成的 AO 建议计划（`proposed_order` 中 po_type='AO' 的记录）。两者不可混淆。

#### 5. 单位转换（EA → CS）
建议订单量 = ceil(补货缺口EA ÷ pack_count)，单位为 CS（箱）
pack_count 来自 sku_master 主数据表

#### 6. 配额约束（AllotmentGuard）
如有配额，补货量不得超过剩余配额；配额为 0 时标记"配额已满"过滤

#### 7. AKBD 约束（AKBDGuard）
> 当前实现口径：AKBD 是费用预算约束，不是库存可用性约束。AKBD SKU 都进入费用约束；配额约束（AllotmentGuard）仍按原规则生效并决定上限。费用不足时按净库存（`available_stock + in_transit`）处理，AO 在途不参与 AKBD 净库存判断：净库存 < 0 时只驱动补货补到 0，不补到目标库存；净库存 >= 0 时按 AKBD 费用预算截断/拦截。

1. **窗口期判定**：查询 `akbd_plan`（机制主数据表）按 bar_code + soldto_code，如果 fee_start_date 和 fee_end_date 都为空则视为有效（数据源已预过滤），否则需 today ∈ [fee_start_date, fee_end_date]
2. **下单费用计算**：`下单费用 = 建议订单CS × sku_extension.case_price × akbd_plan.discount`。这里的 `case_price` 是系统主数据字段，按工具返回的 `constraint_checks.akbd.order_fee_formula` / `case_price` 为准，不要额外乘 200 或自行改写价格口径。
3. **剩余费用计算**：用 bar_code + soldto 查询 `akbd_track` 追踪表获取 `fee_achieve`（达成率，已花费占比）→ `剩余费用 = akbd_plan.fee × (1 - track.fee_achieve)`；如果 `fee_achieve ≥ 1`（已超支）则剩余费用 = 0
4. **约束逻辑**：
   - 下单费用 ≤ 剩余费用 → 不需要控制订单量
   - 下单费用 > 剩余费用 且 净库存 < 0 → 只补到 0：建议订单CS = min(目标补货CS, ceil(abs(净库存EA) / pack_count))
   - 下单费用 > 剩余费用 且 净库存 >= 0，若剩余费用 = 0（fee_achieve ≥ 1 或 track 无数据） → 标记“AKBD费用超支”，建议订单量=0
   - 下单费用 > 剩余费用 且 净库存 >= 0 且 剩余费用 > 0 → 调整建议订单CS = floor(剩余费用 / 折扣点数 / sku_extension.case_price)

#### 8. 停产品排除
itemStatus=停产 的不补货

### SLOG 凑单（已自动化）
全量补货（非单条码）完成后，系统会**自动链式调用** `aro__run_slog_fill`，结果附在 `aro__calc_replenishment` 返回值的 `slog_fill_auto` 字段中。
- 如果 `slog_fill_auto[].gap_cs > 0`，说明已自动凑单，你应在回复中告知用户"已自动凑单 X 箱，共 Y 个 SKU"，并列出凑单明细
- 如果 `slog_fill_auto[].gap_cs <= 0`，告知用户"订单总量已达到凑单目标，无需凑单"
- **不需要**手动再调用 `aro__run_slog_fill`；仅凑单目标已变更且需要重算时例外

**用户调整凑单目标时：**
凑单目标变更属于 **ST-05** 的配置写操作；持久化目标后由 **ST-21** 重算凑单方案。

### 决策原因记录
每个 SKU 的 reason 字段必须记录完整决策链路，**在途必须拆分显示分货在途和 AO 在途**：
```
"forecast(stl)=X × 安全天数Y = 安全库存Z, 到货前置期(ti_leadtime)N × forecast = 周转量W, 可用A, 在途B(分货在途B1 + AO在途B2), 缺口D, MOQ→E"
```
- `B1` = 分货在途（distributor_intransit）
- `B2` = AO 提前单在途（ao_intransit）— 来源于 `ao_data` 表中已确认的 AO 订单，非系统建议的 AO 计划
- 两者之和 = 总在途，用于缺口计算中的扣减
- 默认库存扣减基数是 `available_stock_total`。仅北京 Sold-To `2001146261` 的临时规则会在新生成/刷新订单的 `calc_reason` 中写入“北京临时库存口径: 总库存XEA”，此时缺口改用该总库存值；没有此标记的历史订单仍按可卖库存解释。

### 计算流程回答详细度
单 SKU 计算链路解释不能只输出结论，必须覆盖：
- 关键字段：`abc_class`、`forecast_method`、`forecast_qty`、`six_day_avg_quantity`、`safety_stock_day`、`ti_leadtime`、`pack_count`、`available_stock_total`、`in_transit_qty`、`ao_in_transit_qty`、`sku_quantity`、`confirmed_quantity`、`calc_reason`。
- 查询当前订单各 SKU 的目标库存天数时，调用 `aro__query_order_metrics`，读取其 `target_stock_days` 和 `high_target_stock_days`；如果用户指定了条码，必须同时传 `bar_code` 精确查询该 SKU，避免被前 100 条展示限制截断；不得通过 sandbox 猜测订单字段。
- `aro__query_order_analysis` 是订单级只读聚合入口，覆盖物理指标、库存快照、ABC、配额、AKBD、活动报量、目标库存覆盖和包含今日 AO 的 SLOG 差额。全单汇总不得从 `aro__query_order_items` 的样本行外推。
- 目标库存天数覆盖记录由 `aro__get_target_stock_overrides` 或 `aro__query_order_analysis`.target_override_summary` 提供，与 ABC 覆盖记录无关。
- 目标库存天数解释必须使用 `target_stock_days_explanation`：目标天数是 `target_stock_ea / day_avg_ea` 的结果；不得把 10 天结果误说成 10 天 `ti_leadtime`。
- `proposed_order_item` 没有物理 `target_stock_days` 列；`aro__query_order_metrics`.target_stock_days` 是从订单行 `forecast_method`、`calc_reason`、目标库存和日均销量推导的查询结果。不得把空结果说成“快照字段为 null”或“同步失败”。
- 覆盖记录已存在但订单解释未体现目标天数时，先核对该订单行的 `calc_reason` 和实际刷新结果。仅为了目标库存覆盖而调用 `force_recompute` 是错误的：它用于从源销售重算 ABC/预测，覆盖写入后应使用反馈链路的普通订单刷新。
- 参数化公式：`safety_stock_ea = forecast_qty × safety_stock_day`，`cycle_stock_ea = forecast_qty × ti_leadtime`，`target_stock_ea = safety_stock_ea + cycle_stock_ea` 或目标库存模式 `target_stock_ea = target_stock_days × day_avg`，`raw_gap_ea = target_stock_ea - inventory_deduction_ea - in_transit_ea - ao_in_transit_ea`，`suggested_qty_cs = ceil(max(0, raw_gap_ea) ÷ pack_count)`。`inventory_deduction_ea` 必须读取 `calculation_context.inventory_deduction_ea` 或 `calc_reason`，不得自行假定。
- 每一步都要写“参数名 + 代入值 + 结果 + 单位”，并说明 `round`、`ceil`、`max(0, gap)`、目标库存天数截断/兜底、目标库存模式等处理。
- 公式展示必须使用普通 Markdown 表格，推荐表格列为：`步骤 | 计算项 | 公式 | 代入 | 结果 | 处理`；只有单行公式才可用普通 Markdown 文本。禁止输出数学公式块、TeX 命令或复杂公式标记。
- 必须单独展示“约束校验”小节：配额（是否有有效配额、剩余额度、是否截断）、AKBD（是否命中机制、机制名、窗口期、折扣、费用池、达成率、剩余费用、本次下单费用、是否截断）。即使未触发也要写明“未配置/费用充足/未截断”的原因。
- 如果工具返回 `constraint_checks`，约束校验必须优先使用 `constraint_checks.quota` 和 `constraint_checks.akbd`，不要只根据 `sku_attribute` 推断。
- 如果 `aro__query_order_items`.calc_reason` 或 `aro__calc_replenishment`.items[].calc_reason` 已给出公式，以 `calc_reason` 为准；不要用默认值覆盖已有订单行依据。
- 如果工具返回 `calculation_context`，解释口径必须优先使用它：`day_avg_lookback_days` 是日均销窗口；`ti_leadtime_days` 是补货周转量前置期；`arrival_otd_days` 只用于要求到货日，不参与周转量；`formula_family=target_stock_days` 表示目标库存天数模式优先，不要强行套安全库存+周转量公式。
- 最后用 1-2 句话解释主导原因，例如库存充足、AO 在途抵扣、目标库存模式、箱规取整、配额/AKBD 截断等。

### 单条码支持
单条码计算通过 `aro__calc_replenishment`.bar_code` 限定范围。

### 目标库存天数反馈
用户表达“改为/调到/设成/按某天数补货/以后维持某天数”等任意等价意图，要求按指定 SKU、品类或关键词设置目标库存天数时，调用 `aro__set_target_stock_days` 写入覆盖记录；不要依赖固定关键词，也不要把修改请求当成查询。设置成功后，反馈链路已在后台自动刷新当前范围的建议订单；收到 `auto_recalculated=true` 时，不得再调用 `recalculate_order` 或 `aro__calc_replenishment`，最终答复必须明确说明“已自动刷新当前 Ship-To 的建议订单”，不得说“下次补货时才生效”或询问用户是否需要刷新。需要解释刷新后的 SKU 日均销量时，只能使用 `refreshed_item_snapshot.day_avg_lookback_days` 标注窗口期；它来自 `plant_code_mapping.past_day_num`，不得套用 90 天默认值或从 `six_day_avg_quantity` 字段名推断窗口。仅查询已有覆盖或订单快照时使用 `aro__get_target_stock_overrides` / `aro__query_order_metrics`，不要直接修改数据库。

### 关联 Skills
- 依赖 **ST-01** 需求预测（`aro__forecast_demand` 工具）和 **ST-02** 安全库存天数（`aro__calc_safety_days` 工具）
- 依赖持久化 ABC 分类提供 `abc_class` 并影响 forecast 档位选择；`aro__run_abc_classification` 只用于分类预览
- **ST-21** 凑单填充（`aro__run_slog_fill`）— 全量补货后**必须调用**，确保订单达到凑单目标
- **ST-05** SLOG 配置查看
- **ST-06** 在提交前 cap 配额
- **ST-15** 可追溯决策链路

## === Layer 3: 运营参数（运营人员可调）===

### 补货计算参数
- 正常控单最大可用库存天: 读取 `plant_code_mapping.max_available_inventory_day`（无配置时按代码兜底）
- 补货到货前置期: 读取 `plant_code_mapping.ti_leadtime`（缺省 fallback 为 3），用于“周转量 = ti_leadtime × forecastQty”。不要用 `plant_code_mapping.otd` 或 `pg_otd` 解释补货周转量。
- 日均销回溯天数: 取该 ship-to 的 `plant_code_mapping.past_day_num`（默认 90）。解释已有订单行时以工具返回的 `calculation_context.day_avg_lookback_days` 或订单行口径为准，严禁固定写成“过去90天”。
- 无安全天数数据时默认安全天数: **7.0**（新品或无 COC 数据时的 fallback）
- 安全库存缓冲系数: **1.0**（数据质量差时上调到 1.2）
- forecast 降级策略: 无 forecast 时使用 POS 日均销量
- day_avg 地板除数: **0.01**（防除零，无销量 SKU 的 avail_day 上限）

### 凑单参数（SLOG）
- 凑单目标箱数: 从 `plant_code_mapping.slog_target` 读取，无配置时默认 **3500** CS
- 凑单候选品最高周转天数: 读取 `plant_code_mapping.max_turnover_days`，无配置时默认 **40**（也可由工具参数 `max_turnover_days` 临时覆盖）
- 凑单候选范围: `sku_extension.item_status = Active` 且 `day_avg > 0`；不按 Listing、ABC/D 类或 `stocking_sku` 清单过滤
- 凑单每品默认箱数: **1** CS
- 凑单 day_avg 回溯天数: **90**（与补货一致）

### AO 计划参数
- AO 高档近似乘数: **1.1**（无 STL 时 `f_high = day_avg × 1.1`）
- AO day_avg 回溯天数: **90**（与补货一致）
- AO 无安全天数默认: **7.0**（同上）

### ABC 分类参数
- 分类回溯天数: **30**（POS 销量统计窗口）
- A 类累计占比阈值: **0.8**（80%）
- B 类累计占比阈值: **0.9**（90%）
- 零销量 SKU 默认分类: **D**
- 无分类数据默认: **B**（中性档）

### 显示截断
- LLM 返回概要最多: **30** 个 SKU（全量可下载 Excel）
- AO 计划返回最多: **20** 个 SKU
