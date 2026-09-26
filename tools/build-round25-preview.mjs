/* Round-25 preview (26 Sep 2026) — user screenshot ki last line:
 *   "+5 aur SL available trains Seat Finder card mein hain. ⚙️ find seats"
 * Dikhata hai: pehle kya hota tha (top-4 line + jhootha card pointer, baaki trains kahin nahi) aur
 * ab kya hota hai (saari trains isi jawab me + usi format me jo chat rows me todta hai).
 * Asli components (ReplyText) + asli built CSS + asli server helper (seatSummaryLine/missingSeatLines).
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round25-2026-09-26.html";

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

/* Asli board rows (screenshot wali 10 trains me se 6 — SL, 27 Sep) */
const rows = [
  row("19611", "All ASR EXP", "SL", "AVAILABLE", { seats: 174, fare: 150, departure: "06:25" }),
  row("14615", "LKU ASR EXP", "SL", "AVAILABLE", { seats: 50, fare: 150, departure: "02:15" }),
  row("14631", "DDN ASR EXPRESS", "SL", "AVAILABLE", { seats: 26, fare: 150, departure: "03:20" }),
  row("14663", "AMRIT BHARAT EXP", "SL", "AVAILABLE", { seats: 22, fare: 170, departure: "07:35" }),
  row("13005", "HWH ASR MAIL", "SL", "AVAILABLE", { seats: 7, fare: 150, departure: "08:10" }),
  row("13006", "ASR HWH MAIL", "SL", "AVAILABLE", { seats: 9, fare: 150, departure: "17:40" }),
];

/* PEHLE (wahi line jo user ke screenshot me thi) */
const beforeText =
  "27 Sep 2026, SL class, 1 passenger ke liye seat wali 10 trains mili hain. Top trains:\n" +
  "* 19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150 — 06:25 departure\n" +
  "* 14615 LKU ASR EXP — SL — AVAILABLE 50 seats — ₹150 — 02:15 departure\n" +
  "* 14631 DDN ASR EXPRESS — SL — AVAILABLE 26 seats — ₹150 — 03:20 departure\n" +
  "* 14663 AMRIT BHARAT EXP — SL — AVAILABLE 22 seats — ₹170 — 07:35 departure\n" +
  "* 13005 HWH ASR MAIL — SL — AVAILABLE 7 seats — ₹150 — 08:10 departure\n" +
  "+5 aur SL available trains Seat Finder card mein hain.";

/* AB: wahi AI jawab (5 lines), par baaki trains ki asli lines usi message me + pointer saaf */
const aiReply =
  "27 Sep 2026, SL class, 1 passenger ke liye seat wali 6 trains mili hain:\n" +
  "* 19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150 — 06:25 departure\n" +
  "* 14615 LKU ASR EXP — SL — AVAILABLE 50 seats — ₹150 — 02:15 departure\n" +
  "* 14631 DDN ASR EXPRESS — SL — AVAILABLE 26 seats — ₹150 — 03:20 departure\n" +
  "+3 aur SL available trains Seat Finder card mein hain.";
const afterText = stripSeatCardPointer([aiReply, ...missingSeatLines(aiReply, rows)].join("\n"));
const seatLine = seatSummaryLine(
  { seat: rows, wl: [], missingClass: 0, unknownTime: 0 },
  { classCodes: ["SL"], classGroup: null, sortBy: null, departAfterMinute: null },
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
<title>RailBook Round-25 · "baki trains card me hain" → ab saari trains isi jawab me</title>
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
.pv code { font-family:ui-monospace,Menlo,monospace; font-size:12px; background:#f1f4f8; border-radius:6px; padding:1px 5px; }
</style></head><body><div class="pv">
<h1>Round-25 · "+5 aur SL available trains Seat Finder card mein hain" — ab baki trains isi jawab me</h1>
<div class="sub">
  Sab kuch app ke asli components (<b>ReplyText</b>, wahi jo chat me rows banata hai) aur server ke asli helpers
  (<code>seatSummaryLine</code> / <code>missingSeatLines</code>) se render hua hai — same code jo live jayega.
</div>
<div class="note">
  <b>Wajah:</b> purane rounds me chat ke andar ek Seat Finder card mount hota tha, tab AI ki line "<i>baaki trains
  Seat Finder card me</i>" sach thi. Round-21c me wo card chat se hata diya gaya — par wahi line (server ki summary
  me) reh gayi, isliye AI bhi wahi likhta raha aur baaki trains <b>kahin dikhti hi nahi thi</b>.
  <b>Ab:</b> (1) summary line saari trains likhti hai, (2) jo trains AI ke jawab me chhoot gayi wo usi message me
  usi format me jud jaati hain (live board ki asli rows — kuch invent nahi), (3) client par safety net —
  agar kabhi AI phir bhi "card" likhe to screen par woh baat nahi jaati.
</div>
<div class="grid2">
  <div class="card bad"><div class="cap">Pehle — 5 cards, phir "+5 aur … Seat Finder card mein hain" (aisa card chat me hai hi nahi)</div><div class="msg">${before}</div></div>
  <div class="card good"><div class="cap">Ab — saari trains isi jawab me (aur "card" ka zikr screen par nahi jaata)</div><div class="msg">${after}</div></div>
</div>
<h2>Seat summary line (💺) bhi ab saari trains ke saath</h2>
<div class="card"><div class="cap">server: seatSummaryLine → "${seatLine}"</div></div>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, OUT_HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
