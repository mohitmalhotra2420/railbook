/* Device-like probe (Round-24 investigation): live site ko Pixel-size viewport par kholta hai,
 * sessionStorage me state daal kar — Passengers screen ka layout + scroll behaviour measure karta hai.
 *   node tools/probe-device-scroll.mjs <outDir> [mode]
 * mode: filled | emptypax | notrain
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "/tmp/probe";
const MODE = process.argv[3] ?? "filled";
fs.mkdirSync(OUT, { recursive: true });

const train = {
  number: "12484",
  name: "ASR TVCN SF EXP",
  type: "",
  from: { code: "ASR", name: "Amritsar Junction", city: "Amritsar Junction" },
  to: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana Junction" },
  date: "2026-09-27",
  departure: "05:55",
  arrival: "08:20",
  arrivalDayOffset: 0,
  durationMinutes: 145,
  durationLabel: "2h 25m",
  runsOn: [],
  classes: [{ code: "SL", label: "Sleeper", status: "AVAILABLE", seats: 102, fare: 100, source: "web_confirmtkt" }],
};
const pax = (n) => ({
  id: `p${n}`,
  name: "Mohit Kumar",
  age: "38",
  gender: "MALE",
  berthPreference: "Lower",
  foodChoice: "",
  idType: "",
  idNumber: "",
  bookOnlyIfConfirm: false,
  autoUpgrade: false,
});

const state = {
  flow: "PASSENGERS_PENDING",
  screen: "passengers",
  from: train.from,
  to: train.to,
  date: "2026-09-27",
  dateProvided: true,
  passengerCount: 1,
  paxProvided: true,
  trains: [train],
  recommendations: [],
  searching: false,
  selectedTrain: MODE === "notrain" ? null : train,
  selectedClass: train.classes[0],
  seatPreference: "Lower",
  passengers: MODE === "emptypax" ? [] : [pax(1), pax(2)],
  contact: { mobile: "9876543210", email: "m@example.com", whatsappOptIn: true },
  notice: null,
  error: null,
  booking: null,
  emptyMessage: null,
  previewFare: null,
  sessionId: 1,
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
});

await page.goto("https://railbook-gegs.onrender.com/?probe=" + MODE, { waitUntil: "domcontentloaded" });
await page.evaluate((s) => sessionStorage.setItem("railbook.booking.v1", JSON.stringify(s)), state);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const metrics = await page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const rect = (el) => (el ? { y: Math.round(el.getBoundingClientRect().top), h: Math.round(el.getBoundingClientRect().height) } : null);
  const scroller = q(".dock-scroll");
  const cards = [...document.querySelectorAll(".pax-card, .pax-trip, .pax-catering")].map((el) => ({
    cls: el.className.slice(0, 40),
    ...rect(el),
  }));
  return {
    screen: sessionStorage.getItem("railbook.booking.v1") ? "present" : "absent",
    vw: window.innerWidth,
    vh: window.innerHeight,
    bodyScrollH: document.documentElement.scrollHeight,
    bodyScrollTop: document.documentElement.scrollTop,
    scrollerScrollH: scroller ? scroller.scrollHeight : null,
    scrollerClientH: scroller ? scroller.clientHeight : null,
    scrollerScrollTop: scroller ? scroller.scrollTop : null,
    scrollerRect: rect(scroller),
    paxCards: cards.length,
    cards,
    ctaText: q(".sticky-cta button")?.textContent ?? null,
    ctaRect: rect(q(".sticky-cta")),
    promptText: q(".vb-prompt")?.textContent ?? null,
    paxCountLabel: document.body.innerText.match(/Passenger \d/g)?.length ?? 0,
    textLen: document.body.innerText.trim().length,
  };
});
console.log(JSON.stringify({ mode: MODE, metrics, errors }, null, 1));
await page.screenshot({ path: path.join(OUT, `passengers-${MODE}-top.png`) });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.screenshot({ path: path.join(OUT, `passengers-${MODE}-bottom.png`) });
await browser.close();
