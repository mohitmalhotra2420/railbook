/* Round-57 preview — (a) chat ka jawab AUTOMATIC table/bullet me, (b) connecting page ka saaf layout,
 * (c) seat board se Connecting / Alternative ka next page, (d) connecting + alternative me Book option.
 *
 * Data REAL probe se: `/tmp/r57-seat.json` (ASR→LDH live seat board) aur `/tmp/r57-plan.json`
 * (LDH→JAT poora plan — leg-wise connecting). Kuch banaya hua nahi. */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ReplyText } from "../src/components/ReplyText";
import { AnswerCard } from "../src/components/AnswerCard";
import { JourneyOptions } from "../src/components/JourneyOptions";
import { SeatListBlock } from "../src/views/Concierge";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const appCss = fs.readFileSync(path.join("dist/assets", cssFile!), "utf8");

const seat = JSON.parse(fs.readFileSync("/tmp/r57-seat.json", "utf8")) as {
  reply?: string;
  seatFilter?: { rows: Record<string, unknown>[]; wlRows: Record<string, unknown>[]; source: string | null; dropNote?: string | null; nearbyNote?: string | null };
  nlu?: { from?: { code?: string; name?: string } | null; to?: { code?: string; name?: string } | null; date?: string | null };
};
const plan = JSON.parse(fs.readFileSync("/tmp/r57-plan.json", "utf8"));
const kb = JSON.parse(fs.readFileSync("/tmp/r57-kb.json", "utf8")) as { reply?: string };

const sf = seat.seatFilter!;
const allRows = [...sf.rows, ...sf.wlRows];
const blockRows = allRows.map((r) => ({ ...r, seat: r.status === "AVAILABLE" || r.status === "RAC", raw: r }));
const SEAT_BLOCK = {
  type: "seatlist",
  from: seat.nlu?.from?.code ?? "ASR",
  to: seat.nlu?.to?.code ?? "LDH",
  toName: seat.nlu?.to?.name ?? null,
  date: seat.nlu?.date ?? "2026-09-30",
  source: sf.source,
  dropNote: sf.dropNote ?? null,
  nearbyNote: sf.nearbyNote ?? null,
  rows: blockRows,
} as never;

const noop = () => undefined;
const seatReply = String(seat.reply ?? "");

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 57: auto table/bullet + connecting page + Book option</title>
<style>
${appCss}
body { background:#0f1420; color:#e8ecf3; font-family: system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.pv { max-width: 1320px; margin: 0 auto; padding: 26px 18px 60px; }
.pv h1 { font-size: 23px; margin: 0 0 6px; }
.pv h2 { font-size: 17px; margin: 30px 0 10px; }
.pv .sub { color:#8fa3bf; margin: 0 0 18px; font-size: 14px; line-height: 1.65; }
.pv .grid { display:flex; gap:22px; flex-wrap:wrap; align-items:flex-start; }
.phone { width: 400px; background:#f4f0e8; border-radius: 20px; overflow:hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); border:1px solid #26324a; }
.phone-cap { background:#141c2b; padding:10px 14px; display:flex; align-items:center; gap:8px; font-size:13.5px; }
.cap-tag { font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; border-radius:999px; padding:3px 9px; }
.cap-tag.old { background:#3a2222; color:#ffb4b4; border:1px solid #5c3030; }
.cap-tag.new { background:#16351f; color:#8ee6ab; border:1px solid #2c5a3c; }
.screen { background:#f4f0e8; max-height: 660px; overflow:auto; padding: 12px 12px 10px; }
.msg-user { background: var(--navy); color:#fff; border-radius:16px 16px 4px 16px; padding:10px 14px; font-size:14.5px; max-width:88%; margin-left:auto; margin-bottom:10px; }
.screen .msg { margin: 6px 0 12px; }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
.pv ul { margin:8px 0 0 18px; padding:0; } .pv li { margin:5px 0; }
.small { color:#8fa3bf; font-size:12.5px; }
</style></head><body><div class="pv">

<h1>Round 57 — jawab apne aap table/bullet me · connecting page ka layout · Connecting &amp; Alternative ka next page + Book</h1>
<p class="sub">Aapki 5 baatein: (1) connecting trains ka layout sahi, (2) jawab automatically table ya bullet form me,
(3) "available" (seat board) me <b>Connecting</b> ka option jo <b>next page</b> par khule + <b>Alternative trains</b> ke options bhi,
(4) connecting aur alternative dono me <b>booking ka option</b>, (5) zip dobara.
Neeche sab kuch <b>real live data</b> se render kiya gaya hai (ASR→LDH ka aaj ka board + LDH→JAT ka poora plan) — kuch banaya hua nahi.</p>

<h2>(1) Chat ka jawab — pehle deewar jaisa text, ab apne aap TABLE</h2>
<p class="sub">2+ trains wale jawab me wahi rows table ban jaati hain (Train · Class · Status · Fare · Dep) — bilkul waise jaise aapke ChatGPT screenshot me "LDH departure | ASR arrival | Journey" columns the. Row par tap → usi train/class ka passenger form. Chaaho to "Cards" par switch bhi kar sakte ho.</p>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag old">Pehle</span><b>Sirf cards — comparison ke liye aankh se dhoondhna padta tha</b></div>
    <div class="screen">
      <div class="msg-user">ASR se LDH kal 3A me seat batao</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(h(ReplyText, { text: seatReply, initialView: "cards" }))}</article>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R57)</span><b>Table view default + Cards toggle</b></div>
    <div class="screen">
      <div class="msg-user">ASR se LDH kal 3A me seat batao</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(h(ReplyText, { text: seatReply }))}</article>
    </div>
  </div>
</div>
<p class="small" style="margin-top:8px">Note: dono me component wahi hai — pehle wale panel me <code>cards</code> view jaan-boojh kar dikhaya gaya hai (R57 se pehle ka default). Ab jab bhi jawab me 2+ trains ki rows hain, <b>table view apne aap</b> khulta hai; "Table / Cards" toggle se badla ja sakta hai.</p>

<h2>(2) Prose jawab — ab heading + bullets (deewar nahi)</h2>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R57)</span><b>Rule/GK wale jawab bhi bullets me</b></div>
    <div class="screen">
      <div class="msg-user">tatkal booking kitne baje khulti hai</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(h(AnswerCard, { text: String(kb.reply ?? "") }))}</article>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R57)</span><b>"Label: text" wale jumle saaf bullets</b></div>
    <div class="screen">
      <div class="msg-user">Shikanji aur jaljeera me farq (jaise ChatGPT screenshot)</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(
        h(AnswerCard, {
          text: `Shikanji ek sweet, salty aur lemon-based lemonade hai, jabki jaljeera ek savory, heavily spiced aur cumin-mint cooling drink hai.\nMain Base: Shikanji me paani, nimbu aur cheeni hoti hai; jaljeera me bhuna jeera, kala namak aur podina/tamarind.\nFlavor Profile: Shikanji sweet-sour lagti hai; jaljeera ka taste bold, tangy aur earthy hota hai.\nPrimary Benefit: Shikanji electrolytes wapas laati hai; jaljeera digestion theek karta hai aur bloating kam karta hai.`,
        }),
      )}</article>
    </div>
  </div>
</div>

<h2>(3) Seat board ke neeche — Connecting aur Alternative ka NEXT PAGE</h2>
<p class="sub">"Available" wale card me do naye buttons: <b>Connecting trains · Leg 1 → Leg 2</b> aur <b>Alternative trains &amp; dates</b>.
Tap par wahi route/date ka poora plan maanga jaata hai aur plan card seedha <b>usi page</b> par khulta hai (connect ya alt) — page ka data AI/server ke plan se hi aata hai, naya banaya hua kuch nahi.</p>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R57)</span><b>Seat board + 2 next-page buttons</b></div>
    <div class="screen">
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(
        h(SeatListBlock, { block: SEAT_BLOCK, onPick: noop, onOpenPage: noop }),
      )}</article>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab (R57)</span><b>Rehta wahin — ab "Kholo"</b></div>
    <div class="screen">
      <div class="box" style="margin:0">
        <b>Connecting trains · Leg 1 → Leg 2</b><br />
        <span class="small">Do train jod kar jaayein — dono legs par verified seat, alag-alag ticket</span><br /><br />
        <b>Alternative trains &amp; dates</b><br />
        <span class="small">Doosri trains, doosra station, doosri date — seat ke saath</span><br /><br />
        <span class="small">Tap par: “ASR se LDH 2026-09-30 ka poora plan banao — connecting trains aur leg-wise seat bhi dikhao (1 passenger ke liye)” → plan card seedha <b>Connecting</b> page par khulta hai.</span>
      </div>
    </div>
  </div>
</div>

<h2>(4) Connecting page — saaf layout + har leg par BOOK</h2>
<p class="sub">Leg cards ab saaf: leg number, train, times (boarding/deboarding ke saath), seat pill — aur neeche <b>Book Leg N · &lt;class&gt;</b> button.
Class chips bhi tappable ("Book" ke saath). Leg ke bina-bookable-data ho to button nahi aata (jhootha booking nahi). Data: LDH→JAT ka aaj ka poora live plan.</p>
<div class="grid">
  <div class="phone" style="width:430px">
    <div class="phone-cap"><span class="cap-tag new">Ab (R57)</span><b>Connecting · Leg 1 → Leg 2 (real plan)</b></div>
    <div class="screen">
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(
        h(JourneyOptions, {
          plan,
          initialPage: "connect",
          onPickTrain: noop,
          onPickClass: noop,
          onPickLeg: noop,
          onBookLeg: noop,
          onPickDate: noop,
          onPickStations: noop,
        } as never),
      )}</article>
    </div>
  </div>
  <div class="phone" style="width:430px">
    <div class="phone-cap"><span class="cap-tag new">Ab (R57)</span><b>Alternative trains page (real plan)</b></div>
    <div class="screen">
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${renderToStaticMarkup(
        h(JourneyOptions, {
          plan,
          initialPage: "alt",
          onPickTrain: noop,
          onPickClass: noop,
          onPickLeg: noop,
          onBookLeg: noop,
          onPickDate: noop,
          onPickStations: noop,
        } as never),
      )}</article>
    </div>
  </div>
</div>

<div class="box">
  <b>Kya badla (sirf UI — data/AI/API ko chhua nahi):</b>
  <ul>
    <li><b>Auto table</b>: 2+ train rows → table view (Train · Class · Status · Fare · Dep) + Table/Cards toggle; row tap = passenger form.</li>
    <li><b>Auto bullets</b>: prose jawab ab heading + bullets ("Label: …" wale jumle bold label ke saath).</li>
    <li><b>Seat board → next page</b>: <code>Connecting trains</code> + <code>Alternative trains &amp; dates</code> buttons; plan aane par wahi page khulta hai.</li>
    <li><b>Booking</b>: connecting leg par <code>Book Leg N · &lt;class&gt;</code> (aur class chips par Book) → seedha passenger form (IRCTC handoff); alternative page ke rows pehle se tappable the — ab unpar bhi class chips par Book dikhta hai.</li>
    <li><b>Layout</b>: leg cards ka spacing/hierarchy, layover line, "Book" button alag colour me (WL ke liye amber).</li>
  </ul>
</div>

<p class="small">Round-57 · UI-only change · data sab live probe se (ASR→LDH board + LDH→JAT plan, 29 Sep 2026).</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round57-2026-09-29.html";
fs.writeFileSync(out, html);
console.log("PREVIEW:", out, html.length, "bytes");
