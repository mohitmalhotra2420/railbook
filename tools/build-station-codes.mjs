/* IR station code list → server/data/station-codes.ts generate karta hai.
 * Source: datameet/railways stations.json (data.gov.in ka IR station list). Chalane: node tools/build-station-codes.mjs
 * (src file: tools/station-list-source.json — repo me rakhi hai taaki dobara download na karni pade). */
import fs from "node:fs";
const src = JSON.parse(fs.readFileSync(new URL("./station-list-source.json", import.meta.url), "utf8"));
const rows = new Map();
for (const f of src.features ?? []) {
  const p = f.properties ?? {};
  const code = String(p.code ?? "").trim().toUpperCase();
  const name = String(p.name ?? "").trim().toUpperCase();
  if (!code || !name) continue;
  if (!rows.has(code) || rows.get(code).length < name.length) rows.set(code, name);
}
const keys = [...rows.keys()].sort();
const lines = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(rows.get(k))},`).join("\n");
const out = `/* AUTO-GENERATED — IR station code → naam (${keys.length} stations). Ise haath se edit mat karo;
 * regenerate: node tools/build-station-codes.mjs (source: tools/station-list-source.json).
 * Round-46: reply ke station codes verify karne ke liye — model kabhi galat code likh deta hai
 * (live case: "Haridwar (HWR)", jabki HWR asli me HATWAR hai aur Haridwar = HW). */
export const STATION_CODES: Record<string, string> = {
${lines}
};
`;
fs.writeFileSync("server/data/station-codes.ts", out);
console.log("stations:", keys.length, "bytes:", out.length);
