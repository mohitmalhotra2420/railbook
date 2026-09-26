/* Round-32 preview probe (26 Sep 2026) — local build par, server ke ASLI output shape ke saath:
 *   User requirement: "har query pehle model ke pass jaani chahiye and wo decide kare kon sa tool
 *   use karna, kya karna hai" — isliye agla kadam bhi MODEL chunta hai; data sirf validate/fallback.
 *
 *   1) model    → server ne [NEXT] lines alag karke evidence-validate kiya (nextActions) →
 *                 card par tag "AI ne chuna", chips bilkul model ke (jaisa wo likha)
 *   2) dropped  → model ne [NEXT] diya par evidence me nahi mila → server drop kar deta hai
 *                 (nextActions null) → client verified-data fallback dikhata hai, tag "verified data se"
 *                 (kabhi jhoothi suggestion nahi)
 *   3) list     → model ne koi [NEXT] nahi diya, par train list verified data hai → fallback
 *                 "Kis train me seat hai?" (tag "verified data se")
 *   4) plain    → koi verified data nahi → koi card hi nahi (jhoothi suggestion se behtar kuch na kehna)
 *   5) hint     → plain jawab ho par user ne khud train number poochha ho → chip usi train ka
 *                 (user ke apne turn se grounded — invent kuch nahi)
 *   5) model chip tap → Book chip ke utterance se seedha passenger form (Round-29 flow)
 *
 *   node tools/probe-live-r32.mjs    (RAILBOOK_BASE, default http://127.0.0.1:4173/)
 * Screenshots: round32-{model-chips,dropped-fallback,list-fallback,no-data,chip-tap}.png
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
  { number: "12013", name: "AMRITSAR SHTABDI", classCode: "CC", status: "AVAILABLE", seats: 334, rac: null, waitlist: null, fare: 490 },
  { number: "12013", name: "AMRITSAR SHTABDI", classCode: "EC", status: "AVAILABLE", seats: 22, rac: null, waitlist: null, fare: 770 },
  { number: "15707", name: "KIR ASR EXPRESS", classCode: "3A", status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, fare: 520 },
].map((r) => ({ ...r, departure: null, durationMinutes: null }));

const TRAINS = [
  { number: "12013", name: "AMRITSAR SHTABDI", departure: "07:00", arrival: "09:00", arrivalDayOffset: 0, durationMinutes: 120, durationLabel: "2h 00m", classes: ["CC", "EC"], fare: { classCode: "CC", amount: 675 } },
  { number: "22487", name: "VANDE BHARAT EXP", departure: "08:00", arrival: "09:50", arrivalDayOffset: 0, durationMinutes: 110, durationLabel: "1h 50m", classes: ["CC", "EC"], fare: { classCode: "CC", amount: 790 } },
];

function body(scenario) {
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
    modelUsed: "meta/muse-glimmer-30b",
    latencyMs: 800,
    toolTrace: [{ tool: "find seats", ok: true, source: "confirmtkt" }],
    seatFilter: null,
    trains: null,
    journey: null,
    alternatives: null,
    trainPicker: null,
    choice: null,
    liveDates: null,
    nextActions: null,
  };
  if (scenario === "model") {
    /* Server ne model ki [NEXT] lines alag kar li aur tool-evidence se validate ki — reply clean. */
    return {
      ...base,
      reply: "12013 AMRITSAR SHTABDI — LDH → ASR 2026-09-27: CC (AC Chair Car) — AVAILABLE 334 — fare ₹490 · EC — AVAILABLE 22 — fare ₹770. Source: confirmtkt.com",
      seatFilter: { classCodes: ["CC", "EC"], line: null, rows: SEATS, wlRows: [], trainsSeen: 21, source: "confirmtkt" },
      nextActions: [
        { label: "Book 12013 · CC (AVL 334 ₹490)", utterance: "12013 mein CC book krdo", primary: true },
        { label: "Book 12013 · EC (AVL 22 ₹770)", utterance: "12013 mein EC book krdo", primary: false },
      ],
    };
  }
  if (scenario === "dropped") {
    /* Model ne [NEXT] diya tha par usme aisi cheez thi jo is turn ke tool data me nahi
     * (jaise "Book 99999 · 1A") → server ne drop kiya → nextActions null → data fallback. */
    return {
      ...base,
      reply: "12013 AMRITSAR SHTABDI — LDH → ASR 2026-09-27: CC — AVAILABLE 334 — fare ₹490 · EC — AVAILABLE 22 — fare ₹770.",
      seatFilter: { classCodes: ["CC", "EC"], line: null, rows: SEATS, wlRows: [], trainsSeen: 21, source: "confirmtkt" },
      nextActions: null,
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
    return { ...base, reply: "Ludhiana Junction par 5 platforms hain, waiting room aur veg/non-veg stalls hain — koi train-specific data is turn me nahi aaya.", engine: "deterministic", modelUsed: null };
  }
  if (scenario === "hint") {
    return { ...base, reply: "Train 12013 ke 8 stops hain — LDH par rukti hai 20:16, ASR par 23:05.", engine: "deterministic", modelUsed: null };
  }
  return base;
}

const browser = await chromium.launch();

async function run(scenario, ask, shot) {
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  await page.route("**/api/meta", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: { id: "confirmtkt", name: "ConfirmTkt", mock: false }, serviceFee: 30 }) }));
  await page.route("**/api/agent/stream", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/api/agent", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body(scenario)) }));
  await page.route("**/api/understand", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ nlu: {}, source: "nlu", missingFields: [] }) }));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".composer input", { timeout: 30000 });
  await page.fill(".composer input", ask);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const card = document.querySelector("#next-step");
    const tag = card?.querySelector(".ns-tag");
    return {
      nextStep: Boolean(card),
      tag: (tag?.textContent ?? "").trim(),
      tagClass: (tag?.className ?? "").replace("ns-tag", "").trim(),
      label: (card?.querySelector(".ns-label")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      chips: card ? [...card.querySelectorAll(".ns-chip")].map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim()) : [],
      primary: (card?.querySelector(".ns-chip")?.className ?? "").includes("primary"),
      hint: (card?.querySelector(".ns-hint")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      nextStepText: (card?.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  });
  if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
  return { page, info };
}

let fail = 0;
const check = (name, ok, info) => {
  log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(info)}`);
  if (!ok) fail += 1;
};

/* 1) model ke [NEXT] → chips + tag "AI ne chuna" */
const a = await run("model", "12013 ki seat availability batao kal ke liye ludhiana se amritsar", "round32-model-chips.png");
check("1 model chips (tag AI ne chuna + labels bilkul model ke)", a.info.tag === "AI ne chuna" && a.info.tagClass === "model" && a.info.chips.length === 2 && a.info.chips[0] === "Book 12013 · CC (AVL 334 ₹490)" && a.info.chips[1] === "Book 12013 · EC (AVL 22 ₹770)", a.info);

/* 2) model chip tap → passengers form (model ka utterance hi chalta hai) */
await a.page.click("#next-step .ns-chip.primary");
await a.page.waitForTimeout(1600);
const tapped = await a.page.evaluate(() => {
  const ov = document.querySelector(".overlay-screen");
  return {
    screen: ov ? "passengers-overlay" : "chat",
    hasName: Boolean(document.querySelector('[id^="name-"]')),
    head: (ov?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 130),
  };
});
check("2 model chip tap → passenger form", tapped.screen === "passengers-overlay" && tapped.hasName, tapped);
await a.page.screenshot({ path: `${OUT}/round32-chip-tap.png` });
await a.page.close();

/* 3) ungrounded [NEXT] drop (server) → data fallback, tag "verified data se" */
const b = await run("dropped", "12013 ki seat availability batao kal ke liye ludhiana se amritsar", "round32-dropped-fallback.png");
check("3 ungrounded NEXT drop → verified-data fallback", b.info.tag === "verified data se" && b.info.tagClass === "data" && b.info.chips.length >= 1 && !/99999/.test(b.info.nextStepText), b.info);
await b.page.close();

/* 4) model ne NEXT nahi diya, list data verified hai → fallback */
const c = await run("list", "ludhiana se amritsar kal ki trains batao", "round32-list-fallback.png");
check("4 list par NEXT na hone par data fallback", c.info.tag === "verified data se" && c.info.chips.some((x) => /seat/i.test(x)), c.info);
await c.page.close();

/* 5) koi verified data nahi (train bhi nahi) → koi card nahi (jhoothi suggestion nahi) */
const d = await run("plain", "ludhiana station par kya suvidha hai", "round32-no-data.png");
check("5 plain jawab → koi card nahi", d.info.nextStep === false, d.info);
await d.page.close();

/* 6) user ne khud train poochhi → usi train ka honest chip (invent kuch nahi) */
const e = await run("hint", "12013 ke stops batao", "round32-train-hint.png");
check("6 user ke train number se grounded chip", e.info.nextStep === true && e.info.tag === "verified data se" && /12013/.test(e.info.chips.join(" ")), e.info);
await e.page.close();

await browser.close();
log(fail === 0 ? "PROBE_DONE all-pass" : `PROBE_DONE ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
