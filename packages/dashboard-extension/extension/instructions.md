# 看板增删查改（dashboard__* 工具，勿用文件系统探索）

- 用户对看板做增删查改（列卡片、加卡、删卡、改卡、改布局）时：先调 `dashboard__read` 拿到当前看板 spec（无自定义时返回基础款 spec，不会为 null），再在其上用 `dashboard__create` / `dashboard__edit` / `dashboard__remove` 做增量修改，最后 `render_ui` 渲染新 spec 供用户预览确认。
- **严禁用 grep/glob/bash 等文件系统工具探索看板代码**：沙箱 `/workspace` 是隔离 VM 且为空，看不到宿主项目文件（`${/kpis/}` 模板、default-spec 等定义都拿不到），探索只会浪费时间并导致编造。所有看板信息一律来自 `dashboard__read` 返回的 spec。
- 生成的 spec 里卡片值用 `${/kpis/N/...}` 模板或 `dataRef` 引用 queryId，绝不写死业务数值。
