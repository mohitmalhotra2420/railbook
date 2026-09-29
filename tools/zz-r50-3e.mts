import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
const { getFallbackProvider } = await import("../server/railway/router.js");
const p: any = getFallbackProvider();
const row = await p.getAvailability("20433", "2026-09-30", "LDH", "JAT", "3E", "GN");
console.log("chain 3E:", JSON.stringify(row));
const { scrapeSeatAvailabilityWeb } = await import("../server/railway/webscrape.js");
const ry: any = await scrapeSeatAvailabilityWeb("20433", "2026-09-30", "LDH", "JAT", "3E", "GN").catch((e: any) => ({ err: String(e) }));
console.log("railyatri 3E:", JSON.stringify(ry));
