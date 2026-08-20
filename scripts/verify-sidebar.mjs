import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise((r) => setTimeout(r, 3500));

// 侧栏输入框
await page.type("textarea", "你叫什么名字", { delay: 15 });
await page.keyboard.press("Enter");

let thinking = false;
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  const s = await page.evaluate(() => {
    const t = document.body.innerText;
    return { thinking: t.includes("思考"), err: t.includes("请求失败"), tail: t.slice(-300) };
  });
  if (s.thinking) thinking = true;
  if (s.err) { console.log("请求失败横幅出现"); break; }
  // 回答出现的信号：流式文本里出现与问题相关的回答（启发式：出现了新的「…助手…」回答句）
  if (!s.thinking && /经营分析助手|数据分析|你好，我是/.test(s.tail)) { console.log("检测到 AI 回答"); break; }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log("thinking 出现过:", thinking);
console.log("尾部:", JSON.stringify(await page.evaluate(() => document.body.innerText.slice(-350))));
await browser.close();
