/* Live phone-view proof (Round-24): asli deployed site ko Pixel-size viewport par khol kar
 * (a) review page ("Review journey" = journey receipt + neeche Continue to IRCTC) aur
 * (b) passengers screen ka screenshot + text capture karta hai.
 *   node tools/probe-live-review.mjs <outDir>
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "/home/user/RailBook/previews";
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
const pax2 = [
  { id: "p1", name: "Mohit Kumar", age: "38", gender: "MALE", berthPreference: "Lower", foodChoice: "", idType: "", idNumber: "", bookOnlyIfConfirm: true, autoUpgrade: false },
  { id: "p2", name: "Asha Devi", age: "35", gender: "FEMALE", berthPreference: "Upper", foodChoice: "VEG", idType: "", idNumber: "", bookOnlyIfConfirm: false, autoUpgrade: true },
];
const contact = { mobile: "9876543210", email: "mohit@example.com", whatsappOptIn: true };

const base = {
  flow: "FARE_REVIEW",
  screen: "review",
  date: "2026-09-27",
  dateProvided: true,
  passengerCount: 2,
  paxProvided: true,
  trains: [train],
  selectedTrain: train,
  selectedClass: train.classes[0],
  seatPreference: "Lower",
  passengers: pax2,
  contact,
  previewFare: { baseFare: 200, serviceFee: 50, total: 250 },
  recommendations: [],
  searching: false,
  booking: null,
  emptyMessage: null,
  notice: null,
  error: null,
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
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.goto("https://railbook-gegs.onrender.com/", { waitUntil: "domcontentloaded" });
await page.evaluate((s) => sessionStorage.setItem("railbook.booking.v1", JSON.stringify(s)), base);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const receipt = await page.evaluate(() => {
  const el = document.querySelector("#rv-journey");
  return el ? el.innerText : null;
});
const paxBlock = await page.evaluate(() => document.querySelector("#rv-passengers")?.innerText ?? null);
const order = await page.evaluate(() => {
  const a = document.querySelector("#rv-journey");
  const b = document.querySelector("#irctc-continue");
  return a && b ? a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? "summary-before-button" : "WRONG" : null;
});
const extras = await page.evaluate(() =>
  ["Wallet", "Confirm Booking", "Copy journey + passenger summary", "Copy-ready summary", "Nothing is confirmed"].filter((t) =>
    document.body.innerText.includes(t),
  ),
);
await page.screenshot({ path: path.join(OUT, "round24-live-review-top.png") });
await page.evaluate(() => {
  const sc = document.querySelector(".page") ?? document.scrollingElement;
  if (sc) sc.scrollTop = sc.scrollHeight;
});
await page.screenshot({ path: path.join(OUT, "round24-live-review-bottom.png") });

/* Passengers screen — CTA label + empty-list guard */
await page.evaluate((s) => sessionStorage.setItem("railbook.booking.v1", JSON.stringify(s)), { ...base, screen: "passengers", flow: "PASSENGERS_PENDING" });
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const paxScreen = await page.evaluate(() => ({
  cards: document.querySelectorAll(".pax-card").length,
  cta: document.querySelector(".sticky-cta button")?.textContent ?? null,
  prompt: document.querySelector(".vb-prompt")?.textContent ?? null,
}));
await page.screenshot({ path: path.join(OUT, "round24-live-passengers.png") });

/* Khaali state (device wala case) — guard ke baad kya dikhta hai */
await page.evaluate((s) => sessionStorage.setItem("railbook.booking.v1", JSON.stringify(s)), { ...base, screen: "passengers", flow: "PASSENGERS_PENDING", passengers: [] });
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const emptyGuard = await page.evaluate(() => ({
  cards: document.querySelectorAll(".pax-card").length,
  cardsText: [...document.querySelectorAll(".pax-card")].map((c) => c.innerText.slice(0, 40)),
  cta: document.querySelector(".sticky-cta button")?.textContent ?? null,
}));

console.log(JSON.stringify({ receipt, paxBlock, order, extras, paxScreen, emptyGuard, errors }, null, 1));
await browser.close();
