import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
import request from "supertest";
const { createApp } = await import("../server/app.js");
const app = createApp();
const QS = (process.env.PROBE_QS || "Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na").split("||");
for (const q of QS) {
  const t0 = Date.now();
  const res = await request(app).post("/api/agent").send({ text: q, history: [], known: {} }).timeout({ response: 300000, deadline: 300000 });
  const j = res.body as any;
  console.log(`\n===== (${((Date.now() - t0) / 1000).toFixed(1)}s) ${q}`);
  console.log("engine:", j.engine, "| modelUsed:", j.modelUsed, "| agenticFailure:", j.agenticFailureReason);
  console.log("toolTrace:", (j.toolTrace ?? []).map((s: any) => `${s.tool}${s.ok ? "✓" : "✗"}`).join(" → ") || "(none)");
  console.log("reply:\n" + String(j.reply ?? "").slice(0, 1400));
}
