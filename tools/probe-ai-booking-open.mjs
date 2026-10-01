/* Repro: live prod par asli browser (Chromium) me "🎫 AI Booking" kholne ki koshish.
 * Jo dikhega wahi sach — console errors, page errors, DOM state, screenshot.
 */
import { chromium } from "playwright";

const URL = process.env.URL || "https://railbook-gegs.onrender.com/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 414, height: 900 } });

const logs = [];
const errs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 400)));
page.on("pageerror", (e) => errs.push(String(e && e.message).slice(0, 400)));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);

const beforeBody = (await page.locator("body").innerText()).slice(0, 300);
console.log("── BEFORE (chat load) ──");
console.log(beforeBody.replace(/\n+/g, " | ").slice(0, 300));

const btn = page.getByLabel("AI Booking").first();
const found = await btn.count();
console.log("AI Booking button mila:", found);

await btn.click({ timeout: 15000 }).catch((e) => console.log("click err:", String(e).slice(0, 200)));
await page.waitForTimeout(4000);

const dialog = await page.getByRole("dialog", { name: "AI Booking" }).count();
const dock = await page.getByRole("region", { name: "AI Booking" }).count();
const body = (await page.locator("body").innerText()).slice(0, 600);

console.log("── AFTER click ──");
console.log("dialog(dialog role):", dialog, "| dock(region):", dock);
console.log(body.replace(/\n+/g, " | ").slice(0, 600));
console.log("── page errors ──");
console.log(errs.length ? errs.join("\n") : "(koi page error nahi)");
console.log("── console (error/warning) ──");
console.log(logs.filter((l) => /error|warn|310|hooks/i.test(l)).slice(0, 15).join("\n") || "(koi error/warn nahi)");

await page.screenshot({ path: "/home/user/ai-booking-open-probe.png", fullPage: false });
await browser.close();
console.log("screenshot: /home/user/ai-booking-open-probe.png");
