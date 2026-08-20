---
name: st_31_weight_fill
description: "查询当前 ARO 订单重量，或按目标/追加吨数为指定订单凑重量。修改订单必须调用 run_weight_fill 并携带 po_number；只读问题不得执行凑单。"
---

# ST-31 Weight Fill

## Purpose
Add eligible SKUs to the order under review until a target or additional tonnage is reached.

## Tool Selection
- `run_weight_fill` is a write capability and requires explicit authorization to change an order by weight/tonnage.
- `aro__query_order_metrics` and `aro__query_order_analysis`.physical_summary` are read-only and return the current order's total tons using the same quantity, SKU master and rounding conventions as the review workbench.
- Use `target_value` for a final target such as "fill to 20 tons".
- Use `additional_value` for an increment such as "add another 5 tons".
- Always pass the current `po_number`; preserve an explicitly named category and preferred SKU list.
- For a status/explanation question, use `aro__query_order_metrics` or `aro__query_order_analysis` and do not run a fill.

## Write Boundary
`run_weight_fill` writes order lines. Missing target/additional value or ambiguous order requires clarification; never guess and never calculate fill quantities manually.
