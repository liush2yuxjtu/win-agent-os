---
name: st_04_ao_plan
description: "生成 ARO Ship-To 的 AO 提前单，并查询 AO 订单、库存和预测依据。创建或刷新 AO 建议必须调用 run_ao_plan，不能手工编造 AO 数量。"
---

# ST-04 AO 提前单 — Advance Order Planning

> Canonical Rule: `backend/app/rules/aro/ao_plan.md`。本 Skill 负责工具编排与交互；规则冲突时以该 Rule 文档为准。

## === Layer 1: 架构约束 ===

### 工具权限
- 可调用: `aro__run_ao_plan` / `aro__query_stock` / `aro__query_orders` / `aro__query_order_items` / `aro__forecast_demand`
- 禁止: 直接修改数据库

### 输出格式
返回 JSON:
```json
{
  "po_number": "AO-1234-0406-00263",
  "total_ao_items": 15,
  "total_ao_cs": 230,
  "total_amount": 185000,
  "ao1_date": "2026-06-05",
  "ao1_buffer_days": 5,
  "ao3_date": "2026-06-12",
  "ao3_buffer_days": 12,
  "top_items": [
    {
      "bar_code": "6901234",
      "sku_name": "XX洗发水500ml",
      "ao_type": "AO1",
      "buffer_days": 5,
      "delivery_date": "2026-06-05",
      "ao_qty_cs": 12,
      "case_price": 850.0,
      "line_amount": 10200.0
    }
  ]
}
```

### 安全红线
- AO 订单 po_type="AO"，po_item_type="AO"，与正常补货订单区分
- buffer_stock ≤ 0 的 SKU 不产生 AO（需走正常补货流程）
- buffer_days < 5 天的 SKU 不产生 AO（缓冲太薄，无法提前下单）
- ao_qty ≤ 0 的 SKU 不产生 AO（库存充足无需提前下单）
- AO 只在两个标定档位下单：**AO1**(≈5天) 或 **AO3**(≈12天)，分货日必须对齐 ship-to 订单日
- AO 与正常补货不冲突：AO 是提前下单，正常补货是补缺

## === Layer 2: 业务逻辑 ===

### 能力边界
提前订单能力分为只读查询与生成写入两类：
- "帮我看看263有哪些品可以提前下单"
- "AO计划"、"提前单"、"提前备货"
- "哪些品的分货日最近"
- 常规补货完成后主动建议："以下SKU可提前下单，是否生成AO？"

### AO 计算公式

#### Step 1: 最小库存（用 FCST，含最小前置期）
```
最小库存 (EA) = (safety_stock_day + min_lead_time) × FCST
```
- `safety_stock_day`: 来自 safety_stock_day 表（默认7天）
- `min_lead_time`: **最小前置期**，来自 plant_code_mapping.min_lead_time（按 ship-to 配置，默认2天）
- `FCST`: STL 三层预测按 ABC 档位选出的预测值（`aro__forecast_demand` 返回的 `forecastQty`）。**注意这里用 FCST，不是 neutral**。无值时回退 neutral / 日均销。

#### Step 2: 缓冲库存
```
buffer_stock (EA) = available - 最小库存
```
- buffer_stock ≤ 0 → 已低于最小库存线，跳过AO，走正常补货

#### Step 3: 缓冲天数
```
conservative_forecast = forecast_neutral
buffer_days = floor(buffer_stock / conservative_forecast)
```
- 用中性档预测做除数
- 如果 forecast_neutral 为0，改用日均销替代
- buffer_days < 5 → 缓冲不足5天，跳过（无法建议AO）

#### Step 4: 标定两个 AO 分货日（对齐订单日）
ship-to 订单日来自 order_day_config.order_days（1=周一 … 5=周五）。
- **AO1 分货日**：先取 `today + 5`；若该日不是订单日，往后顺延到最近的订单日。
  - 例：订单日为周二/周五，today+5 落在周三 → AO1 分货日延到 today+7（周五）。
  - 记录 **AO1 标定 buffer_days** = (AO1分货日 − today) 的天数（如上例为7）。
- **AO3 分货日**：先取 `today + 12`；若该日不是订单日，往后顺延到最近的订单日。
  - 例：today+12 落在周三 → AO3 分货日延到 today+14（周五）。
  - 记录 **AO3 标定 buffer_days** = (AO3分货日 − today) 的天数（如上例为14）。

#### Step 5: 选档（对比计算 buffer_days 与标定 buffer_days）
```
buffer_days ≥ AO3标定          → 下 AO3：分货日=AO3分货日，buffer_days=AO3标定
AO1标定 ≤ buffer_days < AO3标定 → 下 AO1：分货日=AO1分货日，buffer_days=AO1标定
buffer_days < AO1标定          → 跳过，下不了AO
```

#### Step 6: AO 下单量
```
cycle_qty = OTD(lead-time) × FCST
safety_stock = safety_stock_day × FCST   (不含 min_lead_time)
ao_qty (EA) = safety_stock + cycle_qty + buffer_days × day_avg
              − available − in_transit − 系统已有的AO
```
- `safety_stock`: 安全库存 = safety_stock_day × FCST（不含 min_lead_time）
- `cycle_qty`: 正常补货周期量 = lead-time × FCST（OTD = ti_leadtime）
- `buffer_days`: Step 5 选定档位（AO1 或 AO3）的**标定** buffer_days
- `day_avg`: 纯日均销售（**不是** FCST）
- `in_transit`: 分货在途 + 已确认AO在途（来源 `ao_data` 表 / `stock.in_transit_stock_total`，ERP 已下达的实际订单）
- `系统已有的AO`: 系统之前通过 `aro__run_ao_plan` 生成、尚未推送的 AO 计划量（proposed_order po_type=AO，排除当天重算的）
- ao_qty ≤ 0 → 库存足以覆盖，不生成 AO

#### 单位转换
```
ao_qty_cs = ceil(ao_qty_ea / pack_count)
line_amount = ao_qty_cs × case_price
```
- 与正常订单一致，EA 除以 pack_count 向上取整到整箱

### 执行流程

#### 首次使用
1. 查询已有 AO 订单使用 `aro__query_orders` / `aro__query_order_items`
2. 生成 AO 计划使用 `aro__run_ao_plan`(shipto_code=...)`
3. 展示结果表格（按提前天数升序 — 最紧急的排前面）:

| SKU | 名称 | 档位 | 缓冲库存 | 提前天数 | 分货日 | AO量(CS) | 金额 |
|-----|------|------|---------|---------|--------|---------|------|
| 6901234 | XX洗发水 | AO1 | 100EA | 5天 | 06/05 | 5CS | ¥4250 |

4. 汇总信息："共15个SKU需要AO提前单，合计230CS，金额¥185,000"

#### 补货后主动建议
1. 正常补货完成后，主动调用 `aro__run_ao_plan`
2. 如果有 AO 结果，告知用户：
   "另外，以下 X 个SKU的缓冲库存较薄（低于5天），建议提前下单："
3. 展示最紧急的几个

#### 单品AO查看
单 SKU AO 计划使用 `aro__run_ao_plan`(bar_code=...)`；已有 AO 明细仍使用订单查询工具。
- 单品与批量模式使用相同的 STL 三层预测（high/neutral）
- 展示详细计算过程

### 单位说明
- `ao_qty_cs`: **CS（箱）** — AO 建议量
- `buffer_days`: **天** — 缓冲库存能撑几天
- `delivery_date`: AO 需到货日期（分货日）
- `case_price`: **¥/箱（不含税）**
- `line_amount`: **¥** — 该SKU的AO金额

### 关联 Skills
- **ST-01** 需求预测提供 forecast_high / forecast_neutral
- **ST-02** 安全库存天数提供 safety_stock_day
- **ST-03** 正常补货订单（AO 与之互补，不冲突）
- **ST-15** 决策解释可追溯 AO 计算过程
- **ST-26** 需求倍率影响 forecast → 间接影响 AO 量

## === Layer 3: 运营参数 ===

### 算法参数
- OTD（Order-to-Delivery / cycle lead-time）: 从 plant_code_mapping.ti_leadtime 读取（默认 3 天），用于 cycle_qty
- min_lead_time（最小前置期）: 从 plant_code_mapping.min_lead_time 读取（默认 2 天），用于 Step 1 最小库存
- order_days（订单日）: 从 order_day_config.order_days 读取（1=周一 … 5=周五），用于 Step 4 标定分货日
- safety_stock_day: 从 safety_stock_day 表读取（默认 7 天）
- day_avg_lookback: 日均销回溯天数（默认 90 天）
- 预测来源: **批量与单品均调用 `aro__forecast_demand`（STL 三层预测）**。Step 1 用 FCST（forecastQty，ABC 选档）；Step 3 用 forecast_high/neutral。

### AO 订单标识
- po_type = "AO"（区别于正常订单 po_type="1"）
- po_item_type = "AO"
- po_number 前缀 = "AO-"

### 持久化
- AO 订单写入 proposed_order + proposed_order_item 表
- 同一 ship-to 同一天重复计算会覆盖（删旧建新）
- 查询工具 `aro__query_orders` / `aro__query_order_items` 可查看 AO 订单

输出契约：AO 计划以 **promotional calendar** 驱动时间倒推和增量需求；保留 release date、uplift、lead time 字段名。不臆造档期，日历缺失时不生成 AO。
