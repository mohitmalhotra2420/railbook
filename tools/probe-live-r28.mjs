/* Round-28 live probe (26 Sep 2026) — Pixel-size browser me:
 *   1) chat se seat chip tap → passenger form
 *   2) naapo: "Review journey" CTA bina scroll dikhta hai? (pehle dock .app ke neeche chala jaata tha)
 *   3) CTA ke saath "Aapki details IRCTC par khud bhar jaayengi" line
 *   4) form bharne par button label badalta hai + Review journey → Continue to IRCTC page par bhi wahi line
 *
 *   node tools/probe-live-r28.mjs
 * Screenshots: round28-live-pax-dock.png / round28-live-review-autofill.png
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
await page.fill(".composer input", "Kya kal ke liye koi available seat hai ludhiana se amritsar ke liye?");
await page.keyboard.press("Enter");
await page.waitForSelector(".sf-group", { timeout: 150000 });
await page.waitForTimeout(1200);

/* seat chip → passenger form */
await page.click(".sf-group .sf-cchip");
await page.waitForSelector("#name-", { timeout: 30000 }).catch(() => null);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/round28-live-pax-dock.png` });

const dock = await page.evaluate(() => {
  const btn = document.querySelector(".sticky-cta button");
  const note = document.querySelector(".sticky-cta .cta-note");
  const vb = document.querySelector(".vb");
  const br = btn?.getBoundingClientRect();
  const nr = note?.getBoundingClientRect();
  return {
    btnLabel: (btn?.textContent ?? "").trim(),
    btnTop: br ? Math.round(br.top) : null,
    btnBottom: br ? Math.round(br.bottom) : null,
    btnVisibleWithoutScroll: br ? br.top >= 0 && br.bottom <= window.innerHeight + 2 : false,
    noteTop: nr ? Math.round(nr.top) : null,
    noteVisibleWithoutScroll: nr ? nr.top >= 0 && nr.bottom <= window.innerHeight + 2 : false,
    noteText: (note?.textContent ?? "").replace(/\s+/g, " ").trim(),
    voicebarVisible: vb ? vb.getBoundingClientRect().bottom <= window.innerHeight + 2 : null,
    innerHeight: window.innerHeight,
  };
});
log("PASSENGER DOCK:", JSON.stringify(dock, null, 1));

/* form bharo → label badalna chahiye, phir Review journey */
const nameInput = await page.$('[id^="name-"]');
await nameInput?.fill("Rahul Sharma");
await page.fill('[id^="age-"]', "38");
await page.selectOption('[id^="gender-"]', "MALE");
/* Berth options class ke hisaab se badalte hain (CC me "Window", SL me "Lower"…) — pehla valid chuno. */
await page.evaluate(() => {
  const sel = document.querySelector('[id^="berth-"]');
  if (sel) {
    const opt = [...sel.options].find((o) => o.value);
    if (opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
});
await page.waitForTimeout(400);
const afterFill = await page.evaluate(() => {
  const btn = document.querySelector(".sticky-cta button");
  const br = btn?.getBoundingClientRect();
  return {
    label: (btn?.textContent ?? "").trim(),
    disabled: btn?.hasAttribute("disabled") ?? null,
    visibleWithoutScroll: br ? br.top >= 0 && br.bottom <= window.innerHeight + 2 : false,
  };
});
log("AFTER FILL:", JSON.stringify(afterFill));
await page.screenshot({ path: `${OUT}/round28-live-pax-dock-filled.png` });

await page.click(".sticky-cta button");
await page.waitForSelector("#irctc-continue", { timeout: 30000 });
await page.waitForTimeout(900);
const review = await page.evaluate(() => {
  const btn = document.querySelector("#irctc-continue");
  const note = document.querySelector("#irctc-autofill-note");
  const br = btn?.getBoundingClientRect();
  return {
    hasContinue: Boolean(btn),
    continueVisibleWithoutScroll: br ? br.top >= 0 && br.bottom <= window.innerHeight + 2 : false,
    autoFillNote: (note?.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
});
log("REVIEW:", JSON.stringify(review, null, 1));
await page.screenshot({ path: `${OUT}/round28-live-review-autofill.png`, fullPage: false });

await browser.close();
log("PROBE DONE");
