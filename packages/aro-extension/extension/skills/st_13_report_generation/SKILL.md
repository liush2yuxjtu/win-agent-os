---
name: st_13_report_generation
description: "汇总 ARO KPI、库存健康和建议订单数据，生成日、周、月度业务报告内容；仅读取事实数据，不执行业务写入。"
---

# ST-13 报表生成（Daily / Weekly / Monthly Reports）

## 1. Metadata

| 字段 | 值 |
|------|-----|
| **Name** | ST-13 报表生成 |
| **ID** | `ST-13` |
| **Category** | Reporting / 报表 |
| **Layer** | Batch + Template |
| **Tags** | `daily`, `weekly`, `monthly`, `report`, `schedule`, `export` |
| **Description** | 按 **daily / weekly / monthly** 周期生成标准运营报表：汇总 KPI（ST-12）、异常摘要（ST-09）、订单与推送状态（ST-08），支持 PDF/Excel/HTML 与邮件分发。 |

## 2. Execution Logic

### Steps

1. 根据 `report_schedule` 解析时间窗（自然日、ISO 周、财务月）。
2. 拉取数据集：销售、库存、建议采纳、AO、SLOG、配额、同步健康度。
3. 套用 **template**（Jinja/Markdown→PDF）：封面、目录、图表占位、附录定义表。
4. 生成文件至对象存储或共享盘；写 `report_run_id`, `period`, `checksum`。
5. 通知订阅者；失败重跑与幂等（同 period 覆盖或版本递增）。

### Tools Used

- 调度器（Airflow/cron）
- 图表库（matplotlib / echarts 导出）
- 邮件/IM 网关

### Constraints

- 大月结报表须 **off-peak** 窗口运行；超时拆分子任务。
- 报表内 KPI 定义须引用 `definition_version`（与 ST-12 一致）。

### Expected Output

- `report_id`, `format`, `uri`, `generated_at`, `recipients[]`。

### 关联 Skills

- 核心指标来自 **ST-12**；异常章节引用 **ST-09**；推送健康引用 **ST-08**；可选附录 **ST-14** 术语表链接。
- **ST-18** 可作为月度管理报告的专章数据源。

### 异常与降级

- 数据延迟：在封面加水印 **data_as_of** 与延迟说明。
- 渲染失败：保留 CSV **fallback** 附件保证可读性。

## 3. Prompt Injection

输出契约：区分 **daily / weekly / monthly** 粒度与执行层/管理层读者。不生成虚构业务数字；数据缺失时仅输出模板结构和占位符。
