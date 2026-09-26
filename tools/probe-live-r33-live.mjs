/* Round-33 LIVE probe (railbook-gegs.onrender.com, asli model + asli provider data):
 *   User ki teen shikaayatein (26 Sep screenshots):
 *   1) "plan bana sakte ho?" → plan milna chahiye (timings + fare + best option), sirf seat board nahi
 *   2) "Kal,1" → passengers dobara nahi poochhna (date + pax ek hi message se)
 *   3) "Alternative trains bta sakte ho?" → asli ALTERNATIVES (timings + fare), wahi purani list nahi
 *
 *   node tools/probe-live-r33-live.mjs
 * Screenshots: round33-live-{plan,alternatives,seat-timings}.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 950 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".composer input", { timeout: 90000 });

const snap = async (tag, shot) => {
  const info = await page.evaluate(() => ({
    reply: (document.querySelector(".bubble.assistant:last-of-type, .msg.assistant:last-of-type")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    journeyCard: Boolean(document.querySelector(".jx-card, #journey-card, .plan-card")),
    seatCard: Boolean(document.querySelector("#chat-seatlist")),
    seatTimes: [...document.querySelectorAll("#chat-seatlist .sf-time, #chat-seatlist .tcb-time")].map((e) => (e.textContent ?? "").trim()).slice(0, 4),
    nextChip: (document.querySelector("#next-step .ns-chip")?.textContent ?? "").trim(),
  }));
  log(`${tag}:`, JSON.stringify(info, null, 1));
  if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false });
  return info;
};

const ask = async (text) => {
  const count = () =>
    page.evaluate(() => [...document.querySelectorAll(".msg.assistant")].filter((el) => !el.querySelector(".thinking")).length);
  const before = await count();
  await page.fill(".composer input", text);
  await page.keyboard.press("Enter");
  /* Jawab = thinking line ka gayab hona + naya assistant message (server 60-180s le sakta hai). */
  await page.waitForFunction(
    (n) =>
      !document.querySelector(".thinking") &&
      [...document.querySelectorAll(".msg.assistant")].filter((el) => !el.querySelector(".thinking")).length > n,
    before,
    { timeout: 300000 },
  ).catch((e) => log("WAIT-ERR:", String(e).slice(0, 90)));
  await page.waitForTimeout(1500);
};
/* 1) plan sawaal */
await ask("Kya tum mera ludhiana se ndls ka plan bana sakte ho?");
const t1 = await snap("PLAN ASK", null);

/* 2) "Kal,1" → plan with timings (RANK_JOURNEY_OPTIONS) */
await ask("Kal,1");
const t2 = await snap("KAL,1 → PLAN", "round33-live-plan.png");

/* 3) alternative trains → FIND_ALTERNATIVE_TRAINS (timings + fare) */
await ask("Alternative trains bta sakte ho?");
const t3 = await snap("ALTERNATIVES", "round33-live-alternatives.png");

/* 4) seat ka jawab: card par timings dikhni chahiye (dep · duration) */
await ask("12013 ki seat availability batao kal ke liye ludhiana se amritsar");
const t4 = await snap("SEAT + TIMINGS", "round33-live-seat-timings.png");

const ok =
  /passengers|kitne log|kitne passenger/i.test(t1.reply) &&
  /\d{1,2}:\d{2}/.test(t2.reply) &&
  /alternative|doosri|options|ASR TVCN|SACHKHAND|SARBAT|PASCHIM/i.test(t3.reply);
log(ok ? "LIVE_PROBE_DONE all-pass" : "LIVE_PROBE_DONE CHECK-MANUALLY");
await browser.close();
