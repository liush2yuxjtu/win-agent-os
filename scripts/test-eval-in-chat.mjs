/**
 * 端到端验证：chatbot 里评估技能 → run_skill_evals 的 HTML 报告
 * 在聊天消息中通过 iframe(srcDoc) 内联渲染（而非显示 HTML 代码）。
 *
 * 用法：node scripts/test-eval-in-chat.mjs [skill-name]
 */
import puppeteer from "puppeteer-core";

const skillName = process.argv[2] ?? "dongsheng-ordering";
const URL = "http://localhost:3000/";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--no-sandbox", "--window-size=1440,900"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector("textarea", { timeout: 20000 });

  // 填消息并提交（native setter + 点击提交按钮，绕过 React 受控组件）
  await page.evaluate((text) => {
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, `评估一下 ${skillName} 技能`);
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    if (btn) btn.click();
  });

  console.log(`已发送：评估一下 ${skillName} 技能`);

  // 轮询等待 iframe（run_skill_evals 完成，最长 5 分钟）；页面导航后自动重连上下文
  const deadline = Date.now() + 5 * 60_000;
  let iframes = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    let state;
    try {
      state = await page.evaluate(() => {
        const frames = [...document.querySelectorAll("iframe")];
        const evalFrames = frames.filter((f) => (f.title ?? "").includes("报告"));
        return {
          evalFrames: evalFrames.length,
          srcDocLen: evalFrames.map((f) => (f.srcdoc ?? "").length),
          bodyText: document.body.innerText,
        };
      });
    } catch {
      // 页面导航导致上下文销毁 → 等待页面稳定后重试
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }).catch(() => {});
      continue;
    }
    // agent 弹 ask_question（HITL）时自动应答：优先选「评估已存在的技能」
    const answered = await page.evaluate(() => {
      const opts = [...document.querySelectorAll("button")].filter((b) =>
        ["评估已存在的技能", "确定", "继续"].includes((b.textContent ?? "").trim()),
      );
      if (opts.length > 0) {
        opts[0].click();
        return true;
      }
      return false;
    });
    if (answered) console.log("↳ 已自动应答 ask_question");
    if (state.evalFrames > 0) {
      iframes = state.evalFrames;
      console.log(`✅ iframe 报告出现：${state.evalFrames} 个（srcDoc 长度 ${state.srcDocLen.join(" / ")}）`);
      await page.screenshot({ path: "edit-dashboard-workspace/chat-eval-iframe.png" });
      // 验证 srcDoc 是渲染的 HTML 而非"代码展示"
      const htmlCheck = await page.evaluate(() => {
        const frames = [...document.querySelectorAll("iframe")].filter((f) => (f.title ?? "").includes("报告"));
        const docs = frames.map((f) => f.srcdoc ?? "");
        return {
          containsHtmlTag: docs.some((d) => d.includes("<!DOCTYPE html>") || d.includes("<html")),
          containsReportTitle: docs.some((d) => /触发|Trigger|Functional|功能/.test(d)),
          toolCards: [...document.querySelectorAll("summary")].map((s) => s.textContent).filter(Boolean),
        };
      });
      console.log("报告内容检查：", JSON.stringify(htmlCheck, null, 1));
      // 截图后打印页面关键状态
      const hasToolCard = await page.evaluate(() => document.body.innerText.includes("run_skill_evals"));
      console.log("工具卡片存在：", hasToolCard);
      break;
    }
    // 进度提示
    const lastLine = state.bodyText.split("\n").filter(Boolean).slice(-2).join(" | ");
    console.log(`...等待中 (${Math.round((deadline - Date.now()) / 1000)}s) 最后消息：${lastLine.slice(0, 80)}`);
  }
  if (iframes === 0) {
    console.log("✗ 超时：5 分钟内未出现 iframe 报告");
    await page.screenshot({ path: "edit-dashboard-workspace/chat-eval-timeout.png" });
  }
} finally {
  await browser.close();
}
