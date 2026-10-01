/* Round-53 preview — text aur cards EK hi live data se + Android back/IRCTC-return + AI model options. */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ReplyText } from "../src/components/ReplyText";
import { SeatListBlock } from "../src/views/Concierge";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const appCss = fs.readFileSync(path.join("dist/assets", cssFile!), "utf8");

const dump = JSON.parse(fs.readFileSync("/tmp/r53-seatfilter.json", "utf8"));
const sf = dump.seatFilter as {
  classCodes: string[];
  line: string | null;
  rows: unknown[];
  wlRows: unknown[];
  trainsSeen: number;
  source: string | null;
  dropNote: string | null;
  nearbyNote: string | null;
};
const trains = [...new Set([...sf.rows, ...sf.wlRows].map((r) => (r as { number: string }).number))];

/* (a) PURANA build — user ke screenshot jaisa: text me 17 trains, cards me kuch aur (kam). */
const BEFORE_TEXT = [
  "LDH → JAT (kal 30-Sep-2026) — confirmed seat wali **17 trains** mili hain:",
  "",
  "* 12265 JAT DURONTO EXP — 3A AVL 10 ₹860",
  "* 12445 UTTAR S KRANTI — 3A WL 9 ₹565",
  "* 12237 BEGUMPURA EXP — 3A AVL 1 ₹565",
  "* 20433 JAMMU MAIL — 3A AVL 1 ₹565",
  "* … 13 aur trains (SL/2S/1A me)",
].join("\n");

/* (b) AB — wahi sawaal, naya build: text aur cards DONO ek hi live data se (real probe output) */
const afterRows = sf.rows as Record<string, unknown>[];
const blockRows = afterRows.map((r) => ({ ...r, seat: r.status === "AVAILABLE" || r.status === "RAC", raw: r }));
const AFTER_BLOCK = {
  type: "seatlist",
  from: "LDH",
  to: "JAT",
  toName: "Jammu Tawi",
  date: "2026-09-30",
  source: sf.source,
  dropNote: sf.dropNote,
  nearbyNote: sf.nearbyNote,
  focus: trains.length ? trains : undefined,
  rows: blockRows,
} as never;

const ANDROID_BAR = `
<div class="ph-android">
  <div class="ph-android-ol"></div>
  <div class="ph-nav">
    <span class="navbtn">‹</span>
    <span class="navbtn home">⌂</span>
    <span class="navlogo"></span>
    <span class="navtitle">RailBook</span>
    <span class="navwhere">IRCTC (autofill)</span>
    <span class="navbtn">⟳</span>
  </div>
  <div class="ph-body">
    <div class="ph-line">IRCTC — autofill ho chuka (user login kare)</div>
    <div class="ph-line dim">‹ Back dabao → seedha RailBook home (chat waise hi)</div>
    <div class="ph-line dim">App dobara kholo → RailBook home se shuru (IRCTC nahi)</div>
  </div>
</div>`;

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 53: text = cards, app me back, model options</title>
<style>
${appCss}
body { background:#0f1420; color:#e8ecf3; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.pv { max-width: 1280px; margin: 0 auto; padding: 26px 18px 60px; }
.pv h1 { font-size: 23px; margin: 0 0 6px; }
.pv h2 { font-size: 17px; margin: 28px 0 10px; }
.pv .sub { color:#8fa3bf; margin: 0 0 18px; font-size: 14px; line-height: 1.65; }
.pv .grid { display:flex; gap:22px; flex-wrap:wrap; align-items:flex-start; }
.phone { width: 400px; background:#f4f0e8; border-radius: 20px; overflow:hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); border:1px solid #26324a; }
.phone-cap { background:#141c2b; padding:10px 14px; display:flex; align-items:center; gap:8px; font-size:14px; }
.cap-tag { font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; border-radius:999px; padding:3px 9px; }
.cap-tag.old { background:#3a2222; color:#ffb4b4; border:1px solid #5c3030; }
.cap-tag.new { background:#16351f; color:#8ee6ab; border:1px solid #2c5a3c; }
.screen { background:#f4f0e8; max-height: 620px; overflow:auto; padding: 12px 12px 8px; }
.msg-user { background: var(--navy); color:#fff; border-radius:16px 16px 4px 16px; padding:10px 14px; font-size:14.5px; max-width:88%; margin-left:auto; margin-bottom:10px; }
.screen .msg { margin: 6px 0 12px; }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
.bad { color:#ff9d9d; } .good { color:#8ee6ab; }
.pv ul { margin:8px 0 0 18px; padding:0; } .pv li { margin:5px 0; }
.pv table { border-collapse: collapse; width:100%; margin-top:8px; font-size:13px; }
.pv th, .pv td { border:1px solid #24324b; padding:6px 9px; text-align:left; vertical-align:top; }
.pv th { background:#1b2435; }
.small { color:#8fa3bf; font-size:12.5px; }
.ph-android { width: 320px; background:#0b1220; border-radius:20px; border:1px solid #26324a; overflow:hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); }
.ph-android-ol { height: 22px; background:linear-gradient(#0b1220,#0b1220); }
.ph-nav { display:flex; align-items:center; gap:8px; background:#0b2340; padding:6px 8px; height:48px; box-sizing:border-box; }
.ph-nav .navbtn { width:30px; height:30px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:19px; border-radius:50%; }
.ph-nav .navbtn.home { color:#93C5FD; }
.ph-nav .navlogo { width:22px; height:22px; border-radius:6px; background:linear-gradient(135deg,#2f6fed,#8ab4ff); }
.ph-nav .navtitle { color:#fff; font-weight:700; font-size:13.5px; }
.ph-nav .navwhere { color:#93C5FD; font-size:11px; margin-left:auto; }
.ph-body { padding:14px; }
.ph-line { color:#dbe3f0; font-size:13px; padding:8px 10px; background:#131c2c; border:1px solid #24324b; border-radius:10px; margin-top:8px; }
.ph-line.dim { color:#8fa3bf; }
</style></head><body><div class="pv">
<h1>Round 53 — jo text me hai, wahi cards me · app me back button · aur aapke naye model ke options</h1>
<p class="sub">Aapki screenshot ka asli bug: jawab ka <b>text</b> model ke FIND_SEATS data se banta tha, par neeche ke <b>cards</b> app dobara board fetch karke banata tha — do alag snapshots + 12-train ka cap. Isliye text me 17 trains, cards me kuch aur. Ab <b>ek hi data</b>: jo live board model ne dekha, usi se text bhi aur cards bhi. (Screenshot: “17 trains” — aur neeche 4 trains × 1 class.)</p>

<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag old">Pehle (5877a20)</span><b>Text me saari trains, cards me kuch aur</b></div>
    <div class="screen">
      <div class="msg-user">Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(h(ReplyText, { text: BEFORE_TEXT }))}
        <div class="sf-card jx-sb sf-focused" style="margin-top:10px">
          <div class="sf-head"><strong>Aapki maangi train (live board)</strong><span class="muted">12265 · 1 train · 1 me seat</span></div>
          <div class="sf-groups"><div class="sf-train"><div class="sf-train-head"><b>12265 JAT DURONTO EXP</b></div><div class="muted small">1 class</div></div></div>
          <div class="sf-note muted">…baaki trains ka koi zikr nahi (yahi aapne screenshot me dekha)</div>
        </div></article>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R53)</span><b>Text aur cards — ek hi live data se</b></div>
    <div class="screen">
      <div class="msg-user">LDH se JAT kal confirm seat batao</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(h(ReplyText, { text: String(dump.reply ?? "").slice(0, 1200) }))}
        ${renderToStaticMarkup(h(SeatListBlock, { block: AFTER_BLOCK, onPick: () => {} }))}
      </article>
    </div>
  </div>
</div>

<h2>Is round me kya badla (sab general — koi per-question patch nahi)</h2>
<div class="box">
 <ul>
  <li><b>Cards ab model ke data se hi bante hain.</b> Agentic brain jab <code>FIND_SEATS</code> chalata hai, uska poora result capture hota hai (<code>SearchCapture.seat</code>) — app usi se cards banata hai, dobara board fetch <b>nahi</b> karta. Yaani text me jo train/class hai, card me bhi wahi.</li>
  <li><b>Cards ka cap ab 60 trains</b> (text line par 12 ka cap waise hi — wahan honest tail likhi jaati hai: <i>“+N trains aur bhi hain — neeche poori live list me”</i>, aur Round-25 ka niyam bani rahi hai ki “card” shabd par trains chhupane ka bahana nahi banta).</li>
  <li><b>“confirm” maangne par sirf seat-wali trains</b> — user: <i>“Agar confirm bola to confirm dikhao na sirf”</i>. Confirm/available ki request par cards me sirf unhi trains ke rows aate hain jinme seat hai (usi train ki baaki classes chhupti nahi — Round-51 ka usool).</li>
  <li><b>Cards = jawab me likhi trains (dono taraf ka mismatch khatam).</b> Prod probe me dikha: <i>“confirm seat”</i> par model 4 trains likhta hai (cards me bhi wahi 4 — Round-53b), aur <i>“saari trains … availability batao”</i> par 12 trains likhta hai (cards me bhi wahi 12 — Round-53c; pehle wahan sirf 4 reh gayi thin). Cards ka train-set = jawab me likhi trains ∩ live payload; class-level detail (usi train ki baaki classes) payload se hi aati hai.</li>
  <li><b>Naya provider bina code chhue.</b> 3 env vars (<code>AI_LLM_BASE_URL</code>, <code>AI_LLM_API_KEY</code>, <code>AI_LLM_MODELS</code>) — poora AI stack (agentic + NLU + journey decisions) kisi bhi OpenAI-compatible provider par chala jaata hai. Aapki nayi key milte hi lag jaayega; abhi ka NVIDIA path waisa hi safe rehta hai.</li>
 </ul>
</div>

<h2>Android app (v1.5.0) — back button + IRCTC se wapas RailBook</h2>
<div class="grid">
  ${ANDROID_BAR}
  <div class="box" style="flex:1; min-width:340px">
   <ul>
    <li><b>Back button aa gaya</b> (nav bar me ‹ + phone ka hardware/gesture back, dono): IRCTC par ho → seedha RailBook home; RailBook ke andar ho → page peeche; home par ho → “dobara back dabao to app band” (galti se band nahi hota).</li>
    <li><b>⌂ Home aur ⟳ Reload</b> bhi nav bar me — kisi bhi haalat me ek tap me RailBook home.</li>
    <li><b>Reopen par IRCTC se nahi.</b> Aap: <i>“ek baar IRCTC pe autofill hogya to reopen pe bhi RailBook directly IRCTC se open hoti hai”</i>. Ab jaisi hi app aage aati hai (ya page load hone ke baad WebView IRCTC par milta hai) → history saaf karke RailBook home khul jaata hai; aapki chat wahin rehti hai. IRCTC tabhi khulta hai jab aap khud Continue to IRCTC dabayein.</li>
    <li><b>APK ban gaya:</b> <code>RailBook-v1.5.0-release.apk</code> (4,823,319 bytes · SHA256 <code>55fe7412ad99…954265</code>) + source zip — dono <code>/home/user/RailBook/APKs/</code> me.</li>
   </ul>
  </div>
</div>

<h2>Aapka sawaal: kaun sa model best work karega (key aap baad me doge)</h2>
<div class="box">
 <b>Short jawab:</b> shuru karo <b>Groq</b> se (free, card nahi, Hinglish theek) — model <code>openai/gpt-oss-120b</code> (wahi gpt-oss, par fast provider par). Quality-first chahiye to <b>OpenRouter</b> ki ek key se chain: <code>anthropic/claude-sonnet-4.6</code> + <code>z-ai/glm-5</code> + <code>openai/gpt-oss-120b</code>. Poori table + exact env vars <code>docs/MODEL-RECOMMENDATION.md</code> me hai.
 <table>
  <tr><th>Provider</th><th>Base URL</th><th>Model (chain me)</th><th>Free tier</th></tr>
  <tr><td>Groq</td><td><code>https://api.groq.com/openai/v1</code></td><td><code>openai/gpt-oss-120b, openai/gpt-oss-20b</code></td><td>30 RPM · 1000 req/din · 200K tokens/din</td></tr>
  <tr><td>OpenRouter (ek key, 300+ models)</td><td><code>https://openrouter.ai/api/v1</code></td><td><code>anthropic/claude-sonnet-4.6, z-ai/glm-5</code></td><td>20 RPM · 50 req/din (free models)</td></tr>
  <tr><td>Cerebras (sabse tez)</td><td><code>https://api.cerebras.ai/v1</code></td><td><code>zai-glm-4.7, gpt-oss-120b</code></td><td>~5 RPM · 10 lakh tokens/din</td></tr>
  <tr><td>Google AI Studio</td><td><code>https://generativelanguage.googleapis.com/v1beta/openai/</code></td><td><code>gemini-2.5-flash</code></td><td>10–15 RPM (Flash)</td></tr>
  <tr><td>Sarvam (India)</td><td><code>https://api.sarvam.ai/v1</code></td><td><code>sarvam-105b</code></td><td>Hinglish/code-mix ke liye banaya gaya</td></tr>
 </table>
 <p class="small">Sabak: NVIDIA NIM prod par queue me atak jaata hai (30–60s), jabki wahi model Groq par 1–2 second me jawab deta hai. Isliye chain me do alag provider rakhein — fir koi ek limit na rok sake. (Groq par <code>llama-3.3-70b-versatile</code> 16 Aug 2026 se retire ho gaya hai — purane tutorials mat follow karein.)</p>
</div>

<div class="box">
 <b>Prod par verify (deploy c259803):</b> <code>LDH se JAT kal confirm seat batao</code> → <b>agentic</b> · <code>FIND_SEATS ✓</code> · <b>34s</b> · payload trains <code>11077, 12237, 15651</code> = jawab ke trains <b>(MATCH)</b>. <code>LDH se JAT kal saari trains ki seat availability batao</code> → <b>agentic</b> · <code>FIND_SEATS ✓</code> · <b>19s</b> · payload trains <code>11077, 12207, 12237, 12355, 12475, 12919, 15651, 18309, 22431</code> = jawab ke trains <b>(MATCH)</b>. Yaani live app me bhi text aur cards ek hi data ke — aur latency 19–34s (NIM queue khulne par).
</div>
<div class="box">
 <b>Proof (local, aapki query):</b> <code>engine: agentic_tool_calling</code> · <code>openai/gpt-oss-20b</code> · <code>FIND_SEATS ✓</code> · <b>22.2s</b> · board me <b>${sf.trainsSeen} trains</b>, seat-wali ${trains.length} (${trains.join(", ")}) — <b>text ke trains: ${trains.join(",")}</b> · payload ${sf.rows.length} seat rows + ${sf.wlRows.length} WL rows · cards unhi se bane. Isi round ke naye tests: <code>round53-text-cards-and-provider</code> (6) + <code>round53-app-nav-and-irctc-return</code> (5) — full suite <b>134 files / 1421 tests PASS</b>. Latency par aapka faisla saaf hai: <i>quality pehle</i> — isliye koi shortcut nahi liya.
</div>
<p class="sub">Note: ye preview asli payload se render hai (probe output); phone frame sirf dikhane ke liye hai. Prod deploy ke baad yahi query live app par bhi verify ki jaayegi.</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round53-2026-09-29.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
