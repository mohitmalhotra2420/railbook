/* R59 verify (prod): chat → seat board → "Connecting trains" → plan ka APNA page (leg 1/leg 2 + Book). */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.PROD_URL ?? "https://railbook-gegs.onrender.com";
const Q = process.env.Q ?? "Ludhiana se amritsar ki confirm trains btana kal ke liye";
const LOG = "/tmp/r59-verify-log.txt";
const t0 = Date.now();
const W = fs.createWriteStream(LOG, { flags: "w" });
const say = (s: string) => W.write(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}\n`);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on("pageerror", (e) => say(`[PAGEERROR] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") say(`[console.error] ${m.text().slice(0, 200)}`); });

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(2500);
await page.locator(".composer input").first().fill(Q);
await page.locator(".composer input").first().press("Enter");
say("sent query");

/* seat board (sf-np buttons) ka intezaar — beech me pax sawaal aaye to "1" bol do (jaise asli user). */
let boardSeen = false;
let answered = 0;
for (let i = 0; i < 42; i++) {
  await page.waitForTimeout(10000);
  const btns = await page.locator(".sf-np").count();
  if (btns >= 2) { boardSeen = true; say(`seat board buttons mil gaye (${btns}) at tick ${i}`); break; }
  const last = await page.evaluate(() => {
    const m = [...document.querySelectorAll("article.msg.assistant")].pop();
    return (m?.textContent || "").slice(-260);
  });
  const asksPax = /logon ke liye|passenger|kitne (log|passenger|aadmi)|how many/i.test(last);
  const done = !/checks completed|Check|dhoondh|Soch|plan/i.test(last);
  if (asksPax && done && answered < 2) {
    answered++;
    await page.locator(".composer input").first().fill("1");
    await page.locator(".composer input").first().press("Enter");
    say(`pax sawaal mila → "1" bhej diya (#${answered}) | last="${last.slice(-90).replace(/\n+/g, " ")}"`);
  }
}
if (!boardSeen) { say("NO SEAT BOARD — ruk raha hoon"); await page.screenshot({ path: "/tmp/r59-verify-noboard.png" }); await browser.close(); process.exit(1); }

await page.screenshot({ path: "/tmp/r59-verify-board.png" });
await page.locator(".sf-np.connect").first().click();
say("Clicked 'Connecting trains'");

let opened = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(10000);
  const st = await page.evaluate(() => {
   try {
    const pp = document.querySelector(".planpage");
    const body = (document.querySelector(".planpage-body")?.innerText || "").replace(/\n+/g, " | ").slice(0, 320);
    const err = !!document.querySelector(".planpage-err");
    const note = (document.querySelector(".planpage-note")?.innerText || "").slice(0, 120);
    const legs = document.querySelectorAll(".planpage .jx-leg").length;
    const bookLegs = [...document.querySelectorAll(".planpage .jx-leg-book")].map((b) => (b.textContent || "").trim());
    const loading = !!document.querySelector(".planpage-load");
    const head = (document.querySelector(".planpage-head strong")?.textContent || "").trim();
    const chatMsgs = document.querySelectorAll("article.msg").length;
    return { has: !!pp, legs, bookLegs, loading, head, chatMsgs, body, err, note };
   } catch (e) {
     return { has: false, legs: 0, bookLegs: [] as string[], loading: false, head: "", chatMsgs: 0, body: "EVAL-ERR " + String(e), err: false, note: "" };
   }
  }).catch(() => null);
  say(`tick ${i}: planpage=${st.has} loading=${st.loading} head="${st.head}" legs=${st.legs} books=${JSON.stringify(st.bookLegs)} chatMsgs=${st.chatMsgs} err=${st.err} note="${st.note}"`);
  if (st.has && !st.loading) say(`   BODY: ${st.body}`);
  if (st.has && !st.loading && (st.legs > 0 || st.err || st.note)) {
    await page.screenshot({ path: `/tmp/r59-verify-planstate-${i}.png` });
    await page.screenshot({ path: "/tmp/r59-verify-planpage.png" });
    /* R60: touch scroll naapo (asli device jaisa) */
    const cdp = await page.context().newCDPSession(page);
    const before = await page.evaluate(() => (document.querySelector(".planpage-body") as HTMLElement | null)?.scrollTop ?? -1);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 206, y: 700 }] });
    for (let k = 1; k <= 12; k++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 206, y: 700 - k * 40 }] });
      await new Promise((r) => setTimeout(r, 12));
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(700);
    const afterScroll = await page.evaluate(() => (document.querySelector(".planpage-body") as HTMLElement | null)?.scrollTop ?? -1);
    say(`SCROLL TEST: touch swipe ke baad bodyScrollTop ${before} → ${afterScroll}`);
    await page.screenshot({ path: "/tmp/r60-prod-scrolled.png" });
    /* back button → chat waisi hi? */
    await page.locator(".planpage-back").first().click();
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
      planpage: !!document.querySelector(".planpage"),
      chatMsgs: document.querySelectorAll("article.msg").length,
      text: (document.body.innerText || "").slice(0, 120).replace(/\n+/g, " | "),
    }));
    say(`back ke baad: planpage=${after.planpage} chatMsgs=${after.chatMsgs} body="${after.text}"`);
    await page.screenshot({ path: "/tmp/r59-verify-after-back.png" });
    if (st.legs > 0) { opened = true; break; }
    say("   (legs 0 — state dump ho gaya, ruk raha hoon)");
    break;
  }
}
say(opened ? "RESULT: plan page + legs OK" : "RESULT: plan page nahi khula");
W.end();
await browser.close();
