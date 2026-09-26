/* Round-33 preview (26 Sep 2026) — user ke teen screenshots + naye aadesh:
 *   "Kya AI meri baat samajh nhi paaya ... AI ko jitne bhi tools available hai wo sabh provide kro
 *    (no restriction on any tool), bss AI continue to IRCTC pe click nhi karega na hi passenger
 *    details khud se fill krega, don't fake anything sabh real and live data hona chahiye, first use
 *    confirm tkt, then rail yatri, then e rail on API fallback to fetch relevant data, like fare,
 *    seat availability, timings, route, station codes, live status, etc."
 *   node tools/build-round33-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round33-2026-09-26.html";
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
<title>RailBook — Round 33 (26 Sep 2026)</title>
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
  .grid3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:14px; }
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
  <h1>RailBook · Round 33 — "AI ko saare tools khule… aur sawaal ka matlab pehle samjho"</h1>
  <p class="sub">26 Sep 2026 · fix <code>a96ed83</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye (app live web URL load karta hai)</p>

  <div class="q">User: <i>"Kya tum mera ludhiana se ndls ka plan bana sakte ho?"</i> → AI ne trains list kar di (bina fare/timings), phir <i>"Alternative trains bta sakte ho?"</i> → wahi purani list. User: <i>"kya AI meri baat samajh nhi paaya … AI ko jitne bhi tools available hai wo sabh provide kro (no restriction), bss AI continue to IRCTC pe click nhi karega na hi passenger details khud se fill krega, don't fake anything — sab real and live data, first use confirm tkt, then rail yatri, then e rail on API fallback (fare, seat availability, timings, route, station codes, live status…)."</i></div>

  <h2>1 · Kya theek hua (teen shikaayatein)</h2>
  <table class="checks">
    <tr><th>Shikaayat (user screenshot)</th><th>Ab kya hota hai (live proof)</th></tr>
    <tr><td>"trains list krdi <b>without fare and timings</b>"</td><td>Har train list me <b>departure → arrival + duration</b>, aur jahan provider fare deta hai wahan <b>class-wise fare</b> (confirmtkt route board se). Seat cards par bhi <code>🕑 20:19 · 2h 46m</code>.</td></tr>
    <tr><td>"plan banao" poochha, <b>seat board</b> aa gaya</td><td>Ab <b>RANK_JOURNEY_OPTIONS</b> chalta hai: JOURNEY PLAN card — 19 direct, 6 me seat, RECOMMENDED · direct 22478, earlier-stop options, alt dates.</td></tr>
    <tr><td>"alternative trains" poochha, <b>wahi list</b> dobara</td><td>Ab <b>FIND_ALTERNATIVE_TRAINS</b>: "YOU MAY ALSO CONSIDER" — 12484 ASR TVCN 08:12→12:55 (4h 43m) 3A AVL 110 ₹635 · 12716 SACHKHAND 07:45→12:45 3A AVL 47 ₹635 · 11058 3E AVL 29 ₹600 · 12926 1A AVL 1 ₹1,620.</td></tr>
    <tr><td>"Kal,1" ke baad AI ne <b>passengers dobara</b> poochh liye</td><td>Ab <code>Kal,1</code> = 27 Sep + <b>1 passenger</b> — plan card me <code>👥 1 passenger</code> dikhta hai, dobara koi sawaal nahi.</td></tr>
  </table>

  <h2>2 · Tools ki azadi + provider order (jo user ne maanga)</h2>
  <div class="card">
    <p><span class="pill info">rules 27/28</span> Model ko saaf likha jaata hai: <b>saare tools khule hain</b> (koi count-limit nahi) — sirf do cheezein kabhi nahi: <b>"Continue to IRCTC" click</b> aur <b>passenger details khud bharna</b>. Aur "<b>sawaal ka matlab pehle</b>": plan → journey tools, alternative → FIND_ALTERNATIVE_TRAINS, list → timings+fare, seat → seat tools.</p>
    <p><span class="pill">web order</span> Naya pure module <code>server/railway/webOrder.ts</code> — <b>CONFIRMTKT → RAILYATRI → ERAIL</b>, aur har capability ka apna chain: availability (confirmtkt → railyatri → erail fare-only), fare (wahi), <b>trains-between</b> (confirmtkt route board = timings+fare, phir erail IRCTC list), schedule, station codes (erail list), live status (railyatri ETA). Jo site wo cheez deti hi nahi, wo chain me aati hi nahi — koi jhootha attempt ya galat source-naam nahi.</p>
    <p><span class="pill">list tool</span> <code>SEARCH_TRAINS</code> ab passengers ka mohtaaj nahi (list ke liye pax ki zaroorat hi nahi) — pax-precondition sirf seat/plan tools par. Aur agar model ne pax khud samjha (<code>Kal,1</code> → 1) to wo capture hokar yaad rakha jaata hai.</p>
  </div>

  <h2>3 · Live proof (railbook-gegs.onrender.com @ a96ed83, asli model + asli data)</h2>
  <div class="grid3">
    <div class="figbox"><img src="${img("round33-live-plan.png")}" alt="plan" /><div class="cap">"Kal,1" → <b>JOURNEY PLAN</b> card: LDH → NDLS · 27 Sept · <b>1 passenger</b> · 19 direct · 6 me seat · RECOMMENDED direct 22478</div></div>
    <div class="figbox"><img src="${img("round33-live-alternatives.png")}" alt="alternatives" /><div class="cap">"Alternative trains" → <b>YOU MAY ALSO CONSIDER</b> (timings + fares), plus "usi train ki doosri class" + alt-date chips</div></div>
    <div class="figbox"><img src="${img("round33-live-seat-timings.png")}" alt="seat timings" /><div class="cap">Seat answer: har card par <b>🕑 20:19 · 2h 46m</b> (pehle sirf "live board" likha tha)</div></div>
  </div>
  <pre>LIVE /api/agent  "Kal,1"           → tools: RANK_JOURNEY_OPTIONS (ok, source web_confirmtkt) · journey: yes · 19 trains
LIVE /api/agent  "Alternative…"    → tools: FIND_ALTERNATIVE_TRAINS (ok, web_confirmtkt) · alternatives: yes
LIVE browser     "12013 ki seat availability…" → seat card: "12013 AMRITSAR SHTABDI 🕑 20:19 · 2h 46m · 2 classes (2 me seat)"
                 + agla kadam chip (model ka chuna hua — Round-32 wahi raha)</pre>

  <h2>4 · Tests + kya nahi badla</h2>
  <p><span class="pill">tests</span> naya <code>tests/round33-tool-freedom-and-provider-order.test.ts</code> (26) — provider order har capability me, chain loops, board→list mapping (timings/duration/fare/night offset), rules 27/28, pax-seed, timings text — plus 4 purane tests naye rules ke hisaab se update → <b>112 files / 1169 ALL PASS</b> · server tsc clean · client 67 baseline.</p>
  <ul>
    <li>Booking flows, passenger form, IRCTC handoff — <b>waisa hi</b>; AI ab bhi <code>confirmBook=false</code> (server par hamesha false).</li>
    <li>Round-32 ka model-chuna agla kadam (tag "AI ne chuna" / "verified data se") jaisa tha waisa hai.</li>
    <li>Kuch bhi fake nahi: jo provider ne diya wahi dikhta hai; na mile to honest line (koi guess/placeholder nahi).</li>
    <li>Android app: koi native change nahi → <b>naya APK nahi</b>.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Screenshots: <code>RailBook/previews/round33-live-{plan,alternatives,seat-timings}.png</code> · probe: <code>tools/probe-live-r33-live.mjs</code> (live, asli model) · ye preview: <code>node tools/build-round33-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
