/* Round-59 preview — (1) connecting plan ka apna PAGE (chat me nahi), (2) leg 1 / leg 2 ka poora data,
 * (3) alternative trains page. Sab kuch REAL prod data se: /tmp/r59-plan-repro.json (ASR→LDH poora plan,
 * 25 direct + 4 connecting + 2 legPlans) aur /tmp/r58-reply2.json (LDH→ASR ka live seat board). */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { PlanPageSheet, SeatListBlock } from "../src/views/Concierge";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const appCss = fs.readFileSync(path.join("dist/assets", cssFile!), "utf8");

const planResp = JSON.parse(fs.readFileSync("/tmp/r59-plan-repro.json", "utf8")) as { journey: unknown; reply?: string };
const plan = planResp.journey as Parameters<typeof PlanPageSheet>[0]["st"]["plan"];
const seat = JSON.parse(fs.readFileSync("/tmp/r58-reply2.json", "utf8")) as {
  seatFilter?: { rows: Record<string, unknown>[]; wlRows: Record<string, unknown>[]; source: string | null };
  nlu?: { from?: { code?: string; name?: string } | null; to?: { code?: string; name?: string } | null; date?: string | null };
};
const sf = seat.seatFilter!;
const blockRows = [...sf.rows, ...sf.wlRows].map((r) => ({ ...r, seat: r.status === "AVAILABLE" || r.status === "RAC", raw: r }));
const SEAT_BLOCK = {
  type: "seatlist",
  from: seat.nlu?.from?.code ?? "LDH",
  to: seat.nlu?.to?.code ?? "ASR",
  toName: seat.nlu?.to?.name ?? null,
  date: seat.nlu?.date ?? "2026-09-30",
  source: sf.source,
  dropNote: null,
  nearbyNote: null,
  rows: blockRows,
} as never;

const noop = () => undefined;
const sheet = (page: "connect" | "alt") =>
  renderToStaticMarkup(
    h(PlanPageSheet, {
      st: { page, from: "ASR", to: "LDH", date: "2026-09-30", loading: false, progress: null, plan, reply: null, error: null, tries: 1 },
      onClose: noop,
      onRetry: noop,
      onChatFallback: noop,
      /* App me ye handlers hamesha hote hain (isi se Book/chips kaam karte hain) — preview me bhi wahi. */
      onPickTrain: noop,
      onPickLeg: noop,
      onPickClass: noop,
      onPickDate: noop,
      onPickStations: noop,
      onBookLeg: noop,
      onOpenBoard: noop,
    } as never),
  );

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 59: connecting plan ka apna page (Leg 1 → Leg 2 + Book)</title>
<style>
${appCss}
body { background:#0f1420; color:#e8ecf3; font-family: system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.pv { max-width: 1400px; margin: 0 auto; padding: 26px 18px 70px; }
.pv h1 { font-size: 23px; margin: 0 0 6px; }
.pv h2 { font-size: 17px; margin: 32px 0 10px; }
.pv .sub { color:#8fa3bf; margin: 0 0 18px; font-size: 14px; line-height: 1.65; }
.pv .grid { display:flex; gap:22px; flex-wrap:wrap; align-items:flex-start; }
.phone { width: 420px; background:#f4f0e8; border-radius: 20px; overflow:hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); border:1px solid #26324a; }
.phone-cap { background:#141c2b; padding:10px 14px; display:flex; align-items:center; gap:8px; font-size:13.5px; }
.cap-tag { font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; border-radius:999px; padding:3px 9px; }
.cap-tag.old { background:#3a2222; color:#ffb4b4; border:1px solid #5c3030; }
.cap-tag.new { background:#16351f; color:#8ee6ab; border:1px solid #2c5a3c; }
.screen { background:#f4f0e8; max-height: 700px; overflow:auto; position: relative; }
.screen .planpage { position: static; min-height: 660px; }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
.pv ul { margin:8px 0 0 18px; padding:0; } .pv li { margin:5px 0; }
.small { color:#8fa3bf; font-size:12.5px; }
.tap { display:inline-block; background:#fff8ee; border:1px solid #f0d3a8; border-radius:8px; padding:2px 8px; color:#8a3f00; font-weight:700; }
</style></head><body><div class="pv">

<h1>Round 59 — Connecting trains ka apna PAGE (Leg 1 → Leg 2 + Book), aur leg-wise data poora</h1>
<p class="sub">Aapki baat: <i>"Connecting trains are not showing leg 1 and leg 2 … connecting trains next chat page pe open ho, same chat page par nhi."</i>
Do cheezein theek ki gayi hain — <b>logic/data waisa hi hai</b> (wahi plan, wahi phrasing, wahi verified seats), sirf <b>dikhne ki jagah</b> badli hai:
seat board ke <span class="tap">Connecting trains</span> / <span class="tap">Alternative trains</span> button par ab ek <b>alag full-screen page</b> khulta hai — chat me kuch nahi likha jaata, back dabao to wahi chat waisi hi milti hai.</p>

<h2>(1) Entry — seat board ke neeche do buttons (chat waisa hi rehta hai)</h2>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R59)</span><b>Seat board · button dabate hi page khulta hai</b></div>
    <div class="screen" style="padding:12px">
      <article class="msg assistant" style="margin:0"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(
        h(SeatListBlock, { block: SEAT_BLOCK, onPick: noop, onOpenPage: noop } as never),
      )}</article>
    </div>
  </div>
  <div class="box" style="max-width:430px;margin:0">
    <b>Kya badla:</b>
    <ul>
      <li>Pehle button chat me ek naya sawaal bhejta tha aur jawab usi chat me (adhoore text + cards) aata tha — Leg 1/Leg 2 saaf nahi dikhte the.</li>
      <li>Ab wahi plan <b>apne page</b> par: upar route/date + ↻ (dobara check), neeche poora plan card.</li>
      <li>Chat me koi naya message nahi — page <b>band karo to chat bilkul waisi</b> jaisi thi.</li>
      <li>Plan maangne ka text/logic <b>bilkul wahi</b> R57 wala hai (<code>ASR se LDH 2026-09-30 ka poora plan banao — connecting trains aur leg-wise seat bhi dikhao (1 passenger ke liye)</code>).</li>
    </ul>
  </div>
</div>

<h2>(2) Connecting page — Leg 1 aur Leg 2 (asli plan: ASR → PGW → LDH), har leg par Book</h2>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R59)</span><b>Connecting trains · Leg 1 → Leg 2</b></div>
    <div class="screen">${sheet("connect")}</div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R59)</span><b>Alternative trains &amp; dates</b></div>
    <div class="screen">${sheet("alt")}</div>
  </div>
</div>
<p class="small" style="margin-top:8px">Ye dono screenshot <b>live prod plan</b> se bane hain (ASR → LDH, 30 Sep 2026 — 25 direct trains, 4 connecting combos, 2 hubs). Page par leg cards, layover, aur har leg par uski verified class ka <b>Book</b> — tap par wahi passenger form jo chips se khulta hai.</p>

<div class="box">
  <b>Is round me exactly kya hua (UI-only, data/AI logic untouched):</b>
  <ul>
    <li><b>Plan card banne ki shart theek ki:</b> pehle card sirf tab banta tha jab direct list ya "direct nahi mili" ho — connecting-only plan (routeOptions khaali, connections bhare) me card hi nahi banta tha, isliye Leg 1/Leg 2 dikhte nahi the. Ab routeOptions / connections / legPlans me se koi bhi ho to card banta hai (wahi data, kuch invent nahi).</li>
    <li><b>Naya plan page:</b> seat board ke dono buttons ab full-screen page kholte hain (loading + real progress → plan), back se wapas chat. Plan na mile to saaf message + <b>Dobara try</b> + <b>Chat me poochho</b> — andaza nahi lagta.</li>
    <li><b>Book:</b> connecting leg aur class chips par Book usi page se passenger form kholta hai (page khud band ho jaata hai taaki form saamne aaye).</li>
    <li>Alternative page bhi usi page system se — doosri trains, doosri date, seat ke saath.</li>
  </ul>
</div>

<p class="small">Round-59 · live data: ASR→LDH plan (29 Sep 2026 prod) + LDH→ASR seat board.</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round59-2026-09-29.html";
fs.writeFileSync(out, html);
console.log("PREVIEW:", out, html.length, "bytes");
