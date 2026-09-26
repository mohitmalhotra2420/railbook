/* Round-35 LIVE probe — user ka exact scenario:
 *   1) "vaishno devi se ludhiana ki seat availability batao"  → seat board
 *   2) board se wo train chuno jisme 2+ classes me seat khuli hai (jaise user ne 19028 ke saath kiya)
 *   3) "Book <train>" → ab AI khud poochhe "kaunsi class?" (class-choice card) — form na khule
 *   4) card ke chip par tap → us class ka passenger form (wahi data jo dikha tha)
 *
 *   node tools/probe-live-r35-live.mjs
 * Screenshots: round35-live-{class-choice,class-picked}.png
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
    const cc = document.querySelector("#class-choice");
    const ov = document.querySelector(".overlay-screen");
    return {
      reply: (document.querySelector(".bubble.assistant:last-of-type, .msg.assistant:last-of-type")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 260),
      classChoice: Boolean(cc),
      classChips: cc ? [...cc.querySelectorAll(".ns-chip")].map((c) => (c.textContent ?? "").trim()) : [],
      screen: ov ? "passengers-overlay" : "chat",
      formClass: (ov?.textContent ?? "").match(/\b(1A|2A|3A|3E|2S|SL|CC|EC)\b/)?.[1] ?? null,
      formHead: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 150),
    };
  });
  log(`${tag}:`, JSON.stringify(info, null, 1));
  if (shot) {
    /* Card/overlay ko view me la kar capture karo — warna screenshot pichhle content ka aata hai. */
    await page.evaluate(() => {
      const t = document.querySelector("#class-choice") ?? document.querySelector(".msg.assistant:last-of-type") ?? document.querySelector(".overlay-screen");
      t?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false });
  }
  return info;
};

/* 1) user ka route: vaishno devi → ludhiana (seat availability) */
await ask("vaishno devi se ludhiana kal ki seat availability batao");
const t1 = await snap("SEAT (SVDK→LDH)", null);

/* 2) board se wo train chuno jisme 2+ classes me seat khuli hai */
const picked = await page.evaluate(() => {
  const groups = [...document.querySelectorAll("#chat-seatlist .sf-groups > *")];
  for (const g of groups) {
    const txt = (g.textContent ?? "").replace(/\s+/g, " ");
    const num = (txt.match(/\b\d{5}\b/) ?? [])[0];
    const seats = (txt.match(/AVL\s*\d+/g) ?? []).length;
    if (num && seats >= 2) return { num, seats, txt: txt.slice(0, 120) };
  }
  const first = groups[0] ? ((groups[0].textContent ?? "").match(/\b\d{5}\b/) ?? [])[0] : null;
  return first ? { num: first, seats: 0, txt: "" } : null;
});
log("PICKED (2+ AVL classes):", JSON.stringify(picked));

/* 3) bare booking hukm — class nahi boli */
if (picked?.num) {
  await ask(`Book ${picked.num}`);
  const t2 = await snap("BOOK <TRAIN> (class nahi boli)", "round35-live-class-choice.png");

  /* 4) chip tap → us class ka passenger form */
  const chip = await page.evaluate(() => {
    const c = document.querySelector("#class-choice .ns-chip");
    if (!c) return null;
    const label = (c.textContent ?? "").trim();
    c.click();
    return label;
  });
  log("CHIP TAPPED:", chip);
  if (chip) {
    await page.waitForFunction(() => !document.querySelector(".thinking"), null, { timeout: 300000 }).catch(() => null);
    await page.waitForTimeout(2500);
    const t3 = await snap("CHIP → FORM", "round35-live-class-picked.png");
    log(t3.screen === "passengers-overlay" ? "OK: chip tap se passenger form khula (class user ne chuni)" : "CHECK: form khula? upar dekho");
    log(t2.classChoice && t2.screen === "chat" ? "OK: form RUK gaya — AI ne pehle class poochhi" : "CHECK: class-choice card dikha?");
  }
}
await browser.close();
