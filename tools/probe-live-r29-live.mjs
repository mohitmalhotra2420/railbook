/* Round-29 LIVE probe (railbook-gegs.onrender.com, asli AI + asli provider data):
 *   1) "Vaishno devi se Ludhiana … seat wali trains" → alias SVDK parse ho + chat me har train EK hi card me
 *      (live board wala block: `.sf-group` per train; text-only jawab me `.rp-row` per train — dono check)
 *   2) class chip par tap → seedha passenger form (client-only, instant)
 *   3) "<train> mein <class> book krdo" → AI khud passenger form kholta hai (train+class+date+fare pehle se)
 *
 *   node tools/probe-live-r29-live.mjs
 * Screenshots: round29-live-{groups,class-tap,autobook}.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const ASK = "Vaishno devi se Ludhiana kal ke liye seat wali trains batao";
const browser = await chromium.launch();

const readList = (p) =>
  p.evaluate(() => {
    const cards = [...document.querySelectorAll(".rp-row")];
    const groups = [...document.querySelectorAll(".sf-group")];
    const nums = [
      ...cards.map((c) => c.querySelector(".rp-no")?.textContent ?? ""),
      ...groups.map((g) => (g.textContent ?? "").match(/\b(\d{4,5})\b/)?.[1] ?? ""),
    ].filter(Boolean);
    const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
    return {
      textCards: cards.length,
      boardGroups: groups.length,
      classRows: cards.reduce((n, c) => n + c.querySelectorAll(".rp-crow").length, 0),
      chips: document.querySelectorAll(".sf-cchip").length,
      trains: nums.length,
      duplicateTrains: nums.filter((n, i) => nums.indexOf(n) !== i),
      svdkRoute: /SVDK/.test(text) && /LDH/.test(text),
      sample: text.slice(text.indexOf("RAILBOOK") + 8, text.indexOf("RAILBOOK") + 220),
    };
  });

/* ── 1) live turn: chhota naam + grouping ───────────────────────────── */
const p1 = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await p1.goto(URL, { waitUntil: "domcontentloaded" });
await p1.waitForSelector(".composer input", { timeout: 60000 });
await p1.fill(".composer input", ASK);
await p1.keyboard.press("Enter");
await p1.waitForSelector(".sf-group, .rp-row", { timeout: 240000 }).catch(() => null);
await p1.waitForTimeout(1500);
const t1 = await readList(p1);
log("LIVE TURN 1:", JSON.stringify(t1, null, 1));
await p1.screenshot({ path: `${OUT}/round29-live-groups.png` });

/* ── 2) class chip tap → passenger form (instant) ───────────────────── */
const tapped = await p1.evaluate(() => {
  const chip =
    document.querySelector(".rp-row button.rp-crow") ??
    document.querySelector(".sf-group .sf-cchip");
  if (!chip) return null;
  chip.scrollIntoView({ block: "center" });
  const info = {
    label: (chip.textContent ?? "").replace(/\s+/g, " ").trim(),
    groupText: (chip.closest(".rp-row") ?? chip.closest(".sf-group"))?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80),
  };
  chip.click();
  return info;
});
await p1.waitForTimeout(1500);
const t2 = await p1.evaluate(() => {
  const ov = document.querySelector(".overlay-screen");
  return {
    screen: ov ? "passengers-overlay" : "chat",
    hasName: Boolean(document.querySelector('[id^="name-"]')),
    overlayHead: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
  };
});
log("LIVE CLASS TAP:", JSON.stringify({ ...(tapped ?? {}), ...t2 }, null, 1));
await p1.screenshot({ path: `${OUT}/round29-live-class-tap.png` });
await p1.close();

/* ── 3) "book krdo" → khud passenger form (asli AI turn) ────────────── */
const p2 = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
await p2.goto(URL, { waitUntil: "domcontentloaded" });
await p2.waitForSelector(".composer input", { timeout: 60000 });
await p2.fill(".composer input", ASK);
await p2.keyboard.press("Enter");
await p2.waitForSelector(".sf-group, .rp-row", { timeout: 240000 }).catch(() => null);
await p2.waitForTimeout(1200);
const pick = await p2.evaluate(() => {
  const chip = [...document.querySelectorAll(".sf-group .sf-cchip")].find((c) => !/N\/A|—/.test(c.textContent ?? ""));
  const card = document.querySelector(".rp-row button.rp-crow");
  const host = chip ?? card;
  if (!host) return null;
  const groupText = (host.closest(".sf-group") ?? host.closest(".rp-row"))?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const number = groupText.match(/\b(\d{4,5})\b/)?.[1] ?? "";
  const cls = (host.textContent ?? "").match(/\b(1A|2A|3A|3E|2S|SL|CC|EC|EA|FC|GN)\b/)?.[1] ?? "";
  return number && cls ? { number, cls } : null;
});
log("LIVE PICK:", JSON.stringify(pick));
if (pick) {
  const message = `${pick.number} mein ${pick.cls} book krdo`;
  await p2.fill(".composer input", message);
  await p2.keyboard.press("Enter");
  await p2.waitForSelector(".overlay-screen", { timeout: 240000 }).catch(() => null);
  await p2.waitForTimeout(1500);
  const t3 = await p2.evaluate(() => {
    const ov = document.querySelector(".overlay-screen");
    return {
      screen: ov ? "passengers-overlay" : "chat",
      hasName: Boolean(document.querySelector('[id^="name-"]')),
      overlayHead: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      chatTail: (document.body.textContent ?? "").replace(/\s+/g, " ").slice(-200),
    };
  });
  log("LIVE AUTO BOOK:", JSON.stringify({ asked: message, ...t3 }, null, 1));
  await p2.screenshot({ path: `${OUT}/round29-live-autobook.png` });
}

await browser.close();
log("LIVE_PROBE_DONE");
