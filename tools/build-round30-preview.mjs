/* Round-30 preview (26 Sep 2026) — user ke 2 screenshots @686a88f:
 *   "12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye" maanga tha,
 *   par chat me poori 21-train ki live board khul gayi — "yeh question pe board kyu le aata …
 *   maine to maanga hi nahi".
 *
 * Preview: before/after screenshots + exact rules + live proof numbers + code touch list.
 *   node tools/build-round30-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round30-2026-09-26.html";
const PRE = "/home/user/RailBook/previews";
const UPLOADS = "/home/user/uploads";

const b64 = (p) => (fs.existsSync(p) ? `data:image/png;base64,${fs.readFileSync(p).toString("base64")}` : "");
const img = (n, dir = PRE) => b64(path.join(dir, n));

const before1 = img("Screenshot_20260926-180125_RailBook.png", UPLOADS);
const before2 = img("Screenshot_20260926-180130_RailBook.png", UPLOADS);
const afterFocus = img("round30-live-focused.png");
const afterGeneric = img("round30-live-generic.png");

const js = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".js"));
  return { file: f, bytes: fs.statSync(path.join(dir, f)).size };
})();

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RailBook — Round 30 (26 Sep 2026)</title>
<style>
  :root { --ink:#16202f; --muted:#5b6a7d; --line:#e3e6ec; --green:#14603f; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f6f2ea; color:var(--ink); font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif; }
  .wrap { max-width:1080px; margin:0 auto; padding:22px 18px 60px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:17px; margin:30px 0 8px; }
  p, li { font-size:13.5px; line-height:1.55; }
  .sub { color:var(--muted); font-size:12.5px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px 15px; margin:12px 0; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:14px; }
  .figbox { background:#fff; border:1px solid var(--line); border-radius:14px; padding:10px; }
  .figbox img { width:100%; border-radius:10px; display:block; border:1px solid #eef1f5; }
  .cap { font-size:11.5px; color:var(--muted); margin:7px 2px 0; }
  .pill { display:inline-block; font-size:11px; font-weight:700; border-radius:999px; padding:3px 9px; background:#eef6f1; color:var(--green); margin-right:6px; }
  .pill.bad { background:#fdecec; color:#a32020; }
  .pill.warn { background:#fff5e6; color:#995f00; }
  .pill.info { background:#eaf1fd; color:#1d4ed8; }
  code { background:#f1f4f8; border-radius:6px; padding:1px 5px; font-size:12px; }
  pre { background:#0f1b2b; color:#dbe6f3; border-radius:10px; padding:11px 12px; font-size:11.5px; overflow:auto; }
  table.checks { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.checks th, table.checks td { border-bottom:1px solid #eef1f5; padding:6px 8px; text-align:left; vertical-align:top; }
  table.checks th { background:#f7f9fc; font-size:11.5px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); }
</style></head>
<body><div class="wrap">
  <h1>RailBook · Round 30 — "12013 ki seat availability" maanga, poori 21-train ki board kyun khul gayi</h1>
  <p class="sub">26 Sep 2026 · user ke 2 screenshots (@<code>686a88f</code>) · fix <code>0b36c52</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye (app live web URL load karta hai)</p>

  <div class="card">
    <span class="pill">kya galat tha</span>
    <span class="pill">kya ab hota hai</span>
    <span class="pill warn">data waisa hi (kuch chhupta/merge nahi)</span>
    <p style="margin:10px 0 0">Chat ka seat-block har baar <b>poori live board</b> (21 trains × saari classes) render karta tha — chahe user ne ek train poochi ho. Isliye 12013 ka jawab aane se pehle screen par 21 trains aa gayi thi ("maine to maanga hi nahi"). Ab block us sawaal ke daayre me hi rehta hai.</p>
  </div>

  <h2>1 · Pehle vs ab (asli live screenshots)</h2>
  <div class="grid2">
    <div class="figbox">
      <img src="${before1}" alt="pehle: 21 trains ki board" />
      <p class="cap"><span class="pill bad">pehle</span> user ka screenshot: sawaal <i>"12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye"</i> — aur screen par <b>21 trains · 12 me seat</b> ki poori board (12013 ke saath banaras 22487, 14631, 11057, 15707, 12029… sab).</p>
    </div>
    <div class="figbox">
      <img src="${afterFocus}" alt="ab: sirf 12013 ka card" />
      <p class="cap"><span class="pill">ab</span> live deploy par wahi sawaal: <b>1 hi card — 12013 AMRITSAR SHTABDI</b>, header "Aapki maangi train (live board) · 12013 · 1 train · 1 me seat", chips <code>CC AVL 354 ₹675</code>, <code>EC AVL 23 ₹1,015</code> (browser probe + asli AI jawab).</p>
    </div>
  </div>

  <h2>2 · Generic sawaal par sab kuch pehle jaisa</h2>
  <div class="grid2">
    <div class="figbox">
      <img src="${afterGeneric}" alt="generic sawaal: poora board" />
      <p class="cap"><span class="pill info">generic</span> usi chat me <i>"kal ke liye seat wali trains batao ludhiana se amritsar"</i> → pehle jaisa <b>poora board: 20 trains · 12 me seat · 59 class chips</b> (kuch bhi nahi chhupta jab user sab maange).</p>
    </div>
    <div class="figbox">
      <img src="${before2}" alt="pehle: jawab ke saath board ke rows" />
      <p class="cap"><span class="pill bad">pehle</span> user ka dusra screenshot: text jawab ke saath bhi wahi poori board rows (12357, 18237, 12411…) — ab ye sirf tab dikhta hai jab user ne saari trains maangi hon.</p>
    </div>
  </div>

  <h2>3 · Exact rule (jaisa lagaya gaya hai)</h2>
  <table class="checks">
    <tr><th>Sawaal</th><th>Nateeja</th></tr>
    <tr><td>message me train number (jaise <code>12013 …</code>, <code>12013 aur 22487</code>)</td><td>block <b>sirf usi/uni trains ka</b> — header "Aapki maangi train (live board)" + halka green pehchaan</td></tr>
    <tr><td>generic (koi number nahi: "seat wali trains batao")</td><td><b>poora board</b> — Round-27/28/29 jaisa exactly</td></tr>
    <tr><td>maangi hui train board me hi nahi (jaise 14610)</td><td>koi block nahi — unrelated trains ki board nahi thopti (chat ka text jawab jaisa hai waisa)</td></tr>
    <tr><td>saal/tareekh/time ke number</td><td>train nahi maane jaate: <code>2026-09-27</code>, <code>27/09/2026</code>, <code>18:01</code>, <code>2026</code> → focus khaali</td></tr>
    <tr><td>har class ka data</td><td>waisa hi — <code>CC AVL 354 ₹675</code> aur <code>EC AVL 23 ₹1,015</code> alag (koi merge/sum nahi); chips tap → usi train/class ka passenger form</td></tr>
  </table>

  <h2>4 · Live proof (deploy <code>0b36c52</code>)</h2>
  <pre>LIVE A (12013 maanga) : blocks=1 · focused=true · head="Aapki maangi train (live board) 12013 · 1 train · 1 me seat"
                        groups=1 · chips=2 · "12013 AMRITSAR SHTABDI · CC AVL 354 ₹675 · EC AVL 23 ₹1,015"
LIVE B (generic)      : blocks=2 · focused=false · head="Seat wali trains (live board) 20 trains · 12 me seat"
                        groups=20 · chips=59
PROBE (local build)   : 12013 → 1 card · generic → 7 trains (mock rows) · 14610 (list me nahi) → koi block nahi</pre>
  <p class="sub">Probe: <code>node tools/probe-live-r30-live.mjs</code> (live) + <code>node tools/probe-live-r30.mjs</code> (local build, deterministic mock).</p>

  <h2>5 · Code touch + na badla</h2>
  <ul>
    <li><b>Touch:</b> <code>src/chatText.ts</code> (naye pure helpers <code>trainNumbersInText()</code> + <code>focusSeatRows()</code>) · <code>src/views/Concierge.tsx</code> (block ko message ke number(s) par scope karna + header) · <code>src/ai/orchestrate.ts</code> (block me <code>focus?</code> field) · <code>src/styles.css</code> (focused pehchaan) · Round-29 ka booking auto-advance bhi wahi helper use karta hai (saal "2026" ko train nahi samajhta).</li>
    <li><b>Na badla:</b> AI/agentic logic, tools, provider calls, seat-search backend, fares/availability ka source, booking engine, IRCTC handoff, Android app. Server ka seatFilter payload jaisa tha waisa hi aata hai — sirf display scope hota hai.</li>
    <li><b>Tests:</b> naya <code>tests/round30-focused-train-seat-block.test.tsx</code> (11) → <b>109 files / 1103 tests PASS</b>; server tsc clean · client 67 (baseline).</li>
  </ul>

  <p class="sub" style="margin-top:26px">Screenshots: <code>RailBook/previews/round30-live-focused.png</code>, <code>round30-live-generic.png</code>, <code>round30-focus-block.png</code>, <code>round30-full-board.png</code> · ye preview: <code>node tools/build-round30-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
