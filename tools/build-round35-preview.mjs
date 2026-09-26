/* Round-34 preview (26 Sep 2026) — user ke do screenshots + ek sawaal:
 *   1) Seat list pehle hi dikhi thi, phir "Book 12380" par AI ne passengers dobara poochh liye
 *      ("eske pass seats to pehle hi hain to fir kyu dubara pooch rha, kya AI apna brain use nhi kar raha?")
 *   2) "Agla kadam na humesha AI hi chunne sabh sochke and suggestions bhi de user ko, agla kadam
 *      fallback pe verified data se mat aaye"
 *   3) "kya tumne AI logic yan AI pehle jaise tools use karta tha usmein kuch changes krein kya?"
 *   node tools/build-round35-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round35-2026-09-26.html";
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
<title>RailBook — Round 35 (26 Sep 2026)</title>
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
  <h1>RailBook · Round 35 — "class khuli hain to AI khud poochhe: kaunsi class me book karun?"</h1>
  <p class="sub">26 Sep 2026 · fix <code>b97b3c7</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye (app live web URL load karta hai)</p>

  <div class="q">User: <i>"mainay bola vaishno devi se ludhiana ki seat availability btao to AI ne bta di … uske baad maine 19028 train mein na multiple class mein seats available thi to maine bola '19028 mein book krdo' to AI ne yeh nhi poocha kon si class mein book krun … AI khud kyu nhi soch rha kya sahi logic se poochhna chahiye, khud kyu nhi dimag laga raha wo, har cheez thodi btani padegi usee."</i></div>

  <h2>1 · Kya toota tha</h2>
  <div class="card">
    <p><b>Root cause:</b> booking hukm par client chup-chaap us train ki <b>pehli openable row</b> utha kar passenger form khol deta tha. Us train me 3–5 classes khuli ho (jaise 19028) to AI ka <b>koi sawaal hi nahi</b> aata tha — user ko andaza bhi na chalta ki konsi class khul gayi. (Aur list me SL/WL row pehle hoti to WL ka form khul sakta tha.)</p>
  </div>

  <h2>2 · Fix — AI khud poochhta hai (live proof: <code>b97b3c7</code>, asli model + asli data)</h2>
  <div class="grid3">
    <div class="figbox"><img src="${img("round35-live-class-choice.png")}" alt="class choice" /><div class="cap"><b>"Book 13042"</b> (2 classes khuli) → form RUK gaya; model ne khud poochha <i>"Class confirm karo — kaunsi class chahiye?"</i> + card <b>🪑 13042 — kaunsi class me book karun?</b> chips <b>3A · AVAILABLE 29 · ₹520</b> / <b>2A · AVAILABLE 7 · ₹725</b></div></div>
    <div class="figbox"><img src="${img("round35-live-class-picked.png")}" alt="class picked" /><div class="cap">Chip tap → passenger form <b>13042 HIMGIRI EXPRESS · 3A · SVDK → LDH · 📅 2026-09-28 · 💰 ₹520 per passenger</b> — jo chip par dikha, wahi form me gaya</div></div>
  </div>
  <pre>LIVE probe (tools/probe-live-r35-live.mjs) — user ka exact route
  1) "vaishno devi se ludhiana kal ki seat availability batao"  → seat board (18 trains · 12 me seat)
  2) "Book 13042"  (us board se — 3A + 2A dono me seat khuli)   → form RUK gaya, class-choice card
       reply: "13042 HIMGIRI EXPRESS me 2 classes khuli hain — 3A (AVAILABLE 29), 2A (AVAILABLE 7).
               Kaunsi class me book karun? Neeche chip par tap karo."
  3) chip "3A · AVAILABLE 29 · ₹520" tap                        → passenger form: 13042 · 3A · SVDK→LDH
                                                                  2026-09-28 · ₹520/pax</pre>

  <h2>3 · Niyam jo ab lagte hain</h2>
  <table class="checks">
    <tr><th>Halaat</th><th>AI ka behaviour</th></tr>
    <tr><td>Booking maangi, <b>class nahi boli</b>, train me <b>2+ classes khuli</b> (AVL/RAC)</td><td>Pehle <b>poochho</b> — card ke chips sirf un classes ke jo board par sach me khuli hain (status · seats · fare ke saath). Chip tap → seedha us class ka form.</td></tr>
    <tr><td>Booking maangi, class nahi boli, <b>ek hi class khuli</b></td><td>Poochhne ki zaroorat nahi — seedha wahi class (faltu sawaal nahi).</td></tr>
    <tr><td>User ne khud <b>class boli</b> ("19028 mein 2A book krdo")</td><td>Koi sawaal nahi — seedha usi class ka form (user ki marzi chalti hai).</td></tr>
    <tr><td>Class nahi boli aur <b>koi class khuli hi nahi</b></td><td>WL/openable row par form (purana honest behaviour) — lekin <b>N/A/Regret</b> wali class kabhi nahi chunti.</td></tr>
  </table>

  <h2>4 · Kya badla, kya nahi</h2>
  <div class="card">
    <p><span class="pill info">naya</span> Block type <code>classchoice</code> (client UI) · class-choice gate (2+ seat-wali class par form hold) · <code>pickRowForBooking</code> ab <b>seat-wali class prefer</b> karta hai (WL se pehle) · model ko rule 28 me sikhaya: class ambiguous par <b>khud poochho</b> aur <code>[NEXT]</code> me class chips do (live me model ne khud bhi poochha).</p>
    <p><span class="pill">nahi badla</span> Model, tool list (23), execution path (model tool chunta hai → server allowlist+zod), booking safety (<code>confirmBook</code> hamesha false), provider order (confirmtkt → railyatri → erail), koi bhi data invent nahi — chips me wahi status/seats/fare jo provider ne diya.</p>
  </div>

  <h2>5 · Tests</h2>
  <p><span class="pill">tests</span> naya <code>tests/round35-ask-class-when-ambiguous.test.tsx</code> (15) → <b>114 files / 1200 ALL PASS</b> · server tsc clean · client 69 (baseline) · build <code>${js.file}</code> ${(js.bytes / 1024).toFixed(1)} kB · Android change nahi → <b>naya APK nahi</b>.</p>

  <p class="sub" style="margin-top:26px">Screenshots: <code>RailBook/previews/round35-live-{class-choice,class-picked}.png</code> · probe: <code>tools/probe-live-r35-live.mjs</code> · ye preview: <code>node tools/build-round35-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
