/* Round-21 preview builder — asli Android autofill engine (fieldmap.js + irctc-passenger.js) ek
 * IRCTC-jaisa page par chalata hai. Preview STATIC hai (jsdom me autofill pehle chala ke values mark
 * ho jaati hain), aur agar browser scripts allow kare to "Autofill chalao" button live bhi chala deta hai.
 * Output: single self-contained HTML (inline script + styles, no network).
 *
 *   node tools/build-round21-preview.mjs [repoRoot] [assetsDir]
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const ASSETS = path.resolve(process.argv[3] ?? path.join(ROOT, "../app/android-app/app/src/main/assets/autofill"));
const OUT = "/home/user/RailBook/previews/RailBook-round21-2026-09-25.html";

const fieldmap = fs.readFileSync(path.join(ASSETS, "fieldmap.js"), "utf8");
const engineSrc = fs.readFileSync(path.join(ASSETS, "irctc-passenger.js"), "utf8");

const OPT = (sel, val, text) => `<option id="${sel}-${val}" value="${val}">${text}</option>`;
const GENDER = (i) =>
  `<select id="pg${i}" formcontrolname="passengerGender"><option value="">Select</option>` +
  OPT(`pg${i}`, "M", "Male") + OPT(`pg${i}`, "F", "Female") + OPT(`pg${i}`, "T", "Transgender") + `</select>`;
const BERTH = (i) =>
  `<select id="pb${i}" formcontrolname="passengerBerthChoice">` +
  OPT(`pb${i}`, "NP", "No Preference") + OPT(`pb${i}`, "LB", "Lower") + OPT(`pb${i}`, "MB", "Middle") +
  OPT(`pb${i}`, "UB", "Upper") + OPT(`pb${i}`, "SL", "Side Lower") + OPT(`pb${i}`, "SU", "Side Upper") + `</select>`;
const FOOD = (i) =>
  `<select id="pf${i}" formcontrolname="passengerFoodChoice">` +
  OPT(`pf${i}`, "D", "Catering Service Option") + OPT(`pf${i}`, "V", "Veg") +
  OPT(`pf${i}`, "N", "Non Veg") + OPT(`pf${i}`, "NF", "No Food") + `</select>`;

const paxRow = (i) => `
      <tr>
        <td style="width:31%"><label class="fl">Name</label><input id="pn${i}" formcontrolname="passengerName"></td>
        <td style="width:13%"><label class="fl">Age</label><input id="pa${i}" formcontrolname="passengerAge"></td>
        <td style="width:20%"><label class="fl">Gender</label>${GENDER(i)}</td>
        <td style="width:20%"><label class="fl">Berth</label>${BERTH(i)}</td>
        <td style="width:16%"><label class="fl">Food choice</label>${FOOD(i)}</td>
      </tr>
      <tr><td colspan="5">
        <label class="chk"><input type="checkbox" id="cb${i}" formcontrolname="confirmBerths">
          <span>Book only if confirm berths are allotted</span></label>
        <label class="chk"><input type="checkbox" id="au${i}" formcontrolname="autoUpgradation">
          <span>Consider for auto up-gradation</span></label>
      </td></tr>`;

const MOCK_BODY = `
    <div class="bar">IRCTC · Passenger Details (mock page)</div>
    <table><tbody>
      ${paxRow(0)}
      ${paxRow(1)}
      <tr>
        <td><label class="fl">Mobile Number</label><input id="mob" formcontrolname="mobileNumber" type="tel" placeholder="Mobile Number"></td>
        <td colspan="4"><label class="fl">Email</label><input id="mail" formcontrolname="email" type="email" placeholder="Email"></td>
      </tr>
    </tbody></table>`;

const PAYLOAD_V2 = {
  kind: "railbook-autofill-test",
  version: 2,
  test: true,
  createdAt: "2026-09-25T09:00:00.000Z",
  journey: { from: "Amritsar Jn", fromCode: "ASR", to: "New Delhi", toCode: "NDLS", date: "2026-09-26", trainNumber: "12014", classCode: "CC" },
  contact: { mobile: "9876543210", email: "asha@example.com" },
  passengers: [
    { name: "Asha Kaur", age: 28, gender: "female", berth: "Lower", food: "Veg", bookOnlyIfConfirm: true, autoUpgrade: true },
    { name: "Ravi Sharma", age: 35, gender: "male", berth: "No Preference", food: "No Food" },
  ],
};

const FIELD_IDS = {
  "passengers.0.name": "pn0", "passengers.0.age": "pa0", "passengers.0.gender": "pg0", "passengers.0.berth": "pb0",
  "passengers.0.food": "pf0", "passengers.0.bookOnlyIfConfirm": "cb0", "passengers.0.autoUpgrade": "au0",
  "passengers.1.name": "pn1", "passengers.1.age": "pa1", "passengers.1.gender": "pg1", "passengers.1.berth": "pb1",
  "passengers.1.food": "pf1", "passengers.1.bookOnlyIfConfirm": "cb1", "passengers.1.autoUpgrade": "au1",
  "contact.mobile": "mob", "contact.email": "mail",
};

/* ── 1. jsdom me asli engine chalao, values capture karo ── */
const dom = new JSDOM(`<!doctype html><html><body><form>${MOCK_BODY}</form></body></html>`, { runScripts: "outside-only" });
const w = dom.window;
w.eval(fieldmap);
w.eval(engineSrc);
const res = await w.RailBookPocIrctc.fillIrctc(w.document, w.RailBookPocFieldMap.validatePayload(PAYLOAD_V2).payload);

const filledIds = new Set(res.filled.map((p) => FIELD_IDS[p]).filter(Boolean));
const values = {};
for (const id of Object.values(FIELD_IDS)) {
  const el = w.document.getElementById(id);
  if (!el) continue;
  values[id] = el.type === "checkbox" ? { checked: el.checked } : { value: el.value };
}

/* ── 2. static markup me values inject karo (preview bina JS bhi sahi dikhe) ── */
function bake(html) {
  let out = html;
  for (const [id, v] of Object.entries(values)) {
    const cls = filledIds.has(id) ? " filled" : "";
    if ("checked" in v) {
      out = out.replace(new RegExp(`<input type="checkbox" id="${id}"`), `<input type="checkbox" id="${id}"${v.checked ? " checked" : ""} class="chk-in${cls}"`);
      continue;
    }
    if (v.value) {
      out = out.replace(new RegExp(`(<input id="${id}"[^>]*?)(>)`), `$1 value="${v.value}" class="in${cls}"$2`);
      out = out.replace(new RegExp(`<option id="${id}-${v.value}"`), `<option id="${id}-${v.value}" selected`);
    } else {
      out = out.replace(new RegExp(`(<input id="${id}"[^>]*?)(>)`), `$1 class="in"$2`);
    }
  }
  return out;
}

const HEAD = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RailBook Round-21 · IRCTC autofill (food · checkbox · mobile/email)</title>
<style>
  :root { --ink:#12203a; --muted:#5b6b86; --line:#dfe6f0; --ok:#0f7a4d; --okbg:#e8f7ef; --warn:#8a5a00; --warnbg:#fff6e5; }
  * { box-sizing:border-box; }
  body { margin:0; padding:18px; background:#eef2f8; color:var(--ink);
         font-family:"Segoe UI",Roboto,"Noto Sans",system-ui,sans-serif; }
  h1 { font-size:19px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:14px; line-height:1.55; }
  .wrap { display:grid; grid-template-columns:minmax(300px,0.85fr) minmax(360px,1.15fr); gap:14px; align-items:start; }
  @media (max-width:920px){ .wrap { grid-template-columns:1fr; } }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px; box-shadow:0 1px 2px rgba(18,32,58,.05); }
  .card h2 { font-size:13px; margin:0 0 10px; letter-spacing:.03em; text-transform:uppercase; color:var(--muted); }
  .bar { background:#0b3d91; color:#fff; font-weight:600; font-size:13px; padding:8px 10px; border-radius:8px; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  td { padding:4px 6px; vertical-align:top; }
  input, select { font:inherit; font-size:12.5px; padding:5px 6px; border:1px solid #c9d4e4; border-radius:7px;
                  width:100%; background:#fff; color:#20304d; }
  input.chk-in { width:auto; }
  .fl { display:block; font-size:11px; color:var(--muted); margin-bottom:2px; }
  .chk { font-size:11.5px; color:#38466b; display:flex; gap:6px; align-items:flex-start; margin:5px 0; }
  .filled { background:var(--okbg) !important; border-color:#9ad7ba !important; }
  .pill { display:inline-block; font-size:11px; padding:2px 7px; border-radius:999px; background:#eef3fb; color:#2b3f66; margin:2px 4px 2px 0; }
  .pill.ok { background:var(--okbg); color:var(--ok); }
  .pill.warn { background:var(--warnbg); color:var(--warn); }
  .log { font-size:12px; line-height:1.7; }
  .kv { border-top:1px solid var(--line); margin-top:10px; padding-top:9px; font-size:12.5px; line-height:1.75; color:#2c3b5c; }
  .kv b { color:var(--ink); }
  code { background:#f1f5fb; padding:1px 5px; border-radius:5px; font-size:12px; }
  textarea { width:100%; min-height:150px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px;
             border:1px solid var(--line); border-radius:10px; padding:9px; resize:vertical; color:#1b2a45; background:#fbfdff; }
  button { font:inherit; font-weight:600; padding:8px 13px; border-radius:10px; border:1px solid #14508f; background:#14508f; color:#fff; cursor:pointer; }
  .hint { font-size:11.5px; color:var(--muted); margin-top:7px; line-height:1.6; }
</style>
</head><body>
<h1>Round-21 · IRCTC autofill — food, dono checkbox, mobile/email</h1>
<div class="sub">
  App ke <b>asli autofill engine</b> (<code>fieldmap.js</code> + <code>irctc-passenger.js</code> — wahi files jo APK me jaati hain)
  ka result. Jo field engine ne bhara wo <b>hara</b> hai; jo user ne nahi diya (jaise 2nd passenger ke checkbox)
  <b>chhua hi nahi</b> — IRCTC ka default waisa hi rehta hai.
</div>
<div class="wrap">
  <div class="card">
    <h2>Engine report</h2>
    <div id="log" class="log"></div>
    <div class="kv">
      <b>Payload V2</b> (naya): <code>railbookAutofillPayloadV2</code> — food + dono checkbox + contact.<br>
      <b>Purana V1</b>: wahi keys aur wahi shape — purane app/extension par kuch nahi tootta.
    </div>
    <h2 style="margin-top:14px">Payload (badal ke chalao · optional)</h2>
    <textarea id="json"></textarea>
    <div style="margin-top:8px"><button id="run">Autofill chalao</button> <button id="reset" style="background:#fff;color:#14508f">Reset</button></div>
    <div class="hint">
      Login / OTP / CAPTCHA / payment yahan nahi hota — sirf passenger fields. “No Food”, “Veg”, “Non Veg” IRCTC ke
      apne option text se match hote hain (value guess nahi).
    </div>
  </div>
  <div class="card">
    <h2>IRCTC-jaisa page — autofill ke baad</h2>
${bake(MOCK_BODY)}
  </div>
</div>
<script>
const FILLED = ${JSON.stringify([...filledIds])};
const NOT_FOUND = ${JSON.stringify(res.notFound)};
const FAILED = ${JSON.stringify(res.failed)};
const FIELD_IDS = ${JSON.stringify(FIELD_IDS)};
const DEFAULT_V2 = ${JSON.stringify(PAYLOAD_V2)};
const ALL_IDS = Object.values(FIELD_IDS);
const log = document.getElementById("log");
const box = document.getElementById("json");
box.value = JSON.stringify(DEFAULT_V2, null, 2);

function renderLog(filled, notFound, failed) {
  log.innerHTML =
    '<div><span class="pill ok">' + filled.length + ' filled</span><span class="pill">' +
    notFound.length + ' not found</span><span class="pill">' + failed.length + ' failed</span></div>' +
    '<div style="margin-top:6px">' + filled.map(function (p) { return '<span class="pill ok">' + p + '</span>'; }).join("") + '</div>' +
    (notFound.length ? '<div style="margin-top:6px">' + notFound.map(function (p) { return '<span class="pill warn">' + p + '</span>'; }).join("") + '</div>' : "") +
    '<div class="hint">Purana (V1) payload chalao to mobile/email/checkbox khaali rahenge — wahi backward-compat jaan-boojh kar hai.</div>';
}
renderLog(FILLED, NOT_FOUND, FAILED);

function paint(filled) {
  for (const id of ALL_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove("filled");
  }
  for (const p of filled) { const id = FIELD_IDS[p]; if (id && document.getElementById(id)) document.getElementById(id).classList.add("filled"); }
}
document.getElementById("reset").onclick = function () {
  for (const id of ALL_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove("filled");
    if (el.type === "checkbox") el.checked = false;
    else if (el.tagName === "SELECT") el.selectedIndex = 0;
    else el.value = "";
  }
  log.innerHTML = "—";
};
document.getElementById("run").onclick = async function () {
  let payload;
  try { payload = JSON.parse(box.value); }
  catch (e) { log.innerHTML = '<span class="pill warn">JSON galat</span> ' + e.message; return; }
  const v = window.RailBookPocFieldMap.validatePayload(payload);
  if (!v.ok) { log.innerHTML = '<span class="pill warn">Payload reject</span> ' + v.errors.join(" · "); paint([]); return; }
  document.getElementById("reset").onclick();
  const r = await window.RailBookPocIrctc.fillIrctc(document, v.payload);
  paint(r.filled); renderLog(r.filled, r.notFound, r.failed);
};
</script>
</body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HEAD.replace(/\$\{bake\(MOCK_BODY\)\}/, bake(MOCK_BODY)) + "\n<script>\n" + fieldmap + "\n" + engineSrc + "\n</script>\n", "utf8");
if (process.env.RB_DUMP) {
  console.log("filled:", res.filled);
  console.log("notFound:", res.notFound);
  console.log("failed:", res.failed);
}
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes | filled:", res.filled.length, "| notFound:", res.notFound.length, "| failed:", res.failed.length);
