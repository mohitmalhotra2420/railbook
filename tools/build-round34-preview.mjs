/* Round-34 preview (26 Sep 2026) — user ke do screenshots + ek sawaal:
 *   1) Seat list pehle hi dikhi thi, phir "Book 12380" par AI ne passengers dobara poochh liye
 *      ("eske pass seats to pehle hi hain to fir kyu dubara pooch rha, kya AI apna brain use nhi kar raha?")
 *   2) "Agla kadam na humesha AI hi chunne sabh sochke and suggestions bhi de user ko, agla kadam
 *      fallback pe verified data se mat aaye"
 *   3) "kya tumne AI logic yan AI pehle jaise tools use karta tha usmein kuch changes krein kya?"
 *   node tools/build-round34-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round34-2026-09-26.html";
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
<title>RailBook — Round 34 (26 Sep 2026)</title>
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
  <h1>RailBook · Round 34 — "seats to pehle hi hain… aur agla kadam hamesha AI chune"</h1>
  <p class="sub">26 Sep 2026 · fix <code>a1aff0d</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye (app live web URL load karta hai)</p>

  <div class="q">User: <i>"First screenshot mein 12380 mein seats available hai and then I said book 12380 to eske pass seats to pehle hi hain to fir kyu dubara pooch rha kya AI apna brain use nhi kar raha ? And Agla kadam na humesha AI hi chunne sabh sochke and suggestions bhi de user ko, agla kadam fallback pe verified data se mat aaye"</i></div>

  <h2>1 · Kya toota tha aur kya theek hua</h2>
  <table class="checks">
    <tr><th>Problem (root cause)</th><th>Fix (live proof)</th></tr>
    <tr><td><b>"Book 12380"</b> booking hukm hi nahi maana gaya — purana regex sirf <code>book … kar/krdo/karo</code> pakadta tha; isliye message server ko gaya, model ne resolve+seat-check kiya aur pax gate ne <i>"kitne passengers hain?"</i> poochh liya (jabki seats us chat me pehle hi dikh chuki thi).</td><td>Bare hukm bhi pakda jaata hai: <code>book|booking|reserve</code> + 4–5 digit train number (aage/peeche, bina <code>?</code>) → booking intent. Train number ke bina akele "book" par trigger nahi.</td></tr>
    <tr><td>Seat rows sirf usi turn me zinda thi — agle turn par form ke liye data khaali.</td><td>Client <b>pichhle seat turn ki rows yaad</b> rakhta hai (route+date ke saath) — form usi asli data se bharta hai (status/seats/fare/timing). Route/date na mile to purani rows use nahi hoti.</td></tr>
    <tr><td>Model ne <code>[NEXT]</code> na diya to agla kadam <b>data se</b> banta tha ("verified data se" tag).</td><td>Ab ek chhoti <b>NEXT-repair call</b> model ko hi jaati hai ("sirf 1–2 line: [NEXT] … , isi turn ke tool results se") — chips model ke hote hain. Prompt rule 26 bhi sakht: data ho to <code>[NEXT]</code> ZAROOR; data-fallback sirf aakhri upay.</td></tr>
    <tr><td>Passenger form khula hone par koi bhi naya sawaal client ke local booking path me chala jaata tha ("Nahi, seat availability ki jankari mere paas nahi hai").</td><td>Local path ab sirf booking ki baaton ka (confirm / aage / back / details) — train number ya seat/fare/time/status wala <b>naya sawaal hamesha model ke paas</b> (user ka standing rule).</td></tr>
  </table>

  <h2>2 · Live proof (railbook-gegs.onrender.com @ a1aff0d, asli model + asli data)</h2>
  <div class="grid3">
    <div class="figbox"><img src="${img("round34-live-seat-list.png")}" alt="seat list" /><div class="cap">1 · Seat wali trains (20 trains · 12 me seat) + <b>Agla kadam · "AI ne chuna"</b></div></div>
    <div class="figbox"><img src="${img("round34-live-book-known-seats.png")}" alt="book known seats" /><div class="cap">2 · <b>"Book 12053"</b> → seedha passenger form: 12053 · 2S · LDH → ASR · 📅 2026-09-28 · 🕑 19:48 → 💰 ₹110/pax — <b>koi pax sawaal nahi</b></div></div>
    <div class="figbox"><img src="${img("round34-live-next-from-model.png")}" alt="ask while form open" /><div class="cap">3 · Form khula hone par bhi "12013 ki seat availability" → <b>model ka jawab</b>: CC AVL 650 ₹675 · EC AVL 32 ₹1,015</div></div>
  </div>
  <pre>LIVE probe (tools/probe-live-r34-live.mjs)
  A) "kal ke liye ludhiana se amritsar seat wali trains"   → seat board · next tag = "AI ne chuna"
  B) "Book 12053" (bare hukm, pichhle seat data wali train) → passengers-overlay: 12053 · 2S · LDH→ASR
                                                              2026-09-28 · 🕑 19:48 · 💰 ₹110/pax · paxAsk=false
  C) form khula hone par "12013 ki seat availability batao" → model ka jawab (CC AVL 650 ₹675 · EC AVL 32 ₹1,015)
  NEXT tags → model: 4  ·  data-fallback: 0   (agla kadam har turn MODEL ka)</pre>

  <h2>3 · Aapke sawaal ka seedha jawab — "AI logic / tools calling / thinking me kuch change kiya?"</h2>
  <div class="card">
    <p><b>Nahi badla:</b> model wahi hai (<code>meta/muse-glimmer-30b</code> via NVIDIA), tool list wahi (23 tools), execution path wahi (model tool chunta hai → server allowlist + zod se chalata hai, keys model ke paas nahi), booking safety wahi (<code>confirmBook</code> server par hamesha false; model ke paas booking/payment tool nahi), aur Round-32 ka model-NEXT mechanism wahi.</p>
    <p><b>Badla (is round me):</b> (1) client ka booking-intent detection (UI-level), (2) client ki seat-rows memory (UI-level), (3) <b>prompt rules</b> — Round-33 me rules 27/28 add hue (saare tools khule; sawaal ka matlab pehle) aur Round-34 me rule 26 sakht hua (data ho to [NEXT] ZAROOR), (4) <b>tool preconditions</b> — pax-requirement sirf un tools par jo sach me party-size par depend karte hain (SEARCH_TRAINS jaise list tools se hata), (5) provider chain ka <b>data source order</b> (aap ke aadesh par: confirmtkt → railyatri → erail).</p>
  </div>

  <h2>4 · Tests + kya nahi badla</h2>
  <p><span class="pill">tests</span> naya <code>tests/round34-book-known-seats-and-model-next.test.tsx</code> (16) + mock-model call-count update → <b>113 files / 1185 ALL PASS</b> · server tsc clean · client 69 (baseline) · build <code>${js.file}</code> ${(js.bytes / 1024).toFixed(1)} kB.</p>
  <ul>
    <li>Booking flow, passenger form, IRCTC handoff — waisa hi; "Continue to IRCTC" click aur passenger form AI kabhi khud nahi karta.</li>
    <li>Kuch bhi fake nahi — jo provider ne diya wahi form/status/fare me jaata hai; na mile to honest UNKNOWN/fresh-check.</li>
    <li>Round-32 ka evidence-filter + Round-33 ka provider order jaisa tha waisa.</li>
    <li>Android app: koi native change nahi → <b>naya APK nahi</b>.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Screenshots: <code>RailBook/previews/round34-live-*.png</code> · probe: <code>tools/probe-live-r34-live.mjs</code> · ye preview: <code>node tools/build-round34-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
