/* Round-28 probe: Passengers page ko asli component se render karke "pehle vs ab" banata hai —
 * pehle overlay `.app` ke andar absolute tha (chat lambi hone par bottom dock screen ke NEECHE chala
 * jaata tha: user ko bahut scroll karke pata chalta tha ki "Review journey" button bhi hai), ab overlay
 * viewport se bandha hai (fixed + 100vh/100dvh) — dock hamesha screen par.
 *
 *   node tools/probe-pax-dock.mjs        # /tmp/pax-before.html + /tmp/pax-after.html
 * Phir playwright se naapo (probe-live-r28.mjs live site par yahi karta hai). */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/tmp/pax-probe.html";

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

globalThis.fetch = async (url) => {
  const u = String(url?.url ?? url);
  const body = u.includes("/pantry")
    ? { trainNumber: "12013", pantry: true, sources: { erail: true, confirmtkt: true }, conflict: false, premiumCatering: true, foodChoiceExpected: true, evidence: ["Shatabdi — catering fare me included"], providers: ["web_erail", "web_confirmtkt"], note: null }
    : u.includes("/api/meta")
      ? { provider: { id: "live", name: "RailBook", mock: false }, serviceFee: 50 }
      : u.includes("/api/wallet")
        ? { wallet: { balance: 10000, currency: "INR", transactions: [] } }
        : u.includes("/api/bookings")
          ? { bookings: [] }
          : {};
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

sessionStorage.setItem(
  "railbook.booking.v1",
  JSON.stringify({
    flow: "PASSENGERS_PENDING",
    screen: "passengers",
    date: "2026-09-27",
    dateProvided: true,
    passengerCount: 2,
    paxProvided: true,
    trains: [train],
    selectedTrain: train,
    selectedClass: train.classes[0],
    seatPreference: "",
    booking: null,
    emptyMessage: null,
    notice: null,
    error: null,
    searching: false,
    recommendations: [],
    sessionId: 1,
    passengers: [
      { id: "p1", name: "", age: "", gender: "", berthPreference: "", foodChoice: "", idType: "", idNumber: "", bookOnlyIfConfirm: false, autoUpgrade: false },
    ],
    contact: { mobile: "", email: "", whatsappOptIn: true },
  }),
);

const target = document.getElementById("pax");
render(React.createElement(BookingProvider, null, React.createElement(Passengers, null)), { container: target });
await new Promise((r) => setTimeout(r, 400));
const html = target.innerHTML;
cleanup();
await vite.close();


/* Asli App.tsx jaisa wrapper: overlay-screen ke andar hi booking screens hote hain. */
const wrapped = `<div class="overlay-screen">${html}</div>`;

const pageCss = `
  body { margin:0; background:#22252b; }
  /* Device jaisa: .app ki min-height 100dvh hai par chat lambi hone par wo usse bada ho jaata hai. */
  .app { min-height:900px; height:1400px; max-width:430px; position:relative; overflow:hidden; margin:0 auto; }
  /* PEHLE (Round-27 tak): overlay .app ke andar absolute tha → dock screen ke neeche chala jaata tha. */
  .pv-before .overlay-screen { position:absolute; top:0; left:0; right:0; bottom:0; height:auto; max-width:none; margin:0; }`;

const mk = (cls, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n${pageCss}</style></head><body class="${cls}"><div class="app">${body}</div></body></html>`;

fs.writeFileSync("/tmp/pax-before.html", mk("pv-before", wrapped), "utf8");
fs.writeFileSync("/tmp/pax-after.html", mk("pv-after", wrapped), "utf8");
console.log("wrote /tmp/pax-before.html + /tmp/pax-after.html");
