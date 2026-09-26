/* Round-30 preview probe (26 Sep 2026) — local build par deterministic mocks ke saath:
 *   1) "12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye" (user ka asli sawaal)
 *      → chat block SIRF 12013 ka (1 group), header "Aapki maangi train (live board)"
 *   2) generic sawaal ("kal ke liye seat wali trains batao") → pehle jaisa POORA board (saare trains)
 *   3) maangi hui train list me na ho → block hi nahi banta (jhoothi board nahi)
 *
 *   node tools/probe-live-r30.mjs    (RAILBOOK_BASE, default http://127.0.0.1:4173/)
 * Screenshots: round30-{focus-block,full-board}.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.RAILBOOK_BASE ?? "http://127.0.0.1:4173/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const SVDK_LDH = { from: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, to: { code: "ASR", name: "Amritsar Junction", city: "Amritsar" } };

/* Live board ke asli rows (user ke screenshot 1/2 se) — 8 trains, kuch WL/N-A wale bhi. */
const ROWS = [
  ["12013", "AMRITSAR SHTABDI", "CC", "AVAILABLE", 357, 675],
  ["12013", "AMRITSAR SHTABDI", "EC", "AVAILABLE", 23, 1015],
  ["22487", "VANDE BHARAT EXP", "CC", "AVAILABLE", 139, 790],
  ["22487", "VANDE BHARAT EXP", "EC", "AVAILABLE", 15, 1325],
  ["14631", "DDN ASR EXPRESS", "SL", "AVAILABLE", 101, 150],
  ["14631", "DDN ASR EXPRESS", "3A", "AVAILABLE", 7, 520],
  ["11057", "CSMT ASR EXPRESS", "3E", "AVAILABLE", 38, 520],
  ["11057", "CSMT ASR EXPRESS", "SL", "WAITLIST", 1, 150],
  ["15707", "KIR ASR EXPRESS", "2A", "AVAILABLE", 37, 725],
  ["15707", "KIR ASR EXPRESS", "3A", "NOT_AVAILABLE", null, 520],
  ["12357", "DURGIANA EXP", "3E", "WAITLIST", 9, 565],
  ["18237", "CHATTISGARH EXP", "2A", "NOT_AVAILABLE", null, 725],
].map(([number, name, classCode, status, count, fare]) => ({
  number: String(number),
  name: String(name),
  classCode: String(classCode),
  status: String(status),
  seats: status === "AVAILABLE" ? Number(count) : null,
  rac: null,
  waitlist: status === "WAITLIST" ? Number(count) : null,
  fare: Number(fare),
  departure: null,
  durationMinutes: null,
}));

function body({ text }) {
  return {
    nlu: { ...SVDK_LDH, date: "2026-09-27", passengerCount: null, intent: "SEARCH_TRAIN" },
    source: "ai",
    context: {
      intent: "SEARCH_TRAIN",
      origin: SVDK_LDH.from,
      destination: SVDK_LDH.to,
      date: "2026-09-27",
      dateProvided: true,
      passengers: null,
      paxProvided: false,
      selectedTrainNumber: null,
      justReset: false,
    },
    tool: "live_board_seats",
    toolOk: true,
    reply: text.includes("12013")
      ? "12013 LDH → ASR 2026-09-27 ki seat availability dekhne ke liye kitne passengers hain? 1-6 batao, phir class-wise availability bataunga."
      : "27 Sep 2026, LDH → ASR — ye saari trains live board par hain (real provider data).",
    interrupt: false,
    resumeAsk: null,
    resumeText: null,
    confirmBook: false,
    missingFields: [],
    engine: "agentic_tool_calling",
    modelUsed: "probe-mock",
    latencyMs: 900,
    toolTrace: [{ tool: "find seats", ok: true, source: "confirmtkt" }],
    seatFilter: { classCodes: ["CC", "EC", "3A", "2A", "SL", "3E"], line: null, rows: ROWS, wlRows: [], trainsSeen: 21, source: "confirmtkt" },
    trains: null,
    journey: null,
    alternatives: null,
    trainPicker: null,
    choice: null,
    liveDates: null,
  };
}

const browser = await chromium.launch();

async function newPage(replyFor) {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  await page.route("**/api/meta", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: { id: "confirmtkt", name: "ConfirmTkt", mock: false }, serviceFee: 30 }) }),
  );
  await page.route("**/api/agent/stream", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/agent", (r) => {
    const sent = JSON.parse(r.request().postData() ?? "{}");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body({ text: String(sent.text ?? "") })) });
  });
  await page.route("**/api/understand", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nlu: {}, source: "nlu", missingFields: [] }) }));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".composer input", { timeout: 30000 });
  await page.fill(".composer input", replyFor);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  return page;
}

const read = (p) =>
  p.evaluate(() => {
    const card = document.querySelector("#chat-seatlist");
    return {
      blockPresent: Boolean(card),
      focused: card ? card.className.includes("sf-focused") : false,
      head: (card?.querySelector(".sf-head")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      groups: card ? card.querySelectorAll(".sf-group").length : 0,
      groupNumbers: card ? [...card.querySelectorAll(".sf-group")].map((g) => (g.textContent ?? "").match(/\b\d{4,5}\b/)?.[1] ?? "") : [],
      chips: card ? card.querySelectorAll(".sf-cchip").length : 0,
      cardText: (card?.textContent ?? "").replace(/\s+/g, " ").slice(0, 300),
    };
  });

/* ── 1) user ka asli sawaal: ek train maangi ─────────────────────────── */
const p1 = await newPage("12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye");
const t1 = await read(p1);
log("FOCUSED (12013 maanga):", JSON.stringify(t1, null, 1));
await p1.screenshot({ path: `${OUT}/round30-focus-block.png` });
await p1.close();

/* ── 2) generic sawaal: poora board pehle jaisa ──────────────────────── */
const p2 = await newPage("kal ke liye seat wali trains batao ludhiana se amritsar");
const t2 = await read(p2);
log("GENERIC (poori board):", JSON.stringify(t2, null, 1));
await p2.screenshot({ path: `${OUT}/round30-full-board.png` });
await p2.close();

/* ── 3) maangi train list me nahi ────────────────────────────────────── */
const p3 = await newPage("14610 ki seat availability batao");
const t3 = await read(p3);
log("MAANGI TRAIN LIST ME NAHI (14610):", JSON.stringify(t3, null, 1));
await p3.close();

await browser.close();
log("PROBE_DONE");
