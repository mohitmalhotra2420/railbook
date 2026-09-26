/* Round-36 preview (26 Sep 2026) — user: "agla kadam AI se aaye, wo khud ka dimaag lagaye jaise chatgpt yan
 * gemini lagata hai waisa hi next question pooche or soche kya poochna hai, fallback pe verified data se na
 * aaye, and AI har baar apna brain use kre."
 *   node tools/build-round36-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round36-2026-09-26.html";
const PRE = "/home/user/RailBook/previews";

const b64 = (p) => (fs.existsSync(p) ? `data:image/png;base64,${fs.readFileSync(p).toString("base64")}` : "");
const img = (n) => b64(path.join(PRE, n));

const js = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".js"));
  return { file: f, bytes: fs.statSync(path.join(dir, f)).size };
})();

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RailBook — Round 36 (26 Sep 2026)</title>
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
  <h1>RailBook · Round 36 — "Agla kadam sirf AI ke dimaag se (ChatGPT/Gemini jaisa soch), fallback bilkul band"</h1>
  <p class="sub">26 Sep 2026 · fix <code>05622f4</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye</p>

  <div class="q">User: <i>"Bhai agla kadam AI se aaye wo khud ka dimag lagaye jaise chatgpt yan gemini lagata hai waisa hi next question pooche or soche kya poochna hai, fallback pe verified data se na aaye, and AI har baar apna brain use kre."</i></div>

  <h2>1 · Chaar root causes (live probe se pakde)</h2>
  <table class="checks">
    <tr><th>Problem</th><th>Ab kya hota hai</th></tr>
    <tr><td>Model <code>[NEXT]</code> na de to client <b>data se banaya chip</b> dikha deta tha (tag "verified data se").</td><td>Data branch + import <b>poora hata</b> — card sirf model ke validated steps se; model na de to <b>card dikhta hi nahi</b>.</td></tr>
    <tr><td>Model ka NEXT-repair sirf tab chalta tha jab 9s+ budget bachta ho — plan/seat turns 60–70s kha jaate the.</td><td><b>Dedicated chhota NEXT call</b> (apna 12s timeout): sirf user sawaal + jawab + verified tool data ka compact prompt — budget se azaad.</td></tr>
    <tr><td><b>Plan fast-path</b> reply ke saath hi lauta deta tha — <code>[NEXT]</code> extraction tak pahunchta hi nahi ("Kal,1" ke plan par card nahi aata tha).</td><td>Plan fast-path par bhi wahi dedicated call — ab plan turn par bhi agla kadam aata hai.</td></tr>
    <tr><td>Dedicated call chain ke <b>HF model ko NVIDIA endpoint</b> par bhej raha tha → 404 → chup-chaap kuch nahi.</td><td><b>Provider-aware candidates</b> (HF model apne URL/key par) + <b>fast model pehle</b>, per-candidate timeout, dono fail → kuch nahi.</td></tr>
  </table>

  <h2>2 · Live proof (<code>05622f4</code>, 6 turns — asli model + asli data)</h2>
  <div class="grid2">
    <div class="figbox"><img src="${img("round36-live-next-1.png")}" alt="plan card" /><div class="cap">"Kal,1" → plan + card <b>"Book 22478 · CC (AVL 2 ₹1830)"</b> — AI ka apna chuna hua Hinglish next step (pehle is turn par card hi nahi aata tha)</div></div>
    <div class="figbox"><img src="${img("round36-live-next-2.png")}" alt="alternatives card" /><div class="cap">"alternative trains" → card <b>"Book 22486 · 2S (AVL 504 ₹155)"</b> — same data jo jawab me tha</div></div>
  </div>
  <pre>LIVE probe (tools/probe-live-r36-live.mjs)
  T1 "plan bana sakte ho?"        → AI ka apna clarifying sawaal (koi tool data nahi → koi chip nahi — sahi)
  T2 "Kal,1"                      → plan + [NEXT] "Book 22478 · CC (AVL 2 ₹1830)"      "AI ne chuna"
  T3 "alternative trains bta…"     → [NEXT] "Book 22486 · 2S (AVL 504 ₹155)"           "AI ne chuna"
  T4 "12013 ki seat availability…" → [NEXT] "12013 · LDH"                             "AI ne chuna"
  T5 "12014 ka timetable batao"    → [NEXT] (model)                                    "AI ne chuna"
  T6 "Vande Bharat ki speed…"      → [NEXT] (model, web-verified jawab ke baad)         "AI ne chuna"

  NEXT tags → AI (model): 5 · data-fallback: 0 · bina card: 1/6 (wo turn bhi AI ka apna sawaal tha)</pre>

  <h2>3 · Niyam</h2>
  <div class="card">
    <p><span class="pill">model-first</span> Agla kadam <b>hamesha model</b> deta hai (main reply ka <code>[NEXT]</code>, warna repair, warna dedicated call) — server use tool-evidence se validate karta hai, isliye jhootha number/naam chip me nahi ja sakta.</p>
    <p><span class="pill bad">no fallback</span> Data se banaya hua koi "agla kadam" ab maujood hi nahi. Model chup rahe to card nahi — aur yehi honest hai: jhootha suggestion nahi.</p>
    <p><span class="pill info">AI ka brain</span> Prompt me saaf likha hai: "apna dimaag lagao jaise ChatGPT/Gemini karte hain — socho user ke liye sabse kaam ka agla kadam kya hai (booking, doosri class, doosri date, seat, timing, live status, ya sawaal)"; clarifying turn par model ke apne sawaal ka sambhavit jawab bhi chip ban jaata hai.</p>
  </div>

  <h2>4 · Tests + kya nahi badla</h2>
  <p><span class="pill">tests</span> naya <code>tests/round36-agla-kadam-sirf-ai-ke-dimaag-se.test.ts</code> (13) + round31/32/34 + toolcalling updates → <b>115 files / 1214 ALL PASS</b> · server tsc clean · client 69 (baseline).</p>
  <ul>
    <li>Booking/passenger form/IRCTC handoff waisa hi — AI kabhi "Continue to IRCTC" click nahi karta, passenger details khud nahi bharta.</li>
    <li>Provider order (confirmtkt → railyatri → erail), Round-35 class-choice, Round-34 seat-memory — sab waisa hi.</li>
    <li>Render note (deploy karne wale ke liye): <code>clearCache:"clear"</code> use karo — <code>do_not_clear</code> par purana image serve ho gaya tha.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Screenshots: <code>RailBook/previews/round36-live-*.png</code> · probe: <code>tools/probe-live-r36-live.mjs</code> · ye preview: <code>node tools/build-round36-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
