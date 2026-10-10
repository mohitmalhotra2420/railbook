/* Round-44 preview — "particular station kitne baje pahuchi thi" har phrasing par, aur koi instruction leak nahi. */
import fs from "node:fs";
import path from "node:path";

const rows = [
  [
    '"12013 ka ludhiana aarival kitne baje ka tha 27 sept ko"',
    "theek tha (model ne timetable se bataya) — par \u201caarival\u201d jaisa typo har baar kaam kare, iska bharosa nahi tha",
    '"12013 Amritsar Shtabdi — 27 Sep 2026 ki run ke liye timetable ke hisaab se: Ludhiana Jn (LDH): arrival 20:16, departure 20:19" — 3.1s ✅'
  ],
  [
    '"At what time 12013 arrived ldh on 27 sept"',
    '**"Kahan jaana hai? Station bataiye."** ❌ (sawaal ghum gaya)',
    "wahi seedha jawab, 0.8s ✅"
  ],
  [
    '"12013 kal ludhiana kitne baje pahunchi thi ?"',
    "live + history + timetable ka poora dump (jawab beech me chhupa) ❌",
    "wahi ek-line jawab: 27 Sep ki run, LDH arrival 20:16 — 0.9s ✅"
  ],
  [
    '"12013 LDH pahunch gayi kya" (binary)',
    "— (naya case)",
    '"nahi, LDH abhi nahi pahunchi. Aaj ka run 16:30 par start hota hai; LDH par schedule se arrival 20:16 hai." ✅'
  ],
  [
    '"12013 kal ludhiana pahunch gayi thi kya" (binary, live)',
    "— (naya case)",
    '"haan, LDH pahunch chuki hai (27 Sep 2026 ki run poori ho chuki hai, delay 0 min)" ✅'
  ],
  [
    '"12013 haridwar par rukti hai kya"',
    "poora 8-stop route dump ❌",
    '"nahi, HW par rukti nahi (is train ka route NDLS → ASR hai)" ✅ · haan wale case me arr/dep bhi'
  ],
  [
    '"12013 LDH par kitni der rukti hai"',
    "— (naya case)",
    '"LDH: arrival 20:16, departure 20:19 — halt ~3 min" ✅'
  ],
  [
    "SELECT TRAIN card me likha tha: \u201cTrain resolve ho gayi. User ne jo poochha… uska tool AB call karo — sirf confirm karke mat ruko\u201d",
    "**model-instruction user ko dikh gayi** ❌",
    "data me ab koi internal instruction nahi (guidance system prompt ke general rule me); scrub-net bhi aur mazboot ✅"
  ],
];

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 44: har phrasing par sahi station-time jawab</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1420;color:#e8ecf3;margin:0;padding:28px}
 .wrap{max-width:1000px;margin:0 auto} h1{font-size:23px;margin:0 0 6px} .sub{color:#8fa3bf;margin:0 0 16px}
 .pill{display:inline-block;background:#16324f;color:#7fd1ff;border:1px solid #2b5f8a;border-radius:999px;padding:3px 10px;font-size:12px;margin:0 6px 6px 0}
 table{width:100%;border-collapse:collapse;margin:14px 0 20px;font-size:14px}
 th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #22304a;vertical-align:top}
 th{color:#9fb7d8;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
 .ok{color:#5ee08a}.bad{color:#ff8f8f}
 .box{background:#151c2b;border:1px solid #24324b;border-radius:12px;padding:14px 16px;margin:14px 0;font-size:14px;line-height:1.65}
 code{background:#1d2739;padding:1px 6px;border-radius:6px;font-size:12.5px}
 .foot{color:#7c8ba5;font-size:12.5px;margin-top:16px}
</style></head><body><div class="wrap">
<h1>🎯 Round 44 — <b>ek hi sawaal, har phrasing par ek hi sahi jawab</b></h1>
<p class="sub">Aapke 3 screenshots: ek hi cheez (particular station par kitne baje) teen tarah se poochhi — teen alag jawab. Ab teeno par ek hi, seedha, verified jawab.</p>

<span class="pill">AI-first me bhi deterministic arrival</span>
<span class="pill">typo + English phrasing</span>
<span class="pill">run-date label (27 Sep ki run)</span>
<span class="pill">binary: "pahunch gayi kya?"</span>
<span class="pill">"par rukti hai kya?"</span>
<span class="pill">halt duration</span>
<span class="pill">koi instruction leak nahi</span>

<table>
<tr><th>Sawaal</th><th>Pehle</th><th>Ab</th></tr>
${rows.map(([q, before, after]) => `<tr><td><code>${q}</code></td><td class="bad">${before}</td><td class="ok">${after}</td></tr>`).join("\n")}
</table>

<div class="box">
<b>Live proof (railbook-gegs.onrender.com, commit ada48ef):</b><br>
• Aapke teeno screenshots ke sawaal → ek hi jawab, <b>0.8s / 0.9s / 3.1s</b><br>
• Doosri trains par bhi wahi family: <code>12054 haridwar kitne baje pahunchegi</code> → "HW arrival 13:50" (1.8s) · <code>19326 saharanpur par rukti hai kya</code> → "haan, SRE — arrival 07:30, departure 07:40" (1.3s) · <code>18310 cdg kitne baje pahunchi thi kal</code> → "27 Sep ki run, CDG arrival 01:22" (1.0s)<br>
• 14 live cases: <b>14/14 sahi, 0 internal leaks</b>.
</div>

<div class="box">
<b>Tech (general, per-sawaal patch nahi):</b> <code>simpleArrivalQuestion()</code> gate — saaf arrival sawaal par <b>AI-first me bhi</b> deterministic jawab (model timeout/galat ho to bhi sahi) · <code>runDateLabel()</code> — "27 sept/kal/aaj/parso" se run-date · <code>arrivalBinaryTurn()</code> — live run se haan/na (Journey completed ⇒ haan; run start nahi hua ⇒ "abhi nahi"; route-order + NTES "Departed from X at HH:MM") · <code>stoppingQuestionTurn()</code> — route ke sach se "rukta hai?" (+ shehar-sibling) · halt duration · tool data se model-instruction hataayi (system-prompt rule 33) + leak-scrub mazboot.
</div>

<p class="foot">Sirf 2 rok (aapke rule): IRCTC par "Continue to IRCTC" click nahi, passenger details/payment khud nahi bharta. Jo verified nahi, wo guess nahi.</p>
</div></body></html>`;

const out = path.join(process.cwd(), "..", "..", "RailBook", "previews", "RailBook-round44-2026-09-28.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "B");
