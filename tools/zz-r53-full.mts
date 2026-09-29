import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
import request from "supertest";
const { createApp } = await import("../server/app.js");
const app = createApp();
const QS = (process.env.PROBE_QS || "LDH se JAT kal confirm seat batao").split("||");
for (const q of QS) {
  const t0 = Date.now();
  const res = await request(app).post("/api/agent").send({ text: q, history: [], known: {} }).timeout({ response: 300000, deadline: 300000 });
  const j = res.body as any;
  const sf = j.seatFilter;
  console.log(`\n===== (${((Date.now() - t0) / 1000).toFixed(1)}s) ${q}`);
  console.log("engine:", j.engine, "| model:", j.modelUsed, "| failure:", j.agenticFailureReason);
  console.log("tools:", (j.toolTrace ?? []).map((s: any) => `${s.tool}${s.ok ? "✓" : "✗"}`).join(" → ") || "(none)");
  console.log("seatFilter rows:", (sf?.rows ?? []).length, "| wlRows:", (sf?.wlRows ?? []).length,
    "| trains:", [...new Set([...(sf?.rows ?? []), ...(sf?.wlRows ?? [])].map((r: any) => r.number))].join(","));
  console.log("text trains:", (String(j.reply ?? "").match(/\b\d{5}\b/g) ?? []).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(","));
  console.log("reply:\n" + String(j.reply ?? "").slice(0, 900));
}
