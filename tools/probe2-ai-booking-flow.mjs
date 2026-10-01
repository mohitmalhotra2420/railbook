/* Probe v2 — poora AI Booking flow live prod par, asli browser me:
 *   1) bundle verify, 2) AI Booking open, 3) chat query → kitne /api/agent calls,
 *   4) search → dock mode, 5) train → class → passengers, 6) passengers screen par AI Booking dobara kholna,
 *   7) har step par page errors + screenshots.
 */
import { chromium } from "playwright";

const URL = process.env.URL || "https://railbook-gegs.onrender.com/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 414, height: 900 } });

const errs = [];
const api = [];
page.on("pageerror", (e) => errs.push(String(e && e.message).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push("console: " + m.text().slice(0, 300));
});
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/")) api.push(`${r.method()} ${u.replace(URL, "/")}`);
});

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.log(`❌ ${name} → ${String(e.message).split("\n")[0].slice(0, 200)}`);
  }
  const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 220);
  console.log(`   screen: ${body.replace(/\n+/g, " | ").slice(0, 200)}`);
};

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);
const bundle = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.src).join(","));
console.log("bundle:", bundle);

const aiBtn = page.getByLabel("AI Booking").first();
await step("1. AI Booking kholna", async () => {
  await aiBtn.click({ timeout: 15000 });
  await page.getByRole("dialog", { name: "AI Booking" }).waitFor({ timeout: 8000 });
});

const composer = () => page.getByLabel("AI Booking me type karo");
const send = async (text) => {
  await composer().fill(text);
  await composer().press("Enter");
};

await step("2. chhoti query (journey) bhejna", async () => {
  await send("Amritsar se Ludhiana kal, 2 passengers");
  await page.waitForTimeout(12000);
});

await step("3. brain ka jawab aaya? (dock ya dialog text)", async () => {
  const t = await page.locator("body").innerText();
  if (!/Ludhiana/i.test(t)) throw new Error("jawab me Ludhiana nahi mila");
});

await step("4. train number bhejna (dock flow)", async () => {
  await send(process.env.TRAIN || "12014");
  await page.waitForTimeout(9000);
});

await step("5. class bhejna (CC) → passenger form khule", async () => {
  await send("CC");
  await page.waitForTimeout(9000);
  const t = await page.locator("body").innerText();
  if (!/Passenger|passenger/i.test(t)) throw new Error("passenger form nahi khula");
});

await page.screenshot({ path: "/home/user/probe2-passengers.png" });

await step("6. passengers screen par AI Booking dobara kholna (dock)", async () => {
  /* AI Booking band karo — dock mode me ✕ / close button */
  const close = page.getByLabel(/Close|Band/i).first();
  if (await close.count()) await close.click().catch(() => {});
  await page.waitForTimeout(800);
  await aiBtn.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
});

await step("7. chat (Concierge) screen par bhi ek general sawaal", async () => {
  const t = await page.locator("body").innerText();
  if (/dikha nahi paaya/i.test(t)) throw new Error("BOUNDARY CARD screen par hai!");
});

console.log("── /api calls ──");
console.log(api.length ? api.join("\n") : "(koi /api call nahi — shak!)");
console.log("── errors ──");
console.log(errs.length ? errs.slice(0, 20).join("\n") : "(koi error nahi)");
await page.screenshot({ path: "/home/user/probe2-final.png", fullPage: true });
await browser.close();
