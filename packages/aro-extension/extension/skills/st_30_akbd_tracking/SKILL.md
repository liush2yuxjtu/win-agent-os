---
name: st_30_akbd_tracking
description: "查询 ARO AKBD 机制费用、达成率和剩余额度；仅在用户明确要求刷新或重算时，调用 compute_akbd_tracking 写入跟踪结果。"
---

# ST-30 AKBD Tracking Calculation

## Metadata
- **Name**: st_30_akbd_tracking
- **Category**: Resource / AKBD
- **Domain**: aro
- **Tools**: `aro__compute_akbd_tracking`, `aro__query_akbd_usage`, `aro__query_order_analysis`
- **Tags**: `akbd`, `akbd_track`, `akbd_plan`, `fee_achieve`, `mechanism`

## Purpose
计算并查询当前有效 AKBD 计划的使用情况。

`akbd_plan` 是 AKBD 计划来源，由 ARO 侧导入或生成；`akbd_track` 是系统根据 `akbd_plan`、宝洁销售交付数据和 200case 箱价格计算生成的机制级跟踪表。

`aro__query_order_analysis`.akbd_summary` 是当前订单生成快照中的 AKBD 约束结果，包含全量命中 SKU、正数量 SKU、本单费用和机制汇总。`akbd_track` 为空只表示机制跟踪尚未刷新，不能解释成没有有效计划或当前订单没有 AKBD SKU。

## Calculation Rule
1. 从 `akbd_plan` 读取当前有效计划：
   - `fee_start_date <= today`
   - `fee_end_date >= today`
   - 或开始、结束日期都为空。
2. 有效计划明细按以下信息识别：
   - `soldto_code`
   - `bar_code`
   - 机制名称：优先使用 `product_name`，其次 `fee_desc`、`fee_type`
   - `discount`
   - `amount`
   - `fee_start_date`
   - `fee_end_date`
3. 按 `soldto_code + bar_code` 到 `customer_order_delivery` 查询宝洁销量：
   - `sales_doc_date >= fee_start_date`
   - `sales_doc_date <= fee_end_date`
   - 销量字段使用 `delivery_qty_in_cs`
4. SKU 下单金额：
   - `sku_order_amount = sku_extension.case_price * delivery_qty_in_cs`
5. SKU 返点金额：
   - `sku_order_calc_fee = sku_order_amount * akbd_plan.discount`
6. `akbd_track` 按机制维度汇总：
   - 业务 key：`soldto_code + 机制名称 + fee_start_date + fee_end_date`
   - `order_amount = sum(sku_order_amount)`
   - `order_calc_fee = sum(sku_order_calc_fee)`
   - `fee_achieve = order_calc_fee / amount`
   - `amount` 使用同一 `soldto_code + 机制名称 + fee_start_date + fee_end_date` 下的计划原始金额；优先取 `akbd_plan.amount`，为空时兼容旧导入取 `akbd_plan.fee`。

## Refresh Rule
- 相同业务 key 的 `akbd_track` 会被重新计算并覆盖刷新。
- 已过期窗口的历史 `akbd_track` 记录保留。
- 前端导入 `akbd_plan` 后，应触发一次 AKBD track 刷新。

## Tool Usage
- `aro__compute_akbd_tracking` 是刷新/重算写能力，需要明确写入授权。普通查询不得调用。
- AKBD 机制、达成率、剩余费用和使用情况均由只读工具 `aro__query_akbd_usage` 提供。
- 不要手工估算 AKBD 使用情况；必须使用工具返回数据库中的计算结果。

## Parameter Contract
- `aro__query_akbd_usage`(mechanism_name)` 限定单个机制。
- `aro__query_akbd_usage`(active_only=true)` 返回当前有效机制。
- `soldto_code` 由当前客户范围注入。
