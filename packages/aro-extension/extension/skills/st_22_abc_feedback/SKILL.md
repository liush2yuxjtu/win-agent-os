---
name: st_22_abc_feedback
description: "为 ARO 当前订单方案中的 SKU 设置、修改、查询或删除有生效期的人工 ABC 分类覆盖。执行“将 SKU 改为 B 类”“把某商品设为 A/B/C/D 类”或“调整 SKU 分类”时，必须使用 set_abc_override；用户可提供明确日期或30天、2个月、半年等相对时长，缺少有效期时只能追问，不能声称已保存。"
---

# ST-22 ABC 分类反馈 — 用户覆盖 SKU 分类

## === Layer 1: 架构约束 ===

### 工具权限
- 可调用: `aro__set_abc_override` / `aro__get_abc_overrides` / `aro__run_abc_classification` / `aro__query_stock`
- 禁止: 直接修改 sku_forecast.abc_class（通过 override 表间接生效）

### 输出格式
返回 JSON:
```json
{"ok": true, "abc_class": "B", "items": [{"bar_code": "...", "sku_name": "...", "new_class": "B", "action": "created"}]}
```

### 安全红线
- abc_class 仅允许 A / B / C / D 四个值
- 不可批量将所有 SKU 覆盖为同一类别（单次最多 50 个）

### Effective Date Rules
- Mandatory: ABC overrides cannot be written before the effective date range is known. If the user did not provide dates, call `aro__set_abc_override` with the known params; it will not write data and will return `needs_clarification` plus `pending_action` for the UI to preserve. Ask the follow-up question from that result.
- The Runtime Context contains the server's actual `current_date` and timezone. Never infer the current year from model knowledge.
- For a relative duration such as `30天`, `6周`, `2个月`, `一个半月`, `半年`, or `1年`, pass the original wording unchanged as `effective_duration_text`. The backend computes `effective_from` and `effective_until` from the server date. Do not convert a relative duration into dates in the model.
- For an explicitly supplied absolute range, pass `effective_from` and `effective_until` in `YYYY-MM-DD`.
- ABC override writes require either an absolute range or `effective_duration_text`; missing values return one focused clarification question without writing.
- Default-date authorization maps to `effective_from=today` and `effective_until=today + 3 months`.
- An entirely expired range is rejected without writing. Overrides only take effect when `effective_from <= today <= effective_until`; future records remain stored but do not apply before their start date.

## === Layer 2: 业务逻辑 ===

### 覆盖机制
用户手动指定的 ABC 分类存储在 `sku_abc_override` 表中，粒度为 **soldto × shipto × order_profile_id × barcode**，在当前订单方案内优先于算法计算结果。
- `aro__forecast_demand` 读取分类时：先查 override 表 → 有则用 → 无则读 `sku_forecast.abc_class`
- `aro__run_abc_classification` 仅返回分类预览，不写入 `sku_forecast`；持久化 ABC 与预测必须通过范围化预测重算流程完成
- 分类影响预测档位：A→high（乐观）、B→neutral（稳健）、C→low（保守）、D→0（不补货）

### 能力契约

#### 设置覆盖
设置覆盖是显式写操作：
1. 相对时长调用 `aro__set_abc_override`(..., effective_duration_text="2个月")`；用户明确给出日期时调用 `aro__set_abc_override`(..., effective_from="YYYY-MM-DD", effective_until="YYYY-MM-DD")`
2. **自动调用 `aro__calc_replenishment`（不传 bar_code 参数！全量重算）** 重新生成整张订单
3. 若工具结果 `auto_recalculated=true`，明确告知用户“已自动刷新当前订单中受影响 SKU 的明细”；不得再询问是否需要刷新

#### 查看覆盖
查看覆盖是只读操作：
1. 调用 `aro__get_abc_overrides`(soldto_code)`
2. 展示所有覆盖记录（条码、名称、覆盖分类、原因、时间）

#### 取消覆盖
取消覆盖是显式删除操作：
1. 调用 `aro__set_abc_override`(soldto_code, shipto_code, bar_code, action="remove")`
2. **自动调用 `aro__calc_replenishment`（不传 bar_code，全量重算）** 重新生成整张订单
3. 若工具结果 `auto_recalculated=true`，明确告知用户已自动刷新当前订单中受影响 SKU 的明细

#### 多条码批量操作
多条码设置共享同一写入契约：
1. 调用 `aro__set_abc_override`(soldto_code, shipto_code, bar_codes=[xxx,yyy,zzz], abc_class="A", effective_duration_text="2个月")`，或传用户明确给出的绝对日期范围
2. **自动调用 `aro__calc_replenishment`（不传 bar_code，全量重算）** 重新生成整张订单
3. 展示覆盖结果 + 受影响 SKU 的新建议量

### 关联 Skills
- **ST-01** 需求预测 — 预测时自动读取 override，无需额外调用
- **ST-03** 补货计算 — 间接生效（补货调 forecast → forecast 读 override）
- **ST-20** ABC 分类 — 重算分类后可告知用户哪些已被手动覆盖

## === Layer 3: 运营参数 ===

- 合法分类值: A / B / C / D
- 覆盖粒度: soldto_code × shipto_code × order_profile_id × bar_code
- 单次最大覆盖条码数: 50
