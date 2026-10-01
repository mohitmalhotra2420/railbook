/* Probe v4 — R69 verify (live prod, asli browser):
 *   A) normal: AI Booking khule, koi note/reload nahi, query → brain → avail
 *   B) purana-bundle simulate: /api/version par alag commit → panel saaf note de + page taaza kare
 */
import { chromium } from "playwright";

const URL = "https://railbook-gegs.onrender.com/";
const browser = await chromium.launch();

/* ── A) normal ─────────────────────────────────────────────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 414, height: 900 } });
  const errs = [];
  const api = [];
  page.on("pageerror", (e) => errs.push(String(e && e.message).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));
  page.on("request", (r) => r.url().includes("/api/") && api.push(r.url().replace(URL, "/")));
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  console.log("A) bundle:", await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()).join(",")));
  await page.getByLabel("AI Booking").first().click({ timeout: 15000 });
  await page.getByRole("dialog", { name: "AI Booking" }).waitFor({ timeout: 8000 });
  console.log("A) AI Booking khula: ✅ | build tag:", await page.evaluate(() => document.querySelector(".build-tag")?.textContent));
  await page.waitForTimeout(2500);
  console.log("A) fresh-note (nahi hona chahiye):", await page.getByTestId("aib-fresh-note").count());
  const c = page.getByLabel("AI Booking me type karo");
  await c.fill("Amritsar se Ludhiana kal 2 log");
  await c.press("Enter");
  await page.waitForTimeout(16000);
  const txt = await page.locator("body").innerText();
  console.log("A) jawab mila:", /train|mil|Ludhiana/i.test(txt) ? "✅" : "❌");
  console.log("A) agent calls:", api.filter((u) => u.includes("/api/agent")).length);
  console.log("A) /api/version check hua:", api.some((u) => u.includes("/api/version")) ? "haan (R69 check chala)" : "nahi");
  console.log("A) errors:", errs.length ? errs.slice(0, 5).join(" | ") : "(koi nahi)");
  await page.screenshot({ path: "/home/user/probe4-A-normal.png" });
  await page.close();
}

/* ── B) purana bundle simulate ────────────────────────────────────────────────── */
{
  const page = await browser.newPage({ viewport: { width: 414, height: 900 } });
  let reloaded = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) reloaded += 1;
  });
  await page.route("**/api/version*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ commit: "deadbee" }) }),
  );
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.getByLabel("AI Booking").first().click({ timeout: 15000 });
  await page.getByRole("dialog", { name: "AI Booking" }).waitFor({ timeout: 8000 });
  /* note ~900ms tak dikhta hai, phir reload — chirp-chirp poll karo */
  let note = "(note kabhi nahi dikha)";
  for (let i = 0; i < 25; i++) {
    const t = await page.getByTestId("aib-fresh-note").textContent().catch(() => null);
    if (t) { note = t; break; }
    await page.waitForTimeout(120);
  }
  console.log("B) note:", note);
  await page.waitForTimeout(2500);
  console.log("B) page taaza hua (navigations):", reloaded > 1 ? `haan (${reloaded} loads)` : "nahi");
  await page.screenshot({ path: "/home/user/probe4-B-stale.png" });
  await page.close();
}

await browser.close();
