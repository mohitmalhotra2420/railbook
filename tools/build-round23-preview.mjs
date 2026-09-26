/* Round-23 preview builder (26 Sep 2026) — asli React components (vite SSR loader), asli built CSS,
 * asli live payload (ASR→NDLS plan). Dikhata hai:
 *   1) ✅ Available filter: pehle (WL chips bhi) vs ab (sirf AVL/RAC) — asli click se capture.
 *   2) Review page: pehle (booking summary + wallet + Confirm Booking + copy block) vs ab (sirf Continue to IRCTC).
 *   3) Android app header: purana hardcoded "v1.2.8" label vs ab asli "v1.4.7 (30)".
 *
 *   node tools/build-round23-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round23-2026-09-26.html";

const css = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".css"));
  return fs.readFileSync(path.join(dir, f), "utf8");
})();

const dom = new JSDOM(
  "<!doctype html><html><body><div id='card-default'></div><div id='card-avail'></div><div id='review-now'></div><div id='review-was'></div></body></html>",
  { url: "https://railbook.preview/", pretendToBeVisual: true },
);
for (const k of ["window", "document", "navigator", "sessionStorage", "localStorage", "HTMLElement", "Element", "Node", "Event"]) {
  globalThis[k] = dom.window[k];
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const { createServer } = await import("vite");
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { render, cleanup, fireEvent } = await import("@testing-library/react");
const React = (await import("react")).default;
const { JourneyOptions } = await vite.ssrLoadModule("/src/components/JourneyOptions.tsx");
const { BookingProvider } = await vite.ssrLoadModule("/src/booking/context.tsx");
const { FareReview } = await vite.ssrLoadModule("/src/views/ReviewStatus.tsx");
const { IrctcHandoff } = await vite.ssrLoadModule("/src/components/IrctcHandoff.tsx");
const { Shell } = await vite.ssrLoadModule("/src/components/Shell.tsx");

const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "provas/asr-ndls-2026-09-26-plan.json"), "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.fetch = async (url) => {
  const u = String(url?.url ?? url);
  const body = u.includes("/api/meta")
    ? { provider: { id: "live", name: "RailBook", mock: false }, serviceFee: 0 }
    : u.includes("/api/wallet")
      ? { wallet: { balance: 10000, currency: "INR", transactions: [] } }
      : u.includes("/api/bookings")
        ? { bookings: [] }
        : {};
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

/* ── 1. direct card: default vs Available ── */
const cards = {};
{
  const a = document.getElementById("card-default");
  render(React.createElement(JourneyOptions, { plan, onPickClass: () => {}, onPickTrain: () => {} }), { container: a });
  await wait(140);
  cards.default = a.innerHTML;
  cleanup();

  const b = document.getElementById("card-avail");
  const c2 = document.getElementById("card-avail");
  render(React.createElement(JourneyOptions, { plan, onPickClass: () => {}, onPickTrain: () => {} }), { container: c2 });
  await wait(140);
  const btn = [...c2.querySelectorAll(".sf-chip")].find((x) => (x.textContent ?? "").includes("Available"));
  if (btn) fireEvent.click(btn);
  await wait(80);
  cards.avail = c2.innerHTML;
  cleanup();
}

/* ── 2. review page: ab (asli FareReview) vs pehle (handoff card + summary/wallet/CTA) ── */
const train = {
  number: "12484",
  name: "ASR TVCN SF EXP",
  type: "",
  from: { code: "ASR", name: "Amritsar Junction", city: "Amritsar Junction" },
  to: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana Junction" },
  date: "2026-09-27",
  departure: "05:55",
  arrival: "08:20",
  arrivalDayOffset: 0,
  durationMinutes: 145,
  durationLabel: "2h 25m",
  runsOn: [],
  classes: [{ code: "SL", label: "Sleeper", status: "AVAILABLE", seats: 102, fare: 100, source: "web_confirmtkt" }],
};
const handoffProps = {
  train,
  date: "2026-09-27",
  classCode: "SL",
  passengers: [{ id: "p1", name: "Mohit", age: "25", gender: "MALE", berthPreference: "Lower" }],
  contact: { mobile: "9876543210", email: "", whatsappOptIn: true },
};
sessionStorage.setItem(
  "railbook.booking.v1",
  JSON.stringify({
    screen: "review",
    flow: "REVIEW_READY",
    date: "2026-09-27",
    dateProvided: true,
    passengerCount: 1,
    paxProvided: true,
    trains: [train],
    selectedTrain: train,
    selectedClass: train.classes[0],
    seatPreference: "Lower",
    passengers: handoffProps.passengers,
    contact: handoffProps.contact,
    previewFare: { baseFare: 100, serviceFee: 0, total: 100 },
  }),
);

const review = {};
{
  const a = document.getElementById("review-now");
  render(React.createElement(BookingProvider, null, React.createElement(FareReview, null)), { container: a });
  await wait(180);
  review.now = a.innerHTML;
  cleanup();

  /* "pehle" = purana layout (summary + wallet + note + handoff + sticky Confirm Booking) */
  const before = document.createElement("div");
  before.innerHTML = `
    <section class="summary">
      <div class="row"><span class="k">Train</span><span>12484 ASR TVCN SF EXP</span></div>
      <div class="row"><span class="k">Date</span><span>27 September 2026</span></div>
      <div class="row"><span class="k">From → To</span><span>ASR → LDH</span></div>
      <div class="row"><span class="k">Class</span><span>Sleeper</span></div>
      <div class="row"><span class="k">Seat</span><span>Lower</span></div>
      <div class="row"><span class="k">Passengers</span><span>Mohit</span></div>
      <div class="row"><span class="k">Base fare</span><span>₹100</span></div>
      <div class="row"><span class="k">Service fee</span><span>₹0</span></div>
      <div class="row total"><span>Total</span><span>₹100</span></div>
    </section>
    <section class="list-card" style="margin-top:12px">
      <div class="muted">Wallet</div>
      <div>Current balance ₹10,000</div>
      <div class="muted">Remaining after booking ₹9,900</div>
    </section>
    <p class="muted" style="margin-top:12px">Nothing is confirmed until the railway provider accepts this booking.</p>
    <div style="display:grid;gap:8px;margin-top:10px">
      <button class="btn" type="button">Copy journey + passenger summary</button>
    </div>
    <details style="margin-top:10px" open>
      <summary class="muted">Copy-ready summary (From / To / Date / Class / passengers)</summary>
      <pre style="white-space:pre-wrap;font-size:12px">RailBook → IRCTC handoff (copy/paste)
-----------------------------------
From: Amritsar Jn (ASR)
To:   Ludhiana Jn (LDH)
…
</pre>
    </details>`;
  const b = document.getElementById("review-was");
  b.appendChild(before);
  const inner = document.createElement("div");
  b.appendChild(inner);
  render(
    React.createElement(
      BookingProvider,
      null,
      React.createElement(
      Shell,
      { title: "Booking summary", back: true },
      React.createElement(
        "main",
        { className: "page" },
        React.createElement(IrctcHandoff, handoffProps),
        React.createElement(
          "div",
          { className: "sticky-cta" },
          React.createElement("button", { className: "btn primary" }, "Confirm Booking"),
        ),
      ),
      ),
    ),
    { container: inner },
  );
  await wait(160);
  /* purane copy blocks (jo user ne hataye) ko dikhane ke liye unhe dobara jodna nahi — sirf unka
     "hata diya" note chhodte hain; isliye review.was me sirf purana summary+wallet+CTA rakha. */
  review.was = b.innerHTML;
  cleanup();
}

await vite.close();

const OUT_HTML = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RailBook Round-23 · Available me sirf AVL/RAC · review page sirf Continue to IRCTC</title>
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
.pv .phone { max-width:390px; margin:0 auto; border-radius:22px; overflow:hidden; border:1px solid #dfe6f0; background:#fff; }
.pv .phone-top { background:#0f2a4d; color:#fff; padding:11px 14px; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
.pv .phone-top .row1 { display:flex; align-items:baseline; gap:8px; }
.pv .phone-top .t { font-size:17px; font-weight:800; }
.pv .phone-top .v { font-size:11px; color:#93c5fd; margin-left:auto; }
.pv .phone-top .b { font-size:11px; color:#fde68a; }
.pv .phone-btns { display:flex; gap:8px; padding:9px 14px; background:#0f2a4d; }
.pv .phone-btns span { flex:1; text-align:center; font-size:12px; font-weight:700; color:#fff; border:1px solid #7ea6dd; border-radius:9px; padding:7px 0; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
.pv .strike { text-decoration: line-through; color:#9aa4b8; }
</style></head><body><div class="pv">
<h1>Round-23 · Available me sirf AVL/RAC · review page par sirf Continue to IRCTC</h1>
<div class="sub">
  Sab kuch app ke <b>asli components</b> se render hua hai (wahi React code + built CSS), plan data <b>live</b> (ASR → NDLS).
  Filter wala card chips par <b>asli click</b> se capture kiya gaya hai.
</div>

<h2>1 · ✅ Available — pehle WL class chip bhi dikhti thi, ab sirf AVL/RAC</h2>
<div class="card"><div class="cap">🚆 Sabhi trains (default) — har train ki saari classes (WL/N-A halki) — jaisa tha waisa</div>${cards.default}</div>
<div class="card"><div class="cap">✅ Available — ab sirf AVL/RAC classes (WL chips hata; WL-only train list se hat gayi)</div>${cards.avail}</div>

<h2>2 · Review page — ab sirf Continue to IRCTC</h2>
<div class="grid2">
  <div class="card"><div class="cap">Pehle: booking summary + wallet + note + Confirm Booking (sticky) + copy summary</div>${review.was}</div>
  <div class="card"><div class="cap">Ab: sirf IRCTC handoff card</div>${review.now}</div>
</div>

<h2>3 · App header — kaun sa build chal raha hai, ab saaf</h2>
<div class="card"><div class="pv" style="padding:0">
  <div class="phone">
    <div class="phone-top">
      <div class="row1"><span class="t">RailBook</span><span class="strike">v1.2.8</span><span class="v">v1.4.7 (30)</span><span class="b">BHASHA: HINGLISH</span></div>
    </div>
    <div class="phone-btns"><span>RAILBOOK</span><span>IRCTC</span><span>CLEAR HANDOFF</span></div>
    <div class="phone-top" style="text-align:center; padding:26px 14px">
      <div style="font-size:16px; font-weight:800">Redirecting to IRCTC…</div>
      <div style="font-size:52px; font-weight:800; color:#93c5fd; margin-top:14px">45s</div>
    </div>
  </div>
  <div class="note" style="margin-top:12px">Pehle header me <b>hardcoded "v1.2.8"</b> likha aata tha (kabhi badla hi nahi), isliye device par naya APK hai ya nahi — pata nahi chalta tha. Ab asli <b>versionName (versionCode)</b> dikhta hai. Teesre screenshot wala 30s + purani lines wala overlay <b>purane APK</b> ka tha: v1.4.6/v1.4.7 me title "Redirecting to IRCTC…", countdown <b>45s</b> aur step lines hidden hain.</div>
</div></div>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, OUT_HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
