import { defineEval } from "eve/evals";
import { sendAndAnswer } from "./shared";

/**
 * 冒烟：save_report 部署无关链接。
 * 未配置 APP_URL 时工具只返回相对路径 —— agent 回复应包含 /reports/xxx.html，
 * 且不得写死 localhost 端口（回归：eve dev 子进程 PORT 是 dev server 端口，
 * 用它拼 URL 会导致公网/内网部署的用户打不开报告）。
 */
export default defineEval({
  async test(t) {
    await sendAndAnswer(
      t,
      "生成一份测试报告页面：一个 2026 年 8 月投流数据摘要表格（示例数字即可，不用查数据库），用 save_report 保存，把链接给我",
    );

    // 必须调用 save_report 工具
    t.calledTool("save_report");
    // 回复里应给出 /reports/xxx.html 相对路径（前端会补全当前访问地址）
    t.messageIncludes(/\/reports\/[a-zA-Z0-9_-]+\.html/);
    t.noFailedActions();

    // 所有消息文本不得出现 localhost 端口（锁死端口的回归保护）
    t.eventsSatisfy("消息中无 localhost 端口", (events) => {
      const texts: string[] = [];
      for (const ev of events as unknown[]) {
        const e = ev as { type?: string; data?: { part?: { type?: string; text?: string }; parts?: Array<{ type?: string; text?: string }> } };
        if (e.type === "message.part.updated" && e.data?.part?.type === "text" && typeof e.data.part.text === "string") {
          texts.push(e.data.part.text);
        }
        if (e.type === "message.received" && Array.isArray(e.data?.parts)) {
          for (const p of e.data.parts) {
            if (p.type === "text" && typeof p.text === "string") texts.push(p.text);
          }
        }
      }
      return !texts.join("\n").includes("localhost:");
    });
  },
});
