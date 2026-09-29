import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
import request from "supertest";
const { createApp } = await import("../server/app.js");
const app = createApp();
const q = process.env.PROBE_Q || "LDH se JAT kal saari trains ki seat availability batao";
const res = await request(app).post("/api/agent").send({ text: q, history: [], known: {} }).timeout({ response: 300000, deadline: 300000 });
fs.writeFileSync("/tmp/r53-dump2.json", JSON.stringify(res.body, null, 1));
const j = res.body as any; const sf = j.seatFilter ?? {};
const payload = new Set([...(sf.rows ?? []), ...(sf.wlRows ?? [])].map((r: any) => r.number));
const tx = [...new Set((String(j.reply ?? "").match(/\b\d{5}\b/g) ?? []) as string[])];
console.log("extra (reply but not payload):", tx.filter((t) => !payload.has(t)).join(","));
console.log("missing (payload but not reply):", [...payload].filter((p) => !tx.includes(p)).join(","));
console.log("dropNote:", JSON.stringify(sf.dropNote));
console.log("nearbyNote:", JSON.stringify(sf.nearbyNote));
console.log("trainsSeen:", sf.trainsSeen, "| rows:", (sf.rows ?? []).length, "| wlRows:", (sf.wlRows ?? []).length);
