/* Round-46 preview — station-code verification net (model ke galat code band). */
import fs from "node:fs";
const rows = [
  ["12013 haridwar pahunch gayi kya", "R45 me: “…isme Haridwar (HWR) station nahi aata” ❌ (HWR = HATWAR; Haridwar = HW)", "“…Haridwar HW is route par nahi hai…” ✅ (net chaalu — model galat likhe to bhi theek ho jaata hai)"],
  ["12013 haridwar par rukti hai kya", "—", "“Timetable mein Haridwar/HW ka koi stop nahi hai” ✅ 49s"],
  ["12054 haridwar ke liye seat check krna", "sahi tha (control case)", "12054 (ASR → HW) — 28 Sep CC N/A ₹650 · 2S N/A ₹205 | 29 Sep CC WL 20 · 2S AVAILABLE 649 ✅ 57s"],
];
const keep = [
  "Bengaluru (SBC) se Mysuru (MYS) tak",
  "Delhi (NZM) se Ambala (UMB) via Ludhiana (LDH)",
  "12054 LDH ke paas DDL (Dhandari Kalan) route par hai — dep 09:20.",
  "Route: NDLS → UMB → SIR → LDH → PGW → JUC → BEAS → ASR (8 stops).",
  "Delay: 20 min · Next stop: AMBALA CANT JN (UMB) · Platform: 3",
  "(Source: confirmtkt.com — railway API se nahi, verified web site se.)",
];
const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 46: station code verification net</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1420;color:#e8ecf3;margin:0;padding:28px}
 .wrap{max-width:1040px;margin:0 auto} h1{font-size:23px;margin:0 0 6px} .sub{color:#8fa3bf;margin:0 0 16px}
 table{width:100%;border-collapse:collapse;margin:14px 0 20px;font-size:13.5px}
 th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #22304a;vertical-align:top}
 th{color:#9fb7d8;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
 .ok{color:#5ee08a}.bad{color:#ff8f8f}
 .box{background:#151c2b;border:1px solid #24324b;border-radius:12px;padding:14px 16px;margin:14px 0;font-size:14px;line-height:1.65}
 .g{background:#12261b;border-color:#24503a}
 code{background:#1d2739;padding:1px 6px;border-radius:6px;font-size:12.5px}
 ul{margin:8px 0 0 18px;padding:0}
</style></head><body><div class="wrap">
<h1>Round 46 — station-code verification net</h1>
<p class="sub">Model route sahi likhta hai, par code ki slip kar deta tha (Haridwar = HW, par likha HWR). User IRCTC me code hi type karta hai — isliye ab har reply ke code hamare data se verify hote hain.</p>
<div class="box">
 <b>Kaise kaam karta hai (general net — per-question rule nahi):</b>
 <ul>
  <li>Hamara station data: <b>8989 IR stations</b> (code → naam), data.gov.in list se (regenerate script repo me).</li>
  <li>Reply me code+naam jodi dhoondi jaati hai — <code>Naam (CODE)</code>, <code>CODE Naam</code>, <code>Naam — CODE</code>.</li>
  <li>Sirf tab badalta hai jab naam hamare data me ho aur uska code kuch aur ho. Warna haath nahi lagaya jaata.</li>
  <li>Asli station ka code aur naam milte ho (New Delhi ↔ Delhi, Ambala ↔ UMB/UBC) ya naam unknown ho → kuch nahi badalta (andaza nahi).</li>
  <li>Leak-scrub ke usi pipeline me laga hai jahan se model ka reply user tak jaata hai; har fix prod log me telemetry ke saath.</li>
 </ul>
</div>
<h1 style="font-size:18px;margin-top:26px">Live battery — prod <code>2f9c008</code> (3/3, 0 leak)</h1>
<table><thead><tr><th>Sawaal</th><th>Pehle</th><th>Ab</th></tr></thead><tbody>
${rows.map(([q, before, after]) => `<tr><td><code>${q}</code></td><td>${before}</td><td>${after}</td></tr>`).join("\n")}
</tbody></table>
<div class="box g">
 <b>False-positive battery (aisi replies ko haath nahi lagta):</b>
 <ul>${keep.map((k) => `<li><code>${k}</code></li>`).join("")}</ul>
</div>
<p class="sub">Full suite: 125 files / 1366 tests pass · 7 naye tests (live case + dono forms + false-positive battery + end-to-end).</p>
</div></body></html>`;
const out = "/home/user/RailBook/previews/RailBook-round46-2026-09-28.html";
fs.mkdirSync("/home/user/RailBook/previews", { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
