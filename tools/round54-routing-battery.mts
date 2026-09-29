/* Round-54 ROUTING BATTERY — "ChatGPT jaisa sahi tool kaise chune?" ka jaanch-parcha.
 * 12 alag-alag tarah ke sawaal (live status, route, seat, fare, PNR, cancellation, station board, rules,
 * GK, coach position, plan) — har ek ka MUMLIKIN sahi tool family likha hai. Script batati hai:
 *   PASS = model ne khud sahi tool chuna; KB = jawab curated KB se (0s, model call nahi);
 *   FAIL = galat tool ya koi tool nahi.
 * Chalane ka tarika:  ./node_modules/.bin/tsx tools/round54-routing-battery.mts
 * Prod par: PEHLE `curl POST /api/agent` (ya isi script ka koi sawaal) — prod latency NIM queue par. */

import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
/* `--prod` ke saath wahi 12 sawaal LIVE server par chalti hain (localhost app boot nahi hota). */
const PROD = process.argv.includes("--prod");
const PROD_URL = process.env.PROD_URL || "https://railbook-gegs.onrender.com";
let app: unknown = null;
if (!PROD) {
  const request = (await import("supertest")).default;
  const { createApp } = await import("../server/app.js");
  app = createApp();
}

/** expect: kaun se tool(s) sahi maane jaate hain (koi ek chale to pass) */
const CASES: { q: string; expect: string[]; note: string }[] = [
  { q: "12326 late hai kya", expect: ["TRACK_TRAIN", "getLiveStatus", "GET_STATION_BOARD"], note: "live status" },
  { q: "12013 ka poora route batao", expect: ["GET_TIMETABLE", "GET_TRAIN_INFO"], note: "timetable/route" },
  { q: "LDH se JAT kal confirm seat batao", expect: ["FIND_SEATS"], note: "route seat" },
  { q: "12094 me 3A me kitni seat khali hai kal", expect: ["CHECK_AVAILABILITY", "FIND_VACANT_SEATS", "GET_FARE"], note: "train+class seat" },
  { q: "12013 ka kiraya LDH se ASR 3A", expect: ["GET_FARE", "CHECK_AVAILABILITY", "JOURNEY_ANALYZE"], note: "fare" },
  { q: "PNR 1234567890 ka status batao", expect: ["CHECK_PNR"], note: "PNR" },
  { q: "aaj koi train cancel hui hai kya", expect: ["GET_CANCELLED_TRAINS"], note: "cancellations" },
  { q: "LDH par abhi kaunsi trains aa rahi hain", expect: ["GET_STATION_BOARD", "TRACK_TRAIN"], note: "station board" },
  { q: "tatkal booking kitne baje khulti hai", expect: ["WEB_SEARCH", "KNOWLEDGE", "RAIL_RULES", "KB"], note: "rule (KB/web)" },
  { q: "sabse lambi train kaun si hai", expect: ["WEB_SEARCH", "KNOWLEDGE", "KB"], note: "GK (KB/web)" },
  { q: "12013 me coach position kya hai", expect: ["GET_COACH_POSITION", "TRACK_TRAIN"], note: "coach position" },
  { q: "kal subah LDH se DLI jane wali trains ke timings", expect: ["SEARCH_TRAINS", "JOURNEY_ANALYZE", "FIND_SEATS", "GET_TIMETABLE"], note: "route + timing" },
];

const rows: string[] = [];
for (const c of CASES) {
  const t0 = Date.now();
  let tools: string[] = [];
  let engine = "";
  let reply = "";
  try {
    let res: { body: Record<string, unknown> };
    if (PROD) {
      const r = await fetch(`${PROD_URL}/api/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: c.q, history: [], known: {} }),
        signal: AbortSignal.timeout(300000),
      });
      res = { body: (await r.json()) as Record<string, unknown> };
    } else {
      const request = (await import("supertest")).default;
      res = (await request(app).post("/api/agent").send({ text: c.q, history: [], known: {} }).timeout({ response: 300000, deadline: 300000 })) as { body: Record<string, unknown> };
    }
    engine = (res.body.engine as string) ?? "";
    reply = String(res.body.reply ?? "");
    tools = (res.body.toolTrace ?? []).map((s) => `${s.tool}${s.ok ? "" : "(✗)"}`);
  } catch (e) {
    reply = `ERROR ${String(e).slice(0, 80)}`;
  }
  const toolset = tools.map((t) => t.replace("(✗)", ""));
  const ok = c.expect.some((e) => toolset.includes(e));
  const secs = (Date.now() - t0) / 1000;
  /* KB path: koi tool nahi + ≥0s me jawab → curated railway KB (R40b) ne model se pehle jawab diya. */
  const kbPath = !toolset.length && secs < 3;
  const verdict = ok ? "PASS" : kbPath ? "KB" : "FAIL";
  const line = `${verdict} | ${c.note} | ${secs.toFixed(0)}s | tools: ${tools.join(",") || "(none)"} | ${c.q}`;
  console.log(line);
  console.log("   reply: " + reply.replace(/\n/g, " ").slice(0, 180));
  rows.push(line);
}
fs.writeFileSync("/tmp/r54-routing.txt", rows.join("\n"));
const pass = rows.filter((r) => r.startsWith("PASS")).length;
const kb = rows.filter((r) => r.startsWith("KB")).length;
console.log(`\nROUTING PASS: ${pass}/${rows.length} (KB path: ${kb})`);
