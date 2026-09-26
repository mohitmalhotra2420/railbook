/* Round-27 live probe (26 Sep 2026) — do cheezein asli browser me check karta hai:
 *   (a) chat ka seat answer: har train ki SAARI classes ek block me + class chip tap → passenger form
 *   (b) mic: app (Android WebView) me Web Speech nahi hota — isliye page par naya native bridge
 *       (window.RailBookVoice) inject kar ke dekhte hain ki client ka native path chalta hai:
 *       mic tap → start → app se final transcript → input me text + auto-send.
 *
 * Chalane ka tarika: node tools/probe-live-r27.mjs
 * Screenshots: round27-live-seat-block-top.png / -chip-tap.png / round27-live-native-voice.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });

/* ── 1) seat answer ─────────────────────────────────────────────────────────────────────────── */
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".composer input", { timeout: 60000 });
await page.fill(".composer input", "Kya kal ke liye koi available seat hai ludhiana se amritsar ke liye?");
await page.keyboard.press("Enter");
await page.waitForSelector(".sf-group", { timeout: 150000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/round27-live-seat-block-top.png` });

const groups = await page.$$eval(".sf-group", (els) =>
  els.map((el) => ({
    head: (el.querySelector(".sf-group-h")?.textContent ?? "").trim().replace(/\s+/g, " "),
    chips: [...el.querySelectorAll(".sf-cchip")].map((c) => (c.textContent ?? "").trim().replace(/\s+/g, " ")),
  })),
);
log("groups:", groups.length);
for (const g of groups.slice(0, 14)) log("  ", g.head, "→", g.chips.join(" | "));

/* ek chip par tap → passenger form */
const chip = await page.$(".sf-group .sf-cchip");
const chipText = (await chip.textContent()).trim().replace(/\s+/g, " ");
log("tapping chip:", chipText);
await chip.click();
await page.waitForSelector(".overlay-screen", { timeout: 30000 }).catch(() => null);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/round27-live-chip-tap.png` });
const screen = await page.evaluate(() => document.body.innerText.slice(0, 900));
log("--- after chip tap (passenger form?) ---\n" + screen);
log("PASSENGERS screen?:", /Passengers/i.test(screen), "| Review journey?:", /Review journey/i.test(screen));

/* ── 2) native voice bridge (jo Android app deta hai) ───────────────────────────────────────── */
/* Naya context: pichhle booking-draft overlay se bachne ke liye. */
const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
const page2 = await ctx2.newPage();
await page2.goto(URL, { waitUntil: "domcontentloaded" });
await page2.waitForSelector(".composer input", { timeout: 60000 });
await page2.evaluate(() => {
  window.__r27 = { calls: [] };
  window.RailBookVoice = {
    start(lang) {
      window.__r27.calls.push(`start:${lang}`);
      setTimeout(() => window.__railbookVoice?.dispatch(JSON.stringify({ type: "start" })), 20);
    },
    stop() {
      window.__r27.calls.push("stop");
    },
    abort() {
      window.__r27.calls.push("abort");
    },
    isAvailable() {
      return true;
    },
  };
});
/* mic button: VoiceBar ke andar ka button (aria/label se dhoondho) */
await page2.evaluate(() => {
  window.__r27.errors = [];
  window.addEventListener("error", (e) => window.__r27.errors.push(String(e.message)));
});
const micSel = await page2.evaluate(() => {
  const cands = [...document.querySelectorAll("button")].filter((b) =>
    /mic|bol|sun|voice/i.test((b.getAttribute("aria-label") || "") + (b.className || "") + (b.title || "") + b.textContent),
  );
  if (cands.length) cands[0].setAttribute("data-r27mic", "1");
  return cands.slice(0, 6).map((b) => `${b.className}|${b.getAttribute("aria-label") ?? ""}|${(b.textContent || "").trim().slice(0, 20)}`);
});
log("mic candidates:", JSON.stringify(micSel));
const mic = await page2.$("[data-r27mic='1']");
if (!mic) {
  log("MIC: button selector nahi mila");
} else {
  await mic.click();
  await page2.waitForTimeout(1200);
  log("--- voice sheet (start ke baad) ---");
  log(await page2.evaluate(() => (document.querySelector(".vb, .vb-wrap, .sheet")?.innerText ?? document.body.innerText).slice(-500)));
  await page2.evaluate(() => {
    window.__railbookVoice?.dispatch(JSON.stringify({ type: "partial", text: "ludhiana se amritsar" }));
  });
  await page2.waitForTimeout(800);
  log("partial ke baad sheet:", JSON.stringify(await page2.evaluate(() => (document.querySelector(".vb, .vb-wrap, .sheet")?.innerText ?? "").slice(-300))));
  await page2.evaluate(() => {
    window.__railbookVoice?.dispatch(JSON.stringify({ type: "final", text: "Ludhiana se Amritsar kal SL me seat" }));
  });
  await page2.waitForTimeout(3000);
  await page2.screenshot({ path: `${OUT}/round27-live-native-voice.png` });
  log("native calls:", (await page2.evaluate(() => window.__r27.calls)).join(", "));
  log("input value:", JSON.stringify(await page2.inputValue(".composer input").catch(() => "<none>")));
  log("page errors:", JSON.stringify(await page2.evaluate(() => window.__r27.errors)));
  log("mic band message aaya?:", await page2.evaluate(() => /mic band|available nahi/i.test(document.body.innerText)));
  /* Manual-commit: "OK ✓" dabao → wahi text input me jaata hai aur bhej diya jaata hai. */
  const okBtn = await page2.$("button:has-text('OK')");
  if (okBtn) {
    await okBtn.click();
    await page2.waitForTimeout(6000);
    log("OK dabane ke baad input:", JSON.stringify(await page2.inputValue(".composer input").catch(() => "<none>")));
    log("jawab aaya (seat/train rows)?:", await page2.evaluate(() => /12013|19611|seat|AVL/i.test(document.body.innerText)));
    await page2.screenshot({ path: `${OUT}/round27-live-native-voice-sent.png` });
  } else {
    log("OK button nahi mila");
  }
  log("--- sheet (final ke baad) ---");
  log(await page2.evaluate(() => (document.querySelector(".vb, .vb-wrap, .sheet")?.innerText ?? document.body.innerText).slice(-400)));
}
await browser.close();
log("PROBE DONE");
