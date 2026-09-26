/* Round-36 LIVE probe — sach me check karo ki "Agla kadam" HAR turn me AI ka hai:
 *   • card ka tag "AI ne chuna" ho, "verified data se" kabhi na aaye (fallback poora band),
 *   • 6 alag-alag sawaalon par (plan, alternatives, seat, timetable, pax-sawaal, alternative date).
 *
 *   node tools/probe-live-r36-live.mjs
 * Screenshots: round36-live-{next-1,next-2}.png
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

const ask = async (text) => {
  const count = () =>
    page.evaluate(() => [...document.querySelectorAll(".msg.assistant")].filter((el) => !el.querySelector(".thinking")).length);
  const before = await count();
  await page.fill(".composer input", text);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (n) =>
      !document.querySelector(".thinking") &&
      [...document.querySelectorAll(".msg.assistant")].filter((el) => !el.querySelector(".thinking")).length > n,
    before,
    { timeout: 300000 },
  ).catch((e) => log("WAIT-ERR:", String(e).slice(0, 80)));
  await page.waitForTimeout(1800);
};

const snap = async (tag, shot) => {
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#next-step")];
    const last = cards[cards.length - 1];
    return {
      reply: (document.querySelector(".bubble.assistant:last-of-type, .msg.assistant:last-of-type")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 150),
      nextCards: cards.length,
      nextTag: (last?.querySelector(".ns-tag")?.textContent ?? "").trim(),
      nextChips: last ? [...last.querySelectorAll(".ns-chip")].map((c) => (c.textContent ?? "").trim()) : [],
      allTags: cards.map((c) => (c.querySelector(".ns-tag")?.textContent ?? "").trim()),
    };
  });
  log(`${tag}:`, JSON.stringify(info, null, 1));
  if (shot) {
    await page.evaluate(() => {
      const t = [...document.querySelectorAll("#next-step")].pop();
      t?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false });
  }
  return info;
};

const turns = [
  ["kya tum mera ludhiana se ndls ka plan bana sakte ho?", "T1 plan-ask"],
  ["Kal,1", "T2 plan (Kal,1)"],
  ["alternative trains bta sakte ho?", "T3 alternatives"],
  ["12013 ki seat availability batao kal ke liye", "T4 seat"],
  ["12014 ka timetable batao", "T5 timetable"],
  ["Vande Bharat ki speed kitni hoti hai?", "T6 general"],
];

const out = [];
for (const [q, tag] of turns) {
  await ask(q);
  const shot = tag.startsWith("T2") ? "round36-live-next-1.png" : tag.startsWith("T3") ? "round36-live-next-2.png" : null;
  out.push({ tag, ...(await snap(tag, shot)) });
}

const model = out.filter((x) => x.nextTag === "AI ne chuna").length;
const data = out.filter((x) => x.nextTag === "verified data se").length;
const none = out.filter((x) => !x.nextTag).length;
log(`\nNEXT tags → AI (model): ${model} · data-fallback: ${data} · koi card nahi: ${none} / ${out.length}`);
log(data === 0 ? "OK: kisi bhi turn me 'verified data se' fallback nahi aaya" : "FAIL: data fallback dikha!");
await browser.close();
