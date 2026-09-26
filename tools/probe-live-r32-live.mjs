/* Round-32 LIVE probe (railbook-gegs.onrender.com, asli NVIDIA model + asli provider data):
 *   User: "har query pehle model ke pass jaani chahiye and wo decide kare kon sa tool use karna
 *   yan kya karna hai" — agla kadam bhi MODEL chune, data sirf validate + fallback.
 *
 *   A) "12013 ki seat availability batao kal ke liye ludhiana se amritsar, 1 passenger"
 *      → asli model khud [NEXT] deta hai → card par tag "AI ne chuna" + model ke chips
 *   B) us Book chip ka tap → seedha passenger form
 *   C) "12013 ka schedule batao" (deterministic turn — model ne NEXT nahi diya)
 *      → tag "verified data se" (data fallback, jhoothi suggestion nahi)
 *   D) "ludhiana station par kya suvidha hai" (koi train-specific data nahi) → sirf record
 *
 *   node tools/probe-live-r32-live.mjs
 * Screenshots: round32-live-{model-chips,chip-tap,data-fallback,plain}.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
let fail = 0;
const check = (name, ok, info) => {
  log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(info)}`);
  if (!ok) fail += 1;
};

async function turn(ask, waitForCard = true) {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".composer input", { timeout: 90000 });
  await page.fill(".composer input", ask);
  await page.keyboard.press("Enter");
  if (waitForCard) await page.waitForSelector("#next-step", { timeout: 240000 }).catch(() => null);
  else await page.waitForTimeout(90000);
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const card = document.querySelector("#next-step");
    const tag = card?.querySelector(".ns-tag");
    return {
      nextStep: Boolean(card),
      tag: (tag?.textContent ?? "").trim(),
      tagClass: (tag?.className ?? "").replace("ns-tag", "").trim(),
      chips: card ? [...card.querySelectorAll(".ns-chip")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim()) : [],
      hint: (card?.querySelector(".ns-hint")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      reply: (document.querySelector(".bubble.assistant:last-of-type, .msg.assistant:last-of-type")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      seatCard: Boolean(document.querySelector("#chat-seatlist")),
      nextStepText: (card?.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  });
  return { page, info };
}

/* A) asli model [NEXT] → chips + tag */
const a = await turn("12013 ki seat availability batao kal ke liye ludhiana se amritsar, 1 passenger");
log("LIVE A (model):", JSON.stringify(a.info, null, 1));
check("A live model ke chips + tag 'AI ne chuna'", a.info.nextStep && a.info.tag === "AI ne chuna" && a.info.tagClass === "model" && a.info.chips.length >= 1, { tag: a.info.tag, chips: a.info.chips });
await a.page.screenshot({ path: `${OUT}/round32-live-model-chips.png`, fullPage: false });
await a.page.screenshot({ path: `${OUT}/round32-live-model-chips-full.png`, fullPage: true });

/* B) chip tap → passenger form */
const clicked = await a.page.evaluate(() => {
  const b = document.querySelector("#next-step .ns-chip.primary");
  if (!b) return null;
  const label = (b.textContent ?? "").replace(/\s+/g, " ").trim();
  b.scrollIntoView({ block: "center" });
  b.click();
  return label;
});
await a.page.waitForSelector(".overlay-screen", { timeout: 240000 }).catch(() => null);
await a.page.waitForTimeout(1600);
const after = await a.page.evaluate(() => {
  const ov = document.querySelector(".overlay-screen");
  return {
    screen: ov ? "passengers-overlay" : "chat",
    hasName: Boolean(document.querySelector('[id^="name-"]')),
    head: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 170),
  };
});
check("B live chip tap → passenger form", after.screen === "passengers-overlay" && after.hasName, { clicked, ...after });
await a.page.screenshot({ path: `${OUT}/round32-live-chip-tap.png` });
await a.page.close();

/* C) deterministic turn (model ne NEXT nahi diya) → data fallback */
const c = await turn("12013 ka schedule batao");
log("LIVE C (data fallback):", JSON.stringify(c.info, null, 1));
check("C NEXT na hone par data fallback (tag 'verified data se')", c.info.nextStep && c.info.tag === "verified data se" && c.info.tagClass === "data" && /12013/.test(c.info.chips.join(" ")), { tag: c.info.tag, chips: c.info.chips });
await c.page.screenshot({ path: `${OUT}/round32-live-data-fallback.png`, fullPage: true });
await c.page.close();

/* D) plain info turn — sirf record (jhoothi suggestion nahi honi chahiye) */
const d = await turn("ludhiana station par kya suvidha hai", false);
log("LIVE D (plain, informational):", JSON.stringify(d.info, null, 1));
await d.page.screenshot({ path: `${OUT}/round32-live-plain.png`, fullPage: true });
await d.page.close();

await browser.close();
log(fail === 0 ? "LIVE_PROBE_DONE all-pass" : `LIVE_PROBE_DONE ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
