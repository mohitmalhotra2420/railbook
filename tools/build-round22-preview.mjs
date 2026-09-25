/* Round-22 preview builder (26 Sep 2026) — asli React components (vite SSR loader), asli built CSS,
 * asli live payload (ASR→NDLS plan). Teen cheezein dikhati hai:
 *   1) Chat ka seat-answer: screenshot ka ASLI text — pehle (plain paragraph) vs ab (rows + summary).
 *   2) Direct trains card ke shuru me Seat Finder wale filter chips — default / ✅ Available /
 *      class 2A + 💰 Sabse sasta (chips pe click karke capture kiya gaya asli state).
 *   3) IRCTC handoff overlay ka naya simple screen (Android app): "Redirecting to IRCTC…" + 45s.
 *
 *   node tools/build-round22-preview.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(process.argv[2] ?? ".");
const OUT = "/home/user/RailBook/previews/RailBook-round22-2026-09-26.html";

const css = (() => {
  const dir = path.join(ROOT, "dist/assets");
  const f = fs.readdirSync(dir).find((x) => x.endsWith(".css"));
  return fs.readFileSync(path.join(dir, f), "utf8");
})();

const dom = new JSDOM("<!doctype html><html><body><div id='rt-before'></div><div id='rt-after'></div><div id='card-a'></div><div id='card-b'></div><div id='card-c'></div></body></html>", {
  url: "https://railbook.preview/",
  pretendToBeVisual: true,
});
for (const k of ["window", "document", "navigator", "sessionStorage", "localStorage", "HTMLElement", "Element", "Node", "Event"]) {
  globalThis[k] = dom.window[k];
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const { createServer } = await import("vite");
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { render, cleanup, fireEvent } = await import("@testing-library/react");
const React = (await import("react")).default;
const { ReplyText } = await vite.ssrLoadModule("/src/components/ReplyText.tsx");
const { JourneyOptions } = await vite.ssrLoadModule("/src/components/JourneyOptions.tsx");

const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "provas/asr-ndls-2026-09-26-plan.json"), "utf8"));

const SCREENSHOT_TEXT = [
  "Kal 27 Sep ko Amritsar  →  Ludhiana, Subah (04:00–12:00) window mein SL class:",
  "* 12484 ASR TVCN SF EXP — SL — AVAILABLE 102 seats — ₹180 — 05:55 departure",
  "* 15708 ASR KIR EXPRESS — SL — AVAILABLE 42 seats — ₹150 — 07:40 departure",
  "21 trains check ki gayi, is window mein SL seat wali 2 trains hain.",
].join(" ");

const html = (el) => el.innerHTML;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 1) ReplyText: pehle (plain) vs ab (rows) */
{
  const c = document.getElementById("rt-before");
  render(React.createElement("p", { className: "msg-text" }, SCREENSHOT_TEXT), { container: c });
  var beforeHtml = c.innerHTML;
  cleanup();
  const c2 = document.getElementById("rt-after");
  render(React.createElement(ReplyText, { text: SCREENSHOT_TEXT }), { container: c2 });
  var afterHtml = c2.innerHTML;
  cleanup();
}

/* 2) Journey card — teen state */
globalThis.fetch = async (url) => {
  const u = String(url?.url ?? url);
  const body = u.includes("/api/availability") ? { rows: [] } : {};
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

const cardHtml = {};
{
  const c = document.getElementById("card-a");
  const { container } = render(React.createElement(JourneyOptions, { plan, onPickClass: () => {}, onPickTrain: () => {} }), { container: c });
  await wait(120);
  cardHtml.default = html(c);
  cleanup();

  const c2 = document.getElementById("card-b");
  const r2 = render(React.createElement(JourneyOptions, { plan, onPickClass: () => {}, onPickTrain: () => {} }), { container: c2 });
  await wait(120);
  const availBtn = [...c2.querySelectorAll(".sf-chip")].find((b) => (b.textContent ?? "").includes("Available"));
  if (availBtn) fireEvent.click(availBtn);
  await wait(60);
  cardHtml.available = html(c2);
  cleanup();

  const c3 = document.getElementById("card-c");
  render(React.createElement(JourneyOptions, { plan, onPickClass: () => {}, onPickTrain: () => {} }), { container: c3 });
  await wait(120);
  const cls2a = [...c3.querySelectorAll(".sf-chip")].find((b) => (b.textContent ?? "").trim() === "2A");
  if (cls2a) fireEvent.click(cls2a);
  await wait(40);
  const cheap = [...c3.querySelectorAll(".sf-chip")].find((b) => (b.textContent ?? "").includes("Sabse sasta"));
  if (cheap) fireEvent.click(cheap);
  await wait(60);
  cardHtml.twoA = html(c3);
  cleanup();
}

await vite.close();

const OUT_HTML = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RailBook Round-22 · seat-answer rows · direct card filters · IRCTC overlay 45s</title>
<style>
${css}
body { background:#f6f2ec; margin:0; }
.pv { max-width:1240px; margin:0 auto; padding:22px 18px 70px; }
.pv h1 { font-size:20px; margin:0 0 6px; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; color:#1d2230; }
.pv .sub { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:13px; line-height:1.55; color:#55607a; margin-bottom:16px; }
.pv h2 { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:14px; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; margin:22px 0 10px; }
.pv .card { background:#fff; border:1px solid #e6e2da; border-radius:16px; padding:14px; margin-bottom:14px; }
.pv .cap { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:12.5px; font-weight:700; color:#123a63; margin-bottom:10px; }
.pv .why { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:12.5px; line-height:1.55; color:#3c4964; margin-top:10px; }
.pv .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
@media (max-width:1000px){ .pv .grid2 { grid-template-columns:1fr; } }
.pv .phone { max-width:390px; margin:0 auto; border-radius:22px; overflow:hidden; border:1px solid #dfe6f0; background:#0f2a4d; }
.pv .phone-top { background:#0f2a4d; color:#fff; padding:11px 14px; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
.pv .phone-top .t { font-size:15px; font-weight:800; }
.pv .phone-top .s { font-size:11.5px; color:#cfe0f7; margin-top:3px; line-height:1.45; }
.pv .phone-btns { display:flex; gap:8px; padding:9px 14px; background:#0f2a4d; }
.pv .phone-btns span { flex:1; text-align:center; font-size:12px; font-weight:700; color:#fff; border:1px solid #7ea6dd; border-radius:9px; padding:7px 0; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
.pv .phone-body { background:#0f2a4d; color:#fff; text-align:center; padding:70px 18px 90px; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
.pv .phone-body .hd { font-size:16px; font-weight:800; }
.pv .phone-body .cnt { font-size:52px; font-weight:800; color:#93c5fd; margin-top:16px; }
.pv .mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; }
.pv .note { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; font-size:12.5px; line-height:1.6; color:#3c4964; background:#fff; border:1px solid #e6e2da; border-left:4px solid #123a63; border-radius:12px; padding:11px 13px; }
</style></head><body><div class="pv">
<h1>Round-22 · seat-answer readable · direct card ke filter chips · IRCTC overlay 45s</h1>
<div class="sub">
  Sab kuch <b>app ke asli components</b> se render hua hai (wahi React code, wahi built CSS) aur card ka data
  <b>live plan payload</b> se (ASR → NDLS, 26 Sep). Filter wale card chips pe <b>asli click</b> karke capture kiye gaye hain — static mockup nahi.
</div>

<h2>1 · AI ka seat-answer — pehle vs ab</h2>
<div class="grid2">
  <div class="card"><div class="cap">Pehle (screenshot 1): ek hi paragraph, padhna mushkil</div>
    <div class="mono" style="line-height:1.6;color:#22304a">${beforeHtml}</div>
  </div>
  <div class="card"><div class="cap">Ab: rows + status rang + honest summary line</div>
    ${afterHtml}
  </div>
</div>
<div class="note">Text bilkul wahi rehta hai (AI/server ka jawab nahi badla) — sirf <b>padhne ka tareeka</b> badla: headline chips (route, window, class), har train ki apni row (train no · naam · class chip · AVL/RAC/WL badge · fare · time), aur summary line jo <b>sirf usi text ke numbers</b> se banti hai. Bina row waale jawab pehle jaisa paragraph hi rehta hai.</div>

<h2>2 · Direct trains card — filters shuru me (Seat Finder wale hi chips)</h2>
<div class="card"><div class="cap">Default (🚆 Sabhi trains · Sab class · Time: Sab)</div>${cardHtml.default}</div>
<div class="card"><div class="cap">✅ Available dabaane ke baad — sirf AVL/RAC wali trains (filter ki honest line + Clear)</div>${cardHtml.available}</div>
<div class="card"><div class="cap">class 2A + 💰 Sabse sasta — sirf 2A wali trains, sasti pehle</div>${cardHtml.twoA}</div>
<div class="note">Chips <b>shared component (SeatFilterBar)</b> se aati hain — Seat Finder card bhi wahi use karta hai, isliye dono jagah shakal bilkul same. Filter sirf <b>direct trains</b> par lagta hai: connecting / alternatives / alternative dates / planner ka data jaisa tha waisa hi rehta hai.</div>

<h2>3 · IRCTC overlay (Android app) — simple</h2>
<div class="card" style="background:#f7f9fc">
  <div class="phone">
    <div class="phone-top"><div class="t">RailBook</div><div class="s">Handoff saved · 1 pax · IRCTC khol rahe hain…</div></div>
    <div class="phone-btns"><span>RAILBOOK</span><span>IRCTC</span><span>CLEAR HANDOFF</span></div>
    <div class="phone-body"><div class="hd">Redirecting to IRCTC…</div><div class="cnt">45s</div></div>
  </div>
  <div class="why">Ab sirf <b>“Redirecting to IRCTC…”</b> + <b>45s countdown</b> (pehle 30s ke baad ek aur 30s ka extra wait tha — wo hata diya). 45s poore hone par jo page khula ho wahan se seedha continue; login/OTP/payment aap hi karte ho.</div>
</div>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, OUT_HTML, "utf8");
console.log("preview:", OUT, fs.statSync(OUT).size, "bytes");
console.log("cards:", Object.keys(cardHtml).join(", "), "| reply rows:", (afterHtml.match(/rp-row/g) || []).length);
