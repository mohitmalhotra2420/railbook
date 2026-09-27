import { chromium } from "playwright";
const URL = "https://railbook-gegs.onrender.com/";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
await p.goto(URL, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".composer input", { timeout: 60000 });
await p.fill(".composer input", "Kya kal ke liye koi available seat hai ludhiana se amritsar ke liye?");
await p.keyboard.press("Enter");
await p.waitForSelector(".sf-group", { timeout: 150000 });
await p.waitForTimeout(2000);
const dump = await p.evaluate(() => {
  const msgs = [...document.querySelectorAll(".msg")].map((m) => ({
    role: m.className,
    text: (m.querySelector(".msg-text")?.textContent ?? "").slice(0, 220),
    rpRows: m.querySelectorAll(".rp-row").length,
    sfGroups: m.querySelectorAll(".sf-group").length,
    rpSum: (m.querySelector(".rp-sum")?.textContent ?? "").slice(0, 120),
  }));
  return msgs;
});
console.log(JSON.stringify(dump, null, 1));
await b.close();
