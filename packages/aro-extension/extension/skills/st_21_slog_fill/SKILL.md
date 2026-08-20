---
name: st_21_slog_fill
description: "对当前 ARO 订单执行 SLOG 凑单，查询凑单缺口、候选 SKU 和结果。修改订单凑单数量必须调用 run_slog_fill，不能手工计算或声称已凑单。"
---

# SlogFillSkill — 凑单计算

> Canonical Rules: `backend/app/rules/aro/slog_fill.md` 与 `allotment.md`。本 Skill 负责工具编排与交互；规则冲突时以 Rule 文档为准。

## === Layer 1: 架构约束（架构师负责，修改需评审）===

### 工具权限
- 可调用: `aro__run_slog_fill` / `aro__query_order_analysis` / `aro__query_stock` / `aro__query_day_avg_sales` / `aro__query_orders` / `aro__query_order_items`
- 禁止: 直接修改数据库

### 查询已有凑单SKU
凑单明细查询是只读能力：
1. 订单是否达到目标以及剩余差额以 `aro__query_order_analysis`.slog_summary` 为准；其有效数量包含订单确认量和当日 `ao_data`，并按 AO 原因分别返回。
2. **优先从上下文获取**：如果本轮或上轮 `aro__calc_replenishment` 的返回中已包含 `slog_fill_skus` 列表，直接引用即可，无需再次调用工具。
3. **如果上下文中没有**：调用 `aro__query_order_items`(po_number=xxx)` 查询订单明细，找出 `po_item_type` 包含"凑SLOG"或"凑单"的行即为凑单 SKU。
4. **如果不知道 PO 号**：先调用 `aro__query_orders`(shipto_code=xxx)` 拿到最新的 PO 号，再用 `aro__query_order_items` 查明细。

### 输出格式
返回 JSON:
```json
{
  "slog_target": 3500,
  "original_order_qty_cs": 1200,
  "today_ao_qty_cs": 100,
  "effective_original_qty_cs": 1300,
  "gap_cs": 2300,
  "fill_items": [
    {"bar_code": "...", "sku_name": "...", "fill_qty_cs": 50, "pack_count": 12}
  ],
  "total_filled_cs": 2300,
  "remaining_gap_cs": 0
}
```

### 安全红线
- 凑单量不得为负（每个 SKU max_fill ≥ 0）
- 凑单总量不超过 gap（不会超过凑单目标）
- 已在订单中的 SKU 也可参与凑单，但 max_fill 会扣减已订数量
- **严禁手算凑单量**：无论用户指定哪个 SKU，都**必须调用 `aro__run_slog_fill` 工具**计算。工具内部会自动执行40天库存上限校验。**绝对不可以自行计算 fill_qty = gap ÷ pack_count**，否则会导致超储。
- 指定 SKU 偏好是独立写操作，应由 **ST-23** 使用 `aro__set_slog_preference` 保存后，再回到本 Skill 执行 `aro__run_slog_fill`。

## === Layer 2: 业务逻辑（业务专家负责，可自主编辑）===

### 执行前置条件
ship-to 建议订单总量（CS）小于凑单目标时才存在凑单缺口。
凑单目标 by ship-to 可配，默认 3500CS，可配置范围 100-10000 CS。

### 与凑金额（ST-25）的关系（重要）
- 凑SLOG与凑金额 **互不清空**：本工具只删除并重算自己的「凑SLOG/凑单」行，凑金额（po_item_type="凑金额"）的行原样保留。
- **互为基数**：计算原始订单量时，会把已有的凑金额箱数算进 `original_order_qty_cs`。
- 因此若用户先凑金额、再凑SLOG，凑SLOG是把整单总箱数补到 `slog_target` 为止，不会覆盖凑金额；若凑金额已把箱数顶到/超过目标（gap ≤ 0），返回 note 说明「已达标、无需凑单、凑金额内容保留不变」，不报错。

### 凑单公式

#### Gap 计算
```
today_ao_qty_cs = sum(ao_data.order_confirm_qty_in_sales_unit)
  where ao_data.shipto_code = 当前 ship-to
    and ao_data.sales_doc_date = today()

effective_original_qty_cs = original_order_qty_cs + today_ao_qty_cs
gap_cs = slog_target − effective_original_qty_cs
```

说明：今日分货 AO 是已经在系统内、分货日等于今天的 AO 数量，等同于今天可计入凑 SLOG 目标的量。
不要求 AO SKU 已经出现在当前建议订单中；只要是当前 ship-to 当天分货的 AO，都计入凑 SLOG 目标。
例如原始订单 100CS，今天分货 AO 100CS，用户要凑到 500CS，则 gap = 500 − (100 + 100) = 300CS，只需要再凑 300CS。

#### 每个候选 SKU 的最大可凑量
候选范围沿用原有口径：`sku_extension.item_status = Active` 且当前销量口径下 `day_avg > 0`。候选资格不受 Ship-To Listing、ABC/D 类或 `stocking_sku` 清单限制；这些规则只影响正常补货。订单方案的经营部/仓库绑定决定 `day_avg` 的销量范围。

```
max_fill_ea = max_turnover_days × day_avg − available − already_ordered_ea − in_transit（分货在途+AO提前单）
max_fill_cs = max(0, floor(max_fill_ea / pack_count))
```
- max_turnover_days: 最高周转天数，默认读取 `plant_code_mapping.max_turnover_days`，无配置时兜底 40
- day_avg: 日均销量（来自 POS 数据），回溯窗口取该 ship-to 配置的 past_day_num（默认 90 天，可 by ship-to 配置）
- already_ordered_ea: 当前订单中该 SKU 已建议的数量（CS × pack_count）
- **AO提前单**: 此处指 `ao_data` 表中已确认的 AO 在途（ERP 已下达的实际订单），不是系统建议的 AO 计划（proposed_order 中 po_type='AO'）

#### 配额约束（Allotment Guard）
如果 SKU 在 `plant_code_quota` 中有有效期内的配额记录（`quota_start_date <= today <= quota_end_date`）：
```
allotment_cap = max(0, allotment_remaining_cs − already_ordered_cs)
max_fill_cs = min(max_fill_cs, allotment_cap)
```
配额已满的 SKU 不参与凑单。

#### AKBD 费用约束
> 当前实现口径：AKBD SKU 都进入费用约束；配额约束仍按原规则生效。费用不足时按净库存（`available_stock + in_transit`）处理，AO 在途不参与 AKBD 净库存判断：净库存 < 0 时只驱动补货补到 0，不补到目标库存；净库存 >= 0 时按 AKBD 费用预算截断/拦截。

如果 SKU 在 `akbd_plan` 中有记录（日期都为空视为有效，或 `fee_start_date <= today <= fee_end_date`），则该 SKU 受 AKBD 费用约束：
1. **查询机制名称**：用 bar_code + soldto 查 `akbd_plan` 获取 `product_name`（机制名称）
2. **查询达成率**：用 soldto + product_name 查 `akbd_track` 获取 `fee_achieve`（机制级别共享）
3. **计算剩余费用**：
   ```
   mechanism_remaining = (1 − fee_achieve) × plan.fee − sum(同机制所有SKU的 already_ordered_cs × case_price × discount)
   ```
4. **凑单费用检查**：
   ```
   fill_cost = fill_qty_cs × case_price × discount
   if fill_cost > mechanism_remaining:
       fill_qty_cs = floor(mechanism_remaining / case_price / discount)
   ```
5. **同机制共享预算**：贪心循环中先凑的 SKU 会消耗同机制预算，后续同机制 SKU 可用预算相应减少。

#### 排序规则
1. **用户偏好凑单品优先**（`slog_preference` 表中记录的 SKU）
2. 偏好品内按 priority 排序
3. 非偏好品按 **day_avg 降序**（销量最好的优先）
4. 依次累加，直到 gap 填满

### 能力流程

#### 首次使用
1. 调用 `aro__run_slog_fill` 获取系统按日均销排序的凑单方案
2. 结果需要指定偏好品且参数缺失时，返回单一澄清问题。
3. 偏好品已明确时，先转交 **ST-23** 记录偏好，再重新执行本 Skill。

#### 后续使用
1. `aro__run_slog_fill` 自动优先使用已记录的常用凑单品
2. 常用品凑完仍不够时，再用其余 SKU 按销量补充
3. 用户可随时通过对话更改偏好或凑单目标

#### 修改凑单目标
凑单目标变更由 **ST-05** 使用 `set_slog_target` 保存；保存后回到本 Skill 调用 `aro__run_slog_fill` 按新目标重算方案并展示给用户。

#### 修改常用凑单品
- 增量或替换偏好由 **ST-23** 使用 `aro__set_slog_preference` 完成。

### 单位说明
- `fill_qty_cs`: **CS（箱）** — 凑单建议量
- `pack_count`: 每箱 EA 数
- 内部计算的 max_fill_ea 单位为 EA

### 关联 Skills
- 依赖 **ST-03** 补货建议的订单总量作为触发判断
- **ST-20** ABC 分类可辅助理解凑单品选择逻辑
- **ST-15** 决策解释可追溯凑单原因

## === Layer 3: 运营参数（运营人员可调）===

### 凑单目标
- 默认: 3500 CS（可 by ship-to 配置）
- 范围: 100 ~ 10000 CS（用户可在对话中指定任意值，如 2000）

### 算法参数
- max_turnover_days（最高周转天数）: 默认读取 `plant_code_mapping.max_turnover_days`，无配置时兜底 **40**（范围 20 ~ 60）
- day_avg_lookback（日均销回溯天数）: 取该 ship-to 配置的 **past_day_num**（默认 90，可 by ship-to 配置，如本例 30）；输出时须按实际窗口标注，严禁照抄“过去90天”

### 常用凑单品
- 存储位置: `slog_preference` 表（by soldto + shipto）
- 来源: 用户对话指定（source=user）
- 优先级: priority 越小越优先

### 结果持久化
- 凑单品写入 `proposed_order_item` 表，`po_item_type = "凑SLOG"`
- 同时更新 `proposed_order` 的 `total_quantity` 和 `total_sku_count`
- 查询工具 `aro__query_order_items` 返回的 `po_item_type` 字段可区分凑单品与正常补货品
