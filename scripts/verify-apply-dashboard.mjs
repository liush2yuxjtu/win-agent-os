import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// 1. /chat/new → 改看板 → 等「应用到看板」
await page.goto("http://localhost:3000/chat/new", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await page.type("textarea", "把看板 KPI 卡片改成一行三个", { delay: 15 });
await page.keyboard.press("Enter");

let applyBtn = false;
const d2 = Date.now() + 240000;
while (Date.now() < d2) {
  applyBtn = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.includes("应用到看板"))
  ).catch(() => false);
  if (applyBtn) break;
  await new Promise((r) => setTimeout(r, 3000));
}
console.log("出现「应用到看板」:", applyBtn ? "✅" : "❌");
if (!applyBtn) { await browser.close(); process.exit(1); }

// 2. 点击 → 整页跳转 /（点击会销毁执行上下文，吞掉导航错误）
await page.evaluate(() =>
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("应用到看板"))?.click()
).catch(() => {});
await page.waitForFunction(() => location.pathname === "/", { timeout: 20000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

// 3. 首页横幅检查（sessionStorage 接力恢复）
const banner = await page.evaluate(() => ({
  url: location.pathname,
  text: document.body.innerText.includes("AI 生成了新的看板布局"),
  confirm: document.body.innerText.includes("确定应用"),
}));
console.log("跳转首页 + 横幅:", JSON.stringify(banner), banner.confirm ? "✅" : "❌");

// 4. 确定应用
if (banner.confirm) {
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("确定应用"))?.click()
  );
  await new Promise((r) => setTimeout(r, 1500));
  const applied = await page.evaluate(() => document.body.innerText.includes("看板已更新"));
  console.log("确定应用:", applied ? "✅ 看板已更新" : "❌");
}

console.log("pageerrors:", errors.length ? errors : "无");
await browser.close();
