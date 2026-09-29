/* Round-52 preview — "har query AI ke paas jaaye, deterministic path chale hi na". */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ReplyText } from "../src/components/ReplyText";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const appCss = fs.readFileSync(path.join("dist/assets", cssFile!), "utf8");

/* (a) aapka exact sawaal — pehle deterministic engine jawab deta tha (model ne tool hi nahi chuna) */
const BEFORE_TEXT = [
  "LDH → SVDK, 2026-09-30 — kitne passengers hain? (1–6) Seats usi hisaab se check karunga.",
  "* 20433 JAMMU MAIL — 1A AVL 1 ₹1,530 — 01:47 departure",
  "",
  "💺 sab class me seat wali 1 train — 20433 1A AVL 1 ₹1,530 · 2A WL 1 ₹925 · 3A WL 1 ₹675 · 3E WL 1 ₹625 · SL N/A ₹270. (LDH → SVDK · live board)",
  "ℹ️ 12425 JAMMU RAJDHANI (last stop JAT), 14661 SHALIMAR MALANI (last stop JAT), 12413 GALTADHAM POOJA (last stop JAT), 12265 JAT DURONTO EXP (last stop JAT) — ye SVDK tak nahi jaati, isliye list se hata di.",
  "🧭 JAT tak (aage ka safar khud): 12265 JAT DURONTO EXP (2A AVL 5 · 3A AVL 10) | 13151 KOAA JAT EXPRES (SL AVL 8)",
  "(Inme LDH→JAT tak ka ticket hota hai, SVDK ka nahi.)",
].join("\n");

/* (b) ab — model khud FIND_SEATS chunta hai aur SAARI trains × SAARI classes ka jawab deta hai (live probe se) */
const AFTER_TEXT = [
  "LDH → SVDK (kal 30-Sep-2026) — confirmed seat availability, saari classes:",
  "",
  "* 20433 JAMMU MAIL — 1A AVL 1 ₹1,530 · 2A WL 1 ₹925 · 3A WL 1 ₹675 · 3E WL 1 ₹625 · SL N/A ₹270",
  "* 12445 UTTAR S KRANTI — 1A WL 1 ₹1,530 · 2A WL 2 ₹925 · 3A WL 4 ₹625 · 3E WL 4 ₹625 · SL WL 11 ₹270",
  "* 11449 JBP SVDK EXP — 1A WL 1 ₹1,455 · 2A WL 6 ₹880 · 3A WL 19 ₹625 · 3E WL 11 ₹575 · SL WL 62 ₹240",
  "* 12919 MALWA EXP — 1A WL 1 ₹1,530 · 2A WL 1 ₹925 · 3A WL 3 ₹675 · 3E WL 3 ₹625 · SL WL 18 ₹270",
  "* 12475 HAPA SVDK EXP — 1A WL 1 ₹1,530 · 2A WL 3 ₹925 · 3A WL 3 ₹675 · 3E WL 3 ₹625",
  "* 14609 HEMKUNT EXP — 2A WL 4 ₹880 · 3A WL 2 ₹625 · 3E WL 3 ₹575 · SL WL 18 ₹240",
  "* 22461 SHRI SHAKTI EXP — 1A WL 6 ₹1,530 · 2A WL 9 ₹925 · 3A WL 16 ₹675",
  "(Sirf 20433 me 1A AVL 1 hai; baaki trains WL — ye live board ka sach hai.)",
].join("\n");

const CHIP = "Book 20433 · 1A (AVL 1 ₹1,530)";

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 52: har query AI ke paas</title>
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
.screen { background:#f4f0e8; max-height: 660px; overflow:auto; padding: 12px 12px 6px; }
.msg-user { background: var(--navy); color:#fff; border-radius:16px 16px 4px 16px; padding:10px 14px; font-size:14.5px; max-width:88%; margin-left:auto; margin-bottom:10px; }
.screen .msg { margin: 6px 0 12px; }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
.bad { color:#ff9d9d; } .good { color:#8ee6ab; }
.pv ul { margin:8px 0 0 18px; padding:0; }
.chips { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
.chip { border:1px solid var(--navy); color: var(--navy); background:#fff; border-radius:999px; padding:6px 12px; font-size:13px; font-weight:600; }
</style></head><body><div class="pv">
<h1>Round 52 — har sawaal model ke paas, model khud tools chune</h1>
<p class="sub">Aapki baat: <i>“purane builds me model isse apne aap samajh jaata tha… AI first for everything, deterministic path chale hi na — bas AI pe hi har query jaaye aur wo decide kare kaun sa tool, jaise ChatGPT”</i>. Is round me asli wajah mili: aapka sawaal <b>“confirm seat…”</b> tha — aur app me <code>confirm</code> shabd ko hi booking-hukm maan liya jaata tha, isliye poora AI-first flow <b>skip</b> ho jaata tha aur jawab deterministic engine deta tha (isliye 7 second me aa jaata tha, aur model ne koi tool chalaya hi nahi). Ab wahi sawaal model ke paas jaata hai: wo khud <code>FIND_SEATS</code> chalata hai aur live board se <b>saari trains × saari classes</b> ka jawab deta hai.</p>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag old">Pehle (bbb7c84)</span><b>Jawab deterministic engine se</b></div>
    <div class="screen">
      <div class="msg-user">Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(h(ReplyText, { text: BEFORE_TEXT }))}</article>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab</span><b>Model khud tool chunta hai</b></div>
    <div class="screen">
      <div class="msg-user">Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(h(ReplyText, { text: AFTER_TEXT }))}
        <div class="chips"><span class="chip">${CHIP}</span></div></article>
    </div>
  </div>
</div>
<div class="box">
 <b>Kya badla (sab general, per-question patch nahi):</b>
 <ul>
  <li><b>Booking-hukm detector sahi kiya</b> — <code>server/agent/run.ts</code>: pehle <code>/confirm/</code> akela hi mutation maana jaata tha. Ab mutation = asli hukm (<code>book kar do</code>, <code>ticket book kar</code>, <code>booking karo</code>, <code>confirm karo</code>, <code>confirm &amp; book</code>, <code>payment kar do</code>, <code>paise de do</code>). “confirm seat / confirmed seat wali trains / availability confirm karo” = <b>seat sawaal</b> → AI-first flow chalta hai.</li>
  <li><b>Model health ordering</b> — jo model haal hi me fail hua ho (10 min), wo chain ke <b>aakhir</b> me chalta hai; healthy model pehle. Default chain ab fast-first: <code>openai/gpt-oss-20b</code> primary, <code>meta/muse-glimmer-30b</code> fallback (Render env bhi update).</li>
  <li><b>Tools bhi aapki wording samajhte hain</b> — <code>matchStationStrict()</code>: “Yaar Ldh”, “bhai ldh”, “kal katra”, “smvd katra” → LDH/SVDK; “Delhi airport” → station guess <b>nahi</b> (choice-flow). NLU ka purana loose match (R51) waisa hi — “Delhi Saturday ko…” jaisa lamba tail tootta nahi.</li>
  <li><b>Capability/meta sawaal bhi model ka</b> — “tum kya kar sakte ho” par fixed text nahi, model system-prompt (rule 28) se apne shabdon me jawab deta hai. Deterministic jawab sirf AI-off / key-gayab / model-fail (rescue) par.</li>
 </ul>
</div>
<div class="box">
 <b>Proof (local, aapki exact query):</b> <code>engine: agentic_tool_calling</code> · model <code>openai/gpt-oss-20b</code> · <code>toolTrace: FIND_SEATS ✓</code> · jawab me 7 trains × unki saari classes + <code>[NEXT]</code> chip — sab live board se, kuch banaya nahi. Model ne khud stations (LDH/SVDK) resolve kiye, khud date maani (kal), khud tool chuna. Latency 49–82s (aapne 45s+ accept kiya hai). Deterministic path ab sirf <b>rescue</b> hai (AI band/paisa-khatam/hard-fail) — user-facing pehla jawab AI ka hi hota hai.
</div>
<p class="sub">Verify: suite green (132 files / 1410 tests), naye <code>tests/round52-ai-owns-everything.test.ts</code> (8) — model-health ordering, tool-level station samajh, booking-hukm detector, aur “confirm seat par agentic engine chalta hai” ka integration test. Deploy ke baad prod par wahi do sawaal.</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round52-2026-09-29.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
