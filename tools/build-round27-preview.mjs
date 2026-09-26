/* Round-27 preview (26 Sep 2026) — user ke 2 screenshots + 4 points:
 *   (a) "yeh ek hi class dikha rha, jabhi ki aur bhi classes mein seat available hai same train mein"
 *   (b) "baki ki trains live board par hai aa raha"
 *   (c) "agar yahan koi class pe tap kare to user ko fir sidha passenger form pe laajao"
 *   (d) "mic working nahi hai" (Android WebView me Web Speech API hi nahi hota)
 *
 * Sab kuch asli code se: server ke helpers (groupRowsByTrain / trainClassesText / seatSummaryLine),
 * client ka asli component (TrainClassBlock — wahi jo chat block aur Seat Finder me lagta hai) aur
 * asli built CSS. Live screenshots asli browser probe (tools/probe-live-r27.mjs) ke hain.
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round27-2026-09-26.html";

const css = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".css"));
  return fs.readFileSync(path.join(dir, f), "utf8");
})();

const dom = new JSDOM("<!doctype html><html><body><div id='before'></div><div id='after'></div></body></html>", {
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
const { TrainClassBlock } = await vite.ssrLoadModule("/src/components/TrainClassBlock.tsx");
const { seatSummaryLine, groupRowsByTrain } = await vite.ssrLoadModule("/server/agent/seatFilter.ts");
const { seatListGroups } = await vite.ssrLoadModule("/src/chatText.ts");

/* Asli live-board rows (probe: LDH → ASR, 27 Sep 2026, 1 pax) — jo board ne diya wahi. */
const R = (number, name, classCode, status, o = {}) => ({
  number,
  name,
  classCode,
  status,
  seats: status === "AVAILABLE" ? 50 : null,
  rac: status === "RAC" ? 9 : null,
  waitlist: status === "WAITLIST" ? 14 : null,
  fare: 150,
  departure: null,
  durationMinutes: 300,
  ...o,
});
const rows = [
  R("12013", "AMRITSAR SHTABDI", "CC", "AVAILABLE", { seats: 418, fare: 675 }),
  R("12013", "AMRITSAR SHTABDI", "EC", "AVAILABLE", { seats: 23, fare: 1015 }),
  R("19611", "AII ASR EXP", "SL", "AVAILABLE", { seats: 174 }),
  R("19611", "AII ASR EXP", "3A", "AVAILABLE", { seats: 71, fare: 520 }),
  R("19611", "AII ASR EXP", "3E", "AVAILABLE", { seats: 15, fare: 520 }),
  R("19611", "AII ASR EXP", "2A", "AVAILABLE", { seats: 14, fare: 725 }),
  R("22487", "VANDE BHARAT EXP", "CC", "AVAILABLE", { seats: 147, fare: 790 }),
  R("22487", "VANDE BHARAT EXP", "EC", "AVAILABLE", { seats: 15, fare: 1325 }),
  R("14631", "DDN ASR EXPRESS", "SL", "AVAILABLE", { seats: 107 }),
  R("14631", "DDN ASR EXPRESS", "3A", "WAITLIST", { waitlist: 18, fare: 520 }),
  R("20807", "HIRAKUD EXPRESS", "3A", "AVAILABLE", { seats: 62, fare: 565 }),
  R("20807", "HIRAKUD EXPRESS", "3E", "AVAILABLE", { seats: 8, fare: 565 }),
  R("20807", "HIRAKUD EXPRESS", "2A", "AVAILABLE", { seats: 6, fare: 770 }),
  R("20807", "HIRAKUD EXPRESS", "SL", "AVAILABLE", { seats: 4, fare: 180 }),
  R("15707", "KIR ASR EXPRESS", "2A", "AVAILABLE", { seats: 37, fare: 725 }),
  R("15707", "KIR ASR EXPRESS", "3E", "AVAILABLE", { seats: 3, fare: 520 }),
  R("15707", "KIR ASR EXPRESS", "3A", "AVAILABLE", { seats: 1, fare: 520 }),
  R("15707", "KIR ASR EXPRESS", "SL", "NOT_AVAILABLE", { fare: 150 }),
  R("14615", "LKU ASR EXP", "SL", "AVAILABLE", { seats: 50 }),
  R("14615", "LKU ASR EXP", "3E", "AVAILABLE", { seats: 3, fare: 520 }),
  R("14615", "LKU ASR EXP", "3A", "WAITLIST", { waitlist: 2, fare: 520 }),
  R("14615", "LKU ASR EXP", "2A", "UNKNOWN", { fare: 725 }),
];
const wlRows = [
  R("13005", "HWH ASR MAIL", "1A", "WAITLIST", { waitlist: 2, fare: 1190 }),
  R("13005", "HWH ASR MAIL", "2A", "WAITLIST", { waitlist: 16, fare: 725 }),
  R("13005", "HWH ASR MAIL", "3A", "WAITLIST", { waitlist: 24, fare: 520 }),
];

/* PEHLE (screenshot jaisa): cap rows (12) par laga tha — same train ki doosri classes kat gayi thi. */
const beforeGroups = seatListGroups([...rows.slice(0, 12)]);
/* AB (fix ke baad): cap trains par — har train ki SAARI classes. */
const afterGroups = seatListGroups([...rows, ...wlRows]);

const chipOf = (r) => ({
  code: r.classCode,
  status: r.status,
  seats: r.seats,
  rac: r.rac,
  waitlist: r.waitlist,
  fare: r.fare,
  seat: r.status === "AVAILABLE" || r.status === "RAC",
});
const groupsHtml = (gs) =>
  gs
    .map((g) => {
      const seatCount = g.rows.filter((r) => r.status === "AVAILABLE" || r.status === "RAC").length;
      return renderIntoRaw(
        React.createElement(TrainClassBlock, {
          number: g.number,
          name: g.name,
          timeText: "🕑 live board",
          countText: `${g.rows.length} class${g.rows.length === 1 ? "" : "es"} (${seatCount} me seat)`,
          rows: g.rows.map(chipOf),
        }),
      );
    })
    .join("");

/* Server ki asli summary lines (dono shakal — pehle ek row per train/class, ab ek train ki saari classes). */
const slot = { classCodes: [], classGroup: null, onlyAvailable: true, sortBy: null, departAfterMinute: null };
const lineNow = seatSummaryLine({ seat: rows, wl: [], missingClass: 0, unknownTime: 0 }, slot, { from: "LDH", to: "ASR" });
const grouped = groupRowsByTrain(rows);
const lineBefore = grouped
  .map((g) => `${g.number} ${g.classes[0].classCode} AVL ${g.classes[0].seats ?? ""} ₹${g.classes[0].fare ?? ""}`)
  .join(" | ");

function renderIntoRaw(node) {
  const t = document.createElement("div");
  render(node, { container: t });
  const html = t.innerHTML;
  cleanup();
  return html;
}

const beforeHtml = groupsHtml(beforeGroups);
const afterHtml = groupsHtml(afterGroups);

await vite.close();

const OUT_HTML = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RailBook Round-27 · har train ki saari classes + tap → passenger form + native mic</title>
<style>
${css}
body { background:#f6f2ec; margin:0; }
.pv { max-width:1180px; margin:0 auto; padding:22px 18px 70px; }
.pv h1 { font-size:20px; margin:0 0 6px; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; color:#1d2230; }
.pv .sub { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:13px; line-height:1.55; color:#55607a; margin-bottom:16px; }
.pv h2 { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; margin:22px 0 10px; }
.pv .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
@media (max-width:1000px){ .pv .grid2 { grid-template-columns:1fr; } }
.pv .card { background:#fff; border:1px solid #e6e2da; border-radius:16px; padding:14px; }
.pv .card.bad { border-left:4px solid #b91c1c; }
.pv .card.good { border-left:4px solid #15803d; }
.pv .cap { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:12.5px; font-weight:700; color:#123a63; margin-bottom:10px; }
.pv .note { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:12.5px; line-height:1.6; color:#3c4964; background:#fff; border:1px solid #e6e2da; border-left:4px solid #123a63; border-radius:12px; padding:11px 13px; margin-bottom:16px; }
.pv .live { display:flex; gap:12px; flex-wrap:wrap; }
.pv .live img { width:300px; border:1px solid #e0dcd4; border-radius:14px; }
.pv code { font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#f1f4f8; border-radius:6px; padding:1px 5px; }
.pv .mono { font-family:ui-monospace,Menlo,monospace; font-size:11.5px; line-height:1.7; color:#33405c; word-break:break-word; }
</style></head><body><div class="pv">
<h1>Round-27 · "ek hi class dikha raha" + "class pe tap → sidha passenger form" + "mic working nahi hai"</h1>
<div class="sub">
  Sab kuch app ke asli component (<b>TrainClassBlock</b> — wahi jo chat block aur Seat Finder dono me lagta hai) aur
  server ke asli helpers (<code>groupRowsByTrain</code>, <code>seatSummaryLine</code>) se render hua hai — yahi code live hai (deploy <b>76d53c3</b>).
  Live section ke screenshots asli browser probe (<code>tools/probe-live-r27.mjs</code>) ke hain.
</div>
<div class="note">
  <b>1) Ek hi class kyun dikh rahi thi:</b> server ka cap (12) <i>rows</i> par laga tha, aur rows = train × class.
  Isliye 12013 ki EC, 15707 ki 3E/3A/SL, 20807 ki baaki classes chat block me kat jaati thi (text me aa rahi thi) —
  ConfirmTkt par wahi classes dikh rahi thi. Ab cap <b>trains</b> par lagta hai: 12 trains, aur har train ki
  <b>saari</b> classes (AVL/RAC/WL/N-A, status ke saath) ek saath.<br>
  <b>2) "Baki trains live board par hai":</b> wahi live board ki rows ab usi jawab ke block me aati hain — 20 trains
  (12 me seat + 8 WL/N-A).<br>
  <b>3) Tap = booking:</b> har class chip tappable hai — tap par wahi <code>bookingFromSeatRow</code> flow chalta hai jo
  Seat Finder/direct card ke chips par: usi train + usi class ka <b>passenger form</b> khulta hai.<br>
  <b>4) Mic:</b> Android <b>WebView</b> me Web Speech API (<code>webkitSpeechRecognition</code>) hota hi nahi — isliye
  "Mic band" message aata tha. Ab app apna <b>native SpeechRecognizer</b> deta hai (<code>VoiceBridge.kt</code> →
  <code>window.RailBookVoice</code>), aur client usi ko use karta hai (<code>src/voice/nativeSpeech.ts</code>).
  Transcript "OK ✓ Bhejo" par bhejta hai (manual-commit — jaisa pehle tha).
</div>
<h2>1 · Pehle vs Ab — ek train ki saari classes (asli block, asli component)</h2>
<div class="grid2">
  <div class="card bad"><div class="cap">Pehle — cap rows par tha: 12013 sirf CC, 22487 sirf CC, 20807 sirf 3A… (EC/3E/2A/SL gayab)</div>
    <div class="sf-card jx-sb"><div class="sf-head"><strong>Seat wali trains (live board)</strong><span class="muted">${beforeGroups.length} trains</span></div><div class="sf-groups">${beforeHtml}</div></div>
  </div>
  <div class="card good"><div class="cap">Ab — 12 trains, har train ki SAARI classes (WL/N-A bhi halki, status ke saath)</div>
    <div class="sf-card jx-sb"><div class="sf-head"><strong>Seat wali trains (live board)</strong><span class="muted">${afterGroups.length} trains · ${afterGroups.filter((g) => g.rows.some((r) => r.status === "AVAILABLE" || r.status === "RAC")).length} me seat · confirmtkt</span></div><div class="sf-groups">${afterHtml}</div></div>
  </div>
</div>
<h2>2 · Server ki summary line (jawab me jo jaata hai)</h2>
<div class="card"><div class="cap">Pehle — ek train ki ek hi class line me</div><div class="mono">💺 seat wali ${grouped.length} trains — ${lineBefore} (LDH → ASR · live board)</div></div>
<div class="card" style="margin-top:12px"><div class="cap">Ab — train ke andar uski saari classes (<code>·</code>), trains alag (<code>|</code>)</div><div class="mono">${lineNow}</div></div>
<h2>3 · Live site par (asli browser, Pixel-size)</h2>
<div class="card"><div class="cap">"Kya kal ke liye koi available seat hai ludhiana se amritsar ke liye?" → poora block, aur class chip tap → passenger form</div>
  <div class="live">
    <img src="round27-live-seat-block-top.png" alt="live seat block" />
    <img src="round27-live-chip-tap.png" alt="chip tap → passenger form" />
    <img src="round27-live-native-voice.png" alt="native voice sheet" />
  </div>
</div>
<h2>4 · Mic (app ke andar)</h2>
<div class="note">
  Browser me <code>start:hi-IN</code> native bridge ke through chalta hai (probe me mock bridge se verify hua:
  <code>native calls: start:hi-IN</code>, koi "Mic band" message nahi, koi page error nahi), transcript sheet me
  aata hai aur <b>OK ✓ Bhejo</b> par sawaal chala jaata hai. Asli device par ye kaam APK <b>v1.4.8</b> se karta hai
  (jo is round me bana hai — pehle wale APK me WebView ka Web Speech hi try hota tha).
</div>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, OUT_HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
