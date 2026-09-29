import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
import request from "supertest";
const { createApp } = await import("../server/app.js");
const res = await request(createApp()).post("/api/agent").send({ text: "LDH se DLI kal saari trains ki seat batao", history: [], known: {} }).timeout({ response: 300000, deadline: 300000 });
const sf = res.body.seatFilter;
fs.writeFileSync("/tmp/r53-wide.json", JSON.stringify({ line: sf?.line ?? null, trainsSeen: sf?.trainsSeen, rows: sf?.rows?.length, wlRows: sf?.wlRows?.length, trains: [...new Set([...(sf?.rows??[]), ...(sf?.wlRows??[])].map((r:any)=>r.number))], reply: String(res.body.reply ?? "").slice(0, 300) }, null, 1));
console.log("wide done. trains:", sf?.trainsSeen, "rows:", sf?.rows?.length, "wl:", sf?.wlRows?.length);
console.log("line tail:", String(sf?.line ?? "").slice(-160));
