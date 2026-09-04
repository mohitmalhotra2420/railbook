/**
 * Regression tests for the FINAL ADVERSARIAL VALIDATION round fixes:
 *  1. "next <weekday>" = agle hafte (ISO week) — not the immediate occurrence.
 *  2. Legacy city names (Calcutta/Madras/Bombay) → needs_choice (real cluster
 *     stations from the bundled dataset), never "not found" → model improvise.
 *  3. Airport guard — user said "airport" → no silent rail-station substitution.
 *  4. Both-provider search failure → provider "none" (honest unavailable),
 *     never "railkit_fallback: 0 trains" ka jhooth.
 *  5. Grounding guard — invented station codes (jaise "NDAP") user tak nahi jaate.
 *  6. preferred_class partition — search classes missing ho to verified probed
 *     class (cheapest.classCode) se partition.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { parseDatePhrase } from "../server/understand/legacy-dates";
import { createApp } from "../server/app";
import { runAgenticTurn, setAgenticNvidiaFetch, executeApprovedTool } from "../server/agent/agentic";
import { runAgent } from "../server/agent/run";
import { setRailcoreFetch, resetRailcoreBookings } from "../server/railway/railcore";
import { setRailkitSdk } from "../server/railway/railkit";
import { setProvider } from "../server/providers/index";
import { searchTrainsRouted } from "../server/railway/router";

const NOW = "2026-09-04T04:00:00.000Z"; // Friday 4 Sep 2026, 09:30 IST

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_FIXTEST_railcore";
  process.env.RAILKIT_API_KEY = "rk_live_FIXTEST_railkit";
  process.env.NVIDIA_API_KEY = "nvapi-FIXTEST_nvidia_key_value";
  process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
  delete process.env.NVIDIA_FALLBACK_MODEL;
  setProvider(null);
});

afterEach(() => {
  setAgenticNvidiaFetch(null);
  setRailcoreFetch(null);
  setRailkitSdk(null);
  resetRailcoreBookings();
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  process.env.RAILKIT_API_KEY = "";
  process.env.NVIDIA_API_KEY = "";
  setProvider(null);
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fix: next <weekday> = next ISO week (agle hafte)", () => {
  it("Friday ko 'next Saturday' = 8 din baad, 'coming Saturday' = kal", () => {
    const now = new Date(NOW);
    expect(parseDatePhrase("next Saturday", now).date).toBe("2026-09-12");
    expect(parseDatePhrase("coming Saturday", now).date).toBe("2026-09-05");
    expect(parseDatePhrase("Saturday", now).date).toBe("2026-09-05");
  });
  it("'next Friday' said ON Friday = agle hafte ka Friday (+7)", () => {
    const now = new Date(NOW);
    expect(parseDatePhrase("next Friday", now).date).toBe("2026-09-11");
  });
  it("'next Monday' from Friday stays coming Monday (aane wala Monday hi agla hafte hai)", () => {
    const now = new Date(NOW);
    expect(parseDatePhrase("next Monday", now).date).toBe("2026-09-07");
  });
});

describe("fix: legacy city names → needs_choice (cluster se real options)", () => {
  for (const [city, code] of [["Calcutta", "HWH"], ["Madras", "MAS"], ["Bombay", "BCT"]] as const) {
    it(`'${city}' search par ${code} cluster options chahiye (not-found nahi)`, async () => {
      // RailCore station API in legacy naamon ke liye kuch nahi deta.
      setRailcoreFetch(async () => jsonResponse(200, { success: true, data: { results: [] } }));
      const app = createApp();
      const res = await request(app).get("/api/stations").query({ q: city });
      const codes = (res.body.stations ?? []).map((s: { code: string }) => s.code);
      expect(codes).toContain(code);
      expect(res.body.needChoice).toBe(true);
    });
  }
});

describe("fix: airport guard — no silent rail-station substitution", () => {
  it("user bola 'Delhi airport' + model ne SEARCH call kiya → needs_airport_clarification, search execute nahi", async () => {
    setRailcoreFetch(async () => {
      throw new Error("railcore must not be called in this test");
    });
    setAgenticNvidiaFetch(async () =>
      jsonResponse(200, {
        model: "openai/gpt-oss-20b",
        choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "SEARCH_TRAINS", arguments: JSON.stringify({ origin: "ASR", destination: "NDLS", date: "2026-09-05" }) } }] } }],
      }),
    );
    const turn = await runAgenticTurn({ text: "Amritsar se Delhi airport Saturday ko trains", now: NOW });
    expect(turn.steps[0].tool).toBe("SEARCH_TRAINS");
    expect(turn.steps[0].ok).toBe(false);
    expect(String(turn.steps[0].summary)).toMatch(/airport/i);
    const data = turn.steps[0].dataPreview ?? "";
    expect(data).toContain("needs_airport_clarification");
  });
});

describe("fix: dono-provider search failure → 'none' (honest unavailable)", () => {
  it("RailCore fail + RailKit fail → provider none, ok=false (0-trains ka jhooth nahi)", async () => {
    setRailcoreFetch(async () => jsonResponse(503, { success: false, error: { message: "down" } }));
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async () => {
        throw new Error("railkit down");
      },
      getTrainInfo: async () => {
        throw new Error("railkit down");
      },
      trackTrain: async () => {
        throw new Error("railkit down");
      },
      getAvailability: async () => {
        throw new Error("railkit down");
      },
      fareLookup: async () => {
        throw new Error("railkit down");
      },
      checkPNRStatus: async () => {
        throw new Error("railkit down");
      },
      cancelList: async () => {
        throw new Error("railkit down");
      },
    } as never);
    const routed = await searchTrainsRouted({ from: "ASR", to: "NDLS", date: "2026-09-05" });
    expect(routed.trains).toEqual([]);
    expect(routed.provider).toBe("none");
  });
});

describe("fix: grounding guard pakadta hai invented station codes", () => {
  it("'NDAP' jaise invented code wala reply replace ho jata hai (grounded=false)", async () => {
    // Real search data ke baad model invented "NDAP" bolta hai.
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      const p = url.pathname;
      const q = url.searchParams;
      if (p.endsWith("/stations/search")) {
        const query = (q.get("q") || "").toLowerCase();
        if (query === "asr") return jsonResponse(200, { success: true, data: { results: [{ station_code: "ASR", station_name: "AMRITSAR JN", city: "Amritsar", confidence: 1 }] } });
        if (query === "ndls") return jsonResponse(200, { success: true, data: { results: [{ station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 1 }] } });
        return jsonResponse(200, { success: true, data: { results: [] } });
      }
      if (p.endsWith("/trains/search") || p.endsWith("/trains")) {
        return jsonResponse(200, { success: true, data: { trains: [{ number: "12030", name: "SWARN SHATABDI", from_station: "ASR", to_station: "NDLS", depart_time: "16:50", arrival_time: "22:50", duration_minutes: 360, classes: ["CC"], days: [0, 1, 2, 3, 4, 5, 6] }] } });
      }
      return jsonResponse(200, { success: true, data: {} });
    });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call++;
      if (call === 1) {
        return jsonResponse(200, {
          model: "openai/gpt-oss-20b",
          choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "SEARCH_TRAINS", arguments: JSON.stringify({ origin: "ASR", destination: "NDLS", date: "2026-09-05" }) } }] } }],
        });
      }
      return jsonResponse(200, {
        model: "openai/gpt-oss-20b",
        choices: [{ message: { content: "Delhi Airport ke liye NDAP station se 12030 SWARN SHATABDI milegi." } }],
      });
    });
    const turn = await runAgenticTurn({ text: "Amritsar se Delhi airport Saturday ko trains batao", now: NOW });
    expect(turn.grounded).toBe(false);
    expect(String(turn.reply ?? "")).not.toContain("NDAP");
  });
});

describe("fix: station-choice reply follow-up (screenshot bug: '4'/'NDLS' par khali reply)", () => {
  const OPTIONS_REPLY = [
    "Kya aapko Delhi ke kis station se jaana hai?",
    "Options:",
    "1. DLI - DELHI",
    "2. DEC - DELHI CANTT",
    "3. DEE - DELHI S ROHILLA",
    "4. NDLS - NEW DELHI",
    "5. NZM - Hazrat Nizamuddin",
    "6. ANVT - Anand Vihar Terminal",
    "Kripya ek number se chunen.",
  ].join("\n");
  const baseCtx = {
    intent: "SEARCH_TRAIN",
    origin: { code: "ASR", name: "AMRITSAR JN", city: "Amritsar" },
    destination: null,
    date: "2026-09-06",
    dateProvided: true,
    passengers: 1,
    paxProvided: true,
    classCode: null,
    selectedTrainNumber: null,
    selectedTrainName: null,
    lastTrainNumbers: [],
    bookingStage: "collecting",
    pendingAsk: "to",
    lastTool: null,
    lastToolOk: null,
  };
  const hist = [
    { role: "user", content: "Mujhe amritsar se delhi jaana kal 1 person hai" },
    { role: "assistant", content: OPTIONS_REPLY },
  ];

  it("numeric pick '4' → destination NDLS resolve + REAL search reply (deterministic, kabhi khali nahi)", async () => {
    process.env.NVIDIA_API_KEY = ""; // deterministic engine hi chale
    process.env.RAILCORE_API_KEY = "rk_live_FIXTEST_railcore";
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      const p = url.pathname;
      if (p.endsWith("/stations/search")) {
        const q = (url.searchParams.get("q") || "").toUpperCase();
        if (q === "NDLS" || q === "NEW DELHI") {
          return jsonResponse(200, { success: true, data: { results: [{ station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 1 }] } });
        }
        return jsonResponse(200, { success: true, data: { results: [] } });
      }
      if (p.endsWith("/routes/trains")) {
        return jsonResponse(200, { success: true, data: { trains: [
          { train_number: "12014", train_name: "AMRITSAR SHTABDI", departure_time: "04:55", arrival_time: "11:02", duration_minutes: 367, running_days: [0,1,2,3,4,5,6], classes: ["CC"] },
        ] } });
      }
      if (p.includes("/schedule")) {
        return jsonResponse(200, { success: true, data: { train_number: "12014", classes: ["CC"], stops: [
          { station_code: "ASR", arrival: "source", departure: "04:55" },
          { station_code: "NDLS", arrival: "11:02", departure: "dest" },
        ] } });
      }
      return jsonResponse(200, { success: true, data: {} });
    });
    const res = await runAgent({ text: "4", context: baseCtx as never, history: hist, now: NOW });
    expect(res.reply).toBeTruthy();
    expect(res.context?.destination?.code).toBe("NDLS");
    expect(String(res.reply)).toMatch(/ASR → NDLS/);
    expect(String(res.reply)).toMatch(/12014/); // REAL provider data, andaza nahi
    expect(res.toolTrace?.[0]?.tool).toBe("SEARCH_TRAINS");
    expect(res.toolTrace?.[0]?.source).toBe("railcore");
    expect(res.grounded).toBe(true);
    expect(res.confirmBook).toBe(false);
  });

  it("bare code 'NDLS' → destination resolve (agentic known pre-fill bhi)", async () => {
    process.env.NVIDIA_API_KEY = ""; // deterministic
    process.env.RAILCORE_API_KEY = "rk_live_FIXTEST_railcore";
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/stations/search")) {
        const q = (url.searchParams.get("q") || "").toUpperCase();
        if (q === "NDLS") {
          return jsonResponse(200, { success: true, data: { results: [{ station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 1 }] } });
        }
        return jsonResponse(200, { success: true, data: { results: [] } });
      }
      return jsonResponse(200, { success: true, data: {} });
    });
    const res = await runAgent({ text: "NDLS", context: baseCtx as never, history: hist, now: NOW });
    expect(res.context?.destination?.code).toBe("NDLS");
    // slots complete hone par do valid outcomes: ya seedha reply, ya
    // tool=searchTrains (client TrainBoard search flow chala deta hai).
    expect(res.reply?.trim() ? true : res.tool === "searchTrains").toBe(true);
  });

  it("compact format '(Options: DLI, DEC, ...)' se bhi numeric pick '4' → NDLS", async () => {
    const { resolveStationPick } = await import("../server/agent/run");
    process.env.RAILCORE_API_KEY = "rk_live_FIXTEST_railcore";
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/stations/search")) {
        const q = (url.searchParams.get("q") || "").toUpperCase();
        if (q === "NDLS") return jsonResponse(200, { success: true, data: { results: [{ station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 1 }] } });
        return jsonResponse(200, { success: true, data: { results: [] } });
      }
      return jsonResponse(200, { success: true, data: {} });
    });
    const compactHist = [
      { role: "user", content: "Mujhe amritsar se delhi jaana kal 1 person hai" },
      { role: "assistant", content: "Kis Delhi station se jaana hai? (Options: DLI, DEC, DEE, NDLS, NZM, ANVT, DAZ, DE)" },
    ];
    const pick = await resolveStationPick("4", compactHist, baseCtx as never);
    expect(pick?.code).toBe("NDLS"); // compact list mein position 4 = NDLS
    expect(pick?.side).toBe("to");
  });

  it("bare paren format '(DLI, DEC, ...)' bina 'Options:' keyword ke bhi pick + 'kaunse' variant suppression", async () => {
    const { resolveStationPick } = await import("../server/agent/run");
    process.env.RAILCORE_API_KEY = "rk_live_FIXTEST_railcore";
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/stations/search")) {
        const q = (url.searchParams.get("q") || "").toUpperCase();
        if (q === "NDLS") return jsonResponse(200, { success: true, data: { results: [{ station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 1 }] } });
        return jsonResponse(200, { success: true, data: { results: [] } });
      }
      return jsonResponse(200, { success: true, data: {} });
    });
    const parenHist = [
      { role: "user", content: "Mujhe amritsar se delhi jaana kal 1 person hai" },
      { role: "assistant", content: "Kaunse Delhi station se jaana hai? (DLI, DEC, DEE, NDLS, NZM, ANVT, DAZ, DE)" },
    ];
    const pick = await resolveStationPick("4", parenHist, baseCtx as never);
    expect(pick?.code).toBe("NDLS");
    expect(pick?.side).toBe("to");
    // 'kaunse … station?' reply par bhi resume bubble suppress hota hai
    process.env.NVIDIA_API_KEY = "";
    const res = await runAgent({
      text: "Amritsar se Delhi 2026-09-05 ko sabse sasti train kaunsi hai? options compare karo",
      context: { ...baseCtx, date: "2026-09-05" } as never,
      now: NOW,
    });
    expect(res.interrupt).toBe(false);
    expect(res.resumeText).toBeNull();
  });

  it("'kal'/'NDLS se ASR' jaise text kabhi station-pick nahi bante", async () => {
    const { resolveStationPick } = await import("../server/agent/run");
    process.env.RAILCORE_API_KEY = "rk_live_FIXTEST_railcore";
    expect(await resolveStationPick("kal", hist, baseCtx as never)).toBeNull();
    expect(await resolveStationPick("haan", hist, baseCtx as never)).toBeNull();
    expect(await resolveStationPick("NDLS se ASR", hist, baseCtx as never)).toBeNull();
    expect(await resolveStationPick("12030", hist, baseCtx as never)).toBeNull(); // train number
  });

  it("station-clarification reply ke baad conflicting resume bubble nahi (interrupt suppressed)", async () => {
    process.env.NVIDIA_API_KEY = "";
    process.env.RAILCORE_API_KEY = "";
    const res = await runAgent({
      text: "Amritsar se Delhi 2026-09-05 ko sabse sasti train kaunsi hai? options compare karo",
      context: { ...baseCtx, date: "2026-09-05", destination: null } as never,
      now: NOW,
    });
    expect(res.reply).toBeTruthy();
    expect(/kaun sa station|Options:/i.test(String(res.reply))).toBe(true);
    expect(res.interrupt).toBe(false); // pehle yahan "Waise booking continue... Kahan jaana hai?" jaata tha
    expect(res.resumeText).toBeNull();
  });
});

describe("fix: deterministic Atlas fallback — SELECT_CHEAPEST kabhi empty reply nahi deta", () => {
  it("agentic fail + ambiguous city → real station options ke saath clarification (empty reply bug)", async () => {
    process.env.NVIDIA_API_KEY = ""; // agentic engine off — deterministic fallback hi chale
    process.env.RAILCORE_API_KEY = "";
    const res = await runAgent({
      text: "Amritsar se Delhi 2026-09-05 ko sabse sasti train kaunsi hai? options compare karo",
      now: NOW,
    });
    expect(res.engine).toBe("deterministic");
    expect(res.reply).toBeTruthy();
    expect(/kaun sa station|exact station/i.test(String(res.reply))).toBe(true);
    expect(String(res.reply)).toMatch(/NDLS/); // real cluster options, guess nahi
    expect(res.toolTrace?.[0]?.tool).toBe("JOURNEY_ANALYZE");
    expect(res.toolTrace?.[0]?.ok).toBe(false);
    expect(res.grounded).toBe(true);
    expect(res.confirmBook).toBe(false);
  });

  it("complete slots → real search + bounded fare probe se grounded answer", async () => {
    process.env.NVIDIA_API_KEY = "";
    process.env.RAILCORE_API_KEY = "rk_live_FIXTEST_railcore";
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      const p = url.pathname;
      if (p.endsWith("/routes/trains")) {
        return jsonResponse(200, { success: true, data: { trains: [
          { train_number: "12014", train_name: "AMRITSAR SHTABDI", departure_time: "04:55", arrival_time: "11:02", duration_minutes: 367, running_days: [0,1,2,3,4,5,6], classes: ["CC"] },
          { train_number: "12030", train_name: "SWARN SHATABDI", departure_time: "16:50", arrival_time: "22:50", duration_minutes: 360, running_days: [0,1,2,3,4,5,6], classes: ["CC"] },
        ] } });
      }
      if (p.includes("/schedule")) {
        const tn = p.match(/trains\/(\d+)/)?.[1] ?? "12014";
        return jsonResponse(200, { success: true, data: { train_number: tn, classes: ["CC"], stops: [
          { station_code: "ASR", arrival: "source", departure: "04:55" },
          { station_code: "NDLS", arrival: "11:02", departure: "dest" },
        ] } });
      }
      if (p.endsWith("/availability/seats")) {
        const q = url.searchParams;
        const tn = String(q.get("train_number") ?? "");
        // 12014 sasta (₹1125), 12030 mehenga (₹1275) — cheapest ranking prove hoti hai
        return jsonResponse(200, { success: true, data: { classes: [
          { class_code: "CC", status: "AVAILABLE", total_fare: tn === "12014" ? 1125 : 1275, available_count: tn === "12014" ? 251 : 68 },
        ] } });
      }
      return jsonResponse(200, { success: true, data: {} });
    });
    const res = await runAgent({
      text: "Amritsar se NDLS 2026-09-05 ko sabse sasti train kaunsi hai? options compare karo",
      now: NOW,
    });
    expect(res.engine).toBe("deterministic");
    expect(res.reply).toBeTruthy();
    expect(String(res.reply)).toMatch(/Sabse sasti train/);
    expect(String(res.reply)).toMatch(/12014/); // ₹1125 < ₹1275 → cheapest hi top
    expect(String(res.reply)).toMatch(/1,125/);
    expect(String(res.reply)).toMatch(/12030/); // compare option bhi
    expect(res.toolTrace?.[0]?.tool).toBe("JOURNEY_ANALYZE");
    expect(res.toolTrace?.[0]?.ok).toBe(true);
    expect(res.toolTrace?.[0]?.source).toBe("railcore");
    expect(res.grounded).toBe(true);
  });
});

describe("fix: GPT-OSS explicit-null optional args (OpenAI semantics)", () => {
  beforeEach(() => {
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      const p = url.pathname;
      const q = url.searchParams;
      if (p.endsWith("/stations/search")) {
        const query = (q.get("q") || "").toLowerCase();
        if (query === "asr") return jsonResponse(200, { success: true, data: { results: [{ station_code: "ASR", station_name: "AMRITSAR JN", city: "Amritsar", confidence: 1 }] } });
        if (query === "ndls") return jsonResponse(200, { success: true, data: { results: [{ station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 1 }] } });
        return jsonResponse(200, { success: true, data: { results: [] } });
      }
      if (p.endsWith("/routes/trains")) {
        return jsonResponse(200, { success: true, data: { trains: [
          { train_number: "12030", train_name: "SWARN SHATABDI", departure_time: "16:50", arrival_time: "22:50", duration_minutes: 360, running_days: [0, 1, 2, 3, 4, 5, 6] },
        ] } });
      }
      if (p.includes("/schedule")) {
        return jsonResponse(200, { success: true, data: { train_number: "12030", classes: ["CC"], stops: [
          { station_code: "ASR", arrival: "source", departure: "16:50" },
          { station_code: "NDLS", arrival: "22:50", departure: "dest" },
        ] } });
      }
      if (p.endsWith("/fares/estimate")) {
        return jsonResponse(200, { success: true, data: { fares: [{ class_code: "CC", fare: 1275 }] } });
      }
      return jsonResponse(200, { success: true, data: {} });
    });
  });
  it("GET_FARE with nulls for optional fields executes (null == absent, invalid_args nahi)", async () => {
    const r = await executeApprovedTool("GET_FARE", {
      train_number: "12030",
      date: null,
      origin: null,
      destination: null,
      class_code: "CC",
      passengers: null,
    } as never);
    expect(r.ok).toBe(true);
    expect(String(r.summary)).toMatch(/12030/);
  });
  it("JOURNEY_ANALYZE with nulls for all optional filters executes fastest analysis", async () => {
    const r = await executeApprovedTool("JOURNEY_ANALYZE", {
      origin: "ASR",
      destination: "NDLS",
      date: "2026-09-05",
      preference: "fastest",
      include_alternative_dates: null,
      include_connections: null,
      max_fare_inr: null,
      preferred_class: null,
      depart_after: null,
      depart_before: null,
    } as never);
    expect(r.ok).toBe(true);
  });
});

describe("fix: grounding guard pakadta hai invented train names", () => {
  it("data fail hone par 'Rajdhani Express' guess karne wala reply replace hota hai", async () => {
    setRailcoreFetch(async () => jsonResponse(503, { success: false, error: { message: "down" } }));
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async () => { throw new Error("down"); },
      getTrainInfo: async () => { throw new Error("down"); },
      trackTrain: async () => { throw new Error("down"); },
      getAvailability: async () => { throw new Error("down"); },
      fareLookup: async () => { throw new Error("down"); },
      checkPNRStatus: async () => { throw new Error("down"); },
      cancelList: async () => { throw new Error("down"); },
    } as never);
    let modelCall = 0;
    setAgenticNvidiaFetch(async () => {
      modelCall++;
      if (modelCall === 1) {
        return jsonResponse(200, {
          model: "openai/gpt-oss-20b",
          choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "TRACK_TRAIN", arguments: JSON.stringify({ train_number: "12014" }) } }] } }],
        });
      }
      return jsonResponse(200, {
        model: "openai/gpt-oss-20b",
        choices: [{ message: { content: "12014 (Rajdhani Express) ka live data abhi available nahi hai." } }],
      });
    });
    const turn = await runAgenticTurn({ text: "12014 ka live location batao", now: NOW });
    expect(turn.grounded).toBe(false);
    expect(String(turn.reply ?? "")).not.toMatch(/Rajdhani/i);
  });
});

describe("fix: preferred_class partition — probed class evidence", () => {
  it("search classes missing + probe CC sirf 12030 ko mila → CC train best (12926 faster/sasta ho tab bhi)", async () => {
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      const p = url.pathname;
      const q = url.searchParams;
      if (p.endsWith("/stations/search")) {
        const query = (q.get("q") || "").toLowerCase();
        if (query === "asr") return jsonResponse(200, { success: true, data: { results: [{ station_code: "ASR", station_name: "AMRITSAR JN", city: "Amritsar", confidence: 1 }] } });
        if (query === "ndls") return jsonResponse(200, { success: true, data: { results: [{ station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 1 }] } });
        return jsonResponse(200, { success: true, data: { results: [] } });
      }
      if (p.endsWith("/routes/trains")) {
        // Classes deliberately MISSING (RailKit-style coverage gap).
        return jsonResponse(200, {
          success: true,
          data: {
            trains: [
              { train_number: "12926", train_name: "PASCHIM EXPRESS", departure_time: "08:00", arrival_time: "13:00", duration_minutes: 300, running_days: [0, 1, 2, 3, 4, 5, 6] },
              { train_number: "12030", train_name: "SWARN SHATABDI", departure_time: "16:50", arrival_time: "22:50", duration_minutes: 360, running_days: [0, 1, 2, 3, 4, 5, 6] },
            ],
          },
        });
      }
      if (p.includes("/schedule")) {
        const train = (p.match(/trains\/(\d+)\//) ?? [])[1] ?? "";
        // 12030 ko CC; 12926 ko sirf SL (CC nahi).
        return jsonResponse(200, { success: true, data: { train_number: train, classes: train === "12030" ? ["CC"] : ["SL"], stops: [
            { station_code: "ASR", arrival: "source", departure: train === "12030" ? "16:50" : "08:00" },
            { station_code: "NDLS", arrival: train === "12030" ? "22:50" : "13:00", departure: "dest" },
          ] } });
      }
      if (p.endsWith("/availability/seats")) {
        const train = q.get("train_number") ?? "";
        const cls = (q.get("class") ?? "").toUpperCase();
        if (train === "12030" && cls === "CC") {
          return jsonResponse(200, { success: true, data: { classes: [{ class_code: "CC", status: "AVAILABLE", available_seats: 68, total_fare: 1275 }] } });
        }
        if (train === "12926" && cls === "SL") {
          return jsonResponse(200, { success: true, data: { classes: [{ class_code: "SL", status: "AVAILABLE", available_seats: 320, total_fare: 500 }] } });
        }
        return jsonResponse(200, { success: true, data: { classes: [] } });
      }
      if (p.endsWith("/fares/estimate")) {
        const train = q.get("train_number") ?? "";
        return jsonResponse(200, { success: true, data: { base_fare: train === "12030" ? 1275 : 500, class_code: q.get("class") ?? "CC" } });
      }
      return jsonResponse(200, { success: true, data: {} });
    });
    let modelCall = 0;
    setAgenticNvidiaFetch(async () => {
      modelCall++;
      if (modelCall === 1) {
        return jsonResponse(200, {
          model: "openai/gpt-oss-20b",
          choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "JOURNEY_ANALYZE", arguments: JSON.stringify({ origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "cheapest", preferred_class: "CC" }) } }] } }],
        });
      }
      return jsonResponse(200, {
        model: "openai/gpt-oss-20b",
        choices: [{ message: { content: "CC analysis done." } }],
      });
    });
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "Amritsar se New Delhi Saturday ko sabse sasta CC train batao",
      now: NOW,
    });
    const analyze = (res.body.toolTrace ?? []).find((t: { tool: string }) => t.tool === "JOURNEY_ANALYZE");
    expect(analyze).toBeTruthy();
    // 12926 sasta (₹500) par CC nahi; 12030 CC-verified — partition fix ke bina
    // best = 12926 aata (classes=[] → koi CC nahi). Fix ke saath best = 12030.
    const preview = String(analyze.dataPreview ?? "");
    const bestMatch = preview.match(/"best"\s*:\s*{[^}]*?"number"\s*:\s*"(\d{5})"/);
    expect(bestMatch?.[1]).toBe("12030");
  });
});
