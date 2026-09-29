/* Round-58 (user screenshot 22:28/22:29): prod par wahi sawaal chala kar BLANK screen reproduce karo.
 * Console errors + uncaught page errors + screenshots — sab /tmp me. */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.PROD_URL ?? "https://railbook-gegs.onrender.com";
const QUERY = process.env.Q ?? "Ludhiana se amritsar ki confirm trains btana kal ke liye";

const logs: string[] = [];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[PAGEERROR] ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 6).join("\n")}`));
page.on("requestfailed", (r) => logs.push(`[REQFAIL] ${r.url()} :: ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(3000);
const input = page.locator("input.composer-input, form.composer input, .composer input").first();
await input.fill(QUERY);
await input.press("Enter");
const t0 = Date.now();
let shot = 0;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(15000);
  const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
  const threadCount = await page.locator("article.msg").count();
  const progress = await page.locator(".ai-progress-line, .ai-progress").first().innerText().catch(() => "");
  const el = ((Date.now() - t0) / 1000).toFixed(0);
  logs.push(`[t=${el}s] msgs=${threadCount} bodyLen=${bodyText.length} progress=${JSON.stringify(progress.slice(0, 90))}`);
  if (i % 4 === 0) await page.screenshot({ path: `/tmp/r58-shot-${shot++}.png`, fullPage: false });
  if (threadCount >= 2 && !/checks completed|Seat checks/.test(progress) && bodyText.length > 200 && i > 1) {
    // reply aa gaya lagta hai — thoda ruk kar final state lo
    await page.waitForTimeout(4000);
    break;
  }
}
const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
await page.screenshot({ path: "/tmp/r58-shot-final.png", fullPage: false });
const dom = await page.evaluate(() => {
  const app = document.querySelector(".app");
  return {
    appHtmlLen: app ? app.innerHTML.length : -1,
    appChildren: app ? app.children.length : -1,
    threadArticles: document.querySelectorAll("article.msg").length,
    rootHtmlLen: document.getElementById("root")?.innerHTML.length ?? -1,
  };
});
fs.writeFileSync("/tmp/r58-repro-log.txt", logs.join("\n"));
fs.writeFileSync("/tmp/r58-repro-result.json", JSON.stringify({ bodyText: bodyText.slice(0, 3000), dom }, null, 1));
console.log(logs.slice(-14).join("\n"));
console.log("DOM:", JSON.stringify(dom));
await browser.close();
