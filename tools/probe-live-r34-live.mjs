/* Round-34 LIVE probe (railbook-gegs.onrender.com, asli model + asli data):
 *   User ke do points:
 *   1) Seat list pehle dikh chuki thi; "Book 12380" par AI ne phir passengers poochh liye → ab:
 *      booking hukm turant pakda jaata hai aur PEHLE DIKHAYI GAYI seat rows se passenger form khulta hai.
 *   2) "Agla kadam hamesha AI chune" → [NEXT] missing par model se hi repair call; chip par tag
 *      "AI ne chuna" aana chahiye (data fallback sirf aakhri upay).
 *
 *   node tools/probe-live-r34-live.mjs
 * Screenshots: round34-live-{book-known-seats,next-from-model,seat-then-book}.png
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
  await page.waitForTimeout(1500);
};

const snap = async (tag, shot) => {
  const info = await page.evaluate(() => {
    const card = document.querySelector("#next-step");
    const tagEl = card?.querySelector(".ns-tag");
    const ov = document.querySelector(".overlay-screen");
    return {
      reply: (document.querySelector(".bubble.assistant:last-of-type, .msg.assistant:last-of-type")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300),
      paxAsk: /kitne passengers|kitne log/i.test(document.body.innerText.slice(-1200)),
      seatCard: Boolean(document.querySelector("#chat-seatlist")),
      nextTag: (tagEl?.textContent ?? "").trim(),
      nextChips: card ? [...card.querySelectorAll(".ns-chip")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim()) : [],
      screen: ov ? "passengers-overlay" : "chat",
      formHead: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
    };
  });
  log(`${tag}:`, JSON.stringify(info, null, 1));
  if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false });
  return info;
};

/* 1) seat wali trains (data aa jaye) */
await ask("kal ke liye ludhiana se amritsar seat wali trains batao");
const t1 = await snap("SEAT LIST", "round34-live-seat-list.png");

/* 2) "Book 12380"-jaisa bare hukm — jis train ka seat data abhi dikha ho */
const firstTrain = await page.evaluate(() => {
  const el = document.querySelector("#chat-seatlist .sf-group, #chat-seatlist .tcb");
  const txt = el?.textContent ?? "";
  return (txt.match(/\b\d{5}\b/) ?? [])[0] ?? null;
});
log("PICKED TRAIN:", firstTrain);
await ask(firstTrain ? `Book ${firstTrain}` : "Book 12013");
const t2 = await snap("BOOK <TRAIN>", "round34-live-book-known-seats.png");

/* 3) form khula hone par bhi naya sawaal model ke paas jaana chahiye (Round-34: local rasta sirf booking ki baaton ka) */
await ask("12013 ki seat availability batao kal ke liye");
const t3 = await snap("ASK WHILE FORM OPEN", "round34-live-next-from-model.png");

/* 4) form band karke normal sawaal */
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") ?? "").toLowerCase() === "back");
  b?.click();
});
await page.waitForTimeout(1200);
await ask("12014 ka timetable batao");
const t4 = await snap("PLAIN TURN (next tag)", "round34-live-plain-next.png");

const nextFromModel = [t1, t2, t3, t4].filter((x) => x.nextTag === "AI ne chuna").length;
const fallbackTagged = [t1, t2, t3, t4].filter((x) => x.nextTag === "verified data se").length;
log(`NEXT tags → model: ${nextFromModel} · data-fallback: ${fallbackTagged}`);
log(t3.screen === "passengers-overlay" ? "OK: booking hukm se passenger form khula (pichhle seat data ke saath)" : "CHECK: form khula? upar dekho");
await browser.close();
