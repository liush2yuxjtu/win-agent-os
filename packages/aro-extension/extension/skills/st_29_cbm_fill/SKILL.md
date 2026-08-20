---
name: st_29_cbm_fill
description: "查询当前 ARO 订单体积，或按目标/追加 CBM 为指定订单凑体积。修改订单必须调用 run_cbm_fill 并携带 po_number；只读问题不得执行凑单。"
---

# ST-29 CBM Fill

## Purpose
Add eligible SKUs to the order under review until a target or additional CBM volume is reached.

For a read-only question about the current order's CBM, call `aro__query_order_metrics` first. It uses confirmed CS (or suggested CS when confirmation is absent) and `sku_master_data.case_volume / 1000`; it must report missing volume master-data coverage. A CBM gap is only available with a supplied or configured target. Do not use sandbox to guess volume fields.

## Tool Selection
- `run_cbm_fill` is a write capability and requires explicit authorization to change an order by CBM/volume.
- Use `target_value` for a final target such as "fill to 50 CBM".
- Use `additional_value` for an increment such as "add another 10 CBM".
- Always pass the current `po_number`; preserve an explicitly named category and preferred SKU list.
- For a status/explanation question, use `aro__query_order_items` and do not run a fill.

## Write Boundary
`run_cbm_fill` writes order lines. Missing target/additional value or ambiguous order requires clarification; never guess and never calculate fill quantities manually.
