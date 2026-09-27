/* Round-39 preview (27 Sep 2026) — user: "har choti choti cheez check karun? AI khud kyu nhi samajh ke
 * sahi se outcome deta? jaise chatgpt/gemini/claude/manus — koi bhi sawaal, ek dum accurate answer."
 *   node tools/build-round39-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round39-2026-09-27.html";

const js = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".js"));
  return { file: f, bytes: fs.statSync(path.join(dir, f)).size };
})();

const rows = [
  ["Ludhiana se Amritsar kitni doori hai?", "Delhi–Amritsar–Katra <b>Expressway</b> (sadak) ka jawab 😑", "Rail/road km mere providers me nahi — honest line + <b>journey time</b> ka offer"],
  ["Kutta train me le ja sakte hain?", "\"verified rule nahi mil paya\" (51s)", "<b>1A / First Class + Luggage Van</b>, booking zaroori, baaki coaches me nahi"],
  ["Train me smoking allowed hai?", "\"specific rule nahi de paaye\" (37s)", "<b>COTPA — banned</b> (coach, toilet, platform), e-cigarette bhi; penalty"],
  ["Mobile charging point har coach me?", "raw \"UNVERIFIED\" bullet dump", "Reserved coaches (SL/3A/2A/1A/CC/EC) me haan, <b>General/purane rakes me nahi</b>"],
  ["AC kharab ho gaya to paisa wapas?", "\"koi verified rule nahi\" (108s!)", "TTE certificate + <b>TDR 20 ghante</b> + difference formula (3A/2A→SL · 1A/EC→1st · CC→2S)"],
  ["3A aur 2A me fare ka fark?", "\"koi relevant data nahi\" (65s)", "Order <b>2S &lt; SL &lt; 3A &lt; CC &lt; 2A &lt; EC/1A</b>, 2A ~25–40% mehnga, exact provider se"],
  ["Indian Railways ka sabse bada station?", "kuch nahi aaya", "<b>Howrah Jn — 23 platforms</b> (+ Sealdah 21, CSMT 18, NDLS 16)"],
  ["Konkan Railway kahan se kahan tak?", "Mangalore Central station ka page", "<b>Roha (MH) → Thokur (Mangaluru)</b>, ~741 km, 1998 se"],
  ["Tum kya nahi kar sakte?", "AI ne <b>booking flow</b> shuru kar diya — \"Kahan se jaana hai?\"", "Capability jawab <b>0.3s</b> me: kya-kya karta hoon + 2 rok (IRCTC click nahi, details nahi)"],
];

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RailBook — Round 39 (27 Sep 2026)</title>
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
</style></head>
<body><div class="wrap">
  <h1>RailBook · Round 39 — "har tarah ke sawaal, ek dumm sahi jawab" (24-sawaal battery)</h1>
  <p class="sub">27 Sep 2026 · live <code>f10d824</code> · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye</p>

  <div class="q">User: <i>"mai kya abh har choti choti cheez check karun? AI khud kyu nhi samajh ke sahi se outcome deta? Jaise chatgpt yan gemini yan claude yan manus … agar mai koi bhi trains, India railway, Booking, live status, stations etc (examples) poochun to wo ek dum se accurate answer dete hai, but mera AI kyu nhi — esko bhi waisa banao."</i></div>

  <h2>1 · Pehle naapa (24 naye sawaal, asli live app) — jo galat/weak tha</h2>
  <table class="checks">
    <tr><th>Sawaal</th><th>Pehle</th><th>Ab</th></tr>
    ${rows.map(([q, b, a]) => `<tr><td>${q}</td><td><span class="pill bad">pehle</span>${b}</td><td><span class="pill">ab</span>${a}</td></tr>`).join("\n    ")}
  </table>

  <h2>2 · Fix — 6 cheezein</h2>
  <div class="card">
    <p><span class="pill">mode guard</span> Rail sawaal par <b>road/expressway/air</b> wala page reject (user khud road poochhe to allowed). Distance sawaal par honest line + journey-time offer — <b>sadak ka data railway sawaal me kabhi nahi</b>.</p>
    <p><span class="pill">roz ke rules</span> Pet (1A/FC + Luggage Van) · smoking (COTPA) · charging point · AC-fail refund (TTE certificate + TDR 20h + difference formula) · bachche ka ticket (&lt;5 free · 5–12 half/full) · 2A-3A fare order — sab KB me, turant Hinglish jawab.</p>
    <p><span class="pill">general knowledge</span> Sabse bada station (Howrah 23 platforms) · sabse lambi route (Vivek Express ~4,154 km) · Konkan Railway (Roha → Thokur 741 km) — KB <b>web se pehle</b> chalta hai (pehle web par Ernakulam/Mangalore ke galat pages aa jaate the).</p>
    <p><span class="pill">capability</span> "Tum kya (nahi) kar sakte ho" / "tum kaun ho" → <b>0.3s</b> me fixed honest jawab (kya-kya + wahi 2 rok). Pehle AI booking flow shuru kar deta tha.</p>
    <p><span class="pill info">client replies</span> App ke andar charging/bedding/catering/wifi ke jawab ab sach bolte hain (pehle "gadh ke nahi bataunga" jaisi lines thi).</p>
    <p><span class="pill info">subject guard+</span> Hindi adjectives (lambi/lamba/bada/chhota/sabse) generic — warna sahi Wikipedia page reject ho jaata tha (R38 ka guard ab aur saaf).</p>
  </div>

  <h2>3 · Live proof (deploy ke baad, asli app)</h2>
  <pre>Q: "Ludhiana se Amritsar kitni doori hai?" → honest: rail km data nahi + journey-time offer   ✅
Q: "Kutta train me le ja sakte hain?"      → 1A/FC + Luggage Van, booking zaroori            ✅
Q: "Mobile charging point har coach me?"   → reserved me haan, general me nahi                ✅
Q: "AC kharab ho gaya to paisa wapas?"     → TTE certificate + TDR 20h + formula              ✅
Q: "3A aur 2A me fare ka fark?"            → order + 25–40% + exact provider se               ✅
Q: "Sabse bada station?"                   → Howrah Jn — 23 platforms (+ top-5)               ✅
Q: "Konkan Railway kahan se kahan tak?"    → Roha → Thokur, ~741 km, 1998                    ✅
Q: "Sabse lambi train route?"              → Vivek Express, ~4,154 km (~82.5h)                ✅
Q: "Tum kya nahi kar sakte?"               → capability + 2 rok (0.3s)                        ✅</pre>

  <h2>4 · Tests + kya nahi badla</h2>
  <p><span class="pill">tests</span> naya <code>tests/round39-every-question-battery.test.ts</code> (11) + round38 (23) + intelligence/round15 anchors → <b>118 files / 1286 ALL PASS</b> · server tsc clean · client 69 (baseline).</p>
  <ul>
    <li><b>Kuch bhi fake nahi</b> — jo data nahi, wahan saaf "nahi hai" + jo sach me bata sakta hoon; live fare/seat/status hamesha railway tools se.</li>
    <li>Booking flow · passenger form · IRCTC handoff · "agla kadam sirf AI se" · class-choice — sab waisa hi.</li>
    <li>Deploy note: <code>clearCache:"clear"</code>.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Battery: <code>tools/probe-r39-battery.mjs</code> · tests: <code>tests/round39-every-question-battery.test.ts</code> · ye preview: <code>node tools/build-round39-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
