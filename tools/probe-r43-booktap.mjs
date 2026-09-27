/* Round-43c live: "Book" tap par passenger form khulta hai (user bug #3) — do raste:
 *   A) next-step chip "Book <train>" (deterministic single-train seat answer)
 *   B) seat card ka class row / chip (board reply)
 * Chalao: node tools/probe-r43-booktap.mjs   (live Render par, headless chromium) */
import { chromium } from "playwright";

const BASE = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com/";
const OUT = process.env.OUT_DIR ?? "/home/user";

const browser = await chromium.launch();
let page = await browser.newPage({ viewport: { width: 420, height: 940 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

const ask = async (q) => {
  const input = page.locator("textarea, input").first();
  await input.click();
  await input.fill(q);
  await input.press("Enter");
  await page.waitForTimeout(300);
};

const settle = async (maxMs = 150000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const last = (await page.locator(".msg.assistant").allInnerTexts().catch(() => [])).pop() ?? "";
    const progress = /Understanding your request|Samajh raha hoon|Seat checks|checks completed|^\.\.\.$/i;
    if (last && !progress.test(last)) return last;
    await page.waitForTimeout(2000);
  }
  return (await page.locator(".msg.assistant").allInnerTexts().catch(() => [])).pop() ?? "";
};

const paxOpen = async (label) => {
  const ok = await page
    .locator(".pax-inline, .pax-card")
    .first()
    .isVisible({ timeout: 60000 })
    .catch(() => false);
  const last = (await page.locator(".msg.assistant").allInnerTexts().catch(() => [])).pop() ?? "";
  console.log(`${ok ? "✅" : "❌"} ${label} — passenger form ${ok ? "KHULA" : "nahi khula"}`);
  if (!ok) console.log("   last reply:", last.replace(/\s+/g, " ").slice(-200));
  return ok;
};

let pass = 0;

/* ── A) single-train availability → chip "Book <train>" */
console.log("A) '12054 ki seat availability btana' → chip 'Book 12054' tap");
await ask("12054 ki seat availability btana");
await page.waitForTimeout(20000);
const chip = page.locator(".ns-chip", { hasText: /^Book / }).first();
const chipText = (await chip.innerText().catch(() => "")) || "";
console.log(`   chip mila: "${chipText.replace(/\s+/g, " ")}"`);
if (chipText) {
  await chip.click();
  await settle();
  /* Round-43f: determinism wale jawab par class na ho to pehle class poochhi jaati hai (crash ke bajaye) —
   * "Book <train> · <class>" chip tap karo, phir form. */
  let ok = await page
    .locator(".pax-inline, .pax-card")
    .first()
    .isVisible({ timeout: 8000 })
    .catch(() => false);
  if (!ok) {
    const cls = page.locator(".ns-chip", { hasText: /^Book 12054 · / }).first();
    if (await cls.count()) {
      console.log(`   class chip tap: "${(await cls.innerText()).replace(/\s+/g, " ")}"`);
      await cls.click();
      await settle();
      ok = await page
        .locator(".pax-inline, .pax-card")
        .first()
        .isVisible({ timeout: 60000 })
        .catch(() => false);
    }
  }
  const last = (await page.locator(".msg.assistant").allInnerTexts().catch(() => [])).pop() ?? "";
  console.log(`${ok ? "✅" : "❌"} A: chip → class → passenger form ${ok ? "KHULA" : "nahi khula"}`);
  if (ok) pass += 1;
  else console.log("   last reply:", last.replace(/\s+/g, " ").slice(-220));
  await page.screenshot({ path: `${OUT}/r43-booktap-A-chip.png` });
} else {
  console.log("   ❌ 'Book <train>' chip nahi mila");
}

/* ── B) route board (seat card) → tappable Book row / class chip */
console.log("B) route board seat card → Book row tap");
/* A ke baad passenger overlay khula reh sakta hai — B ke liye naya page (saaf state). */
await page.close();
page = await browser.newPage({ viewport: { width: 420, height: 940 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await ask("ASR se NDLS kal ki seat batao");
await settle(120000);
await page.waitForTimeout(1500);
const rows = await page.locator(".rp-crow.tappable").count();
const chips = await page.locator("button[title*='passenger form']").count();
console.log(`   tappable seat rows: ${rows}, passenger-form buttons: ${chips}`);
await page.screenshot({ path: `${OUT}/r43-booktap-B-card.png` });
if (rows > 0) {
  await page.locator(".rp-crow.tappable").first().click();
  await page.waitForTimeout(1200);
  if (await paxOpen("B: seat row Book tap")) pass += 1;
  await page.screenshot({ path: `${OUT}/r43-booktap-B-after.png` });
} else if (chips > 0) {
  await page.locator("button[title*='passenger form']").first().click();
  await page.waitForTimeout(1200);
  if (await paxOpen("B: class chip tap")) pass += 1;
  await page.screenshot({ path: `${OUT}/r43-booktap-B-after.png` });
} else {
  console.log("   ⚠️ is reply me koi tappable seat row/chip nahi mila (form check skip)");
}

console.log(`\nRESULT: ${pass} / 2 book-tap raste pass`);
await browser.close();
process.exit(pass >= 1 ? 0 : 1);
