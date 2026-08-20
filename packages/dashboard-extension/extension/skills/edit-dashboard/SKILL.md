---
name: edit-dashboard
description: 编辑经营看板的布局与视觉（用户通过聊天对看板做增删查改）。用户表达改看板相关意图时都应触发，即使没说 skill 名：「改一下看板/首页布局」「重新排版/排一下卡片」「卡片换一行三个/两个一行」「加一张卡/删掉某个指标卡」「换主题色/深色一点」「看板太挤了帮我调整」「把这个布局存下来一直用」「我把看板改坏了，帮我恢复基础款」；以及问「能不能直接在聊天里改看板」。流程：先 dashboard__read 读当前看板 → 用 dashboard__create / dashboard__edit / dashboard__remove 做增量增删改（或直接生成整体 spec）→ 卡片值用 ${/kpis/N/...} 模板或 dataRef 引用查询数据，绝不写死数值 → 调用 render_ui 工具，客户在看板横幅点【确定】后生效，纯前端热更新无需重启。不要用于：单纯的数据问答（近7日成交多少）、生成表单/清单/按钮等非看板界面（那些直接 render_ui，不用本技能）。
compatibility: 需要 render_ui 工具（公共工具，非本包）与看板数据注入约定（看板 spec 由 dashboard-extension 包提供）。
---

# 编辑看板（Edit Dashboard）

客户想改看板长什么样。流程：你生成看板类 json-render spec → `render_ui` 工具渲染预览 → 客户点「应用到看板」→ 看板底部横幅点【确定】合并生效。全链路纯前端，客户侧即时生效，不需要我们重启或发布。

## 为什么看板 spec 有特殊约定

看板卡片的值**不是静态文本** —— 数字来自经营数据，每次打开页面都会刷新。spec 里**绝不写死数值**，只写数据引用，渲染时由看板运行时拉取最新数据。两种数据绑定机制（见下节）：

- **内置 5 个指标**：`${/kpis/N/...}` 模板注入，由 DashboardSpecShell 注入当前数据（现有机制，始终可用）
- **任意查询结果**：`dataRef` 引用查询（fixed 固定脚本或 `user:` 自定义查询），渲染时由 Query Registry 拉最新数据（落地中）

**任何写死数值的 spec 都会让看板显示过期数据**，这是本技能最容易犯的错。布局（卡片怎么摆）是你的自由，数据（数字是多少）永远来自引用。

## 看板 spec 结构约定（必须遵守）

1. **根元素**：`main` 为 root，类型 `Grid`（多列）或 `Stack`（纵向），children 指向卡片
2. **数据绑定**（关键，双机制）：
   - **模板注入**（内置 5 指标）：卡片 `props.title` 用 `{"$template": "${/kpis/N/label}"}`；`props.description` 用 `{"$template": "${/kpis/N/value} · ${/kpis/N/change}"}`。同一个 `$template` 内可写多个 `${}`（如上）
   - **dataRef 引用查询**（任意 queryId，落地中）：卡片/表格 `props` 里写 `{"dataRef": {"queryId": "<queryId>", "field": "<field>"}}`，渲染时拉取最新数据。queryId 两类：`fixed` 固定脚本（`anchor` / `daily` / `topMaterials`）与 `user:<slug>`（用户在聊天里用 dashboard__query_save 保存的自定义 SQL）。field 取值：`rows`（Table 行数据）、`title`、`description`、`value`（KPI 卡数值）。引用查询结果同样**绝不写死数字**
3. **指标索引**：`/kpis/N/` 的 N 从 0 到 4，对应 5 个指标：0 成交金额、1 广告消耗、2 支付 ROI、3 成交订单、4 月均活跃素材。**尽量覆盖全部 5 个** —— 引用不存在的索引会渲染空白。只保留用户明确要求删的
4. **state 留空**：`"state": {}` —— 数据由看板注入，spec 不携带
5. **可用组件**：Card（KPI 卡，值用模板或 dataRef）、Table（数据表卡，props 配 `dataRef` 的 `rows` 字段展示查询结果）、Grid（多列布局）、Stack（纵向布局）、Heading（标题）、Separator（分隔线）、Badge（标签）、Alert（提示）、Text。其他 shadcn 组件也可用但保持克制 —— 看板是数据呈现，不是表单

## 示例

用户说：「把看板改成两行：第一行三张卡，第二行两张卡，加个标题」

```json
{
  "root": "main",
  "elements": {
    "main": {"type": "Stack", "props": {"direction": "vertical", "gap": "md"}, "children": ["title", "row1", "row2"]},
    "title": {"type": "Heading", "props": {"text": "核心经营指标", "level": "h2"}, "children": []},
    "row1": {"type": "Grid", "props": {"columns": 3, "gap": "md"}, "children": ["k0", "k1", "k2"]},
    "row2": {"type": "Grid", "props": {"columns": 2, "gap": "md"}, "children": ["k3", "k4"]},
    "k0": {"type": "Card", "props": {"title": {"$template": "${/kpis/0/label}"}, "description": {"$template": "${/kpis/0/value} · ${/kpis/0/change}"}, "maxWidth": "full"}, "children": []},
    "k1": {"type": "Card", "props": {"title": {"$template": "${/kpis/1/label}"}, "description": {"$template": "${/kpis/1/value} · ${/kpis/1/change}"}, "maxWidth": "full"}, "children": []},
    "k2": {"type": "Card", "props": {"title": {"$template": "${/kpis/2/label}"}, "description": {"$template": "${/kpis/2/value} · ${/kpis/2/change}"}, "maxWidth": "full"}, "children": []},
    "k3": {"type": "Card", "props": {"title": {"$template": "${/kpis/3/label}"}, "description": {"$template": "${/kpis/3/value} · ${/kpis/3/change}"}, "maxWidth": "full"}, "children": []},
    "k4": {"type": "Card", "props": {"title": {"$template": "${/kpis/4/label}"}, "description": {"$template": "${/kpis/4/value} · ${/kpis/4/change}"}, "maxWidth": "full"}, "children": []}
  },
  "state": {}
}
```

## 示例（dataRef 表格卡）

用户说：「把 topMaterials 固定查询做成一张表格卡加到看板」

```json
{
  "root": "main",
  "elements": {
    "main": {"type": "Stack", "props": {"direction": "vertical", "gap": "md"}, "children": ["title", "table"]},
    "title": {"type": "Heading", "props": {"text": "高消耗素材", "level": "h2"}, "children": []},
    "table": {"type": "Table", "props": {"dataRef": {"queryId": "fixed:topMaterials", "field": "rows"}}, "children": []}
  },
  "state": {}
}
```

表格卡同样不写死任何数字：行数据由看板按 queryId 拉取，每次刷新都是最新。用户自定义查询时，先 `dashboard__query_save` 存为 `user:<slug>` 再在 dataRef 里引用。

## 工作流（增量 CRUD，勿从零覆盖）

1. **先读当前看板**：调 `dashboard__read` 拿到用户当前 spec。无自定义（null）时按基础款（Grid 5 列 × 5 张 KPI 卡，`${/kpis/N/...}` 模板）理解现状
2. **在现状上做增量**：
   - 加卡 → `dashboard__create`（type + props，数据用 dataRef 或模板）
   - 改卡 → `dashboard__edit`（key + 要合并的 props）
   - 删卡 → `dashboard__remove`（key）
   - 整块重排 → 直接生成完整 spec（5 个指标全覆盖，除非用户明确删）
   - 关键：**只动用户要求的部分**，用户已有的自定义卡（Table 卡、自定义布局）必须保留——这是「基于当前看板增删查改」与「从零生成」的本质区别
3. 涉及自定义查询时，先调 `dashboard__query_save` 把 SQL 保存为 `user:<slug>`，再在 spec 里用 dataRef 引用（fixed 固定脚本直接引用 queryId，无需保存）
4. 拿到新 spec 后调用 `render_ui` 工具，把 spec JSON 原样传入
5. 向用户说明：预览已生成，点卡片上的「应用到看板」→ 看板底部点【确定】就生效；不满意直接说怎么改，我会基于当前布局调整
