/* Probe v3 — APK/WebView simulation: wahi environment jo asli phone me hota hai.
 * Android app: UA se "wv" strip, domStorage on, Web Speech API NAHI (native bridge se),
 * speechSynthesis device me hota hai, RailBookVoice bridge maujood.
 * Yahi farq desktop browser test me nahi pakde jaate.
 */
import { chromium } from "playwright";

const URL = process.env.URL || "https://railbook-gegs.onrender.com/";
const MODE = process.env.MODE || "webview"; // webview | browser
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 412, height: 915 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; SM-M135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36",
  hasTouch: true,
  isMobile: true,
});

await page.addInitScript(() => {
  /* WebView me Web Speech API nahi — site ko native bridge milta hai (app me). */
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  /* App ka JS bridge (jaisa MainActivity addJavascriptInterface karta hai) */
  window.RailBookVoice = {
    isAvailable: () => true,
    start: () => true,
    stop: () => true,
    abort: () => true,
    speak: () => true,
    stopSpeaking: () => true,
    ttsAvailable: () => true,
  };
  window.RailBookNative = { postMessage: () => true };
});

const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + String(e && e.message).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push("console.error: " + m.text().slice(0, 300));
});
page.on("crash", () => errs.push("PAGE CRASHED"));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);

console.log(`── MODE=${MODE} ──`);
const btn = page.getByLabel("AI Booking").first();
console.log("button mila:", await btn.count());
await btn.click({ timeout: 15000 }).catch((e) => console.log("click err:", String(e.message).split("\n")[0]));
await page.waitForTimeout(3000);

const dialog = await page.getByRole("dialog", { name: "AI Booking" }).count();
const body = (await page.locator("body").innerText()).slice(0, 400);
console.log("dialog:", dialog);
console.log("body:", body.replace(/\n+/g, " | ").slice(0, 400));
console.log("boundary card:", /dikha nahi paaya/.test(body));

/* ab ek query — voice panel bhi render hota hai */
const composer = page.getByLabel("AI Booking me type karo");
if (await composer.count()) {
  await composer.fill("Amritsar se Ludhiana kal 2 log");
  await composer.press("Enter");
  await page.waitForTimeout(15000);
  const after = (await page.locator("body").innerText()).slice(0, 400);
  console.log("after query:", after.replace(/\n+/g, " | ").slice(0, 400));
}
console.log("── errors ──");
console.log(errs.length ? errs.slice(0, 15).join("\n") : "(koi error nahi)");
await page.screenshot({ path: `/home/user/probe3-${MODE}.png`, fullPage: false });
await browser.close();
