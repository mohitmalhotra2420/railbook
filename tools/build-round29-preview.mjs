/* Round-29 preview (26 Sep 2026) — user ke 2 screenshots + 4 points:
 *   1) same train ki classes alag alag cards me (22432 ×2, 19804 ×2) → ab ek train = ek card
 *   2) class tappable → seedha passenger form
 *   3) "22432 mein 3A book krdo" → AI khud passenger form kholta (train+class+timings/fare pehle se)
 *   4) "vaishno devi" (chhota naam) → SVDK
 *
 * Sab kuch asli cheezon se: grouped card asli ReplyText component se (vite SSR + asli built CSS),
 * probe proofs asli browser run (tools/probe-live-r29.mjs) se, aur user ke screenshots workspace se.
 *
 *   node tools/build-round29-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round29-2026-09-26.html";
const PRE = "/home/user/RailBook/previews";
const UPLOADS = "/home/user/uploads";

const css = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".css"));
  return fs.readFileSync(path.join(dir, f), "utf8");
})();
const js = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".js"));
  return { file: f, bytes: fs.statSync(path.join(dir, f)).size };
})();

const b64 = (p) => `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
const img = (p) => (fs.existsSync(p) ? b64(p) : "");

const shotBefore = img(path.join(UPLOADS, "Screenshot_20260926-163335_RailBook.png"));
const shotGroups = img(path.join(PRE, "round29-chat-groups.png"));
const shotTap = img(path.join(PRE, "round29-live-class-tap.png"));
const shotAuto = img(path.join(PRE, "round29-auto-book-pax.png"));
const shotNoData = img(path.join(PRE, "round29-auto-book-nodata.png"));
/* Live deploy (686a88f) ke screenshots — asli AI + asli provider data */
const shotLiveGroups = img(path.join(PRE, "round29-live-groups.png"));
const shotLiveAuto = img(path.join(PRE, "round29-live-autobook.png"));

/* ── asli component (grouped card) SSR se ────────────────────────────── */
const dom = new JSDOM("<!doctype html><html><body><div id='app'></div></body></html>", {
  url: "https://railbook.preview/",
  pretendToBeVisual: true,
});
for (const k of ["window", "document", "navigator", "sessionStorage", "localStorage", "HTMLElement", "Element", "Node", "Event"]) {
  globalThis[k] = dom.window[k];
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const { createServer } = await import("vite");
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { render } = await import("@testing-library/react");
const React = (await import("react")).default;
const { ReplyText } = await vite.ssrLoadModule("/src/components/ReplyText.tsx");

const REPLY = [
  "27 Sep 2026, SVDK → LDH, 1 passenger — seat wali trains:",
  "* 14606 JAT YNRK EXP — 3E AVL 4 ₹520",
  "* 19804 KOTA EXPRESS — 1A AVL 3 ₹1,455",
  "* 22432 SFG MCTM SF EXP — 1A AVL 1 ₹1,270",
  "* 22432 SFG MCTM SF EXP — 3A AVL 1 ₹565",
  "* 19804 KOTA EXPRESS — 2A RAC 6 ₹880",
].join("\n");

const { container } = render(React.createElement(ReplyText, { text: REPLY, onBook: () => {} }));
const renderedCard = container.innerHTML;
const renderedClasses = [...container.querySelectorAll(".rp-row")].map((c) => c.querySelector(".rp-no")?.textContent);
await vite.close();

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>RailBook — Round 29 (26 Sep 2026)</title>
<style>
${css}
* { box-sizing: border-box; }
body { margin: 0; background: #f6f2ea; color: #16202f; font-family: -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 22px 18px 60px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 30px 0 8px; }
h3 { font-size: 14px; margin: 18px 0 6px; }
p, li { font-size: 13.5px; line-height: 1.55; }
.sub { color: #5b6a7d; font-size: 12.5px; }
.card { background: #fff; border: 1px solid #e3e6ec; border-radius: 14px; padding: 14px 15px; margin: 12px 0; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.figbox { background: #fff; border: 1px solid #e3e6ec; border-radius: 14px; padding: 10px; }
.figbox img { width: 100%; border-radius: 10px; display: block; border: 1px solid #eef1f5; }
.cap { font-size: 11.5px; color: #5b6a7d; margin: 7px 2px 0; }
.pill { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 3px 9px; background: #eef6f1; color: #14603f; margin-right: 6px; }
.pill.bad { background: #fdecec; color: #a32020; }
.pill.warn { background: #fff5e6; color: #995f00; }
.pill.info { background: #eaf1fd; color: #1d4ed8; }
code { background: #f1f4f8; border-radius: 6px; padding: 1px 5px; font-size: 12px; }
pre { background: #0f1b2b; color: #dbe6f3; border-radius: 10px; padding: 11px 12px; font-size: 11.5px; overflow: auto; }
.phone { max-width: 430px; margin: 0 auto; background: #f6f2ea; border: 1px solid #e3e6ec; border-radius: 16px; padding: 12px; }
.msg { background: #fff; border-radius: 12px; padding: 9px 10px; font-size: 13px; }
table.checks { width: 100%; border-collapse: collapse; font-size: 12.5px; }
table.checks th, table.checks td { border-bottom: 1px solid #eef1f5; padding: 6px 8px; text-align: left; vertical-align: top; }
table.checks th { background: #f7f9fc; font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; color: #5b6a7d; }
.kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style></head>
<body><div class="wrap">
  <h1>RailBook · Round 29 — same train ek card, class tap → form, "book krdo" → form, "vaishno devi" → SVDK</h1>
  <p class="sub">26 Sep 2026 · user ke 2 screenshots (@ live build <code>20be5c2</code>) · code <code>5b844dd</code> + round-29 · web build <code>${js.file}</code> (${(js.bytes / 1024).toFixed(1)} kB) · koi naya APK nahi chahiye (app live web URL load karta hai)</p>

  <div class="card">
    <span class="pill">1 · same train = ek card</span>
    <span class="pill">2 · class tap → passenger form</span>
    <span class="pill">3 · "book krdo" → khud form</span>
    <span class="pill">4 · "vaishno devi" → SVDK</span>
    <p style="margin:10px 0 0">Grouping sirf <b>display level</b> par hai — server ka jawab, rows, order, class ka apna status/fare, API calls aur booking logic jaisa tha waisa hi hai. Kuch merge/sum/average nahi, kuch invent nahi.</p>
  </div>

  <h2>1 · Same train ki classes — pehle alag alag cards, ab ek card</h2>
  <div class="grid2">
    <div class="figbox">
      <img src="${shotBefore}" alt="pehle: 22432 do baar, 19804 do baar" />
      <p class="cap"><span class="pill bad">pehle</span> user ka screenshot (4:33): <code>22432</code> do baar, <code>19804</code> do baar — same train ke classes alag alag cards me.</p>
    </div>
    <div class="figbox">
      <img src="${shotGroups}" alt="ab: ek train = ek card, andar class rows" />
      <p class="cap"><span class="pill">ab</span> asli probe (<code>tools/probe-live-r29.mjs</code>): <b>3 cards</b> (14606, 19804, 22432), <code>nameOccurrences = [0, 1, 1]</code> — naam card me sirf ek baar, andar har class ki apni row + apna status/fare, har row par tap-able <b>Book</b>.</p>
    </div>
  </div>
  <div class="figbox" style="margin-top:14px">
    <img src="${shotLiveGroups}" alt="live: 19 trains, har train ek hi card me" />
    <p class="cap"><span class="pill">live ${"686a88f"}</span> asli deploy par ("Vaishno devi se Ludhiana kal ke liye seat wali trains"): <b>19 board cards</b> (har train ek hi baar — <code>duplicateTrains: []</code>), 65 class chips, header me <code>SVDK → LDH, 2026-09-27</code> — chhota naam "Vaishno devi" bhi SVDK par resolve hua.</p>
  </div>

  <h3>Wahi card, asli component se (yeh HTML neeche live render hua hai — same class names jo app me hain)</h3>
  <div class="phone"><div class="msg">${renderedCard}</div></div>
  <p class="sub">Render check: <code>.rp-row</code> cards = <b>${renderedClasses.length}</b> (${renderedClasses.join(", ")}) · har card me <code>.rp-crow</code> class rows · <code>Book</code> button sirf available/RAC/WL/unknown par (N/A par jhootha button nahi).</p>
  <table class="checks">
    <tr><th>Rule (user ne bola)</th><th>Kaise pura hua</th></tr>
    <tr><td>group by train number, ek header (naam ek baar)</td><td><code>groupReplyRowsByTrain()</code> — trainNumber primary key, header me number + naam ek baar</td></tr>
    <tr><td>har class ka apna availability + fare, merge/sum/average nahi</td><td>har class apni row me apna <code>status</code>/<code>count</code>/<code>fare</code>/<code>dep</code> rakhti hai (test: <code>3A AVL 122 ₹635</code> + <code>SL AVL 94 ₹250</code> — koi 216/108 nahi)</td></tr>
    <tr><td>same train+same class duplicate blindly nahi</td><td>bilkul same record (class+status+count+fare+dep) ek hi baar; alag status/fare wala record chhupta nahi (test me AVAILABLE + WAITLIST dono rehte hain)</td></tr>
    <tr><td>sorting/order preserve</td><td>pehli baar jis train ka zikr aaya wahi card wahin — koi sort/filter nahi</td></tr>
    <tr><td>API/data/booking logic na badle</td><td>grouping <code>src/components/ReplyText.tsx</code> (presentation) me; input rows mutate nahi hoti (test: JSON pehle/baad same)</td></tr>
    <tr><td>class par click → usi train+class ka booking flow</td><td>card ka class row → <code>openBookingFromReplyRow()</code> → wahi <code>selectTrainAndClassGo()</code> jo Seat Finder/direct chips use karte hain</td></tr>
  </table>

  <h2>2 · Class tap → seedha passenger form</h2>
  <div class="grid2">
    <div class="figbox">
      <img src="${shotTap}" alt="class row tap → passenger form" />
      <p class="cap"><span class="pill">tap</span> 22432 ka <b>3A</b> row tap → passenger form: <b>22432 SFG MCTM SF EXP · 3A · SVDK → LDH · 2026-09-27 · ₹565</b> (jo dikha wahi bheja, koi naya number nahi).</p>
    </div>
    <div class="figbox">
      <img src="${shotAuto}" alt="'22432 mein 3A book krdo' → khud passenger form" />
      <p class="cap"><span class="pill">book krdo</span> chat me <code>22432 mein 3A book krdo</code> → AI jawab ke saath hi form khul jaata hai (train+class+tareekh+fare pehle se bhare). "Check hui?" poochhne ki zaroorat nahi.</p>
    </div>
    <div class="figbox">
      <img src="${shotLiveAuto}" alt="live: '12208 mein 3A book krdo' → khud passenger form" />
      <p class="cap"><span class="pill">live</span> asli deploy par wahi cheez: <code>12208 mein 3A book krdo</code> → khud passenger form (12208 · 3A · SVDK → LDH · 📅 2026-09-27) + r28 ki assurance line + "Review journey (pehle details bharo)" CTA screen par.</p>
    </div>
  </div>

  <h2>3 · "book krdo" par AI khud passenger form (loop khatam)</h2>
  <p>Pehle (user ka screenshot 4:35): <span class="pill bad">problem</span> <i>"…check kar raha hoon"</i> baar-baar, "Check hui?" par bhi wahi jawab, aur ek baar text beech se kata hua (<i>"ability check karne ke liye…"</i>). Date poochhi gayi jabki <code>2026-09-27</code> pehle se pata tha.</p>
  <table class="checks">
    <tr><th>Ab kya hota hai</th><th>Detail</th></tr>
    <tr><td>booking intent pehchan</td><td><code>isBookingIntent()</code> — "book krdo / booking kardo / ticket chahiye" haan; sawaal ("kya book kar sakta hoon?") nahi</td></tr>
    <tr><td>train + class + route + date</td><td>user ke message + client state + server context se — <b>koi andaza nahi</b>; date sirf jo user/server ne di (form ka default "aaj" guess nahi)</td></tr>
    <tr><td>status/fare</td><td>live board row se jo dikha tha wahi; row na ho to status UNKNOWN + saaf line "Fare abhi confirm nahi — Review journey par provider se aayega"</td></tr>
    <tr><td>N/A / REGRET / CANCELLED</td><td>form nahi khulta (chalne wali class par jhoothi umeed nahi) — wahan pehle fresh check maanga jaata hai</td></tr>
    <tr><td>adhoora text</td><td>ReplyText ka parser ab aadhe shabd par ruk kar line nahi kaatta — aisa text poora paragraph hi rehta hai (kuch adhoora nahi)</td></tr>
  </table>
  <div class="figbox" style="max-width:520px">
    <img src="${shotNoData}" alt="koi row data nahi — form phir bhi khulta hai, honest line ke saath" />
    <p class="cap"><span class="pill warn">edge</span> koi seat row data nahi mila: form phir bhi khulta hai, magar <b>jhooth nahi</b> — "Fare abhi confirm nahi — Review journey par provider se aayega", timings ke liye "Timings provider ke data me nahi the".</p>
  </div>

  <h2>4 · "vaishno devi" (chhota naam) → SVDK</h2>
  <p>Pehle poora <i>"Shri Mata Vaishno Devi Katra"</i> likhna padta tha. Ab yeh sab <code>SVDK</code> par resolve hote hain (server <code>server/understand/legacy-stations.ts</code> + client <code>src/ai/stations.ts</code> — sirf alias, koi naya station/naam nahi):</p>
  <pre>vaishno devi · vaishno devi katra · vaishnodevi · vishno devi · mata vaishno devi
shri mata vaishno devi (katra) · smvd katra · वैष्णो देवी · वैष्णो देवी कटरा · वैष्णोदेवी · माता वैष्णो देवी</pre>
  <table class="checks">
    <tr><th>Input</th><th>Nateeja</th></tr>
    <tr><td><code>"vaishno devi se LDH jaana hai"</code></td><td><code>findStationsInText</code> → SVDK, LDH (kram wahi)</td></tr>
    <tr><td><code>"vaishnodevi"</code> / <code>"katra"</code> / <code>"वैष्णो देवी"</code></td><td>sab <code>SVDK · SMVD Katra · Katra</code></td></tr>
    <tr><td>doosre shehar (ludhiana, jammu)</td><td>apne hi code — koi galat match nahi ("delhi" jaise cluster shehar par bhi guess nahi)</td></tr>
  </table>

  <h2>5 · Tests + probe (asli output)</h2>
  <div class="card">
    <p><span class="pill">tests</span> <b>108 files / 1091 tests PASS</b> (naya <code>tests/round29-group-same-train-book.test.tsx</code> — 22 tests: grouping, per-class data, duplicates, tap, booking-intent, auto-book resolution, aliases). <span class="pill info">tsc</span> server clean · client 67 (baseline wahi). <span class="pill info">build</span> <code>${js.file}</code> ${(js.bytes / 1024).toFixed(1)} kB.</p>
    <p><span class="pill">live</span> <b>live turn 1:</b> <code>textCards 0 · boardGroups 19 · trains 19 · duplicateTrains [] · svdkRoute true</code> — <b>class chip tap:</b> <code>12208 KGM GARIB RATH · 3A · SVDK → LDH · 2026-09-27 · ₹470</code> → passenger form. <b>"12208 mein 3A book krdo":</b> form khud khul gaya (12208 · 3A · 2026-09-27; fare row me na hone par honest line "Fare abhi confirm nahi — Review journey par provider se aayega"). Chat me r28 ki line bhi zinda: "Aapki details IRCTC par khud bhar jaayengi…".</p>
    <pre>CHAT GROUPS: cards=3  heads=[14606, 19804, 22432]  classRows=[1,2,2]  tappable=[1,2,2]
             nameOccurrences=[0,1,1]
CLASS TAP  → passengers-overlay · "22432 SFG MCTM SF EXP · 3A · SVDK → LDH · 2026-09-27 · ₹565"
AUTO BOOK  → passengers-overlay · wahi 22432 · 3A · 2026-09-27 · ₹565 (rows se)
AUTO BOOK (koi row nahi) → passengers-overlay · 22432 · 3A + "Fare abhi confirm nahi — Review journey par provider se aayega"
PROBE_DONE</pre>
  </div>

  <h2>6 · Jo nahi badla</h2>
  <ul>
    <li>Server ka jawab/text, provider calls, fare/availability ka source — waisa hi.</li>
    <li>Booking engine, IRCTC handoff, autofill — waisa hi (r28 ka 30s + "details khud bhar jaayengi" line bani hui hai).</li>
    <li>Seat Finder ka code/backend — intact (chat me block bhi jaisa tha waisa).</li>
    <li>Android app: koi native change nahi — app wahi live web URL load karta hai, isliye <b>naya APK ki zaroorat nahi</b>.</li>
  </ul>

  <p class="sub" style="margin-top:26px">Live commit: <code>686a88f</code> (railbook-gegs.onrender.com) · Screenshots: <code>RailBook/previews/round29-chat-groups.png</code>, <code>round29-class-tap-pax.png</code>, <code>round29-auto-book-pax.png</code>, <code>round29-auto-book-nodata.png</code> · probe: <code>node tools/probe-live-r29.mjs</code> · ye preview: <code>node tools/build-round29-preview.mjs</code></p>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
