/* Round-47 preview — chat UI (lamba jawab → sections) + naya header.
 * Asli React components se render hota hai (AnswerCard) aur asli built CSS inline hoti hai,
 * isliye preview aur app bilkul ek jaise dikhte hain. Chalane: npx tsx tools/build-round47-preview.mts
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AnswerCard } from "../src/components/AnswerCard";
import { IconChat, IconBoard, IconGrid, IconTicket } from "../src/components/Icons";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
if (!cssFile) throw new Error("dist CSS nahi mili — pehle `npx vite build` chalao");
const appCss = fs.readFileSync(path.join("dist/assets", cssFile), "utf8");

const SCREENSHOT_REPLY =
  "12013 Amritsar Shatabdi ka timetable ke hisaab se Ludhiana Jn LDH par scheduled arrival **20:16** hai, departure 20:19. " +
  "Aaj 2026-09-28 ke live run ki baat karein to provider ka last update 2026-09-28 22:47 +0530 ka hai aur train us samay MANANWALA ke paas dikh rahi hai, next Amritsar Jn. " +
  "Update stale hai, isliye Ludhiana par actual pahunchne ka confirmed real-time time abhi verify nahi ho pa raha. " +
  "Overall delay 0m dikh raha hai.";

const SECOND_REPLY =
  "12013 Amritsar Shtabdi — 28 Sep 2026 ki run ke liye timetable ke hisaab se: Ludhiana Jn (LDH): arrival 20:16, departure 20:19. " +
  "(Source: confirmtkt.com — railway API se nahi, verified web site se.)";

const NEW_ANSWER = renderToStaticMarkup(h(AnswerCard, { text: SCREENSHOT_REPLY }));
const NEW_ANSWER2 = renderToStaticMarkup(h(AnswerCard, { text: SECOND_REPLY }));
const ICONS = renderToStaticMarkup(
  h("div", { className: "spacer" }),
);

const headerNew = (icons: string) => `
      <header class="topbar">
        <div class="brand"><span class="p-logo">🚆</span>RailBook<span class="build-tag">2f9c008</span></div>
        <div class="spacer"></div>
        <span class="demo-chip">Demo</span>
        ${icons}
      </header>
      <div class="ai-progress">
        <span class="ai-step on"><i class="ai-dot">✓</i><b>Journey</b></span>
        <span class="ai-step on now"><i class="ai-dot">2</i><b>Train</b></span>
        <span class="ai-step"><i class="ai-dot">3</i><b>Passengers</b></span>
        <span class="ai-step"><i class="ai-dot">4</i><b>Payment</b></span>
      </div>`;

const iconBtn = (label: string, svg: string, accent = false) =>
  `<button class="icon-btn${accent ? " accent" : ""}" title="${label}" aria-label="${label}">${svg}</button>`;

const newIcons = [
  iconBtn("Nayi chat", renderToStaticMarkup(h(IconChat, {}))),
  iconBtn("Board / tools", renderToStaticMarkup(h(IconBoard, {}))),
  iconBtn("Train search", renderToStaticMarkup(h(IconGrid, {}))),
  iconBtn("Meri bookings", renderToStaticMarkup(h(IconTicket, {})), true),
].join("");

const HEADER_OLD = `
      <header class="topbar old">
        <div class="brand"><span class="p-logo">🚆</span>RailBook<span class="build-tag">2f9c008</span></div>
        <div class="spacer"></div>
        <span class="demo-chip">Demo</span>
        <button class="icon-btn old-glyph">✚</button>
        <button class="icon-btn old-glyph">▦</button>
        <button class="icon-btn old-glyph">₹</button>
        <button class="icon-btn old-glyph">☰</button>
      </header>
      <div class="ai-progress old-steps"><span>Journey</span><span class="on">Train</span><span>Passengers</span><span>Payment</span></div>`;

const phone = (title: string, tag: string, body: string, tone: "old" | "new") => `
  <div class="phone ${tone}">
    <div class="phone-cap"><span class="cap-tag ${tone}">${tag}</span><b>${title}</b></div>
    <div class="screen">
      ${body}
      <div class="composer">
        <div class="composer-in">Kahan se kahan jaana hai?</div>
        <button class="cbtn">🎤</button>
        <button class="cbtn send">➤</button>
      </div>
    </div>
  </div>`;

const OLD_CHAT = `
      ${HEADER_OLD}
      <div class="thread">
        <article class="msg user"><p class="msg-text">12013 aaj ludhiana kitne bje pahunchi thi</p></article>
        <article class="msg assistant">
          <div class="msg-kicker">RailBook</div>
          <p class="msg-text">${SCREENSHOT_REPLY.replace(/\*\*/g, "")}</p>
          <div class="rp-tail" style="font-size:12px;color:#5d6672;margin-top:8px">⚙️ Route/schedule dekha → Live position dekhi</div>
          <div class="ns-card"><div class="ns-label"><span class="ns-dot">➡️</span> AGLA KADAM <span class="ns-tag model">AI ne chuna</span></div>
            <div class="ns-chips"><button class="ns-chip primary">12013 · LDH timetable</button></div></div>
        </article>
        <article class="msg user"><p class="msg-text">12013 aaj ludhiana se kitne bje nikli thi</p></article>
        <article class="msg assistant">
          <div class="msg-kicker">RailBook</div>
          <p class="msg-text">${SECOND_REPLY}</p>
        </article>
      </div>`;

const NEW_CHAT = `
      ${headerNew(newIcons)}
      <div class="thread">
        <article class="msg user"><p class="msg-text">12013 aaj ludhiana kitne bje pahunchi thi</p></article>
        <article class="msg assistant">
          <div class="msg-kicker">RailBook</div>
          ${NEW_ANSWER}
          <div class="ns-card"><div class="ns-label"><span class="ns-dot">➡️</span> AGLA KADAM <span class="ns-tag model">AI ne chuna</span></div>
            <div class="ns-chips"><button class="ns-chip primary">12013 · LDH timetable</button></div></div>
        </article>
        <article class="msg user"><p class="msg-text">12013 aaj ludhiana se kitne bje nikli thi</p></article>
        <article class="msg assistant">
          <div class="msg-kicker">RailBook</div>
          ${NEW_ANSWER2}
        </article>
      </div>`;

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 47: chat UI + naya header</title>
<style>
${appCss}
/* ── sirf preview ke wrapper ke styles (app ka hissa nahi) ── */
body { background:#0f1420; color:#e8ecf3; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.pv { max-width: 1180px; margin: 0 auto; padding: 26px 18px 60px; }
.pv h1 { font-size: 23px; margin: 0 0 6px; }
.pv .sub { color:#8fa3bf; margin: 0 0 18px; font-size: 14px; line-height: 1.6; }
.pv .grid { display:flex; gap:22px; flex-wrap:wrap; align-items:flex-start; }
.phone { width: 380px; background:#f4f0e8; border-radius: 22px; overflow:hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); border:1px solid #2a3purple; border:1px solid #26324a; }
.phone-cap { background:#141c2b; padding:10px 14px; display:flex; align-items:center; gap:8px; font-size:14px; color:#e8ecf3; }
.cap-tag { font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; border-radius:999px; padding:3px 9px; }
.cap-tag.old { background:#3a2222; color:#ffb4b4; border:1px solid #5c3030; }
.cap-tag.new { background:#16351f; color:#8ee6ab; border:1px solid #2c5a3c; }
.screen { background:#f4f0e8; max-height: 620px; overflow:auto; position:relative; }
.screen .thread { padding: 14px 14px 10px; }
.screen .topbar { position: static; }
.p-logo { width:30px; height:30px; border-radius:9px; display:inline-grid; place-items:center; background:#0b1f3a; font-size:16px; }
.old .p-logo, .topbar.old .p-logo { background: rgba(255,255,255,.12); }
.old-glyph { font-size:16px; }
.old-steps span { flex:1; text-align:center; }
.composer { display:flex; gap:8px; padding: 10px 12px 14px; background: linear-gradient(180deg, rgba(244,240,232,0) 0%, #f4f0e8 40%); position: sticky; bottom:0; }
.composer-in { flex:1; background:#fff; border:1px solid var(--line); border-radius: 14px; padding: 11px 14px; font-size:14px; color:#5d6672; }
.cbtn { width:44px; height:44px; border-radius:14px; background: var(--navy); color:#fff; font-size:16px; }
.cbtn.send { background: var(--saffron); }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv .box b { color:#fff; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
.pv ul { margin:8px 0 0 18px; padding:0; }
</style></head><body><div class="pv">
<h1>Round 47 — chat ki padhne-layak UI + naya header</h1>
<p class="sub">Aapke screenshot wala hi jawab, bilkul wahi text — bas ab sections me: status chip → headline → timetable board → baaki baat → source. Header se ₹ hata, purane glyph buttons (✚ ▦ ₹ ☰) ki jagah naye SVG buttons, aur booking ka safar ab dots + labels me. AI/API/backend ko haath nahi lagaya.</p>
<div class="grid">
  ${phone("Pehle — ek hi paragraph ka lamba text", "Pehle", OLD_CHAT, "old")}
  ${phone("Ab — chips, timetable board, sections", "Ab", NEW_CHAT, "new")}
</div>
<div class="box">
 <b>Chat me kya badla (sirf UI):</b>
 <ul>
  <li><b>Status chips</b> — jo baat jawab me sach me likhi hai wahi chip banti hai (yahan: <code>ON TIME · DELAY 0</code>, <code>UPDATE STALE</code>, <code>SCHEDULED</code>, <code>2026-09-28</code>). Kuch invent nahi hota.</li>
  <li><b>Timetable board</b> — arrival/departure waqt bade numbers me, station code (LDH) ke saath.</li>
  <li><b>Bada headline + alag-alag jumle</b> — 15.5px → 16.5px headline, line-height 1.62, sections ke beech spacing.</li>
  <li><b>Source</b> alag chhote footer me (pehle body ke andar chipka tha). Model ke <code>**bold**</code> markers bhi ab highlight ban jaate hain — asterisk user ko nahi dikhte.</li>
  <li><b>Tool line</b> (⚙️ Route/schedule dekha → Live position dekhi) ab chips me, prose ke andar nahi.</li>
 </ul>
</div>
<div class="box">
 <b>Header:</b> ₹ (wallet/payment) button hata diya — <b>wallet booking flow ke apne buttons se khulta rehta hai</b>. Purane ✚ ▦ ☰ ki jagah naye SVG icons: <code>Nayi chat</code>, <code>Board/tools</code>, <code>Train search</code>, <code>Meri bookings</code> (gold). Stepper ab dots + ticks me (✓ Journey · <b>Train</b> · 3 Passengers · 4 Payment) — labels wahi 4.
</div>
<p class="sub">Test: full suite 126 files / 1374 tests pass · 8 naye UI tests (AnswerCard + header) · 3 purane UI tests R47 semantics me update (kuch chhupta nahi, wo assertions bhi maujood).</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round47-2026-09-28.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
void ICONS;
