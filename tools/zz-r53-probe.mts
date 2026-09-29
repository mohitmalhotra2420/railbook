import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
import request from "supertest";
const { createApp } = await import("../server/app.js");
const app = createApp();
const QS = (process.env.PROBE_QS || "").split("||").filter(Boolean);
for (const q of QS) {
  const t0 = Date.now();
  const res = await request(app).post("/api/agent").send({ text: q, history: [], known: {} }).timeout({ response: 300000, deadline: 300000 });
  const j = res.body as any; const sf = j.seatFilter ?? {};
  const rows = sf.rows ?? [], wl = sf.wlRows ?? [];
  const payload = [...new Set([...rows, ...wl].map((r: any) => r.number))].sort();
  const reply = String(j.reply ?? "");
  const tx = [...new Set((reply.match(/\b\d{5}\b/g) ?? []) as string[])].sort();
  const okMatch = JSON.stringify(payload) === JSON.stringify(tx);
  console.log(`\n===== (${((Date.now() - t0) / 1000).toFixed(1)}s) ${q}`);
  console.log("engine:", j.engine, "| model:", j.modelUsed, "| failure:", j.agenticFailureReason, "| tools:", (j.toolTrace ?? []).map((s: any) => s.tool + (s.ok ? "✓" : "✗")).join(","));
  console.log(`payload(${payload.length}):`, payload.join(","));
  console.log(`reply  (${tx.length}):`, tx.join(","));
  console.log(okMatch ? "MATCH ✓" : "MISMATCH ✗");
  console.log("reply:\n" + reply.slice(0, 700));
}
