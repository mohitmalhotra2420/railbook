/* Round-38 preview (27 Sep 2026) — user: "jaise chatgpt/gemini/claude/manus — koi bhi trains/India railway/
 * booking/live status/stations sawaal par ek dum accurate answer/outcome do."
 *   node tools/build-round38-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round38-2026-09-27.html";

const js = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".js"));
  return { file: f, bytes: fs.statSync(path.join(dir, f)).size };
})();

const rows = [
  ["Ludhiana junction ke kitne platform hain?", "Raipur Haryana Junction ka page (!) — galat station, phir bhi jawab chala gaya", "<b>\"Ludhiana Junction (LDH) ka platform count mere live data me nahi hai\"</b> + jo sach me bata sakta hoon (station code/naam, trains, seat/fare/live status)"],
  ["Sleeper coach me kitne berth hote hain?", "Vande Bharat Sleeper ka page (count hi nahi)", "<b>SL 72 berth</b> · 3A 64 · 2A 46 · 1A 22 · CC 78 seats · 2S 108 · EC 56"],
  ["Rajdhani ki top speed kitni hoti hai?", "Ek specific Rajdhani service ka page (mojibake, kaam ka nahi)", "<b>130 km/h MPS</b> + comparison (Vande Bharat 160, Gatimaan 160)"],
  ["Vande Bharat me khaana milta hai?", "Raw English Wikipedia paragraph", "IRCTC catering ka Hinglish jawab (booking option + eCatering/1323)"],
  ["Train me chai kitne ki milti hai?", "\"verified data nahi mila\"", "IRCTC catering ka sahi jawab (train-wise menu/rate vendor par)"],
  ["Wheelchair wale passenger ke liye facility?", "“Passenger train toilet” ka adhoora page", "Divyangjan facility: concession + reserved berths + ramp/lift + escort"],
];

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RailBook — Round 38 (27 Sep 2026)</title>
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
  .pill { display:inline-block; font-size:11px; font-weight:700; border-radius:999px; padding:3px 9px; background:#eef6f1; color:var(--green); margin-right:6px; }
  .pill.bad { background:#fdecea; color:var(--red); }
  .pill.info { background:#eaf1fd; color:#1d4ed8; }
  code { background:#f1f4f8; border-radius:6px; padding:1px 5px; font-size:12px; }
  pre { background:#0f1b2b; color:#dbe6f3; border-radius:10px; padding:11px 12px; font-size:11.5px; overflow:auto; }
  table.checks { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.checks th, table.checks td { border-bottom:1px solid #eef1f5; padding:7px 8px; text-align:left; vertical-align:top; }
  table.checks th { background:#f7f9fc; font-size:11.5px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); }
  .q { background:#fff; border-left:4px solid #22304a; border-radius:10px; padding:9px 12px; font-size:13px; margin:10px 0; }
  .big { display:flex; gap:14px; flex-wrap:wrap; margin:10px 0 4px; }
  .big div { background:#fff; border:1px solid var(--line); border-radius:12px; padding:10px 14px; font-size:12.5px; }
  .big b { font-size:18px; display:block; }
</style></head>
<body><div class="wrap">
  <h1>RailBook · Round 38 — "kisi bhi sawaal ka ek dumm sahi jawab, ChatGPT jaisa"</h1>
  <p class="sub">27 Sep 2026 · fix <code>1136870</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye</p>

  <div class="q">User: <i>"jaise chatgpt yan gemini yan claude yan manus — agar mai koi bhi trains, India railway, Booking, live status, stations etc (these are examples) poochun to wo ek dum se accurate answer dete hai, but mera AI kyu nhi krta — esko bhi waisa banao, user ke questions samjho aur ek dum perfect answer ya outcome do."</i></div>

  <div class="big">
    <div><b>18/18</b>sawaal ka seedha jawab (battery)</div>
    <div><b>18/18</b>Hinglish / short</div>
    <div><b>23.5s</b>avg (pehle 33.1s)</div>
    <div><b>0</b>galat page user ko gaya</div>
  </div>

  <h2>1 · Pehle naapa — kahan galat tha (18-sawaal battery, asli live app)</h2>
  <p class="sub">Battery: <code>tools/probe-r38-battery.mjs</code> — 8 category: train identity · station · fare · live status · schedule · rules (tatkal/PNR/refund) · catering · berth · list · capability · station code · speed · accessibility · off-domain.</p>
  <table class="checks">
    <tr><th>Sawaal</th><th>Pehle kya hota tha</th><th>Ab kya hota hai</th></tr>
    ${rows.map(([q, b, a]) => `<tr><td>${q}</td><td><span class="pill bad">pehle</span>${b}</td><td><span class="pill">ab</span>${a}</td></tr>`).join("\n    ")}
  </table>

  <h2>2 · Fix — teen cheezein</h2>
  <div class="card">
    <p><span class="pill">subject guard</span> Naya <code>server/agent/subject.ts</code>: jawab ka page sawaal ke <b>strong shabdon</b> (station/train ke naam, number) se match hota hai; generic railway/bolne ke shabd (platform, berth, khana, mujhe, batao…) subject nahi bante. Galat page <b>skip</b> → agli koshish; sab fail → saaf <i>"is sawaal ka sahi page nahi mila"</i> + jo sach me bata sakta hoon wo suggest. <b>Kuch bhi andaze se nahi.</b></p>
    <p><span class="pill">KB facts</span> <code>railkb.ts</code> me woh cheezein jo "stable railway knowledge" hain: coach layout (berth counts), Rajdhani 130 km/h, Vande Bharat 160/183, onboard khana (IRCTC catering), platform count ka honest jawab, divyangjan/wheelchair facility. Ye topics web se <b>pehle</b> KB se aate hain — turant, Hinglish, sahi.</p>
    <p><span class="pill info">honest fallback</span> Jo data mere paas sach me nahi (jaise station ke platform ki exact count), wahan guess nahi — saaf batata hoon aur jo <b>de sakta hoon</b> (station code/naam/city, wahan ki trains, seat/fare/live status) wahi offer karta hoon.</p>
  </div>

  <h2>3 · Live proof (battery dobara, <code>1136870</code>)</h2>
  <pre>BATTERY: 18/18 seedha jawab · 18/18 Hinglish/short · avg 23.5s   (pehle: 18/18 par accuracy galat, avg 33.1s)

  station-info   "Ludhiana junction ke kitne platform hain?"
                 → "Ludhiana Junction (LDH) ka platform count mere live railway data / tools mein
                    available nahi hai — provider seat/fare/train/live status dete hain …"  (galat Raipur page khatam)
  berth          "Sleeper coach me kitne berth hote hain?"
                 → "Sleeper (SL) coach me aam Indian Railways layout ke hisaab se ek coach me 72 berth …"
  general-speed  "Rajdhani ki top speed kitni hoti hai?"
                 → "Rajdhani Express LHB coaches ki maximum permissible speed (MPS) 130 km/h hoti hai …"
  catering       "Vande Bharat me khaana milta hai?"
                 → "Haan, Vande Bharat mein alag pantry car nahi hoti, lekin IRCTC ki onboard catering milti hai …"
  light          "Chai kitne ki milti hai train me?"   → IRCTC catering ka jawab (pehle "data nahi mila")
  accessibility  "Wheelchair wale passenger ke liye?"  → Divyangjan facility ka poora jawab

R37 ka user-scenario bhi dobara verify (R38 build par):
  "12054 mein 2S book krdo"  → ✅ passenger form khula (12054 · 2S · ASR → HW · 📅 2026-09-28)
  wahi hukm dobara           → "form pehle se khula hai" (koi loop nahi)</pre>

  <h2>4 · Tests + kya nahi badla</h2>
  <p><span class="pill">tests</span> naya <code>tests/round38-any-question-accuracy.test.ts</code> (12: subject-guard ke live bug cases + KB facts + wiring anchors) + round15 web-answer test update → <b>117 files / 1264 ALL PASS</b> · server tsc clean · client 69 (baseline).</p>
  <ul>
    <li><b>Kuch bhi fake nahi</b> — KB facts IRCTC/rules-based hain, live fare/seat/live-status hamesha railway tools se (web data kabhi live claim nahi).</li>
    <li>Booking flow, passenger form, IRCTC handoff, Round-35 class-choice, Round-36 "agla kadam sirf AI se", Round-37 resolver — sab waisa hi.</li>
    <li>Render note: deploy <code>clearCache:"clear"</code> ke saath.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Battery: <code>tools/probe-r38-battery.mjs</code> · tests: <code>tests/round38-any-question-accuracy.test.ts</code> · ye preview: <code>node tools/build-round38-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
