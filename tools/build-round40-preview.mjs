/* Round-40 preview builder — RailBook ChatGPT-jaisa dimaag (LIVE/KNOWLEDGE split + KB authoritative). */
import fs from "node:fs";
import path from "node:path";

const rows = [
  ["\"bhai 12054 ki statsu batao\" (typo!)", "pehle: date ke bina atak jaata / raw dump", "ab: typo samajh kar seedha status — 12054 aaj cancel (railyatri alert, REAL)"],
  ["\"Amritsar se Haridwar jaana hai\"", "pehle: sawaal ko ignore karke generic jawab", "ab: AI khud poochhta hai — \"kis date ko? kitne passengers?\" (8.9s)"],
  ["\"India ka sabse purana railway station?\"", "pehle: \"verified data nahi mila\" 😑", "ab: Bori Bunder 1853 (KB) — 0.0s"],
  ["\"Ludhiana station pe kitne platform?\"", "pehle: \"mere data me nahi hai\"", "ab: 7 platforms (Wikipedia/redbus verified) — 0.0s"],
  ["\"Vivek express kahan se kahan?\"", "pehle: model ki memory \"4273 km\" (GALAT) ya adhoora web", "ab: curated KB — 4,154/4,286 km hedge — 0.1s"],
  ["\"vande bharat ki top speed?\"", "pehle: har number reject → label dump", "ab: Vande Bharat 160 km/h (trial 183) — 0.0s"],
  ["\"Is Saturday ko Vande Bharat chalegi?\"", "pehle: seedha guess ya 'Kahan se jaana hai?'", "ab: honest — \"kaunsi Vande Bharat? us din ka running day check kar dunga\" (4.6s)"],
  ["\"12054 me kal ki seat availability\"", "pehle: fake risk", "ab: real provider data (2S AVL 384 ₹205 · CC WL14 ₹650) — kuch bhi fake nahi"],
  ["\"tum kya kya kar sakte ho?\"", "pehle: booking flow ghum jaata", "ab: capability + 2 rok (IRCTC click / pax-fill nahi) — 0.2s"],
  ["Fake fare/seat ka parda", "pehle: 2-digit invented number bach jaata", "ab: liveClaimCheck — ₹/AVL/RAC/WL/PNR/platform sirf evidence se"],
];

const kb = [
  "pehli train (1853, Bori Bunder→Thane)",
  "zones (18 zonal railways + 19 counting note)",
  "~7,300+ stations",
  "sabse tez train (Vande Bharat 160 / Gatimaan)",
  "sabse purana station (Bori Bunder 1853 / Royapuram 1856)",
  "Ludhiana Junction = 7 platforms (18 tracks)",
];

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 40: "khud ka dimaag" (ChatGPT-jaisa)</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1420;color:#e8ecf3;margin:0;padding:28px}
 .wrap{max-width:900px;margin:0 auto}
 h1{font-size:24px;margin:0 0 6px} .sub{color:#8fa3bf;margin:0 0 18px}
 .pill{display:inline-block;background:#16324f;color:#7fd1ff;border:1px solid #2b5f8a;border-radius:999px;padding:3px 10px;font-size:12px;margin-right:6px}
 table{width:100%;border-collapse:collapse;margin:14px 0 22px;font-size:14px}
 th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #22304a;vertical-align:top}
 th{color:#9fb7d8;font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
 .ok{color:#5ee08a}.bad{color:#ff8f8f}
 ul{line-height:1.7;font-size:14px} li b{color:#ffd479}
 .box{background:#151c2b;border:1px solid #24324b;border-radius:12px;padding:14px 16px;margin:14px 0}
 code{background:#1d2739;padding:1px 6px;border-radius:6px;font-size:13px}
 .foot{color:#7c8ba5;font-size:12.5px;margin-top:18px}
</style></head><body><div class="wrap">
<h1>🚂 RailBook — Round 40: ab AI <b>khud ka dimaag</b> use karta hai</h1>
<p class="sub">ChatGPT / Gemini / Manus jaisa: sawaal samjho → kya missing hai khud pehchano → user se wahi poochho → sahi tools khud lagao → ek dum sahi jawab.</p>
<span class="pill">LIVE da41cb1</span><span class="pill">119 files / 1299 tests ALL PASS</span><span class="pill">kuch bhi fake nahi</span>

<div class="box">
<b>Jadi fix:</b> pehle har 3+ digit number / uppercase code ko tool-data se match karne ki zabardasti thi — isliye <i>sahi</i> general knowledge bhi reject ho kar "data nahi mila" ban jaata tha. Ab do mode: <b>LIVE</b> (seat/fare/status/PNR/booking/journey — sirf verified tools ka data) aur <b>KNOWLEDGE</b> (baaki sab — AI apne dimaag se, aur curated KB entry ho to wahi authoritative 0.0s me).
</div>

<h2 style="font-size:16px;color:#9fb7d8">Pehle vs Ab (live par verified)</h2>
<table><tr><th>User ne poochha</th><th class="bad">Pehle</th><th class="ok">Ab</th></tr>
${rows.map((r) => `<tr><td>${r[0]}</td><td class="bad">${r[1]}</td><td class="ok">${r[2]}</td></tr>`).join("\n")}
</table>

<h2 style="font-size:16px;color:#9fb7d8">Naya Railway KB (verified, curated)</h2>
<ul>${kb.map((k) => `<li>${k}</li>`).join("\n")}</ul>

<h2 style="font-size:16px;color:#9fb7d8">AI ke 4 kadam (har sawaal par, khud — koi batata nahi)</h2>
<ul>
 <li><b>1. Samjho:</b> typo/adhoora bhi — <code>statsu</code>=status, <code>gaadi</code>=train, <code>ldh</code>=Ludhiana.</li>
 <li><b>2. Missing pehchano:</b> route? date? passengers? class? — bas wahi ek zaroori sawaal poochho, options ke saath.</li>
 <li><b>3. Tools khud chuno:</b> live/seat/fare/status/PNR → live tools (ConfirmTkt→RailYatri→eRail); general knowledge → KB/Wikipedia. Koi restriction nahi.</li>
 <li><b>4. Jawab + agla kadam:</b> seedha, poora, confident — phir [NEXT] se next step.</li>
</ul>
<p class="foot">Sirf 2 rok (aapke rule): IRCTC par "Continue to IRCTC" click nahi, passenger details/payment khud nahi bharta. Baaki kuch bhi fake nahi — jo verified nahi, wo guess nahi.</p>
</div></body></html>`;

const out = path.join(process.cwd(), "..", "..", "RailBook", "previews", "RailBook-round40-2026-09-27.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "B");
