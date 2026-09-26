/* Round-28 preview (26 Sep 2026) — user ke 3 screenshots + 4 points:
 *   1) black handoff panel user ko nahi dikhna chahiye (backend pe rakho)
 *   2) Android ka blue header user ko nahi dikhna chahiye (backend pe rakho)
 *   3) passenger form me bahut scroll karke pata chalta tha ki "Review journey" button bhi hai → UI fix
 *   4) IRCTC redirect 45s → 30s + "aapki details khud bhar jaayengi, dobara daalne ki zaroorat nahi"
 *
 * Sab kuch asli components/tools se: Passengers page asli React component se (vite SSR), CSS asli built
 * file se, Android ke hisse asli source files se (jo APK v1.4.9 me gaye), aur live screenshots asli
 * browser probe (tools/probe-live-r28.mjs) ke.
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round28-2026-09-26.html";
const ANDROID = path.resolve(ROOT, "..", "app/android-app/app/src/main");

const css = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".css"));
  return fs.readFileSync(path.join(dir, f), "utf8");
})();

const dom = new JSDOM("<!doctype html><html><body><div id='pax'></div></body></html>", {
  url: "https://railbook.preview/",
  pretendToBeVisual: true,
});
for (const k of ["window", "document", "navigator", "sessionStorage", "localStorage", "HTMLElement", "Element", "Node", "Event"]) {
  globalThis[k] = dom.window[k];
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const { createServer } = await import("vite");
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { render, cleanup } = await import("@testing-library/react");
const React = (await import("react")).default;
const { Passengers } = await vite.ssrLoadModule("/src/views/Passengers.tsx");
const { BookingProvider } = await vite.ssrLoadModule("/src/booking/context.tsx");
const { autoFillNotice } = await vite.ssrLoadModule("/src/components/IrctcHandoff.tsx");

globalThis.fetch = async (url) => {
  const u = String(url?.url ?? url);
  const body = u.includes("/api/meta")
    ? { provider: { id: "live", name: "RailBook", mock: false }, serviceFee: 50 }
    : { trainNumber: "12013", pantry: true, providers: ["web_erail", "web_confirmtkt"], note: null, foodChoiceExpected: true, evidence: ["Shatabdi — catering fare me included"] };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

const train = {
  number: "12013",
  name: "AMRITSAR SHTABDI",
  type: "",
  from: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana Junction" },
  to: { code: "ASR", name: "Amritsar Junction", city: "Amritsar Junction" },
  date: "2026-09-27",
  departure: "06:10",
  arrival: "08:30",
  arrivalDayOffset: 0,
  durationMinutes: 140,
  durationLabel: "2h 20m",
  runsOn: [],
  classes: [{ code: "CC", label: "AC Chair Car", status: "AVAILABLE", seats: 418, fare: 675, source: "web_confirmtkt" }],
};
const blankPax = { id: "p1", name: "", age: "", gender: "", berthPreference: "", foodChoice: "", idType: "", idNumber: "", bookOnlyIfConfirm: false, autoUpgrade: false };
const filledPax = { id: "p1", name: "Rahul Sharma", age: "38", gender: "MALE", berthPreference: "Window", foodChoice: "VEG", idType: "", idNumber: "", bookOnlyIfConfirm: true, autoUpgrade: false };

function seed(pax, contact) {
  sessionStorage.setItem(
    "railbook.booking.v1",
    JSON.stringify({
      flow: "PASSENGERS_PENDING", screen: "passengers", date: "2026-09-27", dateProvided: true, passengerCount: 1,
      paxProvided: true, trains: [train], selectedTrain: train, selectedClass: train.classes[0], seatPreference: "",
      booking: null, emptyMessage: null, notice: null, error: null, searching: false, recommendations: [], sessionId: 1,
      passengers: [pax], contact,
    }),
  );
}

const shots = {};
const renderPax = async (pax, contact) => {
  sessionStorage.clear();
  seed(pax, contact);
  const t = document.createElement("div");
  render(React.createElement(BookingProvider, null, React.createElement(Passengers, null)), { container: t });
  await new Promise((r) => setTimeout(r, 250));
  const html = t.innerHTML;
  cleanup();
  return html;
};

const paxBlank = await renderPax(blankPax, { mobile: "", email: "", whatsappOptIn: true });
const paxFilled = await renderPax(filledPax, { mobile: "9876543210", email: "rahul@example.com", whatsappOptIn: true });
await vite.close();

/* Android ke hisse (asli files) — jo APK v1.4.9 me gaye. */
const kotlin = fs.readFileSync(path.join(ANDROID, "java/com/railbook/assist/MainActivity.kt"), "utf8");
const layout = fs.readFileSync(path.join(ANDROID, "res/layout/activity_main.xml"), "utf8");
const bridge = fs.readFileSync(path.join(ANDROID, "assets/autofill/railbook-webview-bridge.js"), "utf8");
const prewarmMs = (kotlin.match(/PREWARM_COUNTDOWN_MS = ([\d_]+L)/) ?? [])[1] ?? "?";
const topBarGone = /android:id="@\+id\/topBar"[\s\S]{0,400}android:visibility="gone"/.test(layout);
const oldPanelGone = !bridge.includes("RailBook app · assisted fill") && !bridge.includes("Detected (");
const noticeFn = /function postNotice[\s\S]*?\n  }/.exec(bridge)?.[0] ?? "";

/* chat me pehle kya dikhta tha (screenshot 1) vs ab — sirf text farq, asli strings se. */
const oldPanelLines = [
  "RailBook app · assisted fill",
  "Details auto-filled (Continue = approval)",
  "Detected (4): passengers.0.name, passengers.0.age, passengers.0.gender, passengers.0.berth",
  "Filled (5): passengers.0.name, passengers.0.age, passengers.0.gender, passengers.0.berth, passengers.0.food",
  "journey fields are read-only on the IRCTC passenger page — not targeted",
  "Search / Book / Login / Pay — aap hi. App kabhi unhe nahi dabati.",
];
const newPill = "✅ Details bhar di gayi hain — dobara daalne ki zaroorat nahi";

const OUT_HTML = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RailBook Round-28 · dock/handoff cleanup + auto-fill assurance + 30s</title>
<style>
${css}
body { background:#f6f2ec; margin:0; }
.pv { max-width:1240px; margin:0 auto; padding:22px 18px 70px; }
.pv h1 { font-size:20px; margin:0 0 6px; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; color:#1d2230; }
.pv .sub { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:13px; line-height:1.55; color:#55607a; margin-bottom:16px; }
.pv h2 { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; margin:22px 0 10px; }
.pv .card { background:#fff; border:1px solid #e6e2da; border-radius:16px; padding:14px; margin-bottom:14px; }
.pv .cap { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:12.5px; font-weight:700; color:#123a63; margin-bottom:10px; }
.pv .note { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:12.5px; line-height:1.6; color:#3c4964; background:#fff; border:1px solid #e6e2da; border-left:4px solid #123a63; border-radius:12px; padding:11px 13px; margin-bottom:14px; }
.pv .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
@media (max-width:1000px){ .pv .grid2 { grid-template-columns:1fr; } }
.pv .frame { width:430px; max-width:100%; height:900px; overflow:hidden; border:1px solid #e0dcd4; border-radius:18px; background:#f6f2ec; }
.pv .bad { border-left:4px solid #b91c1c; }
.pv .good { border-left:4px solid #15803d; }
.pv .oldpanel { background:#0f172a; color:#e2e8f0; font:12px/1.5 ui-monospace,Menlo,monospace; border-radius:10px; padding:12px; }
.pv code { font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#f1f4f8; border-radius:6px; padding:1px 5px; }
.pv .pre { font-family:ui-monospace,Menlo,monospace; font-size:11.5px; line-height:1.7; color:#33405c; background:#f7f9fc; border:1px solid #e6ecf3; border-radius:10px; padding:10px; white-space:pre-wrap; }
.pv .live { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-start; }
.pv .live img { width:300px; border:1px solid #e0dcd4; border-radius:14px; }
.pv .kv { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font:12.5px/1.5 system-ui; color:#33405c; }
.pv .kv b { color:#123a63; }
</style></head><body><div class="pv">
<h1>Round-28 · black handoff panel + blue header user ko nahi · dock hamesha screen par · 30s + auto-fill assurance</h1>
<div class="sub">
  Passengers page asli React component (<code>Passengers.tsx</code>) + asli built CSS se render hua hai; Android ke hisse asli
  Kotlin/XML/JS files se (jo APK <b>v1.4.9</b> me gaye). Live screenshots asli browser probe
  <code>tools/probe-live-r28.mjs</code> ke (deploy <b>20be5c2</b>).
</div>
<div class="note">
  <b>1) Black panel hataya:</b> IRCTC page par pehle poora diagnostic box dikhta tha (Detected/Filled/read-only note).
  Ab wahi detail <b>backend</b> (native status + log + <code>fill-result</code> event) ko jaati hai, aur page par sirf ek
  <b>one-line pill</b> — jo 6 second me khud ghayab ho jaati hai. STOP/reject jaise serious message pill me rehte hain
  (details phir bhi nahi).<br>
  <b>2) Blue header hataya:</b> Android ka top bar (version · BHASHA · status · RAILBOOK / IRCTC / CLEAR HANDOFF) ab
  <code>visibility="gone"</code> — poora code, buttons aur listeners <b>backend me zinda</b>; user ko sirf zaroori baat
  chhote Toast se milti hai (jaise "✅ Aapki details IRCTC par bhar di gayi hain…"). WebView ab poori screen le raha hai.<br>
  <b>3) Scroll problem:</b> overlay pehle <code>.app</code> ke andar tha, jo chat lambi hone par 900px se 1400px+ ho jaata
  hai — isliye uska bottom dock (VoiceBar + Review journey) screen ke <b>neeche</b> chala jaata tha. Ab overlay
  <code>fixed</code> + <code>100vh/100dvh</code> hai: dock hamesha screen par. Probe: CTA <code>top 1336px</code>
  (screen 900) → <code>top 836px</code>, bina scroll dikhta hai.<br>
  <b>4) 30s + assurance:</b> <code>PREWARM_COUNTDOWN_MS = ${prewarmMs}</code> (pehle 45s) aur teen jagah saaf line —
  passenger dock, prewarm overlay, aur Continue-to-IRCTC ke neeche: <i>"Aapki details IRCTC par khud bhar jaayengi —
  dobara daalne ki zaroorat nahi, sirf login/OTP/payment aap karenge."</i>
</div>
<h2>1 · Passenger page (ab) — dock hamesha screen par + auto-fill line</h2>
<div class="grid2">
  <div class="card good"><div class="cap">Khaali form — button hi batata hai "Review journey (pehle details bharo)", neeche assurance line</div>
    <div class="frame">${paxBlank}</div>
  </div>
  <div class="card good"><div class="cap">Details bharne par — "Review journey" enable, wahi dock jagah par (bina scroll)</div>
    <div class="frame">${paxFilled}</div>
  </div>
</div>
<h2>2 · Black handoff panel: pehle vs ab (asli strings)</h2>
<div class="grid2">
  <div class="card bad"><div class="cap">PEHLE — poora panel user ko dikhta tha (screenshot 1)</div>
    <div class="oldpanel">${oldPanelLines.map((l) => l.replace(/</g, "&lt;")).join("<br>")}</div>
  </div>
  <div class="card good"><div class="cap">AB — page par sirf ek pill (khud hat jaati hai); baaki detail backend me</div>
    <div class="oldpanel" style="background:#0f172a;text-align:center;border-radius:999px;padding:10px 14px">${newPill}</div>
    <div class="pre" style="margin-top:10px">native → statusText + log + Toast
bridge → postNative({ type: "fill-result", filledCount, failed, notFound, siteChanges, refusedClicks, paxFilled … })
bridge → postNative({ type: "ui-notice", text, toast })</div>
  </div>
</div>
<h2>3 · Android: header screen se gayab (backend me zinda)</h2>
<div class="card"><div class="kv">
  <b>topBar visibility=gone</b><span>${topBarGone ? "✅ haan (version · BHASHA · status · RAILBOOK / IRCTC / CLEAR HANDOFF)" : "❌ nahi"}</span>
  <b>buttons + listeners</b><span>${kotlin.includes("binding.btnClear.setOnClickListener") && kotlin.includes("binding.btnLang.setOnClickListener") ? "✅ wahi code (CLEAR HANDOFF, Bhasha cycle) — sirf screen par nahi" : "❌"}</span>
  <b>purana black panel</b><span>${oldPanelGone ? "✅ bridge me nahi raha" : "❌ abhi bhi hai"}</span>
  <b>countdown</b><span>${prewarmMs} (45s nahi)</span>
  <b>user message</b><span>setStatus() → short Toast (handoff saved · auto-fill ho gayi · IRCTC block · login ready)</span>
</div></div>
<h2>4 · Live site par (asli browser, Pixel-size)</h2>
<div class="card"><div class="cap">Seat chip → passenger form (dock bina scroll) aur Review journey → Continue to IRCTC (auto-fill line)</div>
  <div class="live">
    <img src="round28-live-pax-dock.png" alt="passenger dock" />
    <img src="round28-live-pax-dock-filled.png" alt="passenger dock filled" />
    <img src="round28-live-review-autofill.png" alt="review + auto-fill line" />
  </div>
</div>
<h2>5 · Assurance line (asli function se — app vs browser)</h2>
<div class="card"><div class="pre">app ke andar: ${autoFillNotice(true)}

browser me:  ${autoFillNotice(false)}</div></div>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, OUT_HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
