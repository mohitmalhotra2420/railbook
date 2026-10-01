/* R58: blank screen repro — pageerror turant file me, dono scenario (single + duplicate send). */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.PROD_URL ?? "https://railbook-gegs.onrender.com";
const Q = process.env.Q ?? "Ludhiana se amritsar ki confirm trains btana kal ke liye";
const LOG = process.env.LOG ?? "/tmp/r58b-log.txt";
const TAG = process.env.TAG ?? "A";
const dup = process.env.DUP === "1";
const t0 = Date.now();
const W = fs.createWriteStream(LOG, { flags: "w" });
const say = (s: string) => W.write(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}\n`);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") say(`[console.${m.type()}] ${m.text().slice(0, 400)}`); });
page.on("pageerror", (e) => say(`[PAGEERROR] ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 10).join("\n")}`));
page.on("requestfailed", (r) => say(`[REQFAIL] ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));
page.on("crash", () => say("[PAGE CRASH]"));

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(2500);
const input = page.locator("input.composer-input, form.composer input, .composer input").first();
await input.fill(Q);
await input.press("Enter");
say("sent #1");
if (dup) { await page.waitForTimeout(800); await input.fill(Q); await input.press("Enter"); say("sent #2 (duplicate)"); }

for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(10000);
  const st = await page.evaluate(() => {
    const root = document.getElementById("root");
    return {
      rootLen: root?.innerHTML.length ?? -1,
      msgs: document.querySelectorAll("article.msg").length,
      userMsgs: document.querySelectorAll("article.msg.user").length,
      assistMsgs: document.querySelectorAll("article.msg.assistant").length,
      text: (document.body.innerText || "").slice(0, 140).replace(/\n+/g, " | "),
      composer: !!document.querySelector(".composer"),
      progress: (document.querySelector(".ai-progress")?.innerText || "").replace(/\n+/g, " "),
    };
  });
  say(`tick ${i}: root=${st.rootLen} msgs=${st.msgs} (u${st.userMsgs}/a${st.assistMsgs}) composer=${st.composer} progress="${st.progress.slice(0, 60)}" body="${st.text}"`);
  if (i % 3 === 0) await page.screenshot({ path: `/tmp/r58b-${TAG}-${i}.png` });
  /* "done" = streaming ruk gaya: koi progress/thinking nahi aur jawab ka text aa gaya. */
  const working = /checks completed|Understanding|Seat checks|Soch|plan/i.test(st.progress);
  if (!working && st.rootLen > 3000 && i >= 2) {
    await page.waitForTimeout(5000);
    const after = await page.evaluate(() => ({
      len: (document.body.innerText || "").length,
      progress: (document.querySelector(".ai-progress")?.innerText || "").replace(/\n+/g, " "),
      msgs: document.querySelectorAll("article.msg").length,
      cards: document.querySelectorAll("article.msg .jx-card, article.msg .sf-card, article.msg .rp-table, article.msg table").length,
    }));
    say(`done-looking: len=${after.len} msgs=${after.msgs} cards=${after.cards} progress="${after.progress.slice(0, 40)}"`);
    await page.screenshot({ path: `/tmp/r58b-${TAG}-final.png` });
    break;
  }
}
say("END");
W.end();
await browser.close();
