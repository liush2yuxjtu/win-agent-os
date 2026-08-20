import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const reqs = [];
page.on("response", (res) => {
  const url = res.url().replace("http://localhost:3000", "");
  if (url.startsWith("/api") || url.startsWith("/eve") || url.includes("events") || url.includes("stream")) {
    reqs.push({ url, status: res.status() });
  }
});
page.on("request", (req) => {
  const url = req.url().replace("http://localhost:3000", "");
  if (url.includes("events") || url.includes("stream") || url.includes("eve")) {
    reqs.push({ req: url, type: req.resourceType() });
  }
});

await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise((r) => setTimeout(r, 3000));

await page.type("textarea", "你叫什么名字", { delay: 15 });
await page.keyboard.press("Enter");

await new Promise((r) => setTimeout(r, 25000));
console.log(JSON.stringify(reqs, null, 1));
await browser.close();
