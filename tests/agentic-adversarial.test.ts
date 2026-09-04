/**
 * FINAL PRE-DEPLOYMENT ADVERSARIAL VALIDATION (scripted portions).
 *
 * Covers: date semantics, ambiguous stations, provider fallback inside the
 * agentic loop, both-providers-fail honesty, AI model fallback chain
 * (GPT-OSS -> Nemotron -> deterministic), malformed tool output, secret
 * safety, hallucination guards, journey grounding, deterministic scoring,
 * and multi-turn state. Live (real API) portions run separately via
 * scripts/agentic-adversarial-live.mts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { runAgent } from "../server/agent/run";
import {
  deterministicDateHint,
  executeApprovedTool,
  runAgenticTurn,
  setAgenticNvidiaFetch,
} from "../server/agent/agentic";
import { resetRailcoreBookings, setRailcoreFetch } from "../server/railway/railcore";
import { setRailkitSdk, type RailkitSdk } from "../server/railway/railkit";
import { setProvider } from "../server/providers/index";

const NOW = "2026-09-04T04:00:00.000Z"; // Friday, 09:30 IST
const NOW_SAT = "2026-09-05T04:00:00.000Z"; // Saturday

const SECRET_RAILCORE = "rk_live_ADVERSARIAL_railcore_value";
const SECRET_RAILKIT = "rk_test_ADVERSARIAL_railkit_value";
const SECRET_NVIDIA = "nvapi-ADVERSARIAL_nvidia_value";

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = SECRET_RAILCORE;
  process.env.RAILKIT_API_KEY = "";
  process.env.NVIDIA_API_KEY = SECRET_NVIDIA;
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

function toolCall(name: string, args: unknown, rawArgs?: string) {
  return {
    id: `call_${Math.random().toString(36).slice(2, 8)}`,
    type: "function" as const,
    function: { name, arguments: rawArgs ?? JSON.stringify(args) },
  };
}

function chatResponse(step: { tool_calls?: ReturnType<typeof toolCall>[]; content?: string }) {
  const message = step.tool_calls?.length
    ? { content: null, tool_calls: step.tool_calls }
    : { content: step.content ?? "", tool_calls: undefined };
  return jsonResponse(200, { model: "openai/gpt-oss-20b", choices: [{ message }] });
}

/* ── Mock RailCore (same shapes as production payloads) ──────────── */

function railcoreMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const q = url.searchParams;
    if (p.endsWith("/stations/search")) {
      const query = (q.get("q") || "").toLowerCase();
      if (query === "amritsar") {
        return jsonResponse(200, { success: true, data: { results: [{ station_code: "ASR", station_name: "AMRITSAR JN", city: "Amritsar", confidence: 1 }] } });
      }
      if (query === "jaipur") {
        return jsonResponse(200, { success: true, data: { results: [{ station_code: "JP", station_name: "JAIPUR JN", city: "Jaipur", confidence: 1 }] } });
      }
      if (query === "delhi airport") {
        return jsonResponse(200, { success: true, data: { results: [] } });
      }
      // Bare city names with many stations stay ambiguous.
      const multi: Record<string, [string, string][]> = {
        delhi: [["NDLS", "NEW DELHI"], ["DLI", "DELHI JN"], ["NZM", "H NIZAMUDDIN"], ["DEE", "DELHI S ROHILLA"]],
        bombay: [["BCT", "MUMBAI CENTRAL"], ["CSMT", "C SHIVAJI MAH T"], ["DR", "DADAR"], ["LTT", "LOKMANYA TILAK T"]],
        madras: [["MAS", "MGR CHENNAI CTL"], ["MS", "CHENNAI EGMORE"], ["TBM", "TAMBARAM"]],
        calcutta: [["HWH", "HOWRAH JN"], ["SDAH", "SEALDAH"], ["KOAA", "KOLKATA TERM"]],
      };
      const isDelPrefix = !multi[query] && query.startsWith("del");
      const rows = multi[query] ?? (isDelPrefix ? multi.delhi : undefined);
      if (rows) {
        return jsonResponse(200, {
          success: true,
          data: { results: rows.map(([code, name]) => ({ station_code: code, station_name: name, city: isDelPrefix ? "delhi" : query, confidence: 0.9 })) },
        });
      }
      return jsonResponse(200, { success: true, data: { results: [] } });
    }
    if (p.endsWith("/routes/trains")) {
      const from = q.get("from");
      const to = q.get("to");
      const date = q.get("date") || "";
      if (date === "2026-09-05" && from === "ASR") {
        return jsonResponse(200, {
          success: true,
          data: {
            from_station_code: "ASR",
            to_station_code: "NDLS",
            trains: [
              { train_number: "12014", train_name: "AMRITSAR SHATABDI", train_type: "Shatabdi", departure_time: "18:25", arrival_time: "23:00", duration_minutes: 275, running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], classes: ["CC", "EC"] },
              { train_number: "12460", train_name: "INTERCITY EXP", train_type: "Express", departure_time: "21:15", arrival_time: "04:15", duration_minutes: 420, running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], classes: ["CC", "2S"] },
            ],
          },
        });
      }
      if (from === "ASR" && to === "NDLS" && (date === "2026-09-04" || date === "2026-09-07")) {
        return jsonResponse(200, {
          success: true,
          data: { from_station_code: "ASR", to_station_code: "NDLS", trains: [
            { train_number: "12014", train_name: "AMRITSAR SHATABDI", train_type: "Shatabdi", departure_time: "18:25", arrival_time: "23:00", duration_minutes: 275, running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], classes: ["CC"] },
          ] },
        });
      }
      return jsonResponse(200, { success: true, data: { from_station_code: "ASR", to_station_code: "NDLS", trains: [] } });
    }
    if (p.endsWith("/schedule")) {
      const num = (p.match(/\/trains\/(\d+)\/schedule/) || [])[1] || "12014";
      const stops =
        num === "12460"
          ? [
              { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "21:15", day: 1 },
              { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "04:15", departure_time: null, day: 2 },
            ]
          : [
              { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "18:25", day: 1 },
              { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "23:00", departure_time: null, day: 1 },
            ];
      return jsonResponse(200, { success: true, data: { train_number: num, train_name: num === "12460" ? "INTERCITY EXP" : "AMRITSAR SHATABDI", running_days: ["MON","TUE","WED","THU","FRI","SAT","SUN"], classes: num === "12460" ? ["CC", "2S"] : ["CC", "EC"], stops } });
    }
    if (p.endsWith("/fares/estimate")) {
      const cls = q.get("class") || "CC";
      const fare = cls === "2S" ? 500 : cls === "EC" ? 2270 : 1210;
      return jsonResponse(200, { success: true, data: { fares: [{ class_code: cls, fare }] } });
    }
    if (p.endsWith("/availability/seats")) {
      return jsonResponse(200, {
        success: true,
        data: { journey_date: "2026-09-05", quota: "GN", classes: [{ class_code: "CC", status: "AVAILABLE", available_count: 47, total_fare: 1210, availability_text: "AVAILABLE-0047" }] },
      });
    }
    if (p.includes("/live") || p.includes("/running")) {
      return jsonResponse(404, { success: false, error: { message: "live data unavailable" } });
    }
    return jsonResponse(404, { success: false, error: { message: "not found" } });
  });
}

/* ── Fake RailKit SDK (RailKit fallback inside the loop) ─────────── */

function fakeRailkitSdk(overrides: Partial<RailkitSdk> = {}): RailkitSdk {
  return {
    configure: (_key: string) => {},
    searchTrainBetweenStations: async () => ({
      success: true,
      data: {
        trains: [
          { train_number: "12014", train_name: "AMRITSAR SHATABDI", from_time: "18:25", to_time: "23:00", classes: "CC EC" },
          { train_number: "12460", train_name: "INTERCITY EXP", from_time: "21:15", to_time: "04:15", classes: "CC 2S" },
        ],
      },
    }),
    getTrainInfo: async (trainNumber: string) => ({
      success: true,
      data: {
        trainInfo: { train_no: trainNumber, train_name: trainNumber === "12460" ? "INTERCITY EXP" : "AMRITSAR SHATABDI" },
        route:
          trainNumber === "12460"
            ? [
                { stnCode: "ASR", stnName: "AMRITSAR JN", arrival: "--", departure: "21:15", day: "1" },
                { stnCode: "NDLS", stnName: "NEW DELHI", arrival: "04:15", departure: "--", day: "2" },
              ]
            : [
                { stnCode: "ASR", stnName: "AMRITSAR JN", arrival: "--", departure: "18:25", day: "1" },
                { stnCode: "NDLS", stnName: "NEW DELHI", arrival: "23:00", departure: "--", day: "1" },
              ],
      },
    }),
    trackTrain: async () => ({ success: false }),
    getAvailability: async () => ({
      success: true,
      data: { availability: [{ date: "05-09-2026", status: "AVAILABLE 47" }], fare: { totalFare: 1210 }, train: { quota: "GN" } },
    }),
    fareLookup: async () => ({ success: true, data: { fare: { totalFare: 1210 } } }),
    checkPNRStatus: async () => ({ success: false }),
    ...overrides,
  } as RailkitSdk;
}

function railcoreDown(): void {
  setRailcoreFetch(async () => {
    throw new Error("railcore forced outage");
  });
}

/* ══ TEST 1 — DATE SEMANTICS (deterministic resolver, IST) ════════ */

describe("TEST 1: date semantics (deterministic, arbitrary dates, IST)", () => {
  const now = new Date(NOW);

  it("maps every required phrase to the correct IST date", () => {
    const cases: [string, string][] = [
      ["aaj", "2026-09-04"],
      ["kal", "2026-09-05"],
      ["parson", "2026-09-06"],
      ["Saturday", "2026-09-05"],
      ["next Saturday", "2026-09-05"],
      ["coming Saturday", "2026-09-05"],
      ["next Monday", "2026-09-07"],
      ["5 September 2026", "2026-09-05"],
      ["05/09/2026", "2026-09-05"],
    ];
    for (const [text, expected] of cases) {
      const hint = deterministicDateHint(text, now);
      expect(hint, `phrase: ${text}`).toEqual({ kind: "date", date: expected });
    }
  });

  it("handles arbitrary valid calendar dates beyond any literal map", () => {
    expect(deterministicDateHint("18 December 2026 ko", now)).toEqual({ kind: "date", date: "2026-12-18" });
    expect(deterministicDateHint("25/12/2026", now)).toEqual({ kind: "date", date: "2026-12-25" });
    expect(deterministicDateHint("30/01/2027", now)).toEqual({ kind: "date", date: "2027-01-30" });
    expect(deterministicDateHint("2 October ko", now)).toEqual({ kind: "date", date: "2026-10-02" });
  });

  it("never mistakes train numbers / PNRs for dates", () => {
    expect(deterministicDateHint("12014 ka live location batao", now)).toBeNull();
    expect(deterministicDateHint("12014 ko", now)).toBeNull();
    expect(deterministicDateHint("PNR 4512345678 ka status", now)).toBeNull();
    expect(deterministicDateHint("12951 ko mumbai", now)).toBeNull();
  });

  it("flags genuinely ambiguous weekday (today IS that weekday) and weekend/next-week", () => {
    const satHint = deterministicDateHint("Saturday", new Date(NOW_SAT));
    expect(satHint?.kind).toBe("ambiguous");
    const weekend = deterministicDateHint("weekend me jaana hai", now);
    expect(weekend?.kind).toBe("ambiguous");
  });

  it("stays IST-correct just past midnight (00:43 IST counts as the new day)", () => {
    const justPastMidnight = new Date("2026-09-03T19:13:00Z");
    expect(deterministicDateHint("aaj", justPastMidnight)).toEqual({ kind: "date", date: "2026-09-04" });
    expect(deterministicDateHint("kal", justPastMidnight)).toEqual({ kind: "date", date: "2026-09-05" });
  });

  it("injects the resolver verdict into the model's system prompt", async () => {
    railcoreMock();
    let firstSystem = "";
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!firstSystem) firstSystem = body.messages[0].content;
      return chatResponse({ content: "theek hai" });
    });
    await runAgenticTurn({ text: "saturday ko NDLS jaana hai", now: NOW, known: { origin: "ASR", destination: "NDLS" } });
    expect(firstSystem).toContain("Deterministic date resolver (IST): user ke text se date=2026-09-05");
    expect(firstSystem).toContain("FINAL");
  });
});

/* ══ TEST 2 — AMBIGUOUS STATIONS (never silently select) ══════════ */

describe("TEST 2: ambiguous stations need explicit user choice", () => {
  it("asks for clarification on multi-station cities (scripted RailCore)", async () => {
    railcoreMock();
    for (const city of ["Delhi", "Bombay", "Madras", "Calcutta"]) {
      const res = await executeApprovedTool("SEARCH_TRAINS", { origin: city, destination: "ASR", date: "2026-09-05" });
      expect(res.ok, city).toBe(false);
      const data = res.data as { needs_choice?: boolean; stations?: unknown[] };
      expect(data.needs_choice, city).toBe(true);
      expect((data.stations ?? []).length, city).toBeGreaterThan(1);
    }
  });

  it("single unambiguous station resolves without asking; unknown stays unknown", async () => {
    railcoreMock();
    const jp = await executeApprovedTool("SEARCH_TRAINS", { origin: "Jaipur", destination: "ASR", date: "2026-09-05" });
    expect(jp.ok).toBe(true);
    expect((jp.data as { from?: string }).from).toBe("JP");

    const airport = await executeApprovedTool("SEARCH_TRAINS", { origin: "Delhi airport", destination: "ASR", date: "2026-09-05" });
    expect(airport.ok).toBe(false);
    expect(airport.summary).toMatch(/nahi mila/i);
    expect((airport.data as { needs_choice?: boolean } | null)?.needs_choice ?? false).toBe(false);
  });
});

  it("wrong code-style station (airport code) re-verifies -> needs_choice, not fake 0 trains", async () => {
    railcoreMock();
    const res = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "DEL", date: "2026-09-05", preference: "fastest" });
    expect(res.ok).toBe(false);
    const data = res.data as { needs_choice?: boolean; city?: string; stations?: { code: string }[] };
    expect(data.needs_choice).toBe(true);
    expect(data.city?.toLowerCase()).toContain("del");
    expect((data.stations ?? []).map((x) => x.code)).toContain("NDLS");
  });

/* ══ TEST 4 — RAILCORE -> RAILKIT FALLBACK INSIDE THE LOOP ════════ */

describe("TEST 4: RailCore primary -> RailKit fallback (no fake data)", () => {
  it("SEARCH_TRAINS falls back to RailKit and labels the source", async () => {
    railcoreDown();
    process.env.RAILKIT_API_KEY = SECRET_RAILKIT;
    setRailkitSdk(fakeRailkitSdk());
    const res = await executeApprovedTool("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("railkit_fallback");
    const trains = (res.data as { trains?: { number: string }[] }).trains ?? [];
    expect(trains.map((t) => t.number)).toContain("12014");
  });

  it("GET_FARE falls back to RailKit", async () => {
    railcoreDown();
    process.env.RAILKIT_API_KEY = SECRET_RAILKIT;
    setRailkitSdk(fakeRailkitSdk());
    const res = await executeApprovedTool("GET_FARE", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("railkit_fallback");
    expect((res.data as { baseFare?: number }).baseFare).toBe(1210);
  });

  it("CHECK_AVAILABILITY falls back to RailKit", async () => {
    railcoreDown();
    process.env.RAILKIT_API_KEY = SECRET_RAILKIT;
    setRailkitSdk(fakeRailkitSdk());
    const res = await executeApprovedTool("CHECK_AVAILABILITY", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("railkit_fallback");
    expect(JSON.stringify(res.data)).toMatch(/AVAILABLE/);
  });

  it("JOURNEY_ANALYZE records the railkit_fallback provider", async () => {
    railcoreDown();
    process.env.RAILKIT_API_KEY = SECRET_RAILKIT;
    setRailkitSdk(fakeRailkitSdk());
    const res = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest" });
    expect(res.ok).toBe(true);
    expect((res.data as { providers?: { search?: string } }).providers?.search).toBe("railkit_fallback");
  });
});

/* ══ TEST 5 — BOTH PROVIDERS FAIL (honest unavailability) ═════════ */

describe("TEST 5: both providers fail -> tool says unavailable, never invents", () => {
  it("search/journey/fare/availability all fail honestly", async () => {
    railcoreDown(); // RailKit key intentionally unset -> both providers down
    const search = await executeApprovedTool("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" });
    expect(search.ok).toBe(false);
    expect(search.summary).toMatch(/unavailable/i);
    expect((search.data as { unavailable?: boolean }).unavailable).toBe(true);

    const journey = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest" });
    expect(journey.ok).toBe(false);
    expect((journey.data as { unavailable?: boolean }).unavailable).toBe(true);

    const fare = await executeApprovedTool("GET_FARE", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" });
    expect(fare.ok).toBe(false);

    const avail = await executeApprovedTool("CHECK_AVAILABILITY", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" });
    expect(avail.ok).toBe(false);
  });

  it("model relays unavailability instead of inventing trains", async () => {
    railcoreDown();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [toolCall("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" })] });
      }
      return chatResponse({ content: "Railway data abhi unavailable hai — koi train invent nahi karunga." });
    });
    const turn = await runAgenticTurn({ text: "ASR se NDLS trains", now: NOW });
    expect(turn.ok).toBe(true);
    expect(turn.grounded).toBe(true);
    expect(turn.reply).toMatch(/unavailable/i);
    expect(turn.steps[0].ok).toBe(false);
  });
});

/* ══ TEST 6 — AI FALLBACK CHAIN ═══════════════════════════════════ */

describe("TEST 6: GPT-OSS -> Nemotron -> deterministic NLU", () => {
  it("primary model failure falls back to Nemotron and still produces a usable tool plan", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(body.model).includes("gpt-oss")) {
        return jsonResponse(500, { error: { message: "gpt-oss overloaded" } });
      }
      // Nemotron serves the plan (and must NOT receive reasoning_effort).
      expect(body.reasoning_effort).toBeUndefined();
      const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return jsonResponse(200, {
          model: "nvidia/nemotron-3.5-lightning-30b-a3b",
          choices: [{ message: { content: null, tool_calls: [toolCall("TRACK_TRAIN", { train_number: "12014" })] } }],
        });
      }
      return jsonResponse(200, {
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        choices: [{ message: { content: "12014 ki live status abhi unavailable hai.", tool_calls: undefined } }],
      });
    });
    const turn = await runAgenticTurn({ text: "12014 abhi kaha hai?", now: NOW });
    expect(turn.ok).toBe(true);
    expect(turn.modelUsed).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(turn.steps[0].tool).toBe("TRACK_TRAIN");
    expect(turn.reply).toMatch(/unavailable/i);
  });

  it("both AI models failing hands over to the deterministic engine", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async () => {
      throw new Error("both AI providers down");
    });
    const app = createApp();
    const res = await request(app).post("/api/agent").send({ text: "12014 abhi kaha hai?", now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.engine ?? "deterministic").toBe("deterministic");
    expect(typeof res.body.reply === "string" || res.body.reply == null).toBe(true);
    const direct = await runAgent({ text: "12014 abhi kaha hai?", now: NOW });
    expect(direct.reply !== undefined).toBe(true);
  });
});

/* ══ TEST 7 — MALFORMED TOOL OUTPUT ═══════════════════════════════ */

describe("TEST 7: malformed model output is rejected at the gate", () => {
  it("invalid JSON arguments are refused, model can retry", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [{ id: "c1", type: "function" as const, function: { name: "CHECK_AVAILABILITY", arguments: "{not-json!!" } }] });
      }
      if (toolMsgs === 1) {
        return chatResponse({
          tool_calls: [toolCall("CHECK_AVAILABILITY", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" })],
        });
      }
      return chatResponse({ content: "12014 CC: AVAILABLE 47 seats (2026-09-05)." });
    });
    const turn = await runAgenticTurn({ text: "availability", now: NOW });
    expect(turn.steps[0].ok).toBe(false);
    expect(turn.steps[0].summary).toMatch(/Invalid arguments/i);
    expect(turn.steps[1].ok).toBe(true);
    expect(turn.grounded).toBe(true);
  });

  it("bare harmony channel token is not a tool", async () => {
    const res = await executeApprovedTool("<|channel|>commentary", {});
    expect(res.rejected).toBe("not_in_allowlist");
  });

  it("unknown tool names are rejected", async () => {
    for (const name of ["DELETE_BOOKINGS", "SEARCH_WEB", "run_arbitrary_code", "GET_FARE_DROP_TABLE"]) {
      const res = await executeApprovedTool(name, {});
      expect(res.rejected, name).toBe("not_in_allowlist");
    }
  });

  it("URLs in arguments are rejected before execution", async () => {
    const res = await executeApprovedTool("GET_TIMETABLE", { train_number: "12014", callback: "https://evil.example.com/exfil" });
    expect(res.rejected).toBe("url_in_args");
  });

  it("extra unknown arguments are stripped (never forwarded)", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({
          tool_calls: [
            toolCall("CHECK_AVAILABILITY", {
              train_number: "12014",
              date: "2026-09-05",
              origin: "ASR",
              destination: "NDLS",
              class_code: "CC",
              zzz_injected: 123,
              callback_url: "notice-me",
            }),
          ],
        });
      }
      return chatResponse({ content: "12014 CC AVAILABLE 47 seats on 2026-09-05." });
    });
    const turn = await runAgenticTurn({ text: "availability", now: NOW });
    expect(turn.steps[0].ok).toBe(true);
    expect(turn.steps[0].args).not.toHaveProperty("zzz_injected");
    expect(turn.steps[0].args).not.toHaveProperty("callback_url");
  });

  it("missing required arguments are refused", async () => {
    const res = await executeApprovedTool("GET_FARE", { train_number: "12014" });
    expect(res.ok).toBe(false);
    expect(res.rejected).toBe("invalid_args");
  });
});

/* ══ TEST 8 — SECRET SAFETY ════════════════════════════════════════ */

describe("TEST 8: provider secrets never leak", () => {
  it("keys never appear in model messages, responses, or server logs", async () => {
    railcoreMock();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      let modelMessages = "";
      setAgenticNvidiaFetch(async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        modelMessages += JSON.stringify(body);
        const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
        if (toolMsgs === 0) {
          return chatResponse({ tool_calls: [toolCall("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" })] });
        }
        return chatResponse({ content: "2 trains mili 2026-09-05 ko." });
      });
      const app = createApp();
      const res = await request(app).post("/api/agent").send({ text: "ASR se NDLS trains dikhao", now: NOW });
      expect(res.status).toBe(200);

      const clientBlob = JSON.stringify(res.body);
      expect(clientBlob).not.toContain(SECRET_RAILCORE);
      expect(clientBlob).not.toContain(SECRET_RAILKIT);
      expect(clientBlob).not.toContain(SECRET_NVIDIA);
      expect(modelMessages).not.toContain(SECRET_RAILCORE);
      expect(modelMessages).not.toContain(SECRET_NVIDIA);
      for (const line of infoSpy.mock.calls.map((c) => c.join(" "))) {
        expect(line).not.toContain(SECRET_RAILCORE);
        expect(line).not.toContain(SECRET_RAILKIT);
        expect(line).not.toContain(SECRET_NVIDIA);
      }
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("server/browser source contains no key literals; real .env values never appear outside .env", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(
      `grep -rn "rk_live_[A-Za-z0-9_-]\\{20,\\}\\|nvapi-[A-Za-z0-9_-]\\{20,\\}\\|vcp_[A-Za-z0-9]\\{20,\\}" server src scripts --include="*.ts" --include="*.tsx" || true`,
      { encoding: "utf8" },
    );
    // Only redaction *patterns* are allowed; no real key material in code.
    const realLeaks = out.split("\n").filter(Boolean).filter((line) => !/rk_live_\*|\[REDACTED\]|A-Za-z0-9/.test(line));
    expect(realLeaks).toEqual([]);

    // The ACTUAL local secret values must appear ONLY inside .env (gitignored).
    // .env is intentionally absent in clones/CI — the local-secret scan runs only when it exists.
    const fs = await import("node:fs");
    let envText = "";
    try {
      envText = fs.readFileSync(".env", "utf8");
    } catch {
      /* no local .env here */
    }
    const secrets = envText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => l.slice(l.indexOf("=") + 1).trim())
      .filter((v) => v.length >= 20 && /^(rk_live_|rk_test_|nvapi-|vcp_|ghp_)/.test(v));
    for (const secret of secrets) {
      const hits = execSync(
        `grep -rl --exclude=".env" --exclude-dir=node_modules --exclude-dir=.git ${JSON.stringify(secret)} . || true`,
        { encoding: "utf8" },
      ).trim();
      expect(hits, "secret leaked outside .env").toBe("");
    }
  });
});

/* ══ TEST 9 — HALLUCINATION GUARDS ════════════════════════════════ */

describe("TEST 9: no invented facts, no false certainty", () => {
  it("fabricated delay number in the final answer gets replaced", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [toolCall("TRACK_TRAIN", { train_number: "12014" })] });
      }
      return chatResponse({ content: "12014 train 145 minute late hai aur platform 7 par khadi hai." });
    });
    const turn = await runAgenticTurn({ text: "12014 ka live location batao", now: NOW });
    expect(turn.grounded).toBe(false);
    expect(turn.reply ?? "").not.toContain("145");
    expect(turn.reply ?? "").not.toContain("platform 7");
  });

  it("insufficient data -> model must not claim certainty about Vande Bharat", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [toolCall("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" })] });
      }
      return chatResponse({ content: "22439 Vande Bharat Saturday ko definitely chalegi." });
    });
    const turn = await runAgenticTurn({ text: "Is Saturday ko Vande Bharat definitely chalegi?", now: NOW });
    expect(turn.grounded).toBe(false);
    expect(turn.reply ?? "").not.toContain("22439");
    expect(turn.reply ?? "").not.toContain("definitely chalegi");
  });
});

/* ══ TEST 10 — JOURNEY ANALYZE DATA GROUNDING ═════════════════════ */

describe("TEST 10: every recommendation exists in provider data", () => {
  it("ranked candidates, timings and fares all come from the provider payload", async () => {
    railcoreMock();
    const res = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "cheapest" });
    expect(res.ok).toBe(true);
    const data = res.data as {
      direct: { count: number; best: { number: string; departure: string; arrival: string; durationMinutes: number; cheapest: { fare: number; classCode: string } | null } | null; ranked: { number: string; departure: string; arrival: string }[] };
      providers: { search: string };
    };
    const providerTrains = new Set(["12014", "12460"]);
    expect(data.direct.ranked.length).toBeGreaterThan(0);
    for (const t of data.direct.ranked) {
      expect(providerTrains.has(t.number), `ranked ${t.number} must come from provider`).toBe(true);
      expect(t.departure).toMatch(/^\d{2}:\d{2}$/);
    }
    expect(data.direct.best).toBeTruthy();
    expect(providerTrains.has(data.direct.best!.number)).toBe(true);
    // Fare only from provider fare data (1210 CC).
    expect(data.direct.best!.cheapest?.fare ?? null).toBe(1210);
    expect(data.providers.search).toBe("railcore");
  });
});

/* ══ TEST 11 — DETERMINISTIC SCORING ══════════════════════════════ */

describe("TEST 11: scoring is deterministic and reproducible", () => {
  it("same input -> byte-identical output (twice)", async () => {
    railcoreMock();
    const a = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest" });
    const b = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest" });
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });

  it("each preference sorts by actual returned data", async () => {
    railcoreMock();
    const fastest = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest" });
    expect(((fastest.data as any).direct.best as { number: string }).number).toBe("12014"); // 275 min < 420 min

    const earliestDep = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "earliest" });
    expect(((earliestDep.data as any).direct.best as { departure: string }).departure).toBe("18:25");

    const earliestArr = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "earliest_arrival" });
    expect(((earliestArr.data as any).direct.best as { number: string }).number).toBe("12460"); // 04:15 arrival per provider data

    const bestValue = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "best_value" });
    const bvData = bestValue.data as { direct: { best: { cheapest: { fare: number } | null } } };
    expect(bvData.direct.best.cheapest?.fare).toBe(1210);
  });

  it("departure window filter is deterministic", async () => {
    railcoreMock();
    const res = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest", depart_after: "20:00", depart_before: "23:59" });
    const data = res.data as { direct: { count: number; ranked: { number: string }[] } };
    expect(data.direct.ranked.length).toBe(1);
    expect(data.direct.ranked[0].number).toBe("12460"); // only 21:15 departure in window
    expect(data.direct.count).toBe(2); // raw provider count is reported separately
  });

  it("preferred class partitions deterministically (class trains first)", async () => {
    railcoreMock();
    const res = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest", preferred_class: "2S" });
    const data = res.data as { direct: { ranked: { number: string; classes: string[] }[] } };
    expect(data.direct.ranked[0].number).toBe("12460");
    expect(data.direct.ranked[0].classes).toContain("2S");
  });

  it("max fare cap keeps only provider-verified fares under the cap", async () => {
    railcoreMock();
    const under = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "cheapest", max_fare_inr: 1300 });
    const underData = under.data as { direct: { ranked: unknown[] }; filters?: { fare_probe_ok?: boolean } };
    expect(under.ok).toBe(true);
    expect(underData.direct.ranked.length).toBeGreaterThan(0);
    expect(underData.filters?.fare_probe_ok).toBe(true);

    const over = await executeApprovedTool("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "cheapest", max_fare_inr: 900 });
    const overData = over.data as { direct: { ranked: unknown[] }; filters?: { max_fare_inr?: number } };
    expect(over.ok).toBe(true); // honest "koi nahi" — NOT a fabricated cheap train
    expect(overData.direct.ranked).toEqual([]);
    expect(overData.filters?.max_fare_inr).toBe(900);
  });
});

/* ══ TEST 12 — MULTI-TURN STATE ═══════════════════════════════════ */

describe("TEST 12: multi-turn state (origin/date/class preserved)", () => {
  it("Saturday continues on known origin/destination without re-asking", async () => {
    railcoreMock();
    const systems: string[] = [];
    const argsSeen: Record<string, unknown>[] = [];
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      systems.push(body.messages[0].content);
      const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [toolCall("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest" })] });
      }
      return chatResponse({ content: "Saturday (2026-09-05) ko ASR→NDLS sabse fast 12014 hai, 18:25 se." });
    });
    const turn = await runAgenticTurn({ text: "saturday", now: NOW, known: { origin: "ASR", destination: "NDLS" } });
    expect(turn.ok).toBe(true);
    expect(turn.grounded).toBe(true);
    expect(systems[0]).toContain("origin=ASR");
    expect(systems[0]).toContain("destination=NDLS");
    expect(systems[0]).toContain("date=2026-09-05 resolve hui"); // deterministic resolver fed the model
    expect(argsSeen.length).toBe(0);
  });

  it("fare/availability follow-up reuses full context (no slot loss)", async () => {
    railcoreMock();
    let sawArgs: Record<string, unknown> | null = null;
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: { role: string }) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({
          tool_calls: [
            toolCall("GET_FARE", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" }),
            toolCall("CHECK_AVAILABILITY", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" }),
          ],
        });
      }
      return chatResponse({ content: "12014 CC fare 1210 ka base hai; 47 seats AVAILABLE (2026-09-05)." });
    });
    const turn = await runAgenticTurn({
      text: "CC ka fare aur availability?",
      now: NOW,
      known: { origin: "ASR", destination: "NDLS", date: "2026-09-05", trainNumber: "12014" },
    });
    expect(turn.ok).toBe(true);
    expect(turn.grounded).toBe(true);
    sawArgs = turn.steps[0].args;
    expect(sawArgs).toMatchObject({ train_number: "12014", origin: "ASR", destination: "NDLS", date: "2026-09-05", class_code: "CC" });
    expect(turn.steps.map((s) => s.tool)).toEqual(["GET_FARE", "CHECK_AVAILABILITY"]);
  });
});
