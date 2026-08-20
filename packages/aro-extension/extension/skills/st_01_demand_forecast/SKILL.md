---
name: st_01_demand_forecast
description: "查询 ARO SKU 的销量、ABC 档位和 STL 三档需求预测；仅提供预测分析或预览，不写入预测缓存。需要从销售源持久重算 ABC、预测并生成订单时，应使用补货计算。"
---

# ForecastSkill — 需求预测（STL 三档方法）

> Canonical Rule: `backend/app/rules/aro/forecast.md`。本 Skill 负责工具编排与交互；规则冲突时以该 Rule 文档为准。

## === Layer 1: 架构约束（架构师负责，修改需评审）===

### 工具权限
- 可调用: `aro__forecast_demand` / `aro__forecast_detail` / `aro__query_day_avg_sales` / `aro__query_stock` / `aro__run_abc_classification`
- 禁止: 直接修改 pos_daily_sales 表, 直接修改生产数据库

### 工具选择
- 三档预测值和最终采用值由 `aro__forecast_demand` 提供。
- 预测归因、历史销量和异常销量证据由 `aro__forecast_detail` 提供，可补充 `aro__query_day_avg_sales`。
- 预测方法和 ABC 选档属于概念解释，不生成订单、不写库。
- 异常过滤写入属于 ST-24；本 Skill 只提供识别异常所需的数据证据，查询不能变成修改。

### 输出格式
返回 JSON:
```json
{
  "shiptoCode": "...",
  "forecasts": [
    {
      "barCode": "...",
      "high": 12.5,
      "neutral": 8.3,
      "low": 3.1,
      "forecastQty": 8.3,
      "abcClass": "B",
      "method": "stl_three_tier",
      "lookbackDays": 180,
      "filteredAnomalies": 2
    }
  ]
}
```

### 安全红线
- 预测值不得为负数（floor at 0）
- 单 SKU 预测量不得超过日均销的 30 倍
- D 类 SKU 预测值强制为 0，不得覆盖

## === Layer 2: 业务逻辑（业务专家负责，可自主编辑）===

### 预测方法：STL 季节分解三档预测

系统基于最近 **lookback_days**（默认 180 天）的门店日销量数据，通过 STL 季节性分解生成三档预测：

- **高值预测 (high)**: 旺季时段（季节因子高于中位数的天数）的平均日销量
- **中值预测 (neutral)**: 去除季节波动后的趋势基准值，反映稳定需求水平
- **低值预测 (low)**: 淡季时段（季节因子低于中位数的天数）的平均日销量

三档关系始终满足：high ≥ neutral ≥ low ≥ 0

### ABC 分类 → 最终预测值选择

ABC 分类由 **ST-20 ABC SKU 分类** 动态计算（基于 POS 实际销量 Pareto 法则），而非静态配置。
`aro__run_abc_classification` 只提供只读分类预览，不刷新 `sku_forecast`。源销售 ABC+预测持久化重算属于 ST-03，使用 `aro__calc_replenishment`(force_recompute=true, soldto_code, shipto_code)`；`forecast_recomputed=true` 是完成证据。

| ABC 类 | 选用档位 | 业务含义 |
|--------|---------|---------|
| **A**（高频稳定品） | **high** | 重要 SKU 优先保障供应，採用乐观预测避免缺货 |
| **B**（中频品） | **neutral** | 稳健预测，平衡库存成本与服务水平 |
| **C**（低频品） | **low** | 保守预测，控制慢动品库存积压 |
| **D**（不备库品） | **0** | 不做预测，不备货 |

### 异常处理规则
1. **区间内无任何销售数据**（全零） → `forecastQty = 0`
2. **有销量但 ABC 选出的预测值 = 0** → 回退至 90 天日均销量
3. **用户已标记的异常大单** → 自动从历史数据中过滤后再跑预测（见"用户反馈"节）

### 用户反馈与异常过滤（交互式）

预测结果诊断支持以下证据链：

#### 步骤 1：展示支撑数据
调用 `aro__forecast_detail` 工具，为用户提供：
- 指定区间内**销量最高的 3 天**：日期 + 当天总销量
- 每个高销量日的**销量最大门店**：门店编码 + 门店中文名（如已导入）+ 该门店当天订单量
- 当前已被标记过滤的异常记录数

用户看到这些支撑数据后可以判断是否存在异常大单。

#### 步骤 2：异常标记转交
异常大单经业务确认后，应转交 **ST-24 预测异常反馈**调用 `aro__mark_anomaly_order`：
- 记录到 `forecast_anomaly_filter` 表，**持久化存储到数据库**
- 用户可以通过 **门店中文名** 或 **门店编码** 指定门店，系统自动关联到 store_code
- 日期**可选**：
  - 提供日期 → 只过滤该门店当天的销量
  - 不提供日期 → 过滤该门店**所有天**的销量（整店过滤）
- 可选附原因说明

#### 步骤 3：重新预测
标记异常后，再次调用 `aro__forecast_demand`，系统自动：
- 读取该 SKU 的所有异常标记记录
- 从日销量中扣除被标记的门店 + 日期的销量
- 基于过滤后的数据重新跑 STL 三档预测
- 返回结果中包含 `filteredAnomalies` 字段，说明过滤了多少条数据点

#### 持久化机制
- 异常标记通过 `forecast_anomaly_filter` 数据库表**永久存储**
- 后续每次预测该 SKU 都会自动读取过滤记录并排除对应销量
- 取消之前的标记同样由 **ST-24** 使用 `aro__mark_anomaly_order`(action="remove")` 完成
- **不使用本体关系**，直接通过数据库关联，确保跨会话、跨订单复用

#### 规则
- LLM 不要自行判断哪些是异常 — 只展示数据，让用户决定
- 门店中文名由 customer_store 表在当前客户范围内解析为 store_code
- 如果匹配不到门店名称，提示用户提供门店编码

### 关联 Skills
- **ST-02** 安全库存需要 forecast 结果：`safety_quantity = forecastQty × safety_days`
- **ST-03** 补货建议直接消费 forecastQty
- **ST-16** 参数调优可反馈调整 lookback_days / stl_period

## === Layer 3: 运营参数（运营人员可调）===

### 数据窗口
- lookback_days（历史数据回溯天数）: **180**（范围 90 ~ 365，配置表字段 `calc_avg_sales_day`）
- min_data_days（有效销售天数下限）: **60**（少于此值走 fallback）

### STL 参数
- stl_period（季节周期天数）: **90**（范围 30 ~ 180，配置表字段 `stl_period`）
- ewm_span（趋势平滑跨度）: **7**（范围 3 ~ 30，配置表字段 `stl_span`）

### ABC 预测值映射
- A 类 → high
- B 类 → neutral
- C 类 → low
- D 类 → 0（强制）

### ABC 分类参数
- 分类回溯天数: **30**（POS 销量统计窗口）
- A 类累计占比阈值: **0.8**（80%）
- B 类累计占比阈值: **0.9**（90%）
- 零销量 SKU 默认分类: **D**
- 无分类数据默认: **B**（中性档）

### Fallback 规则
- STL 所选档位 = 0 但有销量 → 回退至 90 天日均销量
- 无任何销量数据 → forecastQty = 0
- C 类 → low
- D 类 → 0

### 支撑数据展示
- top_days（展示销量最高天数）: **3**
- 每天展示 top 门店数: **1**

### 回退参数
- fallback_method: 90 天日均销量
- 回退触发条件: 有销量但选定预测值 = 0，或历史数据 < min_data_days 天
