/* Round-32 preview (26 Sep 2026) — user ka correction:
 *   "har query pehle model ke pass jaani chahiye and wo decide kare kon sa tool use karna yan kya karna hai,
 *    user ka answer kahan se laana hai."
 *
 * Preview: (1) kya lagaya gaya (model-first agla kadam + evidence filter + data fallback),
 * (2) har situation ka exact nateeja, (3) LIVE proof (asli model `[NEXT]` + tag "AI ne chuna"),
 * (4) Round-32b — live par pakda gaya number conflict aur uska fix, (5) kya nahi badla.
 *   node tools/build-round32-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round32-2026-09-26.html";
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
<title>RailBook — Round 32 (26 Sep 2026)</title>
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
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:14px; }
  .figbox { background:#fff; border:1px solid var(--line); border-radius:14px; padding:10px; }
  .figbox img { width:100%; border-radius:10px; display:block; border:1px solid #eef1f5; }
  .cap { font-size:11.5px; color:var(--muted); margin:7px 2px 0; }
  .pill { display:inline-block; font-size:11px; font-weight:700; border-radius:999px; padding:3px 9px; background:#eef6f1; color:var(--green); margin-right:6px; }
  .pill.warn { background:#fff5e6; color:#995f00; }
  .pill.info { background:#eaf1fd; color:#1d4ed8; }
  .pill.bad { background:#fdecea; color:var(--red); }
  code { background:#f1f4f8; border-radius:6px; padding:1px 5px; font-size:12px; }
  pre { background:#0f1b2b; color:#dbe6f3; border-radius:10px; padding:11px 12px; font-size:11.5px; overflow:auto; }
  table.checks { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.checks th, table.checks td { border-bottom:1px solid #eef1f5; padding:6px 8px; text-align:left; vertical-align:top; }
  table.checks th { background:#f7f9fc; font-size:11.5px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); }
  .q { background:#fff; border-left:4px solid #22304a; border-radius:10px; padding:9px 12px; font-size:13px; margin:10px 0; }
  .tag { display:inline-block; font-size:11px; font-weight:700; border-radius:999px; padding:2px 8px; margin-left:6px; }
  .tag.model { background:#eaf1fd; color:#1d4ed8; }
  .tag.data { background:#eef6f1; color:var(--green); }
</style></head>
<body><div class="wrap">
  <h1>RailBook · Round 32 — "har query pehle model ke pass jaani chahiye… agla kadam bhi model chune"</h1>
  <p class="sub">26 Sep 2026 · fix <code>dc257a0</code> (LIVE) · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · naya APK nahi chahiye (app live web URL load karta hai)</p>

  <div class="q">User: <i>"har query pehle model ke pass jaani chahiye and wo decide kare kon sa tool use karna yan kya karna hai, user ka answer kahan se laana hai"</i> — matlab agla kadam bhi model chalaye; data sirf <b>validate</b> kare aur <b>fallback</b> de. (Round-31 me agla kadam data se banta tha — wahi user ne reject kiya: "dimaag data ka lagta hai, model ka nahi".)</div>

  <h2>1 · Kya lagaya gaya</h2>
  <div class="card">
    <p><span class="pill info">model-first</span> <b>Pehle verify kiya:</b> har query pehle se hi model ke paas jaati hai (client sirf 3 local exception — booking flow, class pick, chhota UI sawaal) aur server par <b>model tool chunta hai</b>; deterministic routing sirf fallback, booking mutations deterministic, model ke paas booking tool nahi (<code>confirmBook</code> hamesha false).</p>
    <p><span class="pill">rule 26</span> Prompt me: jawab ke aakhir me <code>[NEXT] &lt;label&gt; =&gt; &lt;utterance&gt;</code> (max 2, <b>sirf isi turn ke tool data se</b>, kuch verified na ho to koi line nahi). Rule 13 update: generic "aur kuch chahiye?" band, par asli agla kadam hamesha.</p>
    <p><span class="pill">server</span> <code>extractNextActions()</code> uun lines ko reply se <b>alag</b> karta hai, phir har action <code>groundingCheck(label + utterance)</code> se guzarta hai — jo number/naam/code is turn ke tool evidence me nahi, wo <b>drop</b>.</p>
    <p><span class="pill">client</span> Model ke chips pehle → tag <span class="tag model">AI ne chuna</span>. Nahi mile → Round-31 ka data-derived fallback → tag <span class="tag data">verified data se</span>. Kuch bhi verified na ho → <b>koi card nahi</b>.</p>
  </div>

  <h2>2 · Har situation ka nateeja</h2>
  <table class="checks">
    <tr><th>Situation</th><th>Screen par kya</th></tr>
    <tr><td>model ne <code>[NEXT]</code> diya, sab evidence me match</td><td>chips bilkul model ke + tag <span class="tag model">AI ne chuna</span></td></tr>
    <tr><td>model ke <code>[NEXT]</code> me koi cheez is turn ke data me nahi</td><td>wo line drop → data fallback (tag "verified data se")</td></tr>
    <tr><td>model ne <code>[NEXT]</code> nahi diya (ya clarifying sawaal poochha)</td><td>data fallback (Round-31) — jawab ke saath agla kadam phir bhi milta hai</td></tr>
    <tr><td>chip ke numbers board se takra rahe hain</td><td>action model ka hi, sirf takraate numbers hat gaye</td></tr>
    <tr><td>kuch bhi verified nahi</td><td><b>koi card nahi</b> — jhoothi suggestion se behtar kuch na kehna</td></tr>
    <tr><td>chip tap</td><td>wahi utterance → Round-29 ka auto-advance → <b>seedha passenger form</b></td></tr>
  </table>

  <h2>3 · Round-32b — live par pakda gaya number conflict (fix)</h2>
  <div class="card">
    <p><span class="pill bad">pehle (ff7bda0)</span> Asli model ke tool ne ek provider se data liya (<code>CHECK_AVAILABILITY → web_railyatri</code>: <code>CC AVL 334 ₹490</code>), par screen ka live board doosre provider se bana (<code>web_confirmtkt</code>: <code>CC AVL 341 ₹675</code>). Dono asli — par <b>ek hi screen par same train+class ke do alag number</b>. Standing rule: kuch bhi conflicting/fake nahi.</p>
    <p><span class="pill">fix (dc257a0)</span> Naya pure <code>reconcileNextActions(actions, boardRows)</code> (agentic.ts → app.ts): model ka <b>chuna hua action waise hi</b> rehta hai, sirf wo <b>seat/fare numbers</b> chip se hat jaate hain jo usi train+class ke board rows se na milte hon. Train number kabhi nahi hatta · jargon-only chip drop · board me na ho to kuch nahi chhedte · generic count (<code>Baaki trains bhi (24)</code>) conflict nahi maana jaata.</p>
    <pre>LIVE (dc257a0)  board row: 12013 CC AVL 334 ₹675 (confirmtkt)   model chip: "Book 12013 · CC (AVL 334 ₹490)"
                → chip ban gaya: "Book 12013 · CC (AVL 334)"   (₹490 sirf isliye hata kyunki board ₹675 keh raha tha)</pre>
    <p class="sub">Note: AI ke <b>jawab ke text</b> me uske tool ka fare (₹490, "Source: railyatri.in — railway API down tha") rehta hai — ye do provider ka farq hai aur text me source saaf likha hota hai; board card apna source (confirmtkt) dikhata hai. Koi number banaya nahi gaya hai.</p>
  </div>

  <h2>4 · Live proof (asli model, asli data)</h2>
  <div class="grid2">
    <div class="figbox"><img src="${img("round32-live-model-chips.png")}" alt="live model chips" /><div class="cap">A · asli model ka <code>[NEXT]</code> → tag <b>"AI ne chuna"</b> + chip <code>Book 12013 · CC (AVL 334)</code> (board se match, takraata fare hat gaya)</div></div>
    <div class="figbox"><img src="${img("round32-live-chip-tap.png")}" alt="live chip tap" /><div class="cap">B · chip tap → seedha passenger form (12013 · CC · LDH → ASR · 2026-09-27)</div></div>
    <div class="figbox"><img src="${img("round32-live-data-fallback.png")}" alt="live data fallback" /><div class="cap">C · "12013 ka schedule batao" (model ne NEXT nahi diya) → tag <b>"verified data se"</b>, chip <code>12013 ki seat availability</code></div></div>
    <div class="figbox"><img src="${img("round32-live-plain.png")}" alt="live no card" /><div class="cap">D · suvidha wala sawaal — koi train-specific data nahi → <b>koi card nahi</b></div></div>
    <div class="figbox"><img src="${img("round32-dropped-fallback.png")}" alt="ungrounded drop" /><div class="cap">Local (mock) · ungrounded <code>[NEXT]</code> drop → data fallback chips</div></div>
    <div class="figbox"><img src="${img("round32-train-hint.png")}" alt="train hint chip" /><div class="cap">Local (mock) · user ne khud train poochhi → usi train ka honest chip (invent kuch nahi)</div></div>
  </div>
  <pre>LIVE /api/agent  "12013 ki seat availability batao kal ke liye ludhiana se amritsar, 1 passenger"
  engine=agentic_tool_calling  model=meta/muse-glimmer-30b  grounded=true
  nextActions=[{label:"Book 12013 · CC (AVL 334)", utterance:"12013 mein CC book krdo", primary:true}]

LIVE browser probe  A tag "AI ne chuna" ✓ · B chip tap → passengers-overlay ✓
                    C deterministic turn → data fallback "verified data se" ✓ · D no card ✓
LOCAL probe (built dist + mock)  6/6 PASS  (model · chip tap · ungrounded drop · list · plain · train hint)</pre>

  <h2>5 · Tests + kya nahi badla</h2>
  <p><span class="pill">tests</span> naya <code>tests/round32-model-next-step.test.ts</code> (22 = 14 Round-32 + 8 Round-32b: prompt rules, extraction, evidence drop, reconcile ka har rule, wiring run → app → client) + round-31 test update → <b>111 files / 1143 ALL PASS</b> · server tsc clean · client 67 (baseline).</p>
  <ul>
    <li>AI ka jawab/text, provider calls, seat-search way, alternatives/connecting logic — waisa hi (sirf agla-kadam ka faisla model ka, aur uska evidence-check naya).</li>
    <li>Chips naya kuch nahi karte: wahi utterance bhejte hain jo pehle se chalte flows me jaati thi.</li>
    <li>Round-29 grouping/auto-advance aur Round-30 focus scope jaisa hi — Round-32 uske upar sirf 1–2 line ka card hai.</li>
    <li>Android app: koi native change nahi → <b>naya APK nahi</b>.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Screenshots: <code>RailBook/previews/round32-live-*.png</code> + <code>round32-*.png</code> · probes: <code>tools/probe-live-r32.mjs</code> (local) + <code>tools/probe-live-r32-live.mjs</code> (live) · ye preview: <code>node tools/build-round32-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
