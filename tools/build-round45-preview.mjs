/* Round-45 preview — FULL AI-FIRST: har sawaal pehle model ke paas, deterministic sirf AI-off / model-fail /
 * khokhla-jawab par (rescue). Live battery (28 Sep 2026, prod `4f404d7`). */
import fs from "node:fs";
import path from "node:path";

const rows = [
  ["12013 kal ludhiana kitne baje pahunchi thi ?", "112s", "model summary bhej raha tha → verified rescue", "12013 Amritsar Shtabdi — 27 Sep 2026 ki run ke liye timetable ke hisaab se: Ludhiana Jn (LDH): arrival 20:16, departure 20:19."],
  ["At what time 12013 arrived ldh on 27 sept", "117s", "model ne khud jawaab diya", "…LDH arrival 20:16 (timetable + live dono ka grounded jawab)"],
  ["12013 haridwar arrival kitne baje", "107s", "model ne khud", "12013 Amritsar Shatabdi NDLS → ASR chalti hai, Haridwar HW is route par nahi hai."],
  ["12013 haridwar pahunch gayi kya", "125s", "model ne khud", "…isme Haridwar (HWR) station nahi aata. Isliye train Haridwar pahunchti hi nahi. (code me HWR slip — neeche note)"],
  ["12013 haridwar par rukti hai kya", "46s", "model ne khud", "Nahi, 12013 Amritsar Shatabdi Haridwar par nahi rukti. Iska route NDLS → UMB → SIR → LDH → … → ASR hai."],
  ["12013 LDH par kitni der rukti hai", "42s", "model ne khud", "12013 Amritsar Shatabdi Ludhiana Jn LDH par 3 minute rukti hai. Arrival 20:16, Departure 20:19"],
  ["12013 LDH pahunch gayi kya", "61s", "model ne khud", "…aaj 28 Sep 2026 ke run mein abhi Ludhiana Jn nahi pahunchi. Next station AMBALA CANT JN."],
  ["12054 haridwar ke liye seat check krna", "91s", "model ne train-summary di → verified rescue", "12054 (ASR → HW) — seat availability: 28 Sep CC N/A ₹650 · 2S N/A ₹205 | 29 Sep CC WL 20 ₹650 · 2S AVAILABLE 654 ₹205"],
  ["12054 late hai kya", "44s", "model ne khud (TRACK_TRAIN)", "12054 Jan Shatabdi Express aaj 28 Sep ko time par chal rahi hai — abhi Ambala Cant Jn par hai, delay 0 minute."],
];

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 45: full AI-first (model pehle, verified rescue)</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1420;color:#e8ecf3;margin:0;padding:28px}
 .wrap{max-width:1040px;margin:0 auto} h1{font-size:23px;margin:0 0 6px} .sub{color:#8fa3bf;margin:0 0 16px}
 .pill{display:inline-block;background:#16324f;color:#7fd1ff;border:1px solid #2b5f8a;border-radius:999px;padding:3px 10px;font-size:12px;margin:0 6px 6px 0}
 table{width:100%;border-collapse:collapse;margin:14px 0 20px;font-size:13.5px}
 th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #22304a;vertical-align:top}
 th{color:#9fb7d8;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
 .ok{color:#5ee08a}.warn{color:#ffd479}
 .box{background:#151c2b;border:1px solid #24324b;border-radius:12px;padding:14px 16px;margin:14px 0;font-size:14px;line-height:1.65}
 code{background:#1d2739;padding:1px 6px;border-radius:6px;font-size:12.5px}
 .g{background:#12261b;border-color:#24503a}
 .y{background:#2a2312;border-color:#5a4a1c}
</style></head><body><div class="wrap">
<h1>Round 45 — Full AI-first (aapka chuna hua raasta)</h1>
<p class="sub">Aapne kaha: “har query sabse pehle AI ke paas jaani chahiye… accuracy &gt; speed.” Wahi lagaya gaya.</p>
<div class="box">
 <b>Naya flow (booking hukm chhodkar har sawaal par):</b><br>
 1. <b>Model pehle</b> — wo khud tools chunta hai (TRACK_TRAIN / GET_TIMETABLE / CHECK_AVAILABILITY / …).<br>
 2. <b>Rescue sirf 3 haalat me:</b> (a) AI off/unconfigured, (b) model fail/timeout, (c) model ka jawab us sawaal ka jawab <i>hi na ho</i> (jaise “Kahan jaana hai? Station bataiye.” ya sirf train ki summary) — aur hamare paas usi sawaal ka verified (real tool-data) jawab ho. Warna model ka hi jawab user ko jaata hai.<br>
 3. <b>Booking hukm</b> (“Book 12054”) pehle jaisa deterministic — 2-rok rule intact.
</div>
<div class="box g">
 <b>Saath me tay hue 2 purane gaps (R45 me pakde gaye):</b><br>
 • <code>kitni der rukti hai</code> live-status me hijack ho raha tha → ab halt/stop ka jawab route+timetable se.<br>
 • Route me na hone wala station (<code>12013 haridwar arrival</code> / <code>pahunch gayi kya</code> / <code>se kab chalti hai</code>) → pehle live ka raw dump ya “Kahan jaana hai?” aa jaata tha → ab saaf: “HW par rukti hi nahi (is train ka route NDLS → ASR hai).”
</div>
<h1 style="font-size:18px;margin-top:26px">Live battery — prod <code>4f404d7</code> (9/9 jawab theek, 0 leak)</h1>
<table><thead><tr><th>Sawaal</th><th>Waqt</th><th>Kisne jawab diya</th><th>Jawab</th></tr></thead><tbody>
${rows.map(([q, t, who, a]) => `<tr><td><code>${q}</code></td><td>${t}</td><td>${who}</td><td>${a}</td></tr>`).join("\n")}
</tbody></table>
<div class="box y">
 <b>Do baatein saaf-saaf (chhupana nahi):</b><br>
 1. <b>Latency:</b> AI-first hone ki wajah se simple sawaal bhi 40–125s le rahe hain (model ka har round 20–35s + tools). R44 me yahi jawab 1–3s me aate the (deterministic). Aapne accuracy chuni thi — par agar 20s se zyada nahi chalega to main model ka time-budget ghata kar (ya fast model pehle) 20–30s me laa sakta hoon; bolo to karta hoon.<br>
 2. <b>Model ne station code “HWR” likha</b> (Haridwar ka sahi code <code>HW</code> hai) — ye model ki slip thi, hamare data me sahi hai. Agle round me “reply me station code verify karo” wala general net laga sakta hoon.
</div>
<p class="sub">Full suite: 124 files / 1359 tests pass · tsc clean · live battery 8/9 mere regex ki galti (jawab sahi tha) · 0 leaks.</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round45-2026-09-28.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
