/* ══ CONTEXT-SWITCH regression (user issue 2026-09-05, revised) ════
 * User: "station choice dena SAHI tha pehle" (Delhi = multi-station, options
 * correct UX). ASLI issue: "ek question khatam ho jaaye aur kissi aur cheez
 * yan train ki baat krun same chat mein to AI samajh jaaye."
 * Contract:
 *   - ambiguous city par station options dikhana VALID hai (pehle jaisa)
 *   - options ke baad user ALAG train/cheez poochhe → naye sawaal ka jawab,
 *     options repeat NAHI, purani trains se irrelevant denials NAHI        */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runAgent } from "../server/agent/run";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";
import { setRailcoreFetch } from "../server/railway/railcore";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/* Model down (timeout jaisa) — deterministic path prove karna hai; prompt
 * rules (model path) alag se assert hote hain. */
setAgenticNvidiaFetch(async () => {
  throw new Error("model unavailable — deterministic path");
});

function railcoreMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const q = url.searchParams;
    if (p.endsWith("/stations/search")) {
      const query = (q.get("q") || "").toLowerCase();
      if (query === "ludhiana") {
        return jsonResponse(200, { success: true, data: { results: [{ station_code: "LDH", station_name: "LUDHIANA JN", city: "Ludhiana", confidence: 1 }] } });
      }
      if (query === "delhi") {
        return jsonResponse(200, {
          success: true,
          data: {
            results: [
              { station_code: "DLI", station_name: "DELHI", city: "Delhi", confidence: 0.9 },
              { station_code: "DEC", station_name: "DELHI CANTT", city: "Delhi", confidence: 0.9 },
              { station_code: "DEE", station_name: "DELHI S ROHILLA", city: "Delhi", confidence: 0.9 },
              { station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 0.9 },
              { station_code: "NZM", station_name: "H NIZAMUDDIN", city: "Delhi", confidence: 0.85 },
              { station_code: "ANVT", station_name: "ANAND VIHAR T", city: "Delhi", confidence: 0.85 },
            ],
          },
        });
      }
      return jsonResponse(200, { success: true, data: { results: [] } });
    }
    if (p.endsWith("/routes/trains")) {
      return jsonResponse(200, { success: true, data: { from_station_code: q.get("from"), to_station_code: q.get("to"), trains: [] } });
    }
    /* Timetable — 12498 Shane Punjab (train-switch test ke liye) */
    const sched = p.match(/\/trains\/(\d+)\/schedule$/);
    if (sched) {
      const num = sched[1];
      if (num === "12498") {
        return jsonResponse(200, {
          success: true,
          data: {
            train_number: "12498",
            train_name: "SHAN-E-PUNJAB EXPRESS",
            running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
            stops: [
              { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "15:10", day: 1 },
              { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "17:28", departure_time: "17:30", day: 1 },
              { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "22:30", departure_time: null, day: 1 },
            ],
          },
        });
      }
      return jsonResponse(200, { success: true, data: { train_number: num, train_name: `TRAIN ${num}`, running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], stops: [] } });
    }
    return jsonResponse(404, { success: false, error: { message: "unknown endpoint" } });
  });
}

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test_secret";
});
afterEach(() => {
  setRailcoreFetch(null);
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
});

describe("CONTEXT-SWITCH: same chat mein topic/train badalna (2026-09-05)", () => {
  it("ambiguous Delhi par station options dikhata hai (user-approved pehle jaisa)", async () => {
    railcoreMock();
    const r = await runAgent({ text: "ludhiana se delhi ki fastest train batao", now: "2026-09-05T22:30:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).toMatch(/kaun sa station chahiye/i);
    expect(reply, reply).toMatch(/NDLS/);
    expect(reply, reply).toMatch(/DLI/);
  });

  it("options ke baad user ALAG train poochhe → naye train ka jawab, options repeat NAHI", async () => {
    railcoreMock();
    const first = await runAgent({ text: "ludhiana se delhi ki fastest train batao", now: "2026-09-05T22:30:00+05:30" });
    expect(String(first.reply)).toMatch(/kaun sa station chahiye/i);

    const second = await runAgent({
      text: "chhodo ye, 12498 shane punjab ka time batao",
      context: first.context as never,
      known: {},
      now: "2026-09-05T22:31:00+05:30",
    });
    const reply = String(second.reply ?? "");
    // NAYA sawaal: 12498 ka jawab — pending station options dobara NAHI
    expect(reply, reply).not.toMatch(/kaun sa station chahiye/i);
    expect(reply, reply).toMatch(/12498/);
    expect(second.nlu?.intent).not.toBe("SELECT_FASTEST");
  });

  it("doosri baad teeni alag train — chain continue (screenshot Q2 pattern)", async () => {
    railcoreMock();
    const first = await runAgent({ text: "ludhiana se delhi ki fastest train batao", now: "2026-09-05T22:30:00+05:30" });
    const second = await runAgent({
      text: "chhodo ye, 12498 ka time batao",
      context: first.context as never,
      known: {},
      now: "2026-09-05T22:31:00+05:30",
    });
    expect(String(second.reply)).toMatch(/12498/);

    const third = await runAgent({
      text: "aur 12498 hi rahegi, uska route batao",
      context: second.context as never,
      known: {},
      now: "2026-09-05T22:32:00+05:30",
    });
    const reply = String(third.reply ?? "");
    expect(reply, reply).not.toMatch(/kaun sa station chahiye/i);
  });
});

/* Model path (prompt rules) ka regression guard — behavioral test ke liye live
 * model chahiye; kam se kam rules accidentally drop na hon. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
describe("CONTEXT-SWITCH prompt rules (model path)", () => {
  it("systemPrompt mein rule 18 (context-switch) + rule 19 (no stale denials) hai", () => {
    const src = readFileSync(join(process.cwd(), "server/agent/agentic.ts"), "utf8");
    expect(src).toContain("18. CONTEXT-SWITCH");
    expect(src).toContain("19. Purani search ki trains se current sawaal ka jawab MAT banao");
    expect(src).toContain("PEHLE naye sawaal ka jawab do");
  });
});
