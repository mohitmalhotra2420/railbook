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

/* seat board (sf-np buttons) ka intezaar */
let boardSeen = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(10000);
  const btns = await page.locator(".sf-np").count();
  if (btns >= 2) { boardSeen = true; say(`seat board buttons mil gaye (${btns}) at tick ${i}`); break; }
}
if (!boardSeen) { say("NO SEAT BOARD — ruk raha hoon"); await page.screenshot({ path: "/tmp/r59-verify-noboard.png" }); await browser.close(); process.exit(1); }

await page.screenshot({ path: "/tmp/r59-verify-board.png" });
await page.locator(".sf-np.connect").first().click();
say("Clicked 'Connecting trains'");

let opened = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(10000);
  const st = await page.evaluate(() => {
    const pp = document.querySelector(".planpage");
    const legs = document.querySelectorAll(".planpage .jx-leg").length;
    const bookLegs = [...document.querySelectorAll(".planpage .jx-leg-book")].map((b) => (b.textContent || "").trim());
    const loading = !!document.querySelector(".planpage-load");
    const head = (document.querySelector(".planpage-head strong")?.textContent || "").trim();
    const chatMsgs = document.querySelectorAll("article.msg").length;
    return { has: !!pp, legs, bookLegs, loading, head, chatMsgs };
  });
  say(`tick ${i}: planpage=${st.has} loading=${st.loading} head="${st.head}" legs=${st.legs} books=${JSON.stringify(st.bookLegs)} chatMsgs=${st.chatMsgs}`);
  if (st.has && !st.loading && st.legs > 0) {
    await page.screenshot({ path: "/tmp/r59-verify-planpage.png" });
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
    opened = true;
    break;
  }
}
say(opened ? "RESULT: plan page + legs OK" : "RESULT: plan page nahi khula");
W.end();
await browser.close();
