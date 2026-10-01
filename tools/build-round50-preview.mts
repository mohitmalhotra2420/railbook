/* Round-50 preview — "JAT tak wali trains ka alag section" + "12265 ki 2S IRCTC par thi, app me nahi". */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ReplyText } from "../src/components/ReplyText";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const appCss = fs.readFileSync(path.join("dist/assets", cssFile!), "utf8");

/* ── AB: LDH → SVDK (live board 7 trains) — main list me sirf SVDK wali, phir JAT section ── */
const AFTER_TEXT = [
  "LDH → SVDK, 2026-09-30 — confirm seat wali trains:",
  "* 20433 JAMMU MAIL — 1A AVL 1 ₹1,530 · 3E AVL 1 ₹625 — 01:47 departure",
  "* 11449 JBP SVDK EXP — 1A AVL 1 ₹1,455 — 03:20 departure",
  "",
  "💺 sab class me seat wali 2 trains — 20433 1A AVL 1 ₹1,530 · 3E AVL 1 ₹625 | 11449 1A AVL 1 ₹1,455. (LDH → SVDK · live board)",
  "ℹ️ 12425 JAMMU RAJDHANI (last stop JAT), 14661 SHALIMAR MALANI (last stop JAT), 12413 GALTADHAM POOJA (last stop JAT), 12265 JAT DURONTO EXP (last stop JAT) — ye SVDK tak nahi jaati, isliye list se hata di.",
  "🧭 JAT tak (aage ka safar khud): 12265 JAT DURONTO EXP (2A AVL 5 · 3A AVL 14) | 13151 KOAA JAT EXPRES (SL AVL 8) | 12237 BEGUMPURA EXP (1A AVL 1)",
  "(Inme LDH→JAT tak ka ticket hota hai, SVDK ka nahi.)",
].join("\n");
const AFTER = renderToStaticMarkup(h(ReplyText, { text: AFTER_TEXT }));

/* ── PEHLE (aapka 29 Sep 10:03 wala screenshot): 12265 main list me, 2S "WL —" ── */
const BEF_TEXT = [
  "LDH → SVDK, 2026-09-30 — kitne passengers hain? (1–6) Seats usi hisaab se check karunga.",
  "* 12265 JAT DURONTO EXP — 3A AVL 14 ₹640 · 2A AVL 5 ₹870 · 1A WL 1 ₹1,435 · SL WL 3 ₹355 · 2S WL — ₹225",
  "* 13151 KOAA JAT EXPRES — SL AVL 8 ₹195 · 2A WL 1 ₹725 · 3E WL 5 ₹520 · 3A WL 7 ₹520",
  "* 20433 JAMMU MAIL — 1A AVL 1 ₹1,530 · 3E AVL 1 ₹625 · 2A WL 1 ₹925 · 3A WL 1 ₹675 · SL N/A (Regret) ₹270",
  "",
  "💺 6 me seat (14, 5, 1, 1, 1, 1) · fare ₹625–₹1530",
].join("\n");
const BEFORE = renderToStaticMarkup(h(ReplyText, { text: BEF_TEXT }));

const chip = (cls: string, status: string, fare: string, ok: boolean) =>
  `<div class="rp-crow ${ok ? "ok" : ""}"><span class="rp-cls">${cls}</span><span class="rp-st ${ok ? "ok" : ""}">${status}</span><span class="rp-fare">${fare}</span></div>`;

const oldCard = `
  <div class="rp-row seat">
    <div class="rp-l1"><span class="rp-no">12265</span><span class="rp-name">JAT DURONTO EXP</span></div>
    <div class="rp-crows">
      ${chip("3A", "AVL 14", "₹640", true)}${chip("2A", "AVL 5", "₹870", true)}
      ${chip("1A", "WL 1", "₹1,435", false)}${chip("SL", "WL 3", "₹355", false)}
      ${chip("2S", "WL —", "₹225", false)}
    </div>
  </div>`;

const newCard = `
  <div class="rp-row seat">
    <div class="rp-l1"><span class="rp-no">20433</span><span class="rp-name">JAMMU MAIL</span></div>
    <div class="rp-crows">${chip("1A", "AVL 1", "₹1,530", true)}${chip("3E", "AVL 1", "₹625", true)}</div>
  </div>
  <div class="rp-row seat">
    <div class="rp-l1"><span class="rp-no">11449</span><span class="rp-name">JBP SVDK EXP</span></div>
    <div class="rp-crows">${chip("1A", "AVL 1", "₹1,455", true)}</div>
  </div>
  <div class="rp-near">
    <b>🧭 JAT tak (aage ka safar khud)</b>
    <div class="rp-near-row"><span class="rp-no">12265</span> JAT DURONTO EXP <span class="rp-st ok">2A AVL 5</span> <span class="rp-st ok">3A AVL 14</span></div>
    <div class="rp-near-row"><span class="rp-no">13151</span> KOAA JAT EXPRES <span class="rp-st ok">SL AVL 8</span></div>
    <div class="rp-near-row"><span class="rp-no">12237</span> BEGUMPURA EXP <span class="rp-st ok">1A AVL 1</span></div>
    <div class="rp-near-sub">Inme LDH→JAT tak ka ticket hota hai, SVDK ka nahi.</div>
  </div>`;

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 50: JAT tak ka alag section + seat rows live</title>
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
.screen { background:#f4f0e8; max-height: 700px; overflow:auto; padding: 12px 12px 6px; }
.msg-user { background: var(--navy); color:#fff; border-radius:16px 16px 4px 16px; padding:10px 14px; font-size:14.5px; max-width:88%; margin-left:auto; margin-bottom:10px; }
.screen .msg { margin: 6px 0 12px; }
.rp .rp-rows { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
.rp-near { margin-top:10px; border:1px solid #bcd4f5; background:#eaf2ff; border-radius:14px; padding:10px 12px; font-size:13px; color:#1d3357; line-height:1.6; }
.rp-near-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:6px; }
.rp-near-sub { color:#4a5f80; margin-top:6px; font-size:12.5px; }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
table.pv-t { width:100%; border-collapse:collapse; font-size:13.5px; margin: 10px 0 4px; }
table.pv-t th, table.pv-t td { text-align:left; padding:7px 9px; border-bottom:1px solid #22304a; vertical-align:top; }
table.pv-t th { color:#9fb7d8; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
.bad { color:#ff9d9d; } .good { color:#8ee6ab; }
.pv ul { margin:8px 0 0 18px; padding:0; }
</style></head><body><div class="pv">
<h1>Round 50 — “JAT tak wali trains ka alag section” + “12265 ki 2S IRCTC par thi, mere app me nahi”</h1>
<p class="sub">Dono aapke aaj ke sawaal/screenshots ka jawab. (1) Jo trains maangi hui station tak nahi jaati, wo ab main list se <b>alag section</b> me — saaf label ke saath (IRCTC bhi LDH→Katra search me inhe dikhata hai). (2) Dikhaayi jaane wali har seat row ab <b>live verify</b> hoti hai — purani/future-dated ConfirmTkt cache par app atakta nahi, aur IRCTC-sourced RailYatri se cross-check hota hai. Sab data real — jo mila hi nahi to row waise hi rehti hai, kuch banaya nahi jaata.</p>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag old">Pehle</span><b>12265 main list me + 2S “WL —”</b></div>
    <div class="screen">
      <div class="msg-user">Mujhe ludhiana se SVDK jaana hai kal confirm seat findout krke do</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${BEFORE}
      <div class="rp"><div class="rp-rows">${oldCard}</div></div>
      <p class="msg-text" style="font-size:13px;color:#5d6672">12265 sirf Jammu Tawi (JAT) tak jaati hai — SVDK ka ticket is card se hota hi nahi. Aur 2S row par number hi nahi tha (“WL —”), jabki IRCTC/ConfirmTkt par us class ka apna status dikh raha tha.</p>
      </article>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab</span><b>Sirf SVDK wali + “🧭 JAT tak” section</b></div>
    <div class="screen">
      <div class="msg-user">Mujhe ludhiana se SVDK jaana hai kal confirm seat findout krke do</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${AFTER}
      <div class="rp"><div class="rp-rows">${newCard}</div></div>
      </article>
    </div>
  </div>
</div>

<h2>2S wala sawaal — row ka sach (live, 29 Sep 2026 ~10:50 IST)</h2>
<table class="pv-t">
  <tr><th>Class</th><th>ConfirmTkt API</th><th>RailYatri (IRCTC data)</th><th>App ab kya dikhata hai</th></tr>
  <tr><td>3A</td><td class="good">AVAILABLE-0010 — ₹860</td><td class="good">AVAILABLE-0010 — ₹860</td><td class="good">3A AVL 10 ₹860</td></tr>
  <tr><td>2A</td><td class="good">AVAILABLE-0005 — ₹870</td><td class="good">AVAILABLE-0005 — ₹870</td><td class="good">2A AVL 5 ₹870</td></tr>
  <tr><td>SL</td><td>RLWL3/WL3 — ₹355</td><td>RLWL3/WL3 — ₹355</td><td>SL WL 3 ₹355 (WL section)</td></tr>
  <tr><td><b>2S</b></td><td>RLWL9/WL1 — ₹225 · cacheTime 10:40</td><td>RLWL9/WL1 — ₹225 · updated 10:46</td><td><b>2S WL 1 ₹225</b> (number ke saath — pehle “WL —” tha)</td></tr>
</table>
<div class="box">
 <b>2S par poora sach (koi lapta nahi):</b> aapke 09:13 ke IRCTC screenshot par 2S <b>AVAILABLE ₹225</b> thi — 10:03 wale app card me usi class ka number-missing “WL —” tha. Wajah: app us row ko ConfirmTkt ki <b>purani cache</b> se dikha raha tha (row par <code>stale</code>/future-dated timestamp lagi hui thi). Ab har dikhaayi jaane wali train ke stale/UNKNOWN/future rows ka <b>live probe</b> hota hai aur usi par <b>IRCTC-sourced cross-check</b> — jo row sach me fresh + seat wali hai wahi dikhti hai.
 <br><br><b>Aaj ~10:50 IST par dono live sources (ConfirmTkt + RailYatri/IRCTC) ek hi baat keh rahe hain: 2S WL 1 ₹225</b> — yaani 2S bhar gayi (subah AVAILABLE thi). App wahi dikhata hai; jab seat phir khulegi to live row se turant AVAILABLE dikhega — purani cache par atka nahi rahega.
</div>
<div class="box">
 <b>Kahan-kahan laga:</b>
 <ul>
  <li><b>Alag section:</b> chat seat line + card me <code>🧭 JAT tak (aage ka safar khud) …</code> + <code>(Inme LDH→JAT tak ka ticket hota hai, SVDK ka nahi.)</code> — <code>nearbyCandidatesNote()</code> (sirf seat-detih classes; WL-only train ka jhootha offer nahi)</li>
  <li><b>Live rows:</b> <code>enrichTrainsFreshness()</code> chat/card seat jawab me bhi + <code>secondOpinionRow()</code> cross-check (chain ka row fresh nahi ya seat nahi dikha raha → RailYatri/IRCTC pull; seat wali + fresh row jeetti hai)</li>
  <li><b>Timestamp honesty:</b> ConfirmTkt ka <code>cacheTime</code> IST me hota hai — 5:30 ghante “future” dikh raha tha, isliye purani row fresh lagti thi; ab <code>ctCacheTimeMs()</code> usko sahi karta hai</li>
  <li><b>AI path:</b> FIND_SEATS tool bhi wahi freshness + <code>NEARBY:</code> line deta hai (AI apne jawab me dono baatein likh sakta hai)</li>
 </ul>
</div>
<p class="sub">Live verification: LDH → SVDK 2026-09-30 board = 7 trains → main rows 20433 / 11449 (SVDK tak), JAT section me 12265 · 13151 · 12237; control <code>LDH → JAT</code> me koi train nahi hatti (dropNote null). Suite: naye 11 tests (8 + 3), poori suite green.</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round50-2026-09-29.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
