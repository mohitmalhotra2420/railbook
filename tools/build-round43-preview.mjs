/* Round-43 preview — khaas train ka jawab (poora board nahi) · internal-text leak band · Book-tap crash fix. */
import fs from "node:fs";
import path from "node:path";

const rows = [
  [
    '"12054 ki seat availability btana"',
    "poora 16-train route-board khul gaya, us train ka jawab nahi ❌",
    'CHECK_AVAILABILITY (aaj+kal) → "27 Sep (aaj): train cancelled · 28 Sep (kal): CC WL 16 ₹650 · 2S AVAILABLE 294 ₹205" — 2.8s ✅',
  ],
  [
    '"aaj ki" / "CC" (follow-up)',
    "context khota, board par wapas ❌",
    "train + date yaad — cancelled date par agla din bhi (ChatGPT jaisa), 1.2s ✅",
  ],
  [
    '"19326 hw ke liye seat check krna"',
    "19326 Haridwar JAATI HI NAHI — phir bhi poora ASR→INDB board (saari classes N/A) ❌",
    '"…ke timetable me HW nahi milta — is train ka route ASR → INDB hai" + sahi station ka sawaal — 1.2s ✅',
  ],
  [
    "Reply me internal text (screenshot)",
    'tool ke andar ki instructions user ko dikh gayi thi ("Jawab me SAARI trains ki lines likho… mat likho", "(0 ka alag board check kiya)") ❌',
    "scrubInternalNotes — instruction/process noise kabhi user tak nahi ✅",
  ],
  [
    '"Book <train>" chip (seat card / next-step)',
    "tap par poora app BLANK (white screen) — BERTH_BY_CLASS[undefined].map crash ❌",
    "form sirf VERIFIED class par; chip → class → passenger form khula — live browser 2/2 ✅",
  ],
  [
    '"12054 mein book krdo" (cancelled date)',
    "dead-end (us din kuch bookable hi nahi tha) ❌",
    '"…· 2026-09-28 (2026-09-27 par koi class bookable nahi thi) — kaunsi class me book karun?" + chips usi date ke ✅',
  ],
  [
    '"12054 late hai kya" / "kahan hai"',
    "model date poochh kar ruk gaya ❌",
    "seedha aaj ka live/alert (cancelled hai to wahi sach) — client me aaj ka run prefer ✅",
  ],
];

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 43: khaas train ka sahi jawab + Book-tap crash fix</title>
<style>
 body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1420;color:#e8ecf3;margin:0;padding:28px}
 .wrap{max-width:960px;margin:0 auto} h1{font-size:23px;margin:0 0 6px} .sub{color:#8fa3bf;margin:0 0 16px}
 .pill{display:inline-block;background:#16324f;color:#7fd1ff;border:1px solid #2b5f8a;border-radius:999px;padding:3px 10px;font-size:12px;margin:0 6px 6px 0}
 table{width:100%;border-collapse:collapse;margin:14px 0 20px;font-size:14px}
 th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #22304a;vertical-align:top}
 th{color:#9fb7d8;font-size:12.5px;text-transform:uppercase;letter-spacing:.04em}
 .ok{color:#5ee08a}.bad{color:#ff8f8f}
 .box{background:#151c2b;border:1px solid #24324b;border-radius:12px;padding:14px 16px;margin:14px 0;font-size:14px;line-height:1.65}
 code{background:#1d2739;padding:1px 6px;border-radius:6px;font-size:12.5px}
 .foot{color:#7c8ba5;font-size:12.5px;margin-top:16px}
</style></head><body><div class="wrap">
<h1>🎯 Round 43 — <b>khaas train ka seedha, sahi jawab</b> (poora board nahi) + Book-tap crash fix</h1>
<p class="sub">Aapke 3+1 screenshots se: single-train availability · internal-text leak · Book tap par blank screen · 19326 wala route-mismatch.</p>

<span class="pill">single-train → date-wise (aaj+kal)</span>
<span class="pill">multi-turn resume</span>
<span class="pill">internal notes kabhi nahi</span>
<span class="pill">Book-tap crash-proof</span>
<span class="pill">route me na ho → saaf correction</span>
<span class="pill">tool-level general verification (routeCheck.ts)</span>

<table>
<tr><th>Aapka sawaal</th><th>Pehle</th><th>Ab</th></tr>
${rows.map(([q, before, after]) => `<tr><td><code>${q}</code></td><td class="bad">${before}</td><td class="ok">${after}</td></tr>`).join("\n")}
</table>

<div class="box">
<b>Live proof (railbook-gegs.onrender.com):</b><br>
• <code>12054 ki seat availability btana</code> → 2.8s — cancelled + kal CC WL16 / 2S AVL 294 (provider data)<br>
• <code>aaj ki</code> → 1.2s (wahi train, agla din bhi — board nahi)<br>
• <code>19326 hw ke liye seat check krna</code> → 1.2s — "HW us route me nahi hai, route ASR → INDB"<br>
• <b>Playwright (mobile viewport) live:</b> seat answer → <code>Book 12054</code> → class chip → <b>passenger form khula</b>, aur route board → class chip → <b>form khula</b> = 2/2<br>
• <code>probe-r43-booktap.mjs</code> ye dono raste har deploy par check karta hai.
</div>

<div class="box" style="border-color:#2b5f8a">
<b>Round-43k — "ese kitne rules fix kroge?" (aapka sawaal):</b> ab verification <b>har naye sawaal ka patch nahi</b> — ek hi shared module <code>server/agent/routeCheck.ts</code> ke andar general hai, aur wahi code <b>tool ke andar</b> chalta hai (CHECK_AVAILABILITY / GET_FARE) + deterministic handler me. Matlab: <b>kisi bhi train × station</b> par — station train ke route me na ho to tool khud fail hota hai, koi jhootha N/A board nahi, aur model ise bypass nahi kar sakta.<br>
• <code>19326 haridwar…</code> → "HW nahi jaati — route ASR → INDB" <b>3.5s</b> (pehle 45.7s poora ASR→INDB board)<br>
• <code>12951 mumbai rajdhani haridwar…</code> → "HW nahi jaati — route MMCT → NDLS" <b>0.9s live</b> (train-specific rule nahi, general proof)<br>
• <code>12054 haridwar…</code> → asli seat data (27 Sep cancelled · 28 Sep CC WL16 ₹650 · 2S AVL 235 ₹205)<br>
• Isi round me 2 chhupe bug bhi pakde: station search "ko/se" jaise shabd ko station maan leta tha (false "nahi jaati"), aur aakhri stop ko destination bhejne par provider "HW→HW" samajh kar data nahi deta tha — dono general tarike se band.<br>
• Full suite <b>122 files / 1339 tests pass</b>.
</div>

<div class="box">
<b>Tech:</b> <code>answersSingleTrainAvailability()</code> + deterministic handler (aaj+kal, per-class status/₹, cancelled line) · multi-turn resume (train/date/class) · <code>scrubInternalNotes()</code> (instruction-lines + process-noise, agentic + deterministic dono) · route-inclusion guard (timetable stops) · client form sirf verified class par (BERTH_BY_CLASS safe) · booking next-date fallback · live status: aaj ka run prefer (chahe cancelled ho) · toolTrace har deterministic jawab par bhi.
</div>

<p class="foot">Sirf 2 rok (aapke rule): IRCTC par "Continue to IRCTC" click nahi, passenger details/payment khud nahi bharta. Baaki: jo verified nahi, wo guess nahi — provider ka real data hi.</p>
</div></body></html>`;

const out = path.join(process.cwd(), "..", "..", "RailBook", "previews", "RailBook-round43-2026-09-27.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "B");
