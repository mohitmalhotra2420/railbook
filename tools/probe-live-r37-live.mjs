/* Round-37 LIVE probe — user ka exact screenshot scenario:
 *   1) 12054 (Hw Janshatabdi) ki seat availability ASR → HW
 *   2) "12054 mein 2S book krdo"  → passenger form turant khule (koi loop, koi class dobara sawaal nahi)
 *   3) wahi command DOBARA bhejo → form/pehle se khula ho to dobara kaam nahi karta, aur chat me wahi
 *      jawab dohra kar loop nahi banta
 *   4) ek general railway sawaal (ChatGPT-jaisa seedha jawab) → repeat nahi, saaf jawab
 *
 *   node tools/probe-live-r37-live.mjs
 * Screenshots: round37-live-{book-2s,no-loop}.png
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

const ask = async (text, { expectChange = true } = {}) => {
  const count = () =>
    page.evaluate(() => [...document.querySelectorAll(".msg.assistant")].filter((el) => !el.querySelector(".thinking")).length);
  const before = await count();
  await page.fill(".composer input", text);
  await page.keyboard.press("Enter");
  await page
    .waitForFunction(
      (n) =>
        !document.querySelector(".thinking") &&
        [...document.querySelectorAll(".msg.assistant")].filter((el) => !el.querySelector(".thinking")).length > n,
      before,
      { timeout: 300000 },
    )
    .catch(() => log("WAIT-ERR (kuch naya reply nahi aaya — expected ho sakta hai)"));
  await page.waitForTimeout(1800);
};

const snap = async (tag, shot) => {
  const info = await page.evaluate(() => {
    const ov = document.querySelector(".overlay-screen");
    const msgs = [...document.querySelectorAll(".msg.assistant")].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
    const last = msgs[msgs.length - 1] ?? "";
    const prev = msgs[msgs.length - 2] ?? "";
    const cards = [...document.querySelectorAll("#next-step")];
    const lastCard = cards[cards.length - 1];
    return {
      screen: ov ? "passengers-overlay" : "chat",
      formHead: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
      lastReply: last.slice(0, 140),
      isRepeatOfPrev: last.length > 40 && last.slice(0, 60) === prev.slice(0, 60),
      nextTag: (lastCard?.querySelector(".ns-tag")?.textContent ?? "").trim(),
      nextChip: (lastCard?.querySelector(".ns-chip")?.textContent ?? "").trim(),
    };
  });
  log(`${tag}:`, JSON.stringify(info, null, 1));
  if (shot) {
    await page.evaluate(() => {
      const t = document.querySelector(".overlay-screen") ?? document.querySelector(".msg.assistant:last-of-type");
      t?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false });
  }
  return info;
};

/* 1) seat availability (ASR → HW, 12054) */
await ask("12054 ki seat availability batao ASR se HW kal ke liye");
await snap("T1 seat", "round37-live-seat.png");

/* 2) exact bug command */
await ask("12054 mein 2S book krdo");
const t2 = await snap("T2 'book krdo'", "round37-live-book-2s.png");

/* 3) wahi command dobara — loop nahi hona chahiye */
await ask("12054 mein 2S book krdo");
const t3 = await snap("T3 same command dobara", "round37-live-no-loop.png");

/* 4) general railway sawaal (ChatGPT-jaisa seedha jawab) */
await ask("Vande Bharat Express kis state se kis state tak chalti hai? short me batao");

const okForm = t2.screen === "passengers-overlay";
const okNoLoop = !t3.isRepeatOfPrev;
log(`\nRESULT: form khula(T2)=${okForm} · loop nahi(T3)=${okNoLoop}`);
log(okForm ? "OK: '12054 mein 2S book krdo' par passenger form turant khul gaya" : "FAIL: form nahi khula");
log(okNoLoop ? "OK: dobara bhejne par wahi jawab repeat nahi hua" : "FAIL: jawab repeat ho raha hai");
await browser.close();
