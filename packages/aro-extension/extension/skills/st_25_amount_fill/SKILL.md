---
name: st_25_amount_fill
description: "按目标金额或追加金额为当前 ARO 订单凑金额。修改订单必须调用 run_amount_fill 并携带当前 po_number；查询金额或明细时只读，不得手算补货量。"
---

# ST-25 凑金额 — 按目标金额补充订单

> Canonical Rules: `backend/app/rules/aro/amount_fill.md` 与 `allotment.md`。本 Skill 负责工具编排与交互；规则冲突时以 Rule 文档为准。

## === Layer 1: 架构约束 ===

### 工具权限
- 可调用: `aro__run_amount_fill` / `aro__query_order_analysis` / `aro__query_stock` / `aro__query_orders` / `aro__query_order_items`
- 禁止: 直接修改数据库

### 输出格式
返回 JSON:
```json
{
  "target_amount": 100000,
  "original_amount": 62000,
  "gap_amount": 38000,
  "fill_items": [
    {"bar_code": "...", "sku_name": "...", "fill_qty_cs": 10, "case_price": 1335.0, "fill_amount": 13350.0}
  ],
  "total_filled_amount": 37800,
  "remaining_gap_amount": 200,
  "final_amount": 99800
}
```

### 参数契约
- `soldto_code` / `shipto_code`：必填。从审单上下文获取。
- `po_number`：**必填且关键**。务必传入当前审单上下文中的「订单号」。否则工具会回退到该 ship-to 最新的一张单，可能凑到错误的订单（如某张 AO 单），导致左侧确认箱数不变。
- `target_amount`（凑到目标）**或** `additional_amount`（追加金额），二选一：
  - `target_amount`：订单最终绝对目标金额。
  - `additional_amount`：基于当前金额的新增额。
- `category`（品类范围，可选）：只要用户把凑单**限定到某个品类**，就必须传。
  - 识别并清洗品类名：去掉「品类/类目/类别/的」等词，只保留名称本体。
  - 中英文均可，例如 `hair` / `Hair Care` / `个护` / `织物`。
  - 品类范围存在时必须传 `category`；整单范围省略该参数。
- 「万」必须换算成元：20 万 → 200000。

### 安全红线
- 凑单量不得为负（每个 SKU fill_qty_cs ≥ 0）
- 不会超过目标金额（向下取整到整箱金额）
- case_price 为 0 或无价格的 SKU 不参与凑单
- 每个 SKU 最多可凑受最大库存周转天数上限约束
- **严禁手算凑单量**：无论用户指定哪个 SKU，都**必须调用 `aro__run_amount_fill` 工具**计算。工具内部会自动执行40天库存上限校验。**绝对不可以用 gap_amount ÷ case_price 自行计算**，否则会导致超储。
- 指定 SKU 偏好通过 `preferred_bar_codes` 传入。

## === Layer 2: 业务逻辑 ===

### 执行边界
**非强制执行**：只有明确的订单金额变更指令和完整目标/追加金额才允许写入。查询、解释或参数缺失都不执行。

### 执行时机
SLOG 凑单（ST-21）**之后**。整张单先凑完 SLOG、再根据目标金额凑。

### 与凑SLOG（ST-21）的关系（重要）
- 凑金额与凑SLOG **互不清空**：本工具只删除并重算自己的「凑金额」行，凑SLOG（po_item_type="凑SLOG"/"凑单"）的行原样保留。
- **互为基数**：计算原始金额时，会把已有的凑SLOG箱数对应的金额一起算进 `original_amount`。
- 因此若用户先凑SLOG、再凑金额，凑金额是在「基础补货 + 凑SLOG」的金额之上再补到目标，不会覆盖凑SLOG。
- 若当前金额已达/超过目标（gap ≤ 0），返回 note 说明「已达标、无需凑金额、凑SLOG内容保留不变」，不报错。

### 重复调用（幂等）
- 同一品类/订单重复「再凑 X」不会无限累加：每次先删除旧的「凑金额」行，再以删除后的金额为基数重算。
- 即连续点 N 次「再凑 2 万」，最终仍约为「原始补货 + 2 万」，而非 +2N 万。

### 目标金额
**用户必须提供**。如果用户没有给目标金额，必须主动询问：
> "当前订单金额为 ¥xx，您希望凑到多少金额？"

### 凑金额公式

#### Gap 计算
```
original_amount = Σ(每个订单行 sku_quantity_cs × case_price)
gap_amount = target_amount − original_amount
```
- `case_price`: 每箱不含税价格（来自 SKU 主数据 case_200_exclude_tax）

#### 候选 SKU 排序
按**回溯窗口内销售金额**降序排列（金额高的优先凑）：
```
sales_amount = sum(POS qty_ea) / pack_count × case_price
```
注意：回溯窗口天数取该 ship-to 配置的 past_day_num（默认 90 天，可 by ship-to 配置）；POS 销量单位为支（EA），需除以 pack_count 转为箱，再乘 case_price 得到金额。

#### 每个候选 SKU 的最大可凑
```
max_fill_ea = max_turnover_days × day_avg_ea − available − already_ordered_ea − in_transit（分货在途+AO提前单）
max_fill_cs = max(0, floor(max_fill_ea / pack_count))
max_fill_amount = max_fill_cs × case_price
```
- `already_ordered_ea`: 当前订单中已建议的数量（CS × pack_count）
- `max_turnover_days`: 最高周转天数上限，默认 40
- **AO提前单**: 此处指 `ao_data` 表中已确认的 AO 在途（ERP 已下达的实际订单），不是系统建议的 AO 计划（proposed_order 中 po_type='AO'）

#### 配额约束（Allotment Guard）
如果 SKU 在 `plant_code_quota` 中有有效期内的配额记录（`quota_start_date <= today <= quota_end_date`）：
```
allotment_cap = max(0, allotment_remaining_cs − already_ordered_cs)
max_fill_cs = min(max_fill_cs, allotment_cap)
```
配额已满的 SKU 不参与凑金额。

#### AKBD 费用约束
> 当前实现口径：AKBD SKU 都进入费用约束；配额约束仍按原规则生效。费用不足时按净库存（`available_stock + in_transit`）处理，AO 在途不参与 AKBD 净库存判断：净库存 < 0 时只驱动补货补到 0，不补到目标库存；净库存 >= 0 时按 AKBD 费用预算截断/拦截。

如果 SKU 在 `akbd_plan` 中有记录（日期都为空视为有效，或 `fee_start_date <= today <= fee_end_date`），则受 AKBD 费用约束：
1. **查询机制名称**：用 bar_code + soldto 查 `akbd_plan` 获取 `product_name`
2. **查询达成率**：用 soldto + product_name 查 `akbd_track` 获取 `fee_achieve`（机制级别共享）
3. **计算剩余费用**：
   ```
   mechanism_remaining = (1 − fee_achieve) × plan.fee − Σ(同机制所有SKU already_ordered_cs × case_price × discount)
   ```
4. **凑单费用检查**：
   ```
   fill_cost = fill_qty_cs × case_price × discount
   if fill_cost > mechanism_remaining:
       fill_qty_cs = floor(mechanism_remaining / case_price / discount)
   ```
5. 同机制多个 SKU 共享预算，贪心循环中先凑的 SKU 消耗预算后，后续同机制 SKU 可用预算减少。

#### 填充逻辑
从销售金额最高的 SKU 开始贪心填充：
```
fill_qty_cs = min(max_fill_cs, floor(remaining_gap / case_price))
fill_amount = fill_qty_cs × case_price
remaining_gap -= fill_amount
```
直到 gap 填满或候选品用尽。

### 能力流程

#### 目标金额模式
1. 目标金额写操作已具备明确的订单和金额。
2. 先确保补货 + SLOG 已执行（如未执行，先触发）
3. 调用 `aro__run_amount_fill`(target_amount=100000)`
4. 展示结果：
   - 原始订单金额 → 凑单后金额
   - 每个凑的 SKU：名称、箱数、单价、金额
   - 总凑金额、剩余差额
   - **库存约束说明**: "每个SKU凑单量受40天库存上限约束：凑单后(可用库存+已订+在途(含分货在途+AO已确认在途)+凑单量)不超过40天日均销量"（注：AO 指 ao_data 表中已确认订单，非系统建议计划）

#### 补货后主动询问
1. 补货 + SLOG 凑单完成后
2. 计算当前订单总金额
3. 询问："当前订单金额 ¥62,000，是否需要凑到某个目标金额？"
4. 写操作已获得明确授权后调用 `aro__run_amount_fill`

#### 调整目标
目标金额变更需要新的明确金额：
- 重新调用 `aro__run_amount_fill`(target_amount=80000)`
- 展示新方案

### 单位说明
- `case_price`: **¥/CS（箱）** — 每箱不含税价格
- `fill_qty_cs`: **CS（箱）** — 凑单建议量
- `fill_amount`: **¥** — 该 SKU 凑的金额
- `sales_amount`: **¥** — 回溯窗口内（past_day_num，默认90天）该SKU的销售金额

### 关联 Skills
- 依赖 **ST-03** 补货建议的订单作为基础
- 依赖 **ST-21** SLOG 凑单后的订单作为起点
- **ST-15** 决策解释可追溯凑金额原因
- **ST-20** ABC 分类可辅助理解候选品优先级

## === Layer 3: 运营参数 ===

### 算法参数
- max_turnover_days（最高周转天数）: 默认读取 `plant_code_mapping.max_turnover_days`，无配置时兜底 **40**（范围 20 ~ 60）
- day_avg_lookback（日均销回溯天数）: 取该 ship-to 配置的 **past_day_num**（默认 90，可 by ship-to 配置）；输出时须按实际窗口标注，严禁照抄“过去90天”
- 价格来源: sku_master.case_price（case_200_exclude_tax）

### 结果持久化
- 凑单品写入 `proposed_order_item` 表，`po_item_type = "凑金额"`
- 同时更新 `proposed_order` 的 `total_quantity` 和 `total_sku_count`
- 查询工具 `aro__query_order_items` 返回的 `po_item_type` 字段可区分凑金额品与正常补货品

### 价格数据
- 存储位置: `sku_master.case_price` 字段
- 数据源: CDL SKU Master Data CSV（case_200_exclude_tax）
- 单位: 元/箱（不含税）
- 无价格的 SKU（case_price=0）不参与凑金额
