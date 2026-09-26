/* R37d debug: T3 (dobara hukm) par client branch kyun nahi chala — saare messages + requests dump. */
import { chromium } from "playwright";

const URL = "https://railbook-gegs.onrender.com/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 950 } });
const reqs = [];
page.on("request", (r) => {
  if (r.url().includes("/api/agent")) reqs.push({ t: Date.now(), body: (r.postData() ?? "").slice(0, 200) });
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".composer input", { timeout: 90000 });

const dump = async (tag) => {
  const d = await page.evaluate(() => ({
    screen: document.querySelector(".overlay-screen") ? "overlay" : "chat",
    n: [...document.querySelectorAll(".msg.assistant")].length,
    msgs: [...document.querySelectorAll(".msg.assistant")].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 110)),
  }));
  console.log(`\n[${tag}] screen=${d.screen} assistantMsgs=${d.n}`);
  d.msgs.forEach((m, i) => console.log(`   ${i}: ${m}`));
};

const ask = async (text) => {
  const before = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant")].length);
  await page.fill(".composer input", text);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  await page
    .waitForFunction((n) => [...document.querySelectorAll(".msg.assistant")].length > n, before, { timeout: 300000 })
    .catch(() => console.log("   (wait timeout)"));
  await page.waitForTimeout(2500);
};

await ask("12054 ki seat availability batao ASR se HW kal ke liye");
await dump("T1");
await ask("12054 mein 2S book krdo");
await dump("T2");
await ask("12054 mein 2S book krdo");
await dump("T3");
console.log("\n/api/agent requests:", reqs.length);
reqs.forEach((r, i) => console.log(`  ${i}: ${r.body}`));
await browser.close();
