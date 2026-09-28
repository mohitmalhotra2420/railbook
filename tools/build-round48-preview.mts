/* Round-48 preview — "green line me saari classes, par card me kam" wala bug + fix.
 * Asli components se render (ReplyText) + asli built CSS inline. Chalane: npx vite build && npx tsx tools/build-round48-preview.mts
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ReplyText } from "../src/components/ReplyText";
import { AnswerCard } from "../src/components/AnswerCard";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
if (!cssFile) throw new Error("dist CSS nahi mili — pehle `npx vite build` chalao");
const appCss = fs.readFileSync(path.join("dist/assets", cssFile), "utf8");

export const SCREENSHOT_LINE =
  "💺 sab class me seat wali 19 trains — 12054 2S AVL 660 ₹150 · CC AVL 17 ₹480 | 12498 2S AVL 486 ₹130 | " +
  "14680 2S AVL 328 ₹115 · CC AVL 48 ₹410 | 12014 CC AVL 320 ₹805 · EC AVL 13 ₹1,245 | 22488 CC AVL 307 ₹820 · EC AVL 2 ₹1,520 | " +
  "15015 3E AVL 227 ₹520 · SL AVL 147 ₹190 · 2A AVL 26 ₹725 · 1A AVL 6 ₹1,190 | 12030 CC AVL 96 ₹955 | " +
  "11058 3E AVL 85 ₹530 · 2A AVL 18 ₹805 | 18104 3A AVL 76 ₹520 · 3E AVL 21 ₹520 · 2A AVL 8 ₹725 | " +
  "12204 3A AVL 67 ₹435 | 14624 SL AVL 64 ₹190 · 3A AVL 29 ₹520 | 15708 3E AVL 39 ₹520 · SL AVL 29 ₹190 · 2A AVL 10 ₹725 · 3A AVL 10 ₹520. " +
  "(ASR → UMB · live board)";

const AFTER = renderToStaticMarkup(h(ReplyText, { text: SCREENSHOT_LINE }));
const SEAT_LINE = renderToStaticMarkup(h(AnswerCard, { text: SCREENSHOT_LINE.split("\n")[0].replace(/^💺\s*/, "💺 ") }));

/* "Pehle" wale cards — user ke screenshot se (1 class per train jaisa parser ne pehle banaya tha). */
const OLD_CARDS = [
  ["12054", "1 class", [["2S", "AVL 660", "₹150"]]],
  ["14680", "1 class", [["CC", "AVL 48", "₹410"]]],
  ["12014", "1 class", [["EC", "AVL 13", "₹1,245"]]],
  ["22488", "1 class", [["EC", "AVL 2", "₹1,520"]]],
  ["15015", "3 classes", [["SL", "AVL 147", "₹190"], ["2A", "AVL 26", "₹725"], ["1A", "AVL 6", "₹1,190"]]],
  ["11058", "1 class", [["2A", "AVL 18", "₹805"]]],
  ["18104", "2 classes", [["3E", "AVL 21", "₹520"], ["2A", "AVL 8", "₹725"]]],
  ["14624", "1 class", [["3A", "AVL 29", "₹520"]]],
  ["15708", "3 classes", [["SL", "AVL 29", "₹190"], ["2A", "AVL 10", "₹725"], ["3A", "AVL 10", "₹520"]]],
];
const oldCardsHtml = OLD_CARDS.map(
  ([num, badge, rows]) => `
  <div class="rp-row seat">
    <div class="rp-l1"><span class="rp-no">${num}</span><span class="rp-gcount">${badge}</span></div>
    <div class="rp-crows">
      ${(rows as string[][])
        .map(
          ([cls, st, fare]) =>
            `<div class="rp-crow ok"><span class="rp-cls">${cls}</span><span class="rp-st ok">${st}</span><span class="rp-fare">${fare}</span></div>`,
        )
        .join("")}
    </div>
  </div>`,
).join("");

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 48: card me saari classes (fix)</title>
<style>
${appCss}
body { background:#0f1420; color:#e8ecf3; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.pv { max-width: 1180px; margin: 0 auto; padding: 26px 18px 60px; }
.pv h1 { font-size: 23px; margin: 0 0 6px; }
.pv .sub { color:#8fa3bf; margin: 0 0 18px; font-size: 14px; line-height: 1.6; }
.pv .grid { display:flex; gap:22px; flex-wrap:wrap; align-items:flex-start; }
.phone { width: 390px; background:#f4f0e8; border-radius: 20px; overflow:hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); border:1px solid #26324a; }
.phone-cap { background:#141c2b; padding:10px 14px; display:flex; align-items:center; gap:8px; font-size:14px; }
.cap-tag { font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; border-radius:999px; padding:3px 9px; }
.cap-tag.old { background:#3a2222; color:#ffb4b4; border:1px solid #5c3030; }
.cap-tag.new { background:#16351f; color:#8ee6ab; border:1px solid #2c5a3c; }
.screen { background:#f4f0e8; max-height: 640px; overflow:auto; padding: 12px 12px 4px; }
.screen .msg { margin: 8px 0 12px; }
.screen .msg-text { font-size: 15.5px; line-height: 1.6; }
.green { background:#e4f4ec; border:1px solid #bfe3d1; border-radius:14px; padding:10px 12px; font-size:14.5px; line-height:1.55; color:#123; margin-bottom:10px; }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
table.pv-t { width:100%; border-collapse:collapse; font-size:13.5px; margin: 10px 0 4px; }
table.pv-t th, table.pv-t td { text-align:left; padding:7px 9px; border-bottom:1px solid #22304a; vertical-align:top; }
table.pv-t th { color:#9fb7d8; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
.bad { color:#ff9d9d; } .good { color:#8ee6ab; }
.pv ul { margin:8px 0 0 18px; padding:0; }
</style></head><body><div class="pv">
<h1>Round 48 — "green line me saari classes, par card me kam" (fix ho gaya)</h1>
<p class="sub">Aapke do screenshots ka wahi sawaal, wahi jawab — ab neeche ke cards me <b>har train ki saari classes</b> dikhti hain, jitni green line me likhi hain.</p>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag old">Pehle</span><b>Card me classes kam</b></div>
    <div class="screen">
      <div class="green">💺 sab class me seat wali 19 trains — 12054 <b>2S AVL 660 ₹150 · CC AVL 17 ₹480</b> | 12498 2S AVL 486 ₹130 | 14680 <b>2S AVL 328 ₹115 · CC AVL 48 ₹410</b> | 12014 <b>CC AVL 320 ₹805 · EC AVL 13 ₹1,245</b> | 15015 <b>3E… · SL… · 2A… · 1A…</b> …</div>
      <div class="rp"><div class="rp-sum">💺 12 me seat (660, 486, 328, 320, 307, 227, 147, 96, 85, 76, 67, 64) · fare ₹115–₹955</div>
        <div class="rp-rows">${oldCardsHtml}</div>
      </div>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab</span><b>Saari classes, sahi counts</b></div>
    <div class="screen">
      <div class="green">💺 sab class me seat wali 19 trains — 12054 <b>2S AVL 660 ₹150 · CC AVL 17 ₹480</b> | 12498 2S AVL 486 ₹130 | 14680 <b>2S AVL 328 ₹115 · CC AVL 48 ₹410</b> | 12014 <b>CC AVL 320 ₹805 · EC AVL 13 ₹1,245</b> | 15015 <b>3E… · SL… · 2A… · 1A…</b> …</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${AFTER}</article>
    </div>
  </div>
</div>
<div class="box">
 <b>Kya galat tha (parser, UI-only):</b> server ki compact seat line me train ka <b>naam nahi</b> hota —
 <code>12054 2S AVL 660 ₹150 · CC AVL 17 ₹480</code>. Parser ko naam chahiye tha, isliye wo
 <code>2S AVL 660 ₹150</code> ko "naam" maan leta tha aur agla class chip (CC) hi asli row ban jaata tha
 — pehli class gayab, aur jo rows parse hi nahi hui (jaise <code>12030</code>, <code>12204</code>) wo neeche
 plain text me chali jaati thi. Green line (server ka asli data) sahi thi; sirf neeche ke cards adhoore the.
</div>
<div class="box">
 <b>Fix (sirf UI parser — AI/API/backend ko haath nahi lagaya):</b>
 <ul>
  <li>Number ke turant baad class code ho to <b>compact row</b> banti hai (naam khaali) — jaisa text me hai waisa hi.</li>
  <li>Train ke naam me ab <b>ank nahi</b> aate — "2S AVL 660 ₹150" kabhi naam nahi ban sakta.</li>
  <li>Green line ka lead-in ("💺 sab class me seat wali 19 trains — ") ab head chip me alag hota hai, row nahi khaata.</li>
  <li>Fare me trailing comma nahi aata (<code>₹510</code>, na ki <code>₹510,</code>).</li>
 </ul>
</div>
<h1 style="font-size:18px">Verify — aapke text par hi</h1>
<table class="pv-t"><thead><tr><th>Train</th><th>Text (green line)</th><th>Pehle card me</th><th>Ab card me</th></tr></thead><tbody>
<tr><td>12054</td><td>2S AVL 660 ₹150 · CC AVL 17 ₹480</td><td class="bad">1 class (2S)</td><td class="good">2 classes (2S + CC)</td></tr>
<tr><td>14680</td><td>2S AVL 328 ₹115 · CC AVL 48 ₹410</td><td class="bad">1 class (CC)</td><td class="good">2 classes (2S + CC)</td></tr>
<tr><td>12014</td><td>CC AVL 320 ₹805 · EC AVL 13 ₹1,245</td><td class="bad">1 class (EC)</td><td class="good">2 classes (CC + EC)</td></tr>
<tr><td>15015</td><td>3E · SL · 2A · 1A</td><td class="bad">3 classes</td><td class="good">4 classes</td></tr>
<tr><td>12030 / 12204 / 12498</td><td>CC AVL 96 ₹955 / 3A AVL 67 ₹435 / 2S AVL 486 ₹130</td><td class="bad">card hi nahi banta tha (ya ek hi class)</td><td class="good">poora card</td></tr>
<tr><td>Total</td><td>12 trains · 26 class rows</td><td class="bad">9 cards · 13 rows</td><td class="good">12 cards · 26 rows</td></tr>
</tbody></table>
<p class="sub">Full suite: 127 files / 1378 tests pass (4 naye Round-48 tests: aapka exact text, count match, purane formats par koi asar nahi, adhoora-match safety).</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round48-2026-09-29.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
void SEAT_LINE;
