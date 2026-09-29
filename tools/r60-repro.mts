/* R60 · (a) ambiguous station pe dropdown aata hai ya nahi — prod UI par asli sawaal se.
 * (b) plan page ka scroll — .planpage-body scrollable hai ya content clip ho raha hai. */
import { chromium } from "playwright";
import fs from "node:fs";

const URL = process.env.PROD_URL ?? "https://railbook-gegs.onrender.com";
const Q = process.env.Q ?? "Amritsar se Delhi jana hai";
const MODE = process.env.MODE ?? "choice"; /* choice | scroll */
const LOG = `/tmp/r60-${MODE}-log.txt`;
const t0 = Date.now();
const W = fs.createWriteStream(LOG, { flags: "w" });
const say = (s: string) => W.write(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}\n`);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => say(`[PAGEERROR] ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") say(`[console.error] ${m.text().slice(0, 200)}`); });

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(2500);
await page.locator(".composer input").first().fill(Q);
await page.locator(".composer input").first().press("Enter");
say(`sent: ${Q}`);

if (MODE === "choice") {
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(8000);
    const st = await page.evaluate(() => {
      const sel = document.querySelectorAll("select");
      const chip = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter((t) => /NDLS|DLI|NZM|kaunsa station|Chuno/i.test(t));
      const last = [...document.querySelectorAll("article.msg.assistant")].pop();
      return {
        selects: sel.length,
        options: sel.length ? [...sel[0].options].map((o) => o.textContent) : [],
        chips: chip.slice(0, 6),
        lastText: (last?.textContent || "").slice(0, 220).replace(/\n+/g, " | "),
        msgs: document.querySelectorAll("article.msg").length,
      };
    }).catch(() => ({ selects: -1, options: [], chips: [], lastText: "eval-fail", msgs: -1 }));
    say(`tick ${i}: selects=${st.selects} opts=${JSON.stringify(st.options)} chips=${JSON.stringify(st.chips)} msgs=${st.msgs} last="${st.lastText}"`);
    if (st.selects > 0 || st.chips.length) { await page.screenshot({ path: `/tmp/r60-choice-${i}.png` }); say("DROPDOWN mila"); break; }
    if (i > 3 && st.msgs >= 2 && !/checks completed|dhoondh|Check|plan/i.test(st.lastText)) { await page.screenshot({ path: `/tmp/r60-choice-nodrop.png` }); say("jawab aa gaya, dropdown NAHI"); break; }
  }
} else {
  /* scroll mode — seat board ke buttons ka intezaar, phir plan page khol kar scroll naapo */
  let board = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(9000);
    const n = await page.locator(".sf-np").count();
    if (n >= 2) { board = true; say(`seat board ok (${n})`); break; }
    const last = await page.evaluate(() => ([...document.querySelectorAll("article.msg.assistant")].pop()?.textContent || "").slice(-200));
    if (/logon ke liye|passenger|kitne/i.test(last) && !/checks completed|dhoondh/i.test(last)) {
      await page.locator(".composer input").first().fill("1");
      await page.locator(".composer input").first().press("Enter");
      say("pax → 1");
    }
  }
  if (!board) { say("NO BOARD"); await browser.close(); process.exit(1); }
  await page.locator(".sf-np.connect").first().click();
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(9000);
    const st = await page.evaluate(() => {
      const pp = document.querySelector(".planpage") as HTMLElement | null;
      const body = document.querySelector(".planpage-body") as HTMLElement | null;
      const embed = document.querySelector(".jx-page-embed") as HTMLElement | null;
      const m = (el: HTMLElement | null) => (el ? { ch: el.clientHeight, sh: el.scrollHeight, st: el.scrollTop, of: getComputedStyle(el).overflowY } : null);
      return {
        has: !!pp, loading: !!document.querySelector(".planpage-load"), legs: document.querySelectorAll(".planpage .jx-leg").length,
        doc: { ih: window.innerHeight, seh: document.scrollingElement?.scrollHeight ?? -1, bodyOverflow: getComputedStyle(document.body).overflowY },
        page: m(pp), body: m(body), embed: m(embed),
        books: document.querySelectorAll(".planpage .jx-leg-book").length,
      };
    }).catch(() => null);
    if (!st) continue;
    say(`tick ${i}: has=${st.has} loading=${st.loading} legs=${st.legs} books=${st.books} viewport=${st.doc.ih} docSH=${st.doc.seh} | planpage=${JSON.stringify(st.page)} | body=${JSON.stringify(st.body)} | embed=${JSON.stringify(st.embed)}`);
    if (st.has && !st.loading && st.legs > 0) {
      /* scroll test 1: mouse wheel */
      await page.mouse.move(200, 600);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => {
        const b = document.querySelector(".planpage-body") as HTMLElement | null;
        const p = document.querySelector(".planpage") as HTMLElement | null;
        return { bodyST: b?.scrollTop ?? -1, pageST: p?.scrollTop ?? -1, winST: window.scrollY, docST: document.scrollingElement?.scrollTop ?? -1 };
      });
      say(`wheel ke baad: ${JSON.stringify(after)}`);
      /* scroll test 2: touch swipe */
      await page.touchscreen.tap(200, 300);
      const t1 = await page.evaluate(() => (document.querySelector(".planpage-body") as HTMLElement | null)?.scrollTop ?? -1);
      await page.evaluate(() => {
        const b = document.querySelector(".planpage-body") as HTMLElement | null;
        if (b) b.scrollTop = 500;
      });
      const t2 = await page.evaluate(() => (document.querySelector(".planpage-body") as HTMLElement | null)?.scrollTop ?? -1);
      say(`programmatic: before=${t1} set500→after=${t2}`);
      await page.screenshot({ path: "/tmp/r60-scroll-final.png" });
      break;
    }
  }
}
say("END");
W.end();
await browser.close();
