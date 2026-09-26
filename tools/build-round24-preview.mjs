/* Round-24 preview builder (26 Sep 2026) — asli React components (vite SSR loader), asli built CSS,
 * asli live payload (ASR→NDLS plan). Dikhata hai:
 *   1) Review page (Round-24): ab "Review journey" = journey receipt (Train/Date/From → To/Class/Seat/
 *      Passengers/Base fare/Service fee/Total + passenger & contact details) aur uske NEECHE sirf
 *      Continue to IRCTC — uske elawa kuch nahi. Pehle (Round-23): khaali page par sirf button.
 *   2) Passengers screen: "Review journey" CTA + prompt, aur khaali passengers list ka guard
 *      (pehle blank page + enabled CTA, ab apne aap ek card).
 *
 *   node tools/build-round23-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round24-2026-09-26.html";

const css = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".css"));
  return fs.readFileSync(path.join(dir, f), "utf8");
})();

const dom = new JSDOM(
  "<!doctype html><html><body><div id='review-now'></div><div id='review-was'></div><div id='pax-guard'></div><div id='pax-now'></div></body></html>",
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
const { Passengers } = await vite.ssrLoadModule("/src/views/Passengers.tsx");
const { BookingProvider } = await vite.ssrLoadModule("/src/booking/context.tsx");
const { FareReview } = await vite.ssrLoadModule("/src/views/ReviewStatus.tsx");
const { IrctcHandoff } = await vite.ssrLoadModule("/src/components/IrctcHandoff.tsx");
const { Shell } = await vite.ssrLoadModule("/src/components/Shell.tsx");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.fetch = async (url) => {
  const u = String(url?.url ?? url);
  const body = u.includes("/pantry")
    ? {
        trainNumber: "12484",
        pantry: true,
        sources: { erail: true, confirmtkt: true },
        conflict: false,
        premiumCatering: false,
        foodChoiceExpected: true,
        evidence: ["erail + confirmtkt: catering available"],
        providers: ["web_erail", "web_confirmtkt"],
        note: null,
      }
    : u.includes("/api/meta")
    ? { provider: { id: "live", name: "RailBook", mock: false }, serviceFee: 0 }
    : u.includes("/api/wallet")
      ? { wallet: { balance: 10000, currency: "INR", transactions: [] } }
      : u.includes("/api/bookings")
        ? { bookings: [] }
        : {};
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

/* ── 1. Review page (asli FareReview) — journey receipt + Continue ── */
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

function seedReview(state) {
  sessionStorage.setItem(
    "railbook.booking.v1",
    JSON.stringify({
      flow: "REVIEW_READY",
      date: "2026-09-27",
      dateProvided: true,
      passengerCount: 2,
      paxProvided: true,
      trains: [train],
      selectedTrain: train,
      selectedClass: train.classes[0],
      seatPreference: "Lower",
      booking: null,
      emptyMessage: null,
      notice: null,
      error: null,
      searching: false,
      recommendations: [],
      sessionId: 1,
      ...state,
    }),
  );
}

const pax2 = [
  { id: "p1", name: "Mohit Kumar", age: "38", gender: "MALE", berthPreference: "Lower", foodChoice: "", idType: "", idNumber: "", bookOnlyIfConfirm: true, autoUpgrade: false },
  { id: "p2", name: "Asha Devi", age: "35", gender: "FEMALE", berthPreference: "Upper", foodChoice: "VEG", idType: "", idNumber: "", bookOnlyIfConfirm: false, autoUpgrade: true },
];
const contact = { mobile: "9876543210", email: "mohit@example.com", whatsappOptIn: true };

const shots = {};
const renderInto = async (id, node) => {
  const target = document.getElementById(id);
  render(node, { container: target });
  await wait(200);
  shots[id] = target.innerHTML;
  cleanup();
};

/* ab — naya review page */
sessionStorage.clear();
seedReview({ screen: "review", passengers: pax2, contact, previewFare: { baseFare: 200, serviceFee: 50, total: 250 } });
await renderInto("review-now", React.createElement(BookingProvider, null, React.createElement(FareReview, null)));

/* pehle (Round-23) — khaali page par sirf button (isliye ye "itni khaali thi" wali complaint aayi) */
{
  const t = document.getElementById("review-was");
  const inner = document.createElement("div");
  t.appendChild(inner);
  render(
    React.createElement(
      BookingProvider,
      null,
      React.createElement(
        Shell,
        { title: "Continue to IRCTC", back: true },
        React.createElement("main", { className: "page" }, React.createElement(IrctcHandoff, { train, date: "2026-09-27", classCode: "SL", passengers: pax2, contact })),
      ),
    ),
    { container: inner },
  );
  await wait(200);
  shots["review-was"] = t.innerHTML;
  cleanup();
}

/* Passengers: ab (CTA label) — aur khaali list ka guard */
sessionStorage.clear();
seedReview({ screen: "passengers", flow: "PASSENGERS_PENDING", passengers: [], contact: { mobile: "", email: "", whatsappOptIn: true } });
{
  const t = document.getElementById("pax-guard");
  render(React.createElement(BookingProvider, null, React.createElement(Passengers, null)), { container: t });
  await wait(260);
  shots["pax-guard"] = t.innerHTML;
  cleanup();
}
sessionStorage.clear();
seedReview({ screen: "passengers", flow: "PASSENGERS_PENDING", passengers: pax2, contact });
await renderInto("pax-now", React.createElement(BookingProvider, null, React.createElement(Passengers, null)));

await vite.close();

const OUT_HTML = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RailBook Round-24 · Review journey page (journey summary + Continue to IRCTC)</title>
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
</style></head><body><div class="pv">
<h1>Round-24 · Review journey — journey summary + uske neeche sirf Continue to IRCTC</h1>
<div class="sub">
  Sab kuch app ke <b>asli components</b> se render hua hai (wahi React code + built CSS) aur asli state ke saath —
  jo user ne form me bhara (2 passengers, berth, food, mobile/email) wahi summary me dikhta hai.
</div>
<div class="note">
  <b>Kya badla:</b> "Review fare" → <b>"Review journey"</b> (button + voice prompt). Review page par ab
  <b>journey receipt</b> hai — Train · Date · From → To · Class · Seat · Passengers · Base fare · Service fee · Total,
  aur neeche har passenger ki detail (naam · umar · gender · berth · khaana · checkbox) + Mobile/Email.
  Uske <b>neeche</b> sirf <b>Continue to IRCTC</b>. Wallet, Confirm Booking, copy summary, extra notes — kuch nahi.
</div>
<h2>1 · Review journey page (ab)</h2>
<div class="card"><div class="cap">Journey receipt → Continue to IRCTC (aur kuch nahi)</div>${shots["review-now"]}</div>
<h2>2 · Pehle (Round-23) — khaali page par sirf button</h2>
<div class="card"><div class="cap">Round-23 me summary hata di gayi thi — isliye page khaali lagta tha</div>${shots["review-was"]}</div>
<h2>3 · Passengers screen — CTA label + khaali list ka guard</h2>
<div class="card"><div class="cap">Passengers list khaali mile to ab apne aap ek card (pehle: blan… sirf background + enabled CTA)</div>${shots["pax-guard"]}</div>
<div class="card"><div class="cap">Bhari hui list — neeche ka CTA "Review journey" kehta hai (prompt bhi wahi)</div>${shots["pax-now"]}</div>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, OUT_HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
