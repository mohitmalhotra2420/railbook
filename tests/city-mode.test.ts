/* ══ CITY-MODE regression (user issue 2026-09-05) ══════════════════
 * "ludhiana se delhi ki fastest train" 3 baar poochne par app har baar
 * sirf "Delhi mein kaun sa station chahiye?" poochta raha — jawab kabhi
 * nahi mila. Naya contract: info query par city ki SAB stations par
 * search karke seedha fastest-train jawab; booking intent par hi options. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runAgent } from "../server/agent/run";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";
import { setRailcoreFetch } from "../server/railway/railcore";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/* Model down (timeout jaisa) — deterministic path hi prove karna hai. */
setAgenticNvidiaFetch(async () => {
  throw new Error("model unavailable — deterministic path");
});

export const mockCalls: string[] = [];
export function cityRailcoreMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const q = url.searchParams;
    mockCalls.push(`${p.replace(/^\/v1/, "")}?${url.searchParams.toString()}`);
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
              { station_code: "NZM", station_name: "Hazrat Nizamuddin", city: "Delhi", confidence: 0.85 },
              { station_code: "ANVT", station_name: "Anand Vihar Terminal", city: "Delhi", confidence: 0.85 },
            ],
          },
        });
      }
      return jsonResponse(200, { success: true, data: { results: [] } });
    }
    if (p.endsWith("/routes/trains")) {
      const from = q.get("from");
      const to = q.get("to");
      if (from === "LDH" && to === "NDLS") {
        return jsonResponse(200, {
          success: true,
          data: {
            from_station_code: "LDH",
            to_station_code: "NDLS",
            trains: [
              { train_number: "12460", train_name: "ASR NDLS SHATABDI", train_type: "Shatabdi", departure_time: "16:35", arrival_time: "21:30", duration_minutes: 295, running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], classes: ["CC", "EC"] },
              { train_number: "14682", train_name: "JUC NDLS EXPRESS", train_type: "Express", departure_time: "05:30", arrival_time: "12:40", duration_minutes: 430, running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], classes: ["SL", "3A"] },
            ],
          },
        });
      }
      if (from === "LDH" && to === "DLI") {
        return jsonResponse(200, {
          success: true,
          data: {
            from_station_code: "LDH",
            to_station_code: "DLI",
            trains: [
              { train_number: "13308", train_name: "GANGASUTLEJ EXP", train_type: "Express", departure_time: "22:10", arrival_time: "05:20", duration_minutes: 430, running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], classes: ["SL", "3A"] },
            ],
          },
        });
      }
      return jsonResponse(200, { success: true, data: { from_station_code: from, to_station_code: to, trains: [] } });
    }
    /* Timetable — cluster-station safety (filterTrainsServingStops) ke liye
     * zaroori: Delhi-cluster stations par trains sirf timetable-verified. */
    const sched = p.match(/\/trains\/(\d+)\/schedule$/);
    if (sched) {
      const num = sched[1];
      const stopsByTrain: Record<string, { code: string; name: string; arrival_time: string | null; departure_time: string | null; day: number }[]> = {
        "12460": [
          { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "13:10", day: 1 },
          { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "16:33", departure_time: "16:35", day: 1 },
          { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "21:30", departure_time: null, day: 1 },
        ],
        "14682": [
          { station_code: "JUC", station_name: "JALANDHAR CITY", arrival_time: null, departure_time: "04:15", day: 1 },
          { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "05:28", departure_time: "05:30", day: 1 },
          { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "12:40", departure_time: null, day: 1 },
        ],
        "13308": [
          { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "21:30", day: 1 },
          { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "22:08", departure_time: "22:10", day: 1 },
          { station_code: "DLI", station_name: "DELHI", arrival_time: "05:20", departure_time: null, day: 2 },
        ],
      };
      const stops = stopsByTrain[num];
      if (stops) {
        return jsonResponse(200, {
          success: true,
          data: { train_number: num, train_name: num === "12460" ? "ASR NDLS SHATABDI" : num === "14682" ? "JUC NDLS EXPRESS" : "GANGASUTLEJ EXP", running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], stops },
        });
      }
      return jsonResponse(200, { success: true, data: { train_number: num, train_name: `TRAIN ${num}`, running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], stops: [] } });
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

describe("CITY-MODE: 'ludhiana se delhi fastest train' (2026-09-05 user issue)", () => {
  it("info query → seedha fastest jawab, station-question NAHI", async () => {
    cityRailcoreMock();
    const r = await runAgent({
      text: "Abh mujhe ludhiana se delhi ki btao fastest train",
      now: "2026-09-05T22:30:00+05:30",
    });
    const reply = String(r.reply ?? "");
    expect(reply, reply).not.toMatch(/kaun sa station chahiye/i);
    expect(reply, reply).toMatch(/12460/);
    expect(reply, reply).toMatch(/NDLS/);
    expect(r.toolOk).toBe(true);
    // Table bhi aayi, fastest tag ke saath
    const table = (r as unknown as { trains?: { fastest?: string | null } }).trains;
    expect(table?.fastest).toBe("12460");
  });

  it("follow-up 'btao fastest train' → memory se jawab (context destination resolve hua)", async () => {
    cityRailcoreMock();
    const first = await runAgent({ text: "ludhiana se delhi ki fastest train", now: "2026-09-05T22:30:00+05:30" });
    expect(String(first.reply)).toMatch(/12460/);
    // ctx.destination ab resolve ho chuka hona chahiye (fastest train ka station)
    const ctx = first.context as unknown as { destination?: { code?: string } | null };
    expect(ctx?.destination?.code).toBe("NDLS");
    const second = await runAgent({
      text: "btao fastest train",
      context: first.context as never,
      known: {},
      now: "2026-09-05T22:31:00+05:30",
    });
    const reply = String(second.reply ?? "");
    expect(reply, reply).not.toMatch(/kaun sa station chahiye/i);
    expect(reply, reply).toMatch(/Kahan (se )?jaana|12460|fastest/i);
  });

  it("'kal ke liye' → kal ki date par search", async () => {
    cityRailcoreMock();
    const r = await runAgent({
      text: "Mujhe ludhiana se delhi ki fastest train ka pata karna kal ke liye",
      now: "2026-09-05T22:30:00+05:30",
    });
    const reply = String(r.reply ?? "");
    expect(reply, reply).not.toMatch(/kaun sa station chahiye/i);
    expect(reply, reply).toMatch(/12460/);
  });
});
