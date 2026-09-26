/* Round-30 LIVE probe (railbook-gegs.onrender.com, asli AI + asli provider data):
 *   A) "12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye" (user ka asli sawaal)
 *      → chat block SIRF 12013 ka (poori 21-train board nahi)
 *   B) usi chat me "kal ke liye seat wali trains" (generic) → pehle jaisa POORA board
 *
 *   node tools/probe-live-r30-live.mjs
 * Screenshots: round30-live-{focused,generic}.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const read = (p) =>
  p.evaluate(() => {
    const cards = [...document.querySelectorAll("#chat-seatlist")];
    const last = cards[cards.length - 1];
    return {
      blocks: cards.length,
      focused: last ? last.className.includes("sf-focused") : false,
      head: (last?.querySelector(".sf-head")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      groups: last ? last.querySelectorAll(".sf-group").length : 0,
      chips: last ? last.querySelectorAll(".sf-cchip").length : 0,
      text: (last?.textContent ?? "").replace(/\s+/g, " ").slice(0, 240),
    };
  });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".composer input", { timeout: 60000 });

const ask = async (text, waitFor = 240000) => {
  await page.fill(".composer input", text);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(waitFor);
};

/* A) ek train maangi (user ka asli sawaal) */
await ask("12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye");
await page.waitForSelector("#chat-seatlist", { timeout: 60000 }).catch(() => null);
await page.waitForTimeout(1500);
const a = await read(page);
log("LIVE A (12013 maanga):", JSON.stringify(a, null, 1));
await page.screenshot({ path: `${OUT}/round30-live-focused.png` });

/* B) same chat me generic sawaal → poora board */
await ask("kal ke liye seat wali trains batao ludhiana se amritsar");
const b = await read(page);
log("LIVE B (generic):", JSON.stringify(b, null, 1));
await page.screenshot({ path: `${OUT}/round30-live-generic.png` });

await browser.close();
log("LIVE_PROBE_DONE");
