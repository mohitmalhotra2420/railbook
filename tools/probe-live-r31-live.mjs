/* Round-31 LIVE probe (railbook-gegs.onrender.com, asli AI + asli provider data):
 *   A) "12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye"
 *      → jawab ke neeche "Agla kadam" card, Book chip me wahi jo dikha (train · class · AVL · fare)
 *   B) Book chip tap (kisi bhi turn me bhi kaam kare) → seedha passenger form
 *
 *   node tools/probe-live-r31-live.mjs
 * Screenshots: round31-live-{next-step,book-tap}.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".composer input", { timeout: 60000 });
await page.fill(".composer input", "12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye");
await page.keyboard.press("Enter");
await page.waitForSelector("#next-step", { timeout: 240000 }).catch(() => null);
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const card = document.querySelector("#next-step");
  return {
    nextStep: Boolean(card),
    label: (card?.querySelector(".ns-label")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    chips: card ? [...card.querySelectorAll(".ns-chip")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim()) : [],
    hint: (card?.querySelector(".ns-hint")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    boardText: (document.querySelector("#chat-seatlist")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 150),
  };
});
log("LIVE SEAT ANSWER → NEXT STEP:", JSON.stringify(info, null, 1));
await page.screenshot({ path: `${OUT}/round31-live-next-step.png` });

/* Book chip tap → passenger form */
const clicked = await page.evaluate(() => {
  const b = document.querySelector("#next-step .ns-chip.primary");
  if (!b) return null;
  const label = (b.textContent ?? "").replace(/\s+/g, " ").trim();
  b.scrollIntoView({ block: "center" });
  b.click();
  return label;
});
await page.waitForSelector(".overlay-screen", { timeout: 240000 }).catch(() => null);
await page.waitForTimeout(1500);
const after = await page.evaluate(() => {
  const ov = document.querySelector(".overlay-screen");
  return {
    screen: ov ? "passengers-overlay" : "chat",
    hasName: Boolean(document.querySelector('[id^="name-"]')),
    head: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 170),
  };
});
log("LIVE BOOK CHIP TAP:", JSON.stringify({ clicked, ...after }, null, 1));
await page.screenshot({ path: `${OUT}/round31-live-book-tap.png` });

await browser.close();
log("LIVE_PROBE_DONE");
