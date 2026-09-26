/* Live chat proof (Round-25): asli site par asli sawaal — screenshot wala case.
 *   node tools/probe-live-seat-answer.mjs <outDir>
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
});
const page = await ctx.newPage();
await page.goto("https://railbook-gegs.onrender.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() =>
  sessionStorage.setItem(
    "railbook.booking.v1",
    JSON.stringify({
      screen: "home",
      flow: "SEARCHING",
      date: "2026-09-27",
      dateProvided: true,
      passengerCount: 1,
      paxProvided: true,
      from: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" },
      to: { code: "ASR", name: "Amritsar Junction", city: "Amritsar" },
      trains: [],
      passengers: [],
      contact: { mobile: "", email: "", whatsappOptIn: true },
    }),
  ),
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const input = page.locator(".composer input").first();
await input.fill("SL class me seat wali trains batao");
await input.press("Enter");

/* AI ka jawab aa jaaye (max 90s) */
let text = "";
for (let i = 0; i < 30; i += 1) {
  await page.waitForTimeout(3000);
  text = await page.evaluate(() => document.querySelector(".concierge")?.innerText ?? "");
  if (/rp-row/.test(await page.evaluate(() => document.body.innerHTML)) && !/check kar raha hoon|soch raha/i.test(text)) break;
}
await page.waitForTimeout(1500);
const info = await page.evaluate(() => ({
  rows: document.querySelectorAll(".rp-row").length,
  rowNos: [...document.querySelectorAll(".rp-row .rp-no")].map((el) => el.textContent).slice(0, 16),
  summary: document.querySelector(".rp-sum")?.textContent ?? null,
  tail: document.querySelector(".rp-tail")?.textContent ?? null,
  seatLine: document.querySelector(".msg-seatline")?.textContent?.slice(0, 200) ?? null,
  mentionsCard: /seat\s*finder\s*card/i.test(document.body.innerText),
}));
await page.screenshot({ path: path.join(OUT, "round25-live-seat-answer-top.png") });
await page.evaluate(() => {
  const sc = document.scrollingElement;
  if (sc) sc.scrollTop = sc.scrollHeight;
});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "round25-live-seat-answer-bottom.png") });
console.log(JSON.stringify(info, null, 1));
await browser.close();
