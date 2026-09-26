/* Round-29 preview probe (26 Sep 2026) — local build par, deterministic mocks ke saath:
 *   1) Chat ka train-list: same train ki classes ab EK card me (22432 ×2 / 19804 ×2 → 2 cards, 4 class rows)
 *   2) Class row par tap → seedha passenger form (usi train+class ka)
 *   3) "22432 mein 3A book krdo" → AI khud passenger form kholta hai (train+class+fare pehle se)
 *   4) jo data nahi hai (koi row nahi) to bhi form khulta hai — UNKNOWN status ke honest note ke saath
 *
 *   node tools/probe-live-r29.mjs        (RAILBOOK_BASE se URL, default http://127.0.0.1:4173/)
 * Screenshots: round29-{chat-groups,class-tap-pax,auto-book-pax,auto-book-nodata}.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.RAILBOOK_BASE ?? "http://127.0.0.1:4173/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const SVDK = { code: "SVDK", name: "SMVD Katra", city: "Katra" };
const LDH = { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" };

/* Screenshot 1 (4:33) ka asli jawab — same train do-do baar. */
const REPLY_GROUPS = [
  "27 Sep 2026, SVDK → LDH, 1 passenger — seat wali trains:",
  "* 14606 JAT YNRK EXP — 3E AVL 4 ₹520",
  "* 19804 KOTA EXPRESS — 1A AVL 3 ₹1,455",
  "* 22432 SFG MCTM SF EXP — 1A AVL 1 ₹1,270",
  "* 22432 SFG MCTM SF EXP — 3A AVL 1 ₹565",
  "* 19804 KOTA EXPRESS — 2A RAC 6 ₹880",
].join("\n");

/* "book krdo" par server ka jawab (jo user ko loop me daal raha tha) + live board rows. */
const REPLY_BOOK = "22432 SFG MCTM SF EXP, SVDK → LDH, 2026-09-27, 3A ke liye seat availability check kar raha hoon.";
const SEAT_ROWS = [
  { number: "22432", name: "SFG MCTM SF EXP", classCode: "3E", status: "AVAILABLE", seats: 31, rac: null, waitlist: null, fare: 565, departure: null, durationMinutes: 1250 },
  { number: "22432", name: "SFG MCTM SF EXP", classCode: "3A", status: "AVAILABLE", seats: 1, rac: null, waitlist: null, fare: 565, departure: null, durationMinutes: 1250 },
  { number: "22432", name: "SFG MCTM SF EXP", classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 35, fare: 225, departure: null, durationMinutes: 1250 },
];

function agentBody({ reply, rows, withSeatFilter }) {
  return {
    nlu: { from: SVDK, to: LDH, date: "2026-09-27", passengerCount: 1, intent: "SEARCH_TRAIN" },
    source: "ai",
    context: {
      intent: "SEARCH_TRAIN",
      origin: SVDK,
      destination: LDH,
      date: "2026-09-27",
      dateProvided: true,
      passengers: 1,
      paxProvided: true,
      selectedTrainNumber: null,
      justReset: false,
    },
    tool: "live_board_seats",
    toolOk: true,
    reply,
    interrupt: false,
    resumeAsk: null,
    resumeText: null,
    confirmBook: false,
    missingFields: [],
    engine: "agentic_tool_calling",
    modelUsed: "probe-mock",
    latencyMs: 1200,
    toolTrace: [{ tool: "find seats", ok: true, source: "confirmtkt" }],
    seatFilter: withSeatFilter
      ? { classCodes: ["3E", "3A", "SL"], line: null, rows, wlRows: [], trainsSeen: 12, source: "confirmtkt" }
      : null,
    trains: null,
    journey: null,
    alternatives: null,
    trainPicker: null,
    choice: null,
    liveDates: null,
  };
}

const browser = await chromium.launch();

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  await page.route("**/api/meta", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: { id: "confirmtkt", name: "ConfirmTkt", mock: false }, serviceFee: 30 }) }),
  );
  /* SSE route ko JSON bhejo → client khud plain /api/agent par gir jaata hai (asli fallback). */
  await page.route("**/api/agent/stream", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/agent", (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}");
    lastUserText = String(body.text ?? "");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(agentBody(handler(lastUserText))) });
  });
  await page.route("**/api/understand", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nlu: {}, source: "nlu", missingFields: [] }) }));
  return page;
}

let lastUserText = "";
let handler = () => ({ reply: "probe", rows: [], withSeatFilter: false });

async function send(page, text) {
  await page.fill(".composer input", text);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1400);
}

/* ── 1) grouping + class tap ─────────────────────────────────────────── */
handler = () => ({ reply: REPLY_GROUPS, rows: [], withSeatFilter: false });
const p1 = await newPage();
await p1.goto(BASE, { waitUntil: "domcontentloaded" });
await p1.waitForSelector(".composer input", { timeout: 30000 });
await send(p1, "SVDK se LDH kal ke liye seat wali trains batao");
await p1.waitForSelector(".rp-row", { timeout: 20000 });
const groups = await p1.evaluate(() => {
  const cards = [...document.querySelectorAll(".rp-row")];
  return {
    cards: cards.length,
    heads: cards.map((c) => c.querySelector(".rp-no")?.textContent ?? ""),
    classRowsPerCard: cards.map((c) => c.querySelectorAll(".rp-crow").length),
    tappablePerCard: cards.map((c) => c.querySelectorAll("button.rp-crow").length),
    classTexts: cards.map((c) => [...c.querySelectorAll(".rp-crow")].map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim())),
    nameOccurrences: cards.map((c) => (c.textContent?.match(/SFG MCTM SF EXP|KOTA EXPRESS/g) ?? []).length),
  };
});
log("CHAT GROUPS:", JSON.stringify(groups, null, 1));
await p1.screenshot({ path: `${OUT}/round29-chat-groups.png` });

/* 22432 ka 3A row tap karo (pehla 22432 card, doosra class row) */
await p1.click(".rp-row:nth-of-type(3) .rp-crow:nth-of-type(2)");
await p1.waitForTimeout(1200);
const pax1 = await p1.evaluate(() => {
  const ov = document.querySelector(".overlay-screen");
  const t = (ov?.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    screen: ov ? "passengers-overlay" : "chat",
    hasName: Boolean(document.querySelector('[id^="name-"]')),
    overlayText: t.slice(0, 400),
    overlayHasTrain: /22432/.test(t),
    overlayHasClass: /3A/.test(t),
    overlayHasFare: /565/.test(t),
  };
});
log("CLASS TAP → PASSENGER FORM:", JSON.stringify(pax1, null, 1));
await p1.screenshot({ path: `${OUT}/round29-class-tap-pax.png` });
await p1.close();

/* ── 2) "book krdo" → khud passenger form (rows ke saath, fare/status pehle se) ── */
handler = () => ({ reply: REPLY_BOOK, rows: SEAT_ROWS, withSeatFilter: true });
const p2 = await newPage();
await p2.goto(BASE, { waitUntil: "domcontentloaded" });
await p2.waitForSelector(".composer input", { timeout: 30000 });
await send(p2, "22432 mein 3A book krdo");
await p2.waitForTimeout(900);
const pax2 = await p2.evaluate(() => {
  const ov = document.querySelector(".overlay-screen");
  const t = (ov?.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    screen: ov ? "passengers-overlay" : "chat",
    hasName: Boolean(document.querySelector('[id^="name-"]')),
    overlayText: t.slice(0, 400),
    overlayHasTrain: /22432/.test(t),
    overlayHasClass: /3A/.test(t),
    overlayHasFare: /565/.test(t),
  };
});
log("AUTO BOOK (rows ke saath):", JSON.stringify(pax2, null, 1));
await p2.screenshot({ path: `${OUT}/round29-auto-book-pax.png` });
await p2.close();

/* ── 3) "book krdo" jab koi row data nahi — form phir bhi khule (honest note) ── */
handler = () => ({ reply: REPLY_BOOK, rows: [], withSeatFilter: false });
const p3 = await newPage();
await p3.goto(BASE, { waitUntil: "domcontentloaded" });
await p3.waitForSelector(".composer input", { timeout: 30000 });
await send(p3, "22432 mein 3A book krdo");
await p3.waitForTimeout(900);
const pax3 = await p3.evaluate(() => {
  const ov = document.querySelector(".overlay-screen");
  const t = (ov?.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    screen: ov ? "passengers-overlay" : "chat",
    hasName: Boolean(document.querySelector('[id^="name-"]')),
    overlayText: t.slice(0, 400),
    overlayHasTrain: /22432/.test(t),
    overlayHasClass: /3A/.test(t),
  };
});
log("AUTO BOOK (koi row nahi):", JSON.stringify(pax3, null, 1));
await p3.screenshot({ path: `${OUT}/round29-auto-book-nodata.png` });
await p3.close();

await browser.close();
log("PROBE_DONE");
