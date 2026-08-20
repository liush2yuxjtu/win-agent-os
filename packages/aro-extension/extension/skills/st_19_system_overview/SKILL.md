---
name: st_19_system_overview
description: "说明 ARO 系统能力、配置项和运行健康状态，可查询系统配置与健康检查；不读取或修改客户业务数据。"
---

# ST-19 System Overview

## Purpose
Explain the current ARO system status and customer-visible configuration without exposing secrets or another customer.

## Tool Selection
- Use `get_system_config` for current customer parameters and mappings.
- Use `get_system_health` only for an explicit health/status question.
- A conceptual feature question may be answered from this Skill without calling a tool.
- Do not expose credentials, connection strings, private filesystem details, or cross-customer configuration.

## Write Boundary
This Skill is read-only. It never changes configuration, schedules, orders, or master data.
