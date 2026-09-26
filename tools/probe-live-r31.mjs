/* Round-31 preview probe (26 Sep 2026) — local build par deterministic mocks:
 *   1) seat ka jawab → "Agla kadam" card (Book chip jo dikha wahi) — user: "answer ke baad AI ko next
 *      step pe leke jaana chahiye"
 *   2) Book chip tap → seedha passenger form (Round-29 ka auto-advance flow, wahi utterance)
 *   3) train list ka jawab → agla kadam: "Kis train me seat hai?"
 *   4) koi verified data nahi (plain jawab) → koi card nahi (jhoothi suggestion nahi)
 *
 *   node tools/probe-live-r31.mjs    (RAILBOOK_BASE, default http://127.0.0.1:4173/)
 * Screenshots: round31-{next-step,book-tap,list-nextstep,no-data}.png
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.RAILBOOK_BASE ?? "http://127.0.0.1:4173/";
const OUT = "/home/user/RailBook/previews";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const FROM = { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" };
const TO = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };

const SEATS = [
  { number: "12013", name: "AMRITSAR SHTABDI", classCode: "CC", status: "AVAILABLE", seats: 354, rac: null, waitlist: null, fare: 675 },
  { number: "12013", name: "AMRITSAR SHTABDI", classCode: "EC", status: "AVAILABLE", seats: 23, rac: null, waitlist: null, fare: 1015 },
  { number: "15707", name: "KIR ASR EXPRESS", classCode: "3A", status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, fare: 520 },
].map((r) => ({ ...r, departure: null, durationMinutes: null }));

const TRAINS = [
  { number: "12013", name: "AMRITSAR SHTABDI", departure: "07:00", arrival: "09:00", arrivalDayOffset: 0, durationMinutes: 120, durationLabel: "2h 00m", classes: ["CC", "EC"], fare: { classCode: "CC", amount: 675 } },
  { number: "22487", name: "VANDE BHARAT EXP", departure: "08:00", arrival: "09:50", arrivalDayOffset: 0, durationMinutes: 110, durationLabel: "1h 50m", classes: ["CC", "EC"], fare: { classCode: "CC", amount: 790 } },
];

function body(scenario, text) {
  const base = {
    nlu: { from: FROM, to: TO, date: "2026-09-27", passengerCount: 1, intent: "SEARCH_TRAIN" },
    source: "ai",
    context: { intent: "SEARCH_TRAIN", origin: FROM, destination: TO, date: "2026-09-27", dateProvided: true, passengers: 1, paxProvided: true, selectedTrainNumber: null, justReset: false },
    tool: "live_board_seats",
    toolOk: true,
    interrupt: false,
    resumeAsk: null,
    resumeText: null,
    confirmBook: false,
    missingFields: [],
    engine: "agentic_tool_calling",
    modelUsed: "probe-mock",
    latencyMs: 800,
    toolTrace: [{ tool: "find seats", ok: true, source: "confirmtkt" }],
    seatFilter: null,
    trains: null,
    journey: null,
    alternatives: null,
    trainPicker: null,
    choice: null,
    liveDates: null,
  };
  if (scenario === "seat") {
    return {
      ...base,
      reply: "12013 AMRITSAR SHTABDI — LDH → ASR 2026-09-27: CC (AC Chair Car) — AVAILABLE 354 — fare ₹675 · EC — AVAILABLE 23 — fare ₹1,015. Source: confirmtkt.com",
      seatFilter: { classCodes: ["CC", "EC"], line: null, rows: SEATS, wlRows: [], trainsSeen: 21, source: "confirmtkt" },
    };
  }
  if (scenario === "list") {
    return {
      ...base,
      reply: "LDH → ASR 2026-09-27: 2 trains — 12013 AMRITSAR SHTABDI (07:00 → 09:00, CC, EC) · 22487 VANDE BHARAT EXP (08:00 → 09:50, CC, EC).",
      trains: { from: "LDH", to: "ASR", date: "2026-09-27", fastest: "22487", rows: TRAINS },
    };
  }
  if (scenario === "plain") {
    return { ...base, reply: "Train 12013 ke 8 stops hain — LDH par rukti hai 20:16, ASR par 23:05." };
  }
  return base;
}

const browser = await chromium.launch();

async function run(scenario, ask, shot) {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  let last = "";
  await page.route("**/api/meta", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: { id: "confirmtkt", name: "ConfirmTkt", mock: false }, serviceFee: 30 }) }));
  await page.route("**/api/agent/stream", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/agent", (r) => {
    last = String(JSON.parse(r.request().postData() ?? "{}").text ?? "");
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body(scenario, last)) });
  });
  await page.route("**/api/understand", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nlu: {}, source: "nlu", missingFields: [] }) }));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".composer input", { timeout: 30000 });
  await page.fill(".composer input", ask);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const card = document.querySelector("#next-step");
    return {
      nextStep: Boolean(card),
      label: (card?.querySelector(".ns-label")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      chips: card ? [...card.querySelectorAll(".ns-chip")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim()) : [],
      hint: (card?.querySelector(".ns-hint")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      primary: card ? (card.querySelector(".ns-chip")?.className ?? "").includes("primary") : false,
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
  return { page, info };
}

/* 1) seat ka jawab → agla kadam */
const a = await run("seat", "12013 ki seat availability btana kal ke liye ludhiana se amritsar ke liye", "round31-next-step.png");
log("SEAT ANSWER → NEXT STEP:", JSON.stringify(a.info, null, 1));

/* 2) Book chip tap → passenger form (usi utterance se Round-29 flow) */
await a.page.click("#next-step .ns-chip.primary");
await a.page.waitForTimeout(1500);
const tapped = await a.page.evaluate(() => {
  const ov = document.querySelector(".overlay-screen");
  return {
    screen: ov ? "passengers-overlay" : "chat",
    hasName: Boolean(document.querySelector('[id^="name-"]')),
    head: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
  };
});
log("BOOK CHIP TAP:", JSON.stringify(tapped, null, 1));
await a.page.screenshot({ path: `${OUT}/round31-book-tap.png` });
await a.page.close();

/* 3) train list → agla kadam (seat availability) */
const b = await run("list", "ludhiana se amritsar kal ki trains batao", "round31-list-nextstep.png");
log("TRAIN LIST → NEXT STEP:", JSON.stringify(b.info, null, 1));
await b.page.close();

/* 4) plain jawab (koi verified list nahi) → koi jhoothi suggestion nahi */
const c = await run("plain", "12013 ke stops batao", "round31-no-data.png");
log("PLAIN ANSWER → NEXT STEP:", JSON.stringify(c.info, null, 1));
await c.page.close();

await browser.close();
log("PROBE_DONE");
