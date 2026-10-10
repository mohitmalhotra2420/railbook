/* Round-41 preview — "sahi tool, sahi waqt" (tool-routing audit + fixes). */
import fs from "node:fs";
import path from "node:path";

const rows = [
  ["\"Tejas aur Vande Bharat me kya fark hai?\"", "sirf Vande Bharat ka jawab (adhoora) ❌", "dono taraf bullet-wise compare — 0.1s ✅"],
  ["\"Amritsar station code kya hai\"", "generic KB definition (code nahi mila) ❌", "SEARCH_STATIONS → **ASR** — 5.0s ✅"],
  ["\"12054 time par chalti hai ya late\"", "date poochh liya, tool galat ❌", "GET_TRAIN_HISTORY → sach (cancelled run, history nahi) ✅"],
  ["\"aaj kaunsi trains cancelled hain Amritsar se\"", "tool fail hone par bhi \"koi cancel nahi hui\" (jhootha aaram) ❌", "\"list abhi available nahi ho rahi\" — sach, claim nahi ✅"],
  ["\"ASR se NDLS kal ka plan banao 2 log\"", "date dobara poochh liya ❌", "date FINAL maana → RANK_JOURNEY_OPTIONS → best plan ✅"],
  ["\"12054 ka coach position batao\"", "\"provider se nahi mil...\" dump ❌", "sach + guidance: ~1–2 ghante pehle station board/app par ✅"],
  ["\"12054 kahan hai\" / \"stops\" / \"fare\" / \"PNR\"", "pehle se theek", "TRACK_TRAIN · GET_TIMETABLE · GET_FARE · CHECK_PNR ✅"],
];

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 41: sahi tool, sahi waqt</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1420;color:#e8ecf3;margin:0;padding:28px}
 .wrap{max-width:920px;margin:0 auto} h1{font-size:23px;margin:0 0 6px} .sub{color:#8fa3bf;margin:0 0 16px}
 .pill{display:inline-block;background:#16324f;color:#7fd1ff;border:1px solid #2b5f8a;border-radius:999px;padding:3px 10px;font-size:12px;margin:0 6px 6px 0}
 table{width:100%;border-collapse:collapse;margin:14px 0 20px;font-size:14px}
 th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #22304a;vertical-align:top}
 th{color:#9fb7d8;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
 .ok{color:#5ee08a}.bad{color:#ff8f8f}
 .box{background:#151c2b;border:1px solid #24324b;border-radius:12px;padding:14px 16px;margin:14px 0;font-size:14px;line-height:1.65}
 code{background:#1d2739;padding:1px 6px;border-radius:6px;font-size:12.5px}
 .foot{color:#7c8ba5;font-size:12.5px;margin-top:16px}
</style></head><body><div class="wrap">
<h1>🛠️ Round 41 — ab AI <b>sahi tool, sahi waqt</b> use karta hai</h1>
<p class="sub">Jaise ChatGPT/Gemini/Manus user ki baat samajh kar apna tool chunte hain — waise hi RailBook AI. Audit me 12 sawaal live par naape gaye, toolTrace ke saath.</p>
<span class="pill">LIVE 825c70c</span><span class="pill">120 files / 1314 tests ALL PASS</span><span class="pill">kuch bhi fake nahi</span>

<div class="box">
<b>Kaise pata chala:</b> har sawaal ke saath dekha ki <i>kaunsa tool chala</i>. 4 jagah galat/jhootha tha — sab theek:
<ul style="margin:8px 0 0">
 <li><b>Comparison</b> (X vs Y) → ab dono taraf ka poora jawab (4 naye comparison KB: Tejas vs Vande Bharat, SL vs 3A, 2S vs SL, CC vs EC)</li>
 <li><b>Station code</b> → ab <code>SEARCH_STATIONS</code> tool chalta hai (generic definition nahi)</li>
 <li><b>Punctuality/history</b> → ab <code>GET_TRAIN_HISTORY</code> (timetable/seat nahi) — deterministic routing hint</li>
 <li><b>Tool fail</b> → "koi train cancel nahi hui" jaisa jhootha claim band; sach bolo ("list abhi nahi mili")</li>
</ul>
</div>

<table><tr><th>User ne poochha</th><th class="bad">Pehle</th><th class="ok">Ab (live)</th></tr>
${rows.map((r) => `<tr><td>${r[0]}</td><td class="bad">${r[1]}</td><td class="ok">${r[2]}</td></tr>`).join("\n")}
</table>

<div class="box">
<b>Prompt me naya rule 32 — "SAHI TOOL CHUNO":</b> har intent ka exact tool likha hai (live position → TRACK_TRAIN · stops → GET_TIMETABLE · punctual → GET_TRAIN_HISTORY · seat → CHECK_AVAILABILITY/FIND_SEATS · fare → GET_FARE · plan → JOURNEY_ANALYZE/RANK · PNR → CHECK_PNR · cancelled → GET_CANCELLED_TRAINS · station code → SEARCH_STATIONS · board → GET_STATION_BOARD · coach → GET_COACH_POSITION · history/rules/counts → WEB_SEARCH+KB · comparison → dono taraf). Tool fail ho to <b>agla sahi tool</b> ya <b>sach</b> — dump nahi.
</div>

<p class="foot">Sirf 2 rok (aapke rule): IRCTC par "Continue to IRCTC" click nahi, passenger details/payment khud nahi bharta. Baaki: jo verified nahi, wo guess nahi.</p>
</div></body></html>`;

const out = path.join(process.cwd(), "..", "..", "RailBook", "previews", "RailBook-round41-2026-09-27.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "B");
