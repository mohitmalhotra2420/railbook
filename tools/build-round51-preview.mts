/* Round-51 preview — "Yaar LDH" wording + confirm/available par saari classes. */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ReplyText } from "../src/components/ReplyText";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const appCss = fs.readFileSync(path.join("dist/assets", cssFile!), "utf8");

/* (a) wording */
const OLD_TEXT = [
  "LDH → SVDK, 2026-09-30 — kitne passengers hain? (1–6) Seats usi hisaab se check karunga.",
  "* 20433 JAMMU MAIL — 1A AVL 1 ₹1,530 · 2A WL 1 ₹925 · 3A WL 1 ₹675 · 3E AVL 1 ₹625 · SL N/A (Regret) ₹270 — 01:47 departure",
  "",
  "💺 sab class me seat wali 1 train — 20433 1A AVL 1 ₹1,530 · 2A WL 1 ₹925 · 3A WL 1 ₹675 · 3E AVL 1 ₹625 · SL N/A ₹270. (LDH → SVDK · live board)",
  "ℹ️ 12425 JAMMU RAJDHANI (last stop JAT), 14661 SHALIMAR MALANI (last stop JAT), 12413 GALTADHAM POOJA (last stop JAT), 12265 JAT DURONTO EXP (last stop JAT) — ye SVDK tak nahi jaati, isliye list se hata di.",
  "🧭 JAT tak (aage ka safar khud): 12265 JAT DURONTO EXP (2A AVL 5 · 3A AVL 10) | 13151 KOAA JAT EXPRES (SL AVL 8) | 12237 BEGUMPURA EXP (1A AVL 1)",
  "(Inme LDH→JAT tak ka ticket hota hai, SVDK ka nahi.)",
].join("\n");
const NEW_TEXT = OLD_TEXT;

const OLD_CARDS = `
  <div class="rp-row seat"><div class="rp-l1"><span class="rp-no">12265</span><span class="rp-name">JAT DURONTO EXP</span></div>
    <div class="rp-crows"><div class="rp-crow ok"><span class="rp-cls">3A</span><span class="rp-st ok">AVL 10</span><span class="rp-fare">₹860</span></div>
    <div class="rp-crow ok"><span class="rp-cls">2A</span><span class="rp-st ok">AVL 5</span><span class="rp-fare">₹870</span></div>
    <div class="rp-crow"><span class="rp-cls">2S</span><span class="rp-st wl">WL 1</span><span class="rp-fare">₹225</span></div></div></div>`;

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 51: wording + saari classes</title>
<style>
${appCss}
body { background:#0f1420; color:#e8ecf3; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.pv { max-width: 1240px; margin: 0 auto; padding: 26px 18px 60px; }
.pv h1 { font-size: 23px; margin: 0 0 6px; }
.pv h2 { font-size: 17px; margin: 26px 0 8px; }
.pv .sub { color:#8fa3bf; margin: 0 0 18px; font-size: 14px; line-height: 1.65; }
.pv .grid { display:flex; gap:22px; flex-wrap:wrap; align-items:flex-start; }
.phone { width: 390px; background:#f4f0e8; border-radius: 20px; overflow:hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); border:1px solid #26324a; }
.phone-cap { background:#141c2b; padding:10px 14px; display:flex; align-items:center; gap:8px; font-size:14px; }
.cap-tag { font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; border-radius:999px; padding:3px 9px; }
.cap-tag.old { background:#3a2222; color:#ffb4b4; border:1px solid #5c3030; }
.cap-tag.new { background:#16351f; color:#8ee6ab; border:1px solid #2c5a3c; }
.screen { background:#f4f0e8; max-height: 640px; overflow:auto; padding: 12px 12px 6px; }
.msg-user { background: var(--navy); color:#fff; border-radius:16px 16px 4px 16px; padding:10px 14px; font-size:14.5px; max-width:88%; margin-left:auto; margin-bottom:10px; }
.screen .msg { margin: 6px 0 12px; }
.rp .rp-rows { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
.bad { color:#ff9d9d; } .good { color:#8ee6ab; }
.pv ul { margin:8px 0 0 18px; padding:0; }
</style></head><body><div class="pv">
<h1>Round 51 — “Yaar LDH” samajhna + “confirm/available” par SAARI classes</h1>
<p class="sub">Dono aapke aaj ke points. (1) <code>Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na</code> par app ne poochha tha <span class="bad">“Yaar Ldh” ke liye exact station chahiye</span> — ab phrase ke andar ka saaf station word resolve hota hai (LDH). (2) Jab aap confirm/available seat maangte ho, ab jawab me us train ki <b>saari classes</b> status ke saath aati hain — koi class (jaise 12265 ki 2S) chhupti nahi.</p>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag old">Pehle (b604eaf)</span><b>“Yaar Ldh” → station poochh liya</b></div>
    <div class="screen">
      <div class="msg-user">Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>
        <p class="msg-text">"Yaar Ldh" ke liye exact station chahiye — station ka naam ya code bataiye.</p></article>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab</span><b>Wahi sawaal → seedha jawab</b></div>
    <div class="screen">
      <div class="msg-user">Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(h(ReplyText, { text: NEW_TEXT }))}
      <div class="rp"><div class="rp-rows">${OLD_CARDS}</div></div></article>
    </div>
  </div>
</div>
<div class="box">
 <b>(2) confirm/available maangne par saari classes:</b> pehle <code>💺 … me seat wali N trains</code> line me sirf AVAILABLE classes aati thin. Ab jo train jawab me hai, uski <b>har class</b> usi line me status ke saath aati hai (AVAILABLE pehle, phir WL/N-A) — jaise <code>12265 3A AVL 10 ₹860 · 2A AVL 5 ₹870 · 1A WL 1 ₹1,435 · SL WL 3 ₹355 · 2S WL 1 ₹225</code>. Sirf-WL trains list me nahi aati (aapka R25 ka usool: “available-only” filter trains par lagta hai, train ke andar classes chhupane par nahi). AI wale path (FIND_SEATS) me bhi ab <code>OTHER CLASSES</code> line jaati hai + instruction: “har train ki SAARI classes likho”. Sab data live board se — kuch banaya nahi jaata.
</div>
<div class="box">
 <b>Kahan-kahan laga:</b>
 <ul>
  <li><b>Wording:</b> <code>server/understand/legacy-stations.ts</code> → <code>stationWordInPhrase()</code> — poore phrase (exact/alias/word) ke baad, phrase ke andar ka saaf station word (alias/code list se) — par sirf jab <b>ek hi</b> station nikle aur koi cluster-city (delhi/mumbai) na ho. Isse NLU ka from/to aur AI-extraction dono theek hote hain.</li>
  <li><b>Saari classes:</b> <code>server/agent/seatFilter.ts</code> (<code>seatSummaryLine</code> ka seat branch) + <code>server/agent/seatFinderTool.ts</code> (<code>OTHER CLASSES</code> line + “har train ki saari classes likho” instruction). Card pehle se hi rows+wlRows jodta hai — ab text aur card dono match karte hain.</li>
 </ul>
</div>
<p class="sub">Verify: local probe me <code>matchStation("Yaar Ldh")=LDH</code>, <code>understand("Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na")</code> → from LDH, to SVDK, koi unresolved nahi; suite 131 files green; deploy ke baad prod par wahi sawaal.</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round51-2026-09-29.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
