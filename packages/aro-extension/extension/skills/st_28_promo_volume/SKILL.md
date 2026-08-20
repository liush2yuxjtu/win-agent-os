---
name: st_28_promo_volume
description: "维护 ARO 促销、团购和企业购的活动报量，包括新增、查询和取消。写入必须调用 add_promo_volume，并提供 SKU、分货日和数量。"
---

# ST-28 活动报量 — 促销/团购/企业购加量

## === Layer 1: 架构约束 ===

### 工具权限
- 可调用: `aro__add_promo_volume` / `aro__list_promo_volumes` / `aro__query_order_analysis` / `aro__query_stock` / `aro__calc_replenishment` / `aro__query_orders` / `aro__query_order_items`
- 禁止: 直接修改数据库
- `aro__list_promo_volumes` 返回已配置的活动报量；`aro__query_order_analysis`.promo_summary` 同时返回配置记录和实际计入当前订单的记录。两者不得混为一谈。

### 输出格式
操作成功后返回 JSON 摘要:
```json
{
  "action": "add",
  "bar_code": "6903148062722",
  "sku_name": "汰渍洗衣液500ml",
  "dispatch_date": "2025-07-20",
  "quantity": 50,
  "unit": "CS",
  "quantity_cs": 50,
  "reason": "社区团购活动",
  "status": "active"
}
```
取消时:
```json
{"action": "cancel", "bar_code": "6903148062722", "dispatch_date": "2025-07-20", "status": "cancelled"}
```

### 安全红线
- **bar_code 是必填项**；缺失时返回单一澄清问题。
- **dispatch_date 是必填项**:
  - 相对日期必须解析为明确 `dispatch_date`。
  - `dispatch_date` 缺失时返回单一澄清问题，不设默认日期。
- quantity 必须 > 0
- 单位默认 CS；件数单位统一映射为 `unit='EA'`，系统按 pack_count 转换为 CS。

## === Layer 2: 业务逻辑 ===

### 场景说明
用户有活动/促销/团购/企业购等额外需求，需要在常规补货建议量基础上**增加**指定数量。
这些加量会在补货计算(`aro__calc_replenishment`)时自动叠加到对应 SKU 的建议量上。

### 执行前置条件
- "这个品有活动，帮我加50箱"
- "团购要100箱汰渍"
- "企业购需要200箱，加到明天的单上"
- "帮我报量，6903148062722 加30箱，后天发货"
- "取消之前报的活动量"
- "看看我报了哪些活动量"

### 工作流程
1. **解析用户意图**: 判断是 add / cancel / list
2. **收集必要参数**:
   - add: 需要 bar_code, quantity, dispatch_date (+ 可选 unit, reason, shipto_code)
   - cancel: 需要 bar_code, dispatch_date
   - list: 仅需 soldto_code (+ 可选 shipto_code, bar_code)
3. **调用 `aro__add_promo_volume` 工具**执行操作
4. **确认结果**: 返回操作摘要，包括 SKU 名称、数量(CS)、计划发货日
5. **⚠️ 自动冲刷订单**: 如果 dispatch_date 是今天，操作成功后**必须自动调用 `aro__calc_replenishment`（不传 bar_code 参数！）** 全量重新生成订单，这样活动加量会叠加到整张订单中，而不是生成独立的单品PO。将重算结果摘要一并返回给用户（总SKU数、总箱数、含活动报量的SKU明细）。
6. 如果 dispatch_date 是未来日期，仅提示"已记录，届时生成订单会自动包含此加量"

### 与补货的关系
- 活动报量存入 `promo_volume_addition` 表，status='active'
- 当运行 `aro__calc_replenishment` 时，系统自动查询当天有效的活动报量
- 匹配的 SKU 自动叠加 quantity_cs 到建议量上
- calc_reason 中会标注 "含活动报量XCS"
- 当天补货完成后，status 可改为 'consumed'

### 单位转换
| 业务单位 | unit | 转换逻辑 |
|---|---|---|
| 箱 / 件 / CS | CS | 直接使用 |
| 支 / 个 / IT / EA | EA | quantity ÷ pack_count = quantity_cs |

### shipto_code 推断
- 如果会话上下文中已有 shipto_code，自动使用
- ship-to 未指定且存在多个候选时，返回单一澄清问题。

## === Layer 3: 参数与联动 ===

### `aro__add_promo_volume` 参数
| 参数 | 必填 | 说明 |
|---|---|---|
| soldto_code | 是 | 经销商编码(从 session 获取) |
| shipto_code | 否 | 送达方编码(从 context 推断) |
| bar_code | 是(add/cancel) | 商品条码 |
| dispatch_date | 是(add/cancel) | 计划发货日 YYYY-MM-DD |
| quantity | 是(add) | 数量 |
| unit | 否 | 'CS'(默认) 或 'EA' |
| reason | 否 | 活动原因描述 |
| action | 是 | 'add' / 'cancel' / 'list' |

### 联动技能
- **st_03_replenishment**: 活动报量自动叠加到补货建议量
- **st_26_demand_feedback**: 活动报量是一次性加量，demand_uplift 是持续性倍率调整，两者互不冲突
