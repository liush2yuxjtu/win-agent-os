---
name: st_24_anomaly_feedback
description: "查询、添加或移除 ARO 异常销量过滤规则，包括大批发门店、异常大单和指定 SKU/日期。写入必须调用 mark_anomaly_order，名称歧义时必须先让用户确认门店。"
---

# ST-24 预测异常反馈 — 用户标记异常门店/大单

## === Layer 1: 架构约束 ===

### 工具权限
- 可调用: `aro__list_anomaly_filters` / `aro__mark_anomaly_order` / `aro__forecast_detail` / `aro__forecast_demand` / `aro__query_stock` / `aro__query_day_avg_sales`
- 禁止: 直接修改 pos_daily_sales 原始数据
- 禁止: 面向客户输出其他 soldto_code 的异常过滤规则、全局跨分销商规则概览或示例。

### 门店名称模糊反馈规则
- 用户用门店名称反馈剔除时，优先调用 `aro__mark_anomaly_order` 并传 `store_name`，不要编造 `store_code`。
- `aro__mark_anomaly_order` 会在 `store_mapping.customer_name` 中按名称模糊匹配，并解析出 `store_code` 后再写入 `forecast_anomaly_filter`。
- 如果工具返回 `needs_confirmation=true` 或 `candidates`，说明匹配到多个门店：必须把候选的 `store_name/store_code` 列给用户确认，不能自行选择，也不能落表。
- 如果只匹配到一个门店，工具会直接落表；回复用户时说明已匹配到的完整门店名称和门店编码。
- 如果用户表达“整店剔除/大批发门店/剔除这个门店所有销量”，调用时不传 `bar_code` 或传 `bar_code="*"`。
- 如果用户指定某个 SKU/Barcode/日期/订单号，则把对应字段一起传给工具；未指定时按现有默认范围处理。
- 异常过滤、剔除规则和大批发门店规则列表由 `aro__list_anomaly_filters` 提供，范围参数为当前 `soldto_code` 和可选 `shipto_code`。输出严格限定当前客户范围。
- 列表结果中 `total_records` 是数据库总数，`page_returned_records` 是接口分页返回数，`displayed_records` 是提供给回答的明细数；后两者不得表述为总数。
- 只能基于实际展示的明细描述具体门店。没有覆盖全部 `total_records` 的聚合证据时，不得断言全部记录具有相同原因、来源或创建时间。

### 输出格式
返回 JSON:
```json
{"ok": true, "action": "added", "bar_code": "...", "store_code": "...", "sales_date": "2026-03-15"}
```

### 安全红线
- LLM 不可自行判断哪些是异常 — 只展示数据，让用户决定
- 异常标记持久化到数据库，跨会话生效

## === Layer 2: 业务逻辑 ===

### 异常过滤机制
用户标记的异常门店/大单记录存储在 `forecast_anomaly_filter` 表中。
- 过滤范围固定为 `soldto_code + shipto_code`，同一 Ship-To 下的所有订单方案共用，不按 `order_profile_id` 隔离。
- **当前经销商范围内的全计算环节预过滤**：异常标记只在匹配的 `soldto_code × shipto_code × bar_code × store_code × sales_date` 范围内生效，但作用于该范围内**所有输入销量的计算环节**，不仅限于预测：
  - `aro__forecast_demand` — STL 预测前排除异常销量
  - `generate_proposed_orders` — 补货日均计算时排除异常销量
  - `recalc_safety_stock` — 安全库存/COV重算时排除异常销量
- 支持两种粒度：
  - 指定日期：只过滤该门店当天的销量
  - 不指定日期：过滤该门店所有天的销量（整店过滤）
- **支持通配过滤**（`bar_code="*"`）：
  - 不传 bar_code 或传 `"*"` → 过滤该门店**所有SKU**的销量
  - 适用于大批发门店整店剔除场景

### 能力契约

#### 查看数据后标记
1. `aro__forecast_detail` 提供高销量日期和门店证据。
2. `aro__mark_anomaly_order` 仅在异常已确认后写入。
3. `aro__forecast_demand` 提供过滤后预测。
4. 订单重生成是独立写操作，不由查看证据自动触发。

#### 直接标记
直接标记需要门店身份和可选 SKU/日期：
1. 支持门店中文名或编码，系统通过 customer_store 表自动匹配 store_code
2. 调用 `aro__mark_anomaly_order`(bar_code, store_code/store_name, sales_date可选, reason可选)`
3. **自动调用 `aro__calc_replenishment`** 重新生成订单
4. 告知用户"已标记" + 该 SKU 新建议量

#### 整店剔除（大批发门店）
整店剔除使用 `bar_code="*"` 契约：
1. 调用 `aro__mark_anomaly_order`(store_code="XXX", reason="大批发门店")`，**不传 bar_code**
2. 系统自动使用 `bar_code="*"` 通配，过滤该门店全部SKU的销量
3. **自动调用 `aro__calc_replenishment`** 重新生成整张订单
4. 告知用户"已整店过滤" + 影响的订单变化

#### 取消标记
取消标记使用 `action="remove"`：
1. 调用 `aro__mark_anomaly_order`(bar_code, store_code, action="remove")`
2. **自动调用 `aro__calc_replenishment`** 重新生成订单
3. 告知用户"已取消标记" + 该 SKU 新建议量

### 持久化机制
- 标记通过 `forecast_anomaly_filter` 数据库表**永久存储**
- 后续每次预测、补货计算、安全库存重算都自动读取过滤记录
- 返回值中 `filteredAnomalies` 字段说明过滤了多少条

### 关联 Skills
- **ST-01** 需求预测 — `aro__forecast_demand` 自动读取异常过滤
- **ST-03** 补货计算 — 间接生效（补货调 forecast → forecast 已过滤异常）
- **ST-22** ABC 反馈 — 分类覆盖 + 异常过滤可组合使用

## === Layer 3: 运营参数 ===

- 过滤粒度: soldto_code × shipto_code × bar_code × store_code × sales_date(可选)
- 来源标记: created_by = "user"
- 标记方式: `action = "add"` 或 `action = "remove"`
