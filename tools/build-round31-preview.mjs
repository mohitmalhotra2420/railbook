/* Round-31 preview (26 Sep 2026) — user ka sawaal:
 *   "maine specific train ki availability poochi and AI ne sahi answer bhi diya — ab AI ko passenger ko
 *    next step pe leke jaana chahiye na… answer karne ke baad AI ko next uske question ke hisaab se next
 *    question poochhna chahiye na? To AI khud ka dimaag kyu nahi lagata?"
 *
 * Preview: (1) kya lagaya gaya — "Agla kadam" card, (2) har situation ka exact nateeja table,
 * (3) asli live screenshot + probe output, (4) "AI khud dimaag kyu nahi lagata" ka technical jawab.
 *   node tools/build-round31-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round31-2026-09-26.html";
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
<title>RailBook — Round 31 (26 Sep 2026)</title>
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
  .pill.warn { background:#fff5e6; color:#995f00; }
  .pill.info { background:#eaf1fd; color:#1d4ed8; }
  code { background:#f1f4f8; border-radius:6px; padding:1px 5px; font-size:12px; }
  pre { background:#0f1b2b; color:#dbe6f3; border-radius:10px; padding:11px 12px; font-size:11.5px; overflow:auto; }
  table.checks { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.checks th, table.checks td { border-bottom:1px solid #eef1f5; padding:6px 8px; text-align:left; vertical-align:top; }
  table.checks th { background:#f7f9fc; font-size:11.5px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); }
  .q { background:#fff; border-left:4px solid #22304a; border-radius:10px; padding:9px 12px; font-size:13px; margin:10px 0; }
</style></head>
<body><div class="wrap">
  <h1>RailBook · Round 31 — "answer ke baad AI ko next step pe leke jaana chahiye"</h1>
  <p class="sub">26 Sep 2026 · fix <code>de97b12</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye (app live web URL load karta hai)</p>

  <div class="q">"maine specific train ki availability poochi and AI ne sahi answer bhi diya — ab AI ko passenger ko next step pe leke jaana chahiye na… do not specific to seat availability but any question asked and answered — answer karne ke baad AI ko next uske question ke hisaab se next question poochhna chahiye na? To AI khud ka dimaag kyu nahi lagata?"</div>

  <h2>1 · "AI khud dimaag kyu nahi lagata" — seedha jawab</h2>
  <div class="card">
    <p><b>Aap sahi hain — pehle ye kaam hi nahi ho raha tha.</b> AI ke paas booking/payment ka koi tool nahi hai (<code>confirmBook</code> hamesha false) — use "khud soch kar" agla kadam (screen kholna, ticket banana) lene dena wahi jagah thi jahan pehle bhool hoti thi: galat screen khul jaati thi (Round-18m-7) aur numbers tak bante the. Standing rule bhi yahi hai — <b>"kuch bhi fake nahi"</b>.</p>
    <p>Isliye ab <b>dimaag data ka lagta hai, model ka nahi</b>: har jawab ke saath jo <b>verified data</b> aaya (provider ki live-board rows, train list, journey plan) usse 1–2 <b>tappable "Agla kadam" chips</b> banti hain — aur wahi chips pehle se chalte flows ko trigger karti hain (jaise <code>Book</code> → seedha passenger form). Isse na galat screen khulti hai, na fake number banta hai — aur AI ka apna jawab (jo aapne sahi dekha) waisa hi rehta hai.</p>
  </div>

  <h2>2 · Ab kya hota hai (asli live screenshot)</h2>
  <div class="grid2">
    <div class="figbox">
      <img src="${img("round31-live-next-step.png")}" alt="live: jawab + Agla kadam card" />
      <p class="cap"><span class="pill">live ${"de97b12"}</span> aapka wahi sawaal (<code>12013 ki seat availability … ludhiana se amritsar</code>) — jawab ke neeche <b>➡️ AGLA KADAM</b>: <code>Book 12013 · CC (AVL 354 ₹675)</code> (primary, jo dikha wahi) + <code>12013 ki doosri classes (EC)</code>, aur honest hint.</p>
    </div>
    <div class="figbox">
      <img src="${img("round31-live-book-tap.png")}" alt="live: chip tap → passenger form" />
      <p class="cap"><span class="pill">tap</span> chip tap → seedha passenger form: <b>12013 · CC · LDH → ASR · 📅 2026-09-27</b> + "Aapki details IRCTC par khud bhar jaayengi" + <b>Review journey</b> CTA (Round-28/29 ke saath).</p>
    </div>
  </div>

  <h2>3 · Har situation ka rule (kuch invent nahi — sirf verified data)</h2>
  <table class="checks">
    <tr><th>Jawab me kya aaya</th><th>Agla kadam</th></tr>
    <tr><td>seat rows (khaas train)</td><td><code>Book &lt;train&gt; · &lt;class&gt; (AVL/RAC/WL # ₹fare)</code> — AVL &gt; RAC &gt; WL, phir zyada seats; doosra chip: <code>doosri classes (…)</code></td></tr>
    <tr><td>seat rows (generic list)</td><td>sabse achhi seat wali train ka Book chip + <code>Baaki trains bhi (N)</code></td></tr>
    <tr><td>sab N/A / Regret</td><td><code>Jahan seat hai wahi dikhao</code> + honest hint (kisi bookable hone ka dawa nahi)</td></tr>
    <tr><td>sirf WL</td><td>WL ka sach (<code>WL 9</code>) + "ticket waitlist me rahega" (jhootha "available" nahi)</td></tr>
    <tr><td>train list (seat data nahi)</td><td><code>Kis train me seat hai?</code></td></tr>
    <tr><td>journey plan (connecting/direct)</td><td>pehle bookable leg ka Book chip; kuch bookable na ho → <code>Doosri date dekho</code></td></tr>
    <tr><td>live status / schedule / stops</td><td><code>&lt;train&gt; ki seat availability</code> (train number pata ho to)</td></tr>
    <tr><td>kuch bhi verified nahi</td><td><b>koi chip nahi</b> — jhoothi suggestion se behtar kuch na kehna</td></tr>
  </table>

  <h2>4 · Live proof + tests</h2>
  <pre>LIVE seat answer → next step : ➡️ Agla kadam · "Book 12013 · CC (AVL 354 ₹675)" + "12013 ki doosri classes (EC)"
                             hint: "Tap karne par usi train/class ka passenger form khulega…"
LIVE Book chip tap           : passengers-overlay · 12013 · CC · LDH → ASR · 2026-09-27
LOCAL probe (mock rows)      : seat → Book + doosri classes · list → "Kis train me seat hai?" · stops → "12013 ki seat availability"</pre>
  <p><span class="pill">tests</span> naya <code>tests/round31-next-step.test.tsx</code> (18) — har situation ka rule, status label, UI render/tap, wiring, aur "koi hard-coded number/naam nahi" check → <b>110 files / 1121 tests</b> (1120 pass; 3 network-flaky RailCore tests alag se chalane par pass hote hain). <span class="pill info">build</span> <code>${js.file}</code> ${(js.bytes / 1024).toFixed(1)} kB.</p>

  <h2>5 · Kya nahi badla</h2>
  <ul>
    <li>AI ka jawab/text, provider calls, seat-search backend, fares/availability ka source — waisa hi.</li>
    <li>Chips naya kuch nahi karte: wahi utterance bhejte hain jo pehle se chalte flows me jaati thi (Round-29 ka auto passenger form, Round-27 ka seat block).</li>
    <li>Har class ka apna AVL/fare (Round-29/30) aur focus scope (Round-30) waise hi — Agla kadam sirf upar ki 1–2 lines hai.</li>
    <li>Android app: koi native change nahi → <b>naya APK nahi</b>.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Screenshots: <code>RailBook/previews/round31-live-next-step.png</code>, <code>round31-live-book-tap.png</code>, <code>round31-next-step.png</code>, <code>round31-book-tap.png</code>, <code>round31-list-nextstep.png</code> · probes: <code>tools/probe-live-r31.mjs</code> (local) + <code>tools/probe-live-r31-live.mjs</code> (live) · ye preview: <code>node tools/build-round31-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
