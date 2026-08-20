/**
 * puppeteer-core 截图：访问本地 Next 页面渲染 eval spec，等卡片出现后截图。
 * 用法：node scripts/shot-eval.mjs <rel-output-dir> <png-path>
 */
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [relDir, pngPath] = process.argv.slice(2);
const root = path.dirname(fileURLToPath(import.meta.url));
const url = `http://localhost:3000/json-render-eval?file=${encodeURIComponent(relDir)}`;

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=1", "--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 860, height: 640, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  try {
    await page.waitForSelector(".rounded-xl", { timeout: 20000 });
  } catch {
    // 无卡片也截图（记录现状）
  }
  // 等 React 布局稳定
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: pngPath });
  const text = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log(`✓ ${relDir} → ${path.basename(pngPath)} | ${text.replace(/\n/g, " ⏎ ")}`);
} finally {
  await browser.close();
}
