/* Round-37 preview (27 Sep 2026) — user screenshot: "mainay 3 baar bola 12054 mein 2S book krdo … AI wahi
 * reply dohra raha, form khula hi nahi … AI khd kyu nhi samjh ke sahi se outcome deta? … jaise
 * chatgpt/gemini/claude/manus — ek dum perfect answer/outcome do."
 *   node tools/build-round37-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round37-2026-09-27.html";
const PRE = "/home/user/RailBook/previews";
const UP = "/home/user/uploads";

const b64 = (p) => (fs.existsSync(p) ? `data:image/png;base64,${fs.readFileSync(p).toString("base64")}` : "");
const img = (n) => b64(path.join(PRE, n));
const up = (n) => b64(path.join(UP, n));

const js = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".js"));
  return { file: f, bytes: fs.statSync(path.join(dir, f)).size };
})();

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RailBook — Round 37 (27 Sep 2026)</title>
<style>
  :root { --ink:#16202f; --muted:#5b6a7d; --line:#e3e6ec; --green:#14603f; --red:#a4302b; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f6f2ea; color:var(--ink); font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif; }
  .wrap { max-width:1080px; margin:0 auto; padding:22px 18px 60px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:17px; margin:30px 0 8px; }
  p, li { font-size:13.5px; line-height:1.55; }
  .sub { color:var(--muted); font-size:12.5px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px 15px; margin:12px 0; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; }
  .figbox { background:#fff; border:1px solid var(--line); border-radius:14px; padding:10px; }
  .figbox img { width:100%; border-radius:10px; display:block; border:1px solid #eef1f5; }
  .cap { font-size:11.5px; color:var(--muted); margin:7px 2px 0; }
  .pill { display:inline-block; font-size:11px; font-weight:700; border-radius:999px; padding:3px 9px; background:#eef6f1; color:var(--green); margin-right:6px; }
  .pill.bad { background:#fdecea; color:var(--red); }
  .pill.info { background:#eaf1fd; color:#1d4ed8; }
  code { background:#f1f4f8; border-radius:6px; padding:1px 5px; font-size:12px; }
  pre { background:#0f1b2b; color:#dbe6f3; border-radius:10px; padding:11px 12px; font-size:11.5px; overflow:auto; }
  table.checks { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.checks th, table.checks td { border-bottom:1px solid #eef1f5; padding:6px 8px; text-align:left; vertical-align:top; }
  table.checks th { background:#f7f9fc; font-size:11.5px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); }
  .q { background:#fff; border-left:4px solid #22304a; border-radius:10px; padding:9px 12px; font-size:13px; margin:10px 0; }
</style></head>
<body><div class="wrap">
  <h1>RailBook · Round 37 — "12054 mein 2S book krdo" 3 baar, form nahi khula: AI khud samjhe, ek dumm sahi outcome</h1>
  <p class="sub">27 Sep 2026 · fix <code>b738b8c</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye</p>

  <div class="q">User (screenshot ke saath): <i>"mainay 3 baar bola 12054 mein 2s book krdo … AI wahi reply dohra raha, form khula hi nahi … AI khd kyu nhi samjh ke sahi se outcome deta? mai kya har choti choti cheez check karun? jaise chatgpt/gemini/claude/manus — ek dum perfect answer/outcome do."</i></div>

  ${
    up("Screenshot_20260927-023746_RailBook.png")
      ? `<div class="figbox"><img src="${up("Screenshot_20260927-023746_RailBook.png")}" alt="user screenshot" /><div class="cap">User ka screenshot — "12054 mein 2s book krdo" 3 baar, jawab wahi, form khula hi nahi.</div></div>`
      : ""
  }

  <h2>1 · Root cause (live <code>/api/agent</code> repro se pakde, andaza nahi)</h2>
  <table class="checks">
    <tr><th>Problem</th><th>Asli wajah</th></tr>
    <tr><td>Booking hukm par form nahi khulta, AI wahi class-sawaal dohraata hai</td><td>Raw response me us turn par <code>context.origin/destination = null</code>, <code>intent/nextActions/seatFilter/trains.rows</code> sab khaali — client ka booking gate (<code>train + from + to + date</code>) fail hone par wo <b>chup-chaap kuch nahi</b> karta tha.</td></tr>
    <tr><td>Dobara bhejne par "Samajh raha hoon…" par atak jaana</td><td>Form khula hone par client <b>agent call hi nahi bhejta</b> tha (<code>criticalBookingFlow</code> ka local rasta) — probe me 3rd request hi gayab; model ke paas jaane par "Nahi, main booking nahi kar sakta" aata tha.</td></tr>
    <tr><td>General sawaal par Wikipedia ka raw English paragraph</td><td>Web jawab jaisa aata waisa hi dump ho jaata tha (comparison sawaal par sirf ek hi train ka page).</td></tr>
  </table>

  <h2>2 · Fix — ek hi jagah se sahi target</h2>
  <div class="card">
    <p><span class="pill">resolver</span> Naya pure function <code>resolveBookingTarget()</code> (<code>src/booking/autobook.ts</code>): train / class / route / date <b>har verified source</b> se — booking state → is turn ke seat rows → picker tap → yaad rakhi rows (wahi route/date) → trains list → server ctx → <b>user ke apne chat se</b> ("ASR se HW", "ludhiana se amritsar", "kal/aaj/parso", dd-mm-yyyy). Kuch bhi andaza nahi — jo user ne khud bola wahi.</p>
    <p><span class="pill">class gate</span> Class boli ho → <b>seedha usi class ka</b> passenger form; class na boli aur 2+ class khuli → Round-35 ka class-choice card (silently pick nahi); sirf date missing → saaf date sawaal ("kis date ko jaana hai?"), class dobara nahi.</p>
    <p><span class="pill">repeat</span> Form khula ho + wahi hukm dobara → turant saaf line: <i>"✅ 12054 · 2S ka passenger form pehle se khula hai — usme passenger details bhar do. (Bhejne ke liye 'Continue to IRCTC' aap khud dabayenge.)"</i> — koi server chakkar nahi, koi confusing "main booking nahi kar sakta" nahi.</p>
    <p><span class="pill">no loop</span> Server par <b>repeat-guard</b> (wahi jawab dobara likha jaaye to ek corrective call: "user ka naya message us sawaal ka jawab/aadesh hai, aage badho") + prompt <b>rule 29 "JAWAB EK DAMM SEEDHA"</b> — seedha outcome pehle, ek baar bata diya = FINAL, apna purana sawaal dobara nahi.</p>
    <p><span class="pill info">knowledge</span> General/railway sawaal par ab raw English dump nahi — <code>polishWebReply</code>/<code>composeWebAnswer</code> se <b>2-4 line Hinglish composed jawab</b>; <b>comparison</b> ("Vande Bharat aur Rajdhani me kya fark hai") par dono subjects ka topic page + dono source URLs; railKB ab alag shabdon wali query bhi pakadta hai (<code>token overlap 0.75+, 2+ token</code>) — "waiting list ticket confirm hone ke rules" jaisa sawaal Wikipedia disambiguation ke bajaye KB se.</p>
  </div>

  <h2>3 · Live proof (<code>b738b8c</code>) — user ka exact scenario</h2>
  <pre>LIVE probe (tools/probe-live-r37-live.mjs) — Chromium, phone size, asli live app
  T1 "12054 ki seat availability batao ASR se HW kal ke liye" → real seat jawab (427 seats · ₹205)
  T2 "12054 mein 2S book krdo"   → ✅ PASSENGER FORM KHUL GAYA (12054 · 2S · ASR → HW · 📅 2026-09-28)
  T3 wahi hukm dobara            → "✅ 12054 · 2S ka passenger form pehle se khula hai…" (loop khatam, koi repeat nahi)
  RESULT: form khula(T2)=true · loop nahi(T3)=true

General sawaal battery (live /api/agent)
  "Waiting list ticket confirm hone ke rules kya hain?" → WL ka poora sahi jawab (GNWL/RLWL/PQWL/TQWL + chart) — pehle Wikipedia disambiguation
  "Train me kitna saamaan free le ja sakte hain?"       → 1A 70kg · 2A 50kg · 3A/CC 40kg · SL 40kg · 2S 35kg + size limit
  "Vande Bharat aur Rajdhani me kya fark hai?"          → DONO trains ka composed jawab + dono source URLs
  "Vande Bharat ki top speed kitni hai?"                → 160 km/h operational, 183 km/h trial — numbers jaise hain waise</pre>

  <h2>4 · Tests + kya nahi badla</h2>
  <p><span class="pill">tests</span> naya <code>tests/round37-booking-loop-and-repeat-guard.test.ts</code> (37: resolver 8 · chat-route 7 · client gates 12 · server guard 10) + round29/30/34/35 anchors update → <b>117 files / 1251 ALL PASS</b> · server tsc clean · client 69 (baseline).</p>
  <ul>
    <li><b>Kuch bhi fake nahi</b> — resolver sirf verified sources se bharta hai (jo user ne bola / jo provider ne diya); missing ho to AI saaf maangta hai, chip-jaali step nahi.</li>
    <li>AI kabhi "Continue to IRCTC" click nahi karta, passenger details khud nahi bharta (Round-33 ka 2-rok rule waisa hi).</li>
    <li>Provider order (confirmtkt → railyatri → erail), Round-35 class-choice, Round-34 seat-memory, Round-36 "agla kadam sirf AI se" — sab waisa hi chal raha hai.</li>
    <li>Render note: deploy <code>clearCache:"clear"</code> ke saath (warna purana image serve hota hai).</li>
  </ul>

  <p class="sub" style="margin-top:26px">Probes: <code>tools/probe-live-r37-live.mjs</code>, <code>tools/probe-r37-debug.mjs</code> · screenshots: <code>RailBook/previews/round37-live-*.png</code> · ye preview: <code>node tools/build-round37-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
