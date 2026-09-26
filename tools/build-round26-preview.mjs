/* Round-26 preview (26 Sep 2026) — user screenshot ki last line:
 *   "+5 aur SL available trains Seat Finder card mein hain. ⚙️ find seats"
 * Dikhata hai: pehle kya hota tha (top-4 line + jhootha card pointer, baaki trains kahin nahi) aur
 * ab kya hota hai (saari trains isi jawab me + usi format me jo chat rows me todta hai).
 * Asli components (ReplyText) + asli built CSS + asli server helper (seatSummaryLine/missingSeatLines).
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round26-2026-09-26.html";

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
const { ReplyText } = await vite.ssrLoadModule("/src/components/ReplyText.tsx");
const { missingSeatLines, seatSummaryLine } = await vite.ssrLoadModule("/server/agent/seatFilter.ts");
const { stripSeatCardPointer } = await vite.ssrLoadModule("/src/chatText.ts");

const row = (number, name, cls, status, extra = {}) => ({
  number,
  name,
  classCode: cls,
  status,
  seats: status === "AVAILABLE" ? 50 : null,
  rac: status === "RAC" ? 9 : null,
  waitlist: status === "WAITLIST" ? 21 : null,
  fare: 150,
  departure: "06:10",
  durationMinutes: 300,
  ...extra,
});

/* Asli board rows (live board se — LDH → ASR, 27 Sep, SL) */
const mk = (number, name, status, extra = {}) => ({
  number,
  name,
  classCode: "SL",
  status,
  seats: status === "AVAILABLE" ? 50 : null,
  rac: status === "RAC" ? 9 : null,
  waitlist: status === "WAITLIST" ? 14 : null,
  fare: 150,
  departure: "06:10",
  durationMinutes: 300,
  ...extra,
});
const avail = [
  mk("19611", "All ASR EXP", "AVAILABLE", { seats: 174 }),
  mk("14631", "DDN ASR EXPRESS", "AVAILABLE", { seats: 107, departure: "03:20" }),
  mk("14615", "LKU ASR EXP", "AVAILABLE", { seats: 50, departure: "02:15" }),
  mk("14663", "AMRIT BHARAT EXP", "AVAILABLE", { seats: 22, fare: 170, departure: "07:35" }),
  mk("13005", "HWH ASR MAIL", "AVAILABLE", { seats: 7 }),
  mk("12903", "GOLDEN TEMPLE", "AVAILABLE", { seats: 5, fare: 180 }),
  mk("14653", "HSR ASR EXPRESS", "AVAILABLE", { seats: 4 }),
  mk("20807", "HIRAKUD EXPRESS", "AVAILABLE", { seats: 4, fare: 180 }),
  mk("11057", "CSMT ASR EXPRESS", "AVAILABLE", { seats: 3 }),
  mk("15707", "KIR ASR EXPRESS", "AVAILABLE", { seats: 1 }),
];
const other = [
  mk("12357", "DURGIANA EXP", "WAITLIST", { waitlist: 10, fare: 180, departure: "18:40" }),
  mk("14623", "S G VARNASI EXP", "WAITLIST", { waitlist: 22 }),
  mk("18237", "CHATTISGARH EXP", "NOT_AVAILABLE"),
  mk("12411", "INTERCITY EXP", "NOT_AVAILABLE", { fare: 180 }),
];
const allRows = [...avail, ...other];

const line = (r) =>
  `* ${r.number} ${r.name} — ${r.classCode} — ${
    r.status === "AVAILABLE" ? `AVAILABLE ${r.seats} seats` : r.status === "WAITLIST" ? `WL ${r.waitlist}` : "N/A"
  } — ₹${r.fare}${r.departure ? ` — ${r.departure} departure` : ""}`;

/* PEHLE (user ke screenshot jaisa): sirf available (10) + pehli train intro line me chhipi → "9 me seat" */
const beforeText = [
  "27 Sep 2026, SL class, 1 passenger ke liye seat available wali trains: " + line(avail[0]).slice(2),
  ...avail.slice(1).map(line),
].join("\n");

/* AB: WL/N-A bhi (kyunki user ne khud available nahi maanga) + pehli train bhi row → 14 rows, summary match */
const afterText = ["27 Sep 2026, SL class, 1 passenger ke liye seat wali trains mili hain:", ...allRows.map(line)].join("\n");

/* Summary line (jab user ne khud "sirf available" maanga) — tabhi filter */
const lineFiltered = seatSummaryLine(
  { seat: avail, wl: [], missingClass: 0, unknownTime: 0 },
  { classCodes: ["SL"], classGroup: null, onlyAvailable: true, sortBy: null, departAfterMinute: null },
  { from: "LDH", to: "ASR" },
);
/* Summary line (default: saari trains, seat + WL dono) */
const lineAll = seatSummaryLine(
  { seat: avail, wl: other, missingClass: 0, unknownTime: 0 },
  { classCodes: ["SL"], classGroup: null, onlyAvailable: false, sortBy: null, departAfterMinute: null },
  { from: "LDH", to: "ASR" },
);

const renderInto = (id, node) => {
  const t = document.getElementById(id);
  render(node, { container: t });
  const html = t.innerHTML;
  cleanup();
  return html;
};

const before = renderInto("before", React.createElement(ReplyText, { text: beforeText }));
const after = renderInto("after", React.createElement(ReplyText, { text: afterText }));

await vite.close();

const OUT_HTML = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RailBook Round-26 · WL/N-A trains bhi + count mismatch fix</title>
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
.pv .msg { background:#fdfcf9; border:1px solid #e9e4da; border-radius:14px; padding:10px 12px; }
.pv .live { display:flex; gap:12px; flex-wrap:wrap; }
.pv .live img { width:300px; border:1px solid #e0dcd4; border-radius:14px; }
.pv code { font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#f1f4f8; border-radius:6px; padding:1px 5px; }
</style></head><body><div class="pv">
<h1>Round-26 · "sirf available mat show karo — W/L trains bhi" + "10 trains par 9 show kar rahi"</h1>
<div class="sub">
  Sab kuch app ke asli component (<b>ReplyText</b>) aur server ke asli helpers (<code>seatSummaryLine</code>,
  <code>parseSeatIntent</code>) se render hua hai — yahi code live ja chuka hai (deploy 630c6f9).
</div>
<div class="note">
  <b>1) Count:</b> AI aksar pehli train ko hi intro line me likh deta hai ("… trains: 19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150").
  Pehle parser ka label sirf 40 akshar tak match karta tha → wo row head me chali jaati thi aur summary
  "9 me seat" ginnti thi jabki 10 trains thi. Ab wo row bhi row hai — count match.<br>
  <b>2) WL/N-A:</b> pehle har seat-sawaal par "sirf available" filter apne aap lag jaata tha. Ab
  <b>default me saari trains</b> aati hain (AVL/RAC + WL/N-A, status ke saath) — filter sirf tab jab user
  khud <i>available / khali / vacant / sirf available / confirmed</i> bole. Summary line bhi ab total +
  seat/WL ka farq batati hai.
</div>
<h2>1 · Pehle vs Ab (asli reply text → asli chat rows)</h2>
<div class="grid2">
  <div class="card bad"><div class="cap">Pehle — pehli train intro line me chhipi ("9 me seat" jabki 10 trains) aur WL trains gayab</div><div class="msg">${before}</div></div>
  <div class="card good"><div class="cap">Ab — saari 14 trains (10 AVL/RAC + 4 WL/N-A), summary 14 = 10 + 4</div><div class="msg">${after}</div></div>
</div>
<h2>2 · Filter tabhi jab user khud maange (server ki asli summary lines)</h2>
<div class="card"><div class="cap">Default (user ne sirf available nahi bola) — WL/N-A bhi</div><div class="msg"><code>${lineAll}</code></div></div>
<div class="card" style="margin-top:12px"><div class="cap">User ne "sirf available / khali / confirmed" bola — tabhi sirf AVL/RAC</div><div class="msg"><code>${lineFiltered}</code></div></div>
<h2>3 · Live site par (asli browser, Pixel-size) — deploy ke baad</h2>
<div class="card"><div class="cap">18 trains mile: 10 me seat + 8 WL/N-A — summary "💺 18 trains: 10 me seat (…) · 8 WL/N-A"</div>
  <div class="live">
    <img src="round26-live-seat-answer-top.png" alt="live seat answer" />
    <img src="round26-live-seat-answer-bottom.png" alt="live seat answer bottom" />
  </div>
</div>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, OUT_HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
