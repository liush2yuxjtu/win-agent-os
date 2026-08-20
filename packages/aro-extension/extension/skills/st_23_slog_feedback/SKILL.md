---
name: st_23_slog_feedback
description: "查询或维护 ARO Ship-To 的常用凑单 SKU 偏好，包括查看、添加、替换、移除和清空。查看偏好必须调用 get_slog_preferences，写入偏好必须调用 set_slog_preference；实际凑单需另调用 run_slog_fill。"
---

# ST-23 凑单偏好反馈 — 用户指定常用凑单品

## === Layer 1: 架构约束 ===

### 工具权限
- 可调用: `aro__get_slog_preferences` / `aro__set_slog_preference` / `aro__run_slog_fill` / `aro__calc_replenishment` / `aro__query_order_analysis` / `aro__query_stock` / `aro__query_orders` / `aro__query_order_items`
- 禁止: 直接修改 slog_sku_config 系统配置表

### 输出格式
返回 JSON:
```json
{"ok": true, "shipto_code": "...", "action": "add", "added": [{"bar_code": "...", "sku_name": "..."}], "total_preferences": 5}
```

### 安全红线
- 条码必须存在于 SKU 主数据中
- 不可设置已停产（item_status ≠ Active）的 SKU 为偏好品

## === Layer 2: 业务逻辑 ===

### 偏好机制
用户指定的常用凑单品存储在 `slog_preference` 表中。
- `aro__run_slog_fill` 凑单计算时：**偏好品优先**于按日均销排序的候选品
- 偏好品按 priority 排序，priority 越小越优先
- 偏好品凑完仍不够时，再用剩余 SKU 按日均销量补充

### 能力契约

#### 查询偏好品
查询当前 Ship-To 的凑单偏好品时，调用 `aro__get_slog_preferences`(soldto_code, shipto_code)`；该工具只读，不得调用 `aro__set_slog_preference`。

#### 添加偏好品
添加偏好品使用 `action="add"`：
1. 调用 `aro__set_slog_preference`(soldto_code, shipto_code, bar_codes=[xxx], action="add")`
2. **自动调用 `aro__calc_replenishment`（不传 bar_code，全量重算）** 重新生成整张订单（含新凑单方案）
3. 告知用户"已添加" + 展示新订单凑单部分

#### 替换偏好品
替换偏好品使用 `action="replace"`：
1. 调用 `aro__set_slog_preference`(soldto_code, shipto_code, bar_codes=[A,B,C], action="replace")`
2. **自动调用 `aro__calc_replenishment`（不传 bar_code，全量重算）** 重新生成整张订单
3. 告知用户"已替换凑单品列表" + 展示新订单凑单部分

#### 调整凑单目标
凑单目标属于 **ST-05 SLOG 优化** 的专用配置能力。本 Skill 只维护偏好 SKU；目标保存后可调用 `aro__run_slog_fill` 展示新凑单方案。

#### 移除偏好品
移除指定偏好品使用 `action="remove"`：
1. 调用 `aro__set_slog_preference`(soldto_code, shipto_code, bar_codes=[xxx], action="remove")`
2. **自动调用 `aro__calc_replenishment`（不传 bar_code，全量重算）** 重新生成整张订单
3. 告知用户"已移除" + 展示新订单凑单部分

#### 清空全部偏好
清空偏好使用 `action="clear"`：
1. 调用 `aro__set_slog_preference`(soldto_code, shipto_code, action="clear")`
2. **自动调用 `aro__calc_replenishment`（不传 bar_code，全量重算）** 重新生成整张订单
3. 告知用户"已清除全部凑单偏好" + 展示新订单凑单部分

### 关联 Skills
- **ST-21** SLOG 凑单填充 — 执行凑单时读取偏好
- **ST-03** 补货计算 — 全量补货后自动触发凑单
- **ST-05** SLOG 优化 — 查看 SLOG 配置

## === Layer 3: 运营参数 ===

- 偏好粒度: soldto_code × shipto_code × bar_code
- 来源标记: source = "user"（区分系统配置）
- 凑单目标范围: 100 ~ 10000 CS
