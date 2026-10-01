/* Round-49 preview — "SVDK maanga, JAT wali trains kyun?" (fix: segment verification). */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { ReplyText } from "../src/components/ReplyText";

const cssFile = fs.readdirSync("dist/assets").find((f) => f.endsWith(".css"));
const appCss = fs.readFileSync(path.join("dist/assets", cssFile!), "utf8");

const AFTER_TEXT = [
  "LDH → SVDK, 2026-09-30 — confirm seat wali trains:",
  "* 20433 JAMMU MAIL — 1A AVL 1 ₹1,530 · 3E AVL 1 ₹625 — 01:47 departure",
  "* 11449 JBP SVDK EXP — 1A AVL 1 ₹1,455 — 03:20 departure",
  "",
  "💺 sab class me seat wali 2 trains — 20433 1A AVL 1 ₹1,530 · 3E AVL 1 ₹625 | 11449 1A AVL 1 ₹1,455. (LDH → SVDK · live board)",
  "ℹ️ 12425 JAMMU RAJDHANI (last stop JAT), 14661 SHALIMAR MALANI (last stop JAT), 12413 GALTADHAM POOJA (last stop JAT), 12265 JAT DURONTO EXP (last stop JAT) — ye SVDK tak nahi jaati, isliye list se hata di.",
].join("\n");

const AFTER = renderToStaticMarkup(h(ReplyText, { text: AFTER_TEXT }));

const OLD_CARDS = [
  ["12265", "JAT DURONTO EXP", [["3A", "AVL 14", "₹640"], ["2A", "AVL 5", "₹870"]]],
  ["13151", "KOAA JAT EXPRES", [["SL", "AVL 8", "₹195"]]],
  ["20433", "JAMMU MAIL", [["1A", "AVL 1", "₹1,530"], ["3E", "AVL 1", "₹625"]]],
  ["11449", "JBP SVDK EXP", [["1A", "AVL 1", "₹1,455"]]],
];
const oldCards = OLD_CARDS.map(
  ([num, name, rows]) => `
  <div class="rp-row seat">
    <div class="rp-l1"><span class="rp-no">${num}</span><span class="rp-name">${name}</span></div>
    <div class="rp-crows">
      ${(rows as string[][]).map(([c, s, f]) => `<div class="rp-crow ok"><span class="rp-cls">${c}</span><span class="rp-st ok">${s}</span><span class="rp-fare">${f}</span></div>`).join("")}
    </div>
  </div>`,
).join("");

const html = `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RailBook — Round 49: sirf wahi trains jo SVDK tak jaati hain</title>
<style>
${appCss}
body { background:#0f1420; color:#e8ecf3; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.pv { max-width: 1180px; margin: 0 auto; padding: 26px 18px 60px; }
.pv h1 { font-size: 23px; margin: 0 0 6px; }
.pv .sub { color:#8fa3bf; margin: 0 0 18px; font-size: 14px; line-height: 1.6; }
.pv .grid { display:flex; gap:22px; flex-wrap:wrap; align-items:flex-start; }
.phone { width: 390px; background:#f4f0e8; border-radius: 20px; overflow:hidden; box-shadow: 0 24px 70px rgba(0,0,0,.45); border:1px solid #26324a; }
.phone-cap { background:#141c2b; padding:10px 14px; display:flex; align-items:center; gap:8px; font-size:14px; }
.cap-tag { font-size:10.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; border-radius:999px; padding:3px 9px; }
.cap-tag.old { background:#3a2222; color:#ffb4b4; border:1px solid #5c3030; }
.cap-tag.new { background:#16351f; color:#8ee6ab; border:1px solid #2c5a3c; }
.screen { background:#f4f0e8; max-height: 660px; overflow:auto; padding: 12px 12px 6px; }
.msg-user { background: var(--navy); color:#fff; border-radius:16px 16px 4px 16px; padding:10px 14px; font-size:14.5px; max-width:88%; margin-left:auto; margin-bottom:10px; }
.screen .msg { margin: 6px 0 12px; }
.pv .box { background:#151c2b; border:1px solid #24324b; border-radius:12px; padding:14px 16px; margin:16px 0; font-size:14px; line-height:1.7; color:#dbe3f0; }
.pv code { background:#1d2739; padding:1px 6px; border-radius:6px; font-size:12.5px; }
table.pv-t { width:100%; border-collapse:collapse; font-size:13.5px; margin: 10px 0 4px; }
table.pv-t th, table.pv-t td { text-align:left; padding:7px 9px; border-bottom:1px solid #22304a; vertical-align:top; }
table.pv-t th { color:#9fb7d8; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
.bad { color:#ff9d9d; } .good { color:#8ee6ab; }
.pv ul { margin:8px 0 0 18px; padding:0; }
</style></head><body><div class="pv">
<h1>Round 49 — "SVDK maanga, JAT wali trains kyun dikha raha?"</h1>
<p class="sub">Aapke screenshot ka wahi sawaal. Ab board me sirf wahi trains aati hain jo maangi hui station <b>tak sach me jaati hain</b> — aur jo hataayi gayi, unka saaf note neeche. (Route provider timetable se verify hota hai; pata na chale to train rakhi jaati hai — koi andaza nahi.)</p>
<div class="grid">
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag old">Pehle</span><b>JAT tak wali trains beech me</b></div>
    <div class="screen">
      <div class="msg-user">Mujhe ludhiana se SVDK jaana hai kal confirm seat findout krke do</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div><p class="msg-text">7 me seat (14, 8, 5, 1, 1, 1, 1) · fare ₹195–₹1530</p>
      <div class="rp"><div class="rp-rows">${oldCards}</div></div>
      <p class="msg-text" style="font-size:13px;color:#5d6672">… 12265/13151 sirf Jammu Tawi (JAT) tak jaati hain — SVDK nahi. Unme book karna possible hi nahi tha.</p>
      </article>
    </div>
  </div>
  <div class="phone">
    <div class="phone-cap"><span class="cap-tag new">Ab</span><b>Sirf SVDK jaane wali + note</b></div>
    <div class="screen">
      <div class="msg-user">Mujhe ludhiana se SVDK jaana hai kal confirm seat findout krke do</div>
      <article class="msg assistant"><div class="msg-kicker">RailBook</div>${AFTER}</article>
    </div>
  </div>
</div>
<div class="box">
 <b>Kya hata (live, 30 Sep 2026 — LDH → SVDK board):</b> 13 trains jinme 12265 JAT DURONTO, 13151 KOAA JAT EXPRES, 12425 JAMMU RAJDHANI, 14661 SHALIMAR MALANI, 12413 GALTADHAM POOJA, 12355 ARCHNA EXP, 12237 BEGUMPURA EXP, 11077 JHELUM EXPRESS, 12207, 18309, 15651, 12549, 22431 — inka last stop <b>JAT</b>/MCTM hai, SVDK nahi.
 <br><br><b>Bachi (sach me SVDK jaati hain):</b> 20433 JAMMU MAIL · 11449 JBP SVDK EXP (seat rows); WL me 12919 Malwa, 14609 Hemkunt, 12445 Uttar S Kranti, 12475 Hapa SVDK — sab verify kiye gaye.
 <br><br><b>Control:</b> <code>LDH → JAT</code> maango to 12265 / 13151 / 12237 waise hi list me rehti hain — koi false drop nahi.
</div>
<div class="box">
 <b>Kahan-kahan laga:</b>
 <ul>
  <li>Chat ki seat line + card rows (<code>seatFilterFor</code>)</li>
  <li>AI ka FIND_SEATS tool (pool se hi hat jaati hain — AI unki rows likh hi nahi sakta; output me ROUTE note aata hai)</li>
  <li>UI ka route board (<code>/api/availability</code>)</li>
  <li>Card me amber note strip (<code>dropNote</code>) — "ye SVDK tak nahi jaati, isliye list se hata di"</li>
 </ul>
</div>
<p class="sub">Live prod <code>6531728</code> · suite 128 files / 1386 tests pass · naye 7 tests (segment verify + note + control case + client wiring).</p>
</div></body></html>`;

const out = "/home/user/RailBook/previews/RailBook-round49-2026-09-29.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("preview:", out, fs.statSync(out).size, "bytes");
