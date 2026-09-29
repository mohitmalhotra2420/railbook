import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
import request from "supertest";
const { createApp } = await import("../server/app.js");
const res = await request(createApp()).post("/api/agent").send({ text: "LDH se JAT kal confirm seat batao", history: [], known: {} }).timeout({ response: 300000, deadline: 300000 });
fs.writeFileSync("/tmp/r53-seatfilter.json", JSON.stringify({ seatFilter: res.body.seatFilter, reply: res.body.reply, model: res.body.modelUsed, engine: res.body.engine }, null, 1));
console.log("dumped rows:", (res.body.seatFilter?.rows ?? []).length, "wl:", (res.body.seatFilter?.wlRows ?? []).length);
