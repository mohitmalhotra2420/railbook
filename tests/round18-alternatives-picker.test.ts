/* ══ ROUND-18 (2026-09-10) ══
 * §4 data-conflict resolution (never blend, priority + freshness, honest
 *    "Data sources are conflicting right now. Please retry."),
 * §5 proactive alternatives after journey search,
 * §6 FIND_ALTERNATIVE_TRAINS when selected train is WL/RAC/low/no class,
 * §9/§10 SELECT TRAIN smart picker (number-first, exact/partial name, real data),
 * §13 provider capability registry, §14 freshness envelope, §16 no auto-booking. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { setRailcoreFetch } from "../server/railway/railcore";
import { clearScheduleCache, resetFallbackProvider } from "../server/railway/router";
import { setProvider } from "../server/providers/index";
import { setScrapeFetch } from "../server/railway/webscrape";
import { availabilityEquals, CONFLICT_MESSAGE, freshnessOf, makeProvenance, resolveConflict, sourcePriority } from "../server/providers/provenance";
import { CAPABILITIES, capabilityAvailable, publicCapabilityPayload, supportedProvidersFor, UNAVAILABLE_MESSAGES } from "../server/providers/capabilities";
import { detectBoardConflict, findAlternativeTrains } from "../server/journey/engine";
import { extractTrainQuery, normalizeTrainName, pickTrains, tokenMatches } from "../server/journey/trainpicker";
import { AGENTIC_TOOLS, executeApprovedTool, setAgenticNvidiaFetch } from "../server/agent/agentic";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const FUTURE = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test_secret";
  process.env.RAILKIT_API_KEY = "";
  process.env.RAILRADAR_API_KEY = "";
  setProvider(null);
  resetFallbackProvider();
  clearScheduleCache();
  setScrapeFetch(async () => new Response("", { status: 404 }));
});
afterEach(() => {
  setRailcoreFetch(null);
  setAgenticNvidiaFetch(null);
  setScrapeFetch(async () => new Response("", { status: 404 }));
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  process.env.NVIDIA_API_KEY = "";
  setProvider(null);
  resetFallbackProvider();
  clearScheduleCache();
});

/* ── §4 conflict resolution ─────────────────────────────────────────── */
describe("Round-18 §4: data conflict resolution — never blend", () => {
  it("RailCore 10 vs web 15 → RailCore wins (priority), web discarded with provenance, never 25", () => {
    const r = resolveConflict("availability", [
      { value: { status: "AVAILABLE", seats: 15 }, source: "web_railyatri" },
      { value: { status: "AVAILABLE", seats: 10 }, source: "railcore" },
    ], availabilityEquals);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.seats).toBe(10);
      expect(r.source).toBe("railcore");
      expect(r.discarded).toEqual([{ source: "web_railyatri", value: { status: "AVAILABLE", seats: 15 } }]);
      expect(r.rule).toBe("priority");
    }
  });
  it("agreeing sources → no conflict; single source → fine", () => {
    const r = resolveConflict("availability", [
      { value: { status: "WAITLIST", waitlist: 4 }, source: "railradar" },
      { value: { status: "WAITLIST", waitlist: 4 }, source: "web_railyatri" },
    ], availabilityEquals);
    expect(r.ok && r.discarded.length === 0 && r.rule === "agree_or_single").toBe(true);
  });
  it("lower-priority source materially fresher (>15 min) and disagreeing → unresolved conflict message", () => {
    const old = new Date(Date.now() - 60 * 60000).toISOString();
    const now = new Date().toISOString();
    const r = resolveConflict("live_status", [
      { value: { station: "LDH", delay: 10 }, source: "railcore", providerUpdatedAt: old },
      { value: { station: "UMB", delay: 35 }, source: "web_railyatri", providerUpdatedAt: now },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe(CONFLICT_MESSAGE);
      expect(r.message).toBe("Data sources are conflicting right now. Please retry.");
      expect(r.candidates.map((c) => c.source)).toEqual(["railcore", "web_railyatri"]);
    }
  });
  it("priority order: railcore < railkit < railradar < indianrailapi < web", () => {
    expect([sourcePriority("railcore"), sourcePriority("railkit_fallback"), sourcePriority("railradar"), sourcePriority("indianrailapi"), sourcePriority("web_erail")]).toEqual([1, 2, 3, 4, 5]);
  });
  it("detectBoardConflict: same class from two sources with different values → conflict; else null", () => {
    expect(detectBoardConflict([
      { code: "SL", label: "Sleeper", status: "AVAILABLE", seats: 10, fare: 500, source: "railcore" } as never,
      { code: "SL", label: "Sleeper", status: "AVAILABLE", seats: 15, fare: 500, source: "web_railyatri", webNote: `as of ${new Date().toISOString()}` } as never,
    ])).toBeNull(); // priority resolves it (railcore wins) — no user-facing conflict
    expect(detectBoardConflict([
      { code: "SL", label: "Sleeper", status: "AVAILABLE", seats: 10, fare: 500, source: "railcore" } as never,
      { code: "3A", label: "3A", status: "WAITLIST", waitlist: 3, fare: 1300, source: "railcore" } as never,
    ])).toBeNull();
  });
});

/* ── §13/§14 registry + freshness ───────────────────────────────────── */
describe("Round-18 §13/§14: capability registry + freshness", () => {
  it("berth-level / post-chart / reliability are unavailable everywhere with honest message", () => {
    for (const cap of ["FIND_VACANT_SEATS_BERTH_LEVEL", "POST_CHART_VACANCY", "RELIABILITY_SCORE"] as const) {
      expect(capabilityAvailable(cap)).toBe(false);
      expect(supportedProvidersFor(cap)).toEqual([]);
    }
    expect(UNAVAILABLE_MESSAGES.FIND_VACANT_SEATS_BERTH_LEVEL).toBe("Seat recovery data is currently unavailable.");
    const pub = publicCapabilityPayload();
    expect(pub.matrix.FIND_VACANT_SEATS_BERTH_LEVEL).toMatchObject({ available: false, message: "Seat recovery data is currently unavailable." });
    expect(pub.providers.find((p) => p.id === "indianrailapi")?.capabilities.CHECK_AVAILABILITY).toBe("needs_key");
    expect(JSON.stringify(pub)).not.toMatch(/rk_live|nvapi|rg_/);
  });
  it("web scrape is a configured last-resort provider for availability/live/fare/schedule; class-level vacancy is served", () => {
    const web = publicCapabilityPayload().providers.find((p) => p.id === "web")!;
    expect(web.configured).toBe(true);
    expect(web.capabilities.CHECK_AVAILABILITY).toBe("available");
    expect(web.capabilities.TRACK_TRAIN).toBe("available");
    expect(web.capabilities.CHECK_PNR).toBe("unavailable");
    expect(capabilityAvailable("FIND_VACANT_SEATS_CLASS_LEVEL")).toBe(true);
    expect(CAPABILITIES).toContain("SEARCH_TRAIN_BY_NAME");
  });
  it("freshness: live 1 min = live, 10 min = recent, 2h = stale; schedule 2 days = fresh", () => {
    const now = Date.now();
    const ago = (m: number) => new Date(now - m * 60000).toISOString();
    expect(freshnessOf("live_status", ago(1), null, now)).toBe("live");
    expect(freshnessOf("live_status", ago(10), null, now)).toBe("recent");
    expect(freshnessOf("live_status", ago(120), null, now)).toBe("stale");
    expect(freshnessOf("schedule", ago(2 * 24 * 60), null, now)).toBe("fresh");
    const p = makeProvenance({ source: "web_railyatri", kind: "availability", requestDate: "2026-09-10", travelDate: FUTURE, retrievedAt: ago(90), now });
    expect(p).toMatchObject({ sourceType: "web_scrape", freshness: "stale", travelDate: FUTURE });
    expect(p.label).toMatch(/railyatri.*STALE/);
  });
});

/* ── Provider mock ──────────────────────────────────────────────────── */
type AvailRule = (train: string, from: string, to: string, cls: string) => { status: string; count?: number; wl?: number; rac?: number } | null;
function railcoreMock(rule: AvailRule, calls: string[] = []) {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    calls.push(p + url.search);
    if (p.endsWith("/routes/trains")) {
      return jsonResponse(200, {
        success: true,
        data: {
          trains: [
            { train_number: "12138", train_name: "PUNJAB MAIL", departure_time: "06:00", arrival_time: "07:35", duration_minutes: 1535, classes: ["SL", "3A", "2A"], running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] },
            { train_number: "12904", train_name: "GOLDEN TEMPLE MAIL", departure_time: "12:00", arrival_time: "18:00", duration_minutes: 1800, classes: ["SL", "3A"], running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] },
          ],
        },
      });
    }
    if (p.endsWith("/schedule")) {
      const num = (p.match(/\/trains\/(\d+)\/schedule/) || [])[1];
      if (!["12138", "12904", "12014", "12013", "12029"].includes(num)) return jsonResponse(404, { success: false, error: { code: "NOT_FOUND" } });
      return jsonResponse(200, {
        success: true,
        data: {
          train_number: num,
          train_name: num === "12138" ? "PUNJAB MAIL" : num === "12904" ? "GOLDEN TEMPLE MAIL" : num === "12014" ? "AMRITSAR SHATABDI" : "NEW DELHI SHATABDI",
          running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
          classes: ["SL", "3A", "2A"],
          stops: [
            { station_code: "FZR", station_name: "FIROZPUR", arrival_time: null, departure_time: "06:00", day: 1 },
            { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "08:00", departure_time: "08:10", day: 1 },
            { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "14:00", departure_time: "14:15", day: 1 },
            { station_code: "BPL", station_name: "BHOPAL JN", arrival_time: "23:00", departure_time: "23:10", day: 1 },
            { station_code: "CSMT", station_name: "MUMBAI CSMT", arrival_time: "07:35", departure_time: null, day: 2 },
          ],
        },
      });
    }
    if (p.endsWith("/trains/search")) {
      const q = String(url.searchParams.get("q") ?? "").toLowerCase();
      const all = [
        { train_number: "12014", train_name: "AMRITSAR SHATABDI", source_station_code: "ASR", destination_station_code: "NDLS", train_type: "Shatabdi" },
        { train_number: "12013", train_name: "NEW DELHI SHATABDI", source_station_code: "NDLS", destination_station_code: "ASR", train_type: "Shatabdi" },
        { train_number: "12029", train_name: "SWARN SHATABDI", source_station_code: "NDLS", destination_station_code: "ASR", train_type: "Shatabdi" },
      ].filter((t) => q.split(" ").some((w) => w.length >= 4 && t.train_name.toLowerCase().includes(w)));
      return jsonResponse(200, { success: true, data: { results: all } });
    }
    if (/\/trains\/\d+$/.test(p)) {
      const num = p.split("/").pop()!;
      const names: Record<string, string> = { "12014": "AMRITSAR SHATABDI", "12013": "NEW DELHI SHATABDI", "12138": "PUNJAB MAIL" };
      if (!names[num]) return jsonResponse(404, { success: false, error: { code: "NOT_FOUND" } });
      return jsonResponse(200, { success: true, data: { train_number: num, train_name: names[num], running_days: ["MON"] } });
    }
    if (p.endsWith("/availability/seats")) {
      const train = url.searchParams.get("train_number")!;
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      const cls = url.searchParams.get("class")!;
      const r = rule(train, from, to, cls);
      if (!r) return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "no data" } });
      const text = r.status === "AVAILABLE" ? `AVAILABLE-${String(r.count ?? 0).padStart(4, "0")}` : r.status === "WAITLIST" ? `GNWL${r.wl}/WL${r.wl}` : r.status === "RAC" ? `RAC ${r.rac ?? 1}` : r.status;
      return jsonResponse(200, { success: true, data: { train_number: train, journey_date: FUTURE, quota: "GN", classes: [{ class_code: cls, status: r.status, availability_text: text, available_count: r.count, total_fare: cls === "SL" ? 500 : 1300 }] } });
    }
    return jsonResponse(404, { success: false, error: { code: "NOT_FOUND" } });
  });
}

/* ── §6 alternatives ────────────────────────────────────────────────── */
describe("Round-18 §6: FIND_ALTERNATIVE_TRAINS — real alternatives only", () => {
  it("12138 SL WL → other train 12904 SL AVL + same-train other class 3A AVL + provenance", async () => {
    railcoreMock((train, f, t, cls) => {
      if (train === "12138" && cls === "SL") return f === "LDH" && t === "CSMT" ? { status: "WAITLIST", wl: 24 } : { status: "WAITLIST", wl: 9 };
      if (train === "12138" && cls === "3A") return { status: "AVAILABLE", count: 12 };
      if (train === "12138") return null;
      if (train === "12904" && cls === "SL") return { status: "AVAILABLE", count: 40 };
      return null;
    });
    const alt = await findAlternativeTrains({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, travelClass: "SL" });
    expect(alt.reason).toBe("waitlist");
    expect(alt.selected).toMatchObject({ trainNumber: "12138", classCode: "SL", status: "WAITLIST", waitlist: 24 });
    expect(alt.alternatives.map((o) => [o.trainNumbers[0], o.availability?.classCode, o.availability?.status, o.availability?.seats])).toEqual([["12904", "SL", "AVAILABLE", 40]]);
    expect(alt.alternatives[0].availability?.source).toBe("railcore");
    expect(alt.otherClasses).toEqual([expect.objectContaining({ classCode: "3A", status: "AVAILABLE", seats: 12, source: "railcore" })]);
    expect(alt.provenance).toMatchObject({ travelDate: FUTURE, sourceTypes: ["api"] });
    expect(alt.note).toMatch(/verified alternative/);
  });
  it("low availability (<10 seats) triggers alternatives; AVAILABLE ≥10 → reason fine, no probes beyond board", async () => {
    const calls: string[] = [];
    railcoreMock((train, _f, _t, cls) => (train === "12138" && cls === "SL" ? { status: "AVAILABLE", count: 3 } : train === "12904" && cls === "SL" ? { status: "AVAILABLE", count: 60 } : null), calls);
    const low = await findAlternativeTrains({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, travelClass: "SL" });
    expect(low.reason).toBe("low_availability");
    expect(low.alternatives[0]?.trainNumbers[0]).toBe("12904");
    calls.length = 0;
    railcoreMock(() => ({ status: "AVAILABLE", count: 50 }), calls);
    const fine = await findAlternativeTrains({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, travelClass: "SL" });
    expect(fine.reason).toBe("fine");
    expect(fine.alternatives).toEqual([]);
    expect(calls.filter((c) => c.includes("/routes/trains"))).toHaveLength(0);
  });
  it("nothing verified anywhere → honest empty (no invented alternative)", async () => {
    railcoreMock((train, _f, _t, cls) => (train === "12138" && cls === "SL" ? { status: "WAITLIST", wl: 50 } : train === "12904" && cls === "SL" ? { status: "WAITLIST", wl: 80 } : null));
    const alt = await findAlternativeTrains({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, travelClass: "SL" });
    expect(alt.alternatives).toEqual([]);
    expect(alt.otherClasses).toEqual([]);
    expect(alt.note).toMatch(/koi verified alternative nahi mila/);
  });
  it("tool: FIND_ALTERNATIVE_TRAINS summary lists only verified options + 'YOU MAY ALSO CONSIDER' instruction", async () => {
    railcoreMock((train, _f, _t, cls) => (train === "12138" && cls === "SL" ? { status: "RAC", rac: 5 } : train === "12904" && cls === "SL" ? { status: "AVAILABLE", count: 21 } : null));
    const r = await executeApprovedTool("FIND_ALTERNATIVE_TRAINS", { train_number: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, travel_class: "SL" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/DOOSRI TRAINS: 12904 GOLDEN TEMPLE MAIL .* SL AVAILABLE 21/);
    expect(r.summary).toMatch(/YOU MAY ALSO CONSIDER/);
    expect(r.summary).toMatch(/Berth\/coach number koi provider nahi deta/);
  });
});

/* ── §9/§10 smart picker ────────────────────────────────────────────── */
describe("Round-18 §9/§10: SELECT TRAIN smart picker", () => {
  it("extractTrainQuery: numbers first; name phrase cleaned of filler words", () => {
    expect(extractTrainQuery("12014 ka status batao")).toEqual({ numbers: ["12014"], namePhrase: null });
    expect(extractTrainQuery("Amritsar Shatabdi ka time kya hai?").namePhrase).toBe("Amritsar Shatabdi");
    expect(extractTrainQuery("Shatabdi wali train dikhao").namePhrase).toBe("Shatabdi");
    expect(normalizeTrainName("Amritsar - New Delhi Shatabdi Express")).toBe("AMRITSAR NEW DELHI SHATABDI");
    expect(tokenMatches("SHATABDI", ["AMRITSAR", "SHTABDI"])).toBe(true);
    expect(tokenMatches("RAJDHANI", ["AMRITSAR", "SHTABDI"])).toBe(false);
  });
  it("exact number → single validated match with real route/times from schedule", async () => {
    railcoreMock(() => null);
    const pk = await pickTrains("12014");
    expect(pk.kind).toBe("number");
    expect(pk.single).toBe(true);
    expect(pk.matches[0]).toMatchObject({ number: "12014", name: "AMRITSAR SHATABDI", from: "FZR", to: "CSMT", departure: "06:00", arrival: "07:35", match: "exact_number" });
  });
  it("unknown number → no matches, honest note (no fake train)", async () => {
    railcoreMock(() => null);
    const pk = await pickTrains("99999");
    expect(pk.matches).toEqual([]);
    expect(pk.note).toMatch(/99999/);
  });
  it("name query → multiple real matches ranked (all-token matches first), sorted by number; ambiguity kept for user", async () => {
    railcoreMock(() => null);
    const pk = await pickTrains("Shatabdi wali train dikhao");
    expect(pk.kind).toBe("name");
    expect(pk.matches.length).toBeGreaterThanOrEqual(2);
    expect(pk.single).toBe(false);
    expect(pk.matches.map((m) => m.number)).toEqual(["12013", "12014", "12029"]);
    const amr = await pickTrains("Amritsar Shatabdi ka time kya hai?");
    expect(amr.matches[0]).toMatchObject({ number: "12014", match: "exact_name" });
  });
  it("tools: SEARCH_TRAIN_BY_NUMBER / SEARCH_TRAIN_BY_NAME are registered and grounded", async () => {
    const names = AGENTIC_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(["SEARCH_TRAIN_BY_NUMBER", "SEARCH_TRAIN_BY_NAME", "FIND_ALTERNATIVE_TRAINS"]));
    railcoreMock(() => null);
    const byNo = await executeApprovedTool("SEARCH_TRAIN_BY_NUMBER", { train_number: "12014" });
    expect(byNo.ok).toBe(true);
    expect(byNo.summary).toMatch(/12014 · AMRITSAR SHATABDI \(FZR → CSMT/);
    const byName = await executeApprovedTool("SEARCH_TRAIN_BY_NAME", { query: "Shatabdi" });
    expect(byName.ok).toBe(true);
    expect(byName.summary).toMatch(/AMBIGUOUS — app SELECT TRAIN list dikhata hai/);
  });
  it("GET /api/trains/pick works; short query → empty", async () => {
    railcoreMock(() => null);
    const app = createApp();
    const r = await request(app).get("/api/trains/pick?q=12014");
    expect(r.status).toBe(200);
    expect(r.body.matches[0].number).toBe("12014");
    const short = await request(app).get("/api/trains/pick?q=12");
    expect(short.body.matches).toEqual([]);
  });
});

/* ── §5 proactive + HTTP wiring + §16 ──────────────────────────────── */
describe("Round-18 §5/§16: proactive alternatives via /api/agent, endpoints, no auto-booking", () => {
  it("SEARCH_TRAINS → server attaches deterministic journey plan (BEST + others) without user asking", async () => {
    railcoreMock((train, _f, _t, cls) => (cls === "SL" ? { status: "AVAILABLE", count: train === "12138" ? 30 : 5 } : null));
    process.env.NVIDIA_API_KEY = "nvapi-test";
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const msg =
        call === 1
          ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "SEARCH_TRAINS", arguments: JSON.stringify({ origin: "LDH", destination: "CSMT", date: FUTURE }) } }] }
          : { role: "assistant", content: "2 trains: 12138 Punjab Mail 06:00→07:35 (+1d), 12904 Golden Temple Mail 12:00→18:00 (+1d)." };
      return jsonResponse(200, { choices: [{ message: msg, finish_reason: call === 1 ? "tool_calls" : "stop" }], model: "test" });
    });
    const app = createApp();
    const r = await request(app).post("/api/agent").send({ text: `LDH se CSMT ${FUTURE} ki trains, 2 logon ke liye`, now: new Date().toISOString() });
    expect(r.status).toBe(200);
    expect(r.body.toolTrace?.[0]?.tool).toBe("SEARCH_TRAINS");
    expect(r.body.journey?.best?.trainNumbers).toEqual(["12138"]);
    expect(r.body.journey?.routeOptions?.length).toBe(2);
    expect(r.body.journey?.provenance?.travelDate).toBe(FUTURE);
    expect(r.body.confirmBook).toBe(false);
  });
  it("CHECK_AVAILABILITY WL → server auto-attaches alternatives (real) to the response", async () => {
    railcoreMock((train, _f, _t, cls) => (train === "12138" && cls === "SL" ? { status: "WAITLIST", wl: 18 } : train === "12904" && cls === "SL" ? { status: "AVAILABLE", count: 44 } : null));
    process.env.NVIDIA_API_KEY = "nvapi-test";
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const msg =
        call === 1
          ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "CHECK_AVAILABILITY", arguments: JSON.stringify({ train_number: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, class_code: "SL" }) } }] }
          : { role: "assistant", content: "12138 SL WL18. Is train mein availability kam hai — YOU MAY ALSO CONSIDER: 12904 SL AVL 44." };
      return jsonResponse(200, { choices: [{ message: msg, finish_reason: call === 1 ? "tool_calls" : "stop" }], model: "test" });
    });
    const app = createApp();
    const r = await request(app).post("/api/agent").send({ text: `12138 mein SL ${FUTURE} ko LDH se CSMT seat hai?`, now: new Date().toISOString() });
    expect(r.status).toBe(200);
    expect(r.body.alternatives?.reason).toBe("waitlist");
    expect(r.body.alternatives?.alternatives?.[0]?.trainNumbers).toEqual(["12904"]);
    expect(r.body.toolTrace?.[0]?.summary).toMatch(/YOU MAY ALSO CONSIDER: 12904 GOLDEN TEMPLE MAIL .* \(SL AVL 44/);
    expect(r.body.toolTrace?.[0]?.summary).not.toMatch(/Reply mein|app cards/);
  });
  it("SEARCH_TRAIN_BY_NAME via agent → trainPicker in response", async () => {
    railcoreMock(() => null);
    process.env.NVIDIA_API_KEY = "nvapi-test";
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const msg =
        call === 1
          ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "SEARCH_TRAIN_BY_NAME", arguments: JSON.stringify({ query: "Shatabdi" }) } }] }
          : { role: "assistant", content: "3 Shatabdi trains mili — neeche se select karo." };
      return jsonResponse(200, { choices: [{ message: msg, finish_reason: call === 1 ? "tool_calls" : "stop" }], model: "test" });
    });
    const app = createApp();
    const r = await request(app).post("/api/agent").send({ text: "Shatabdi wali train dikhao", now: new Date().toISOString() });
    expect(r.body.trainPicker?.matches?.length).toBe(3);
  });
  it("POST /api/journey/alternatives + GET /api/capabilities", async () => {
    railcoreMock((train, _f, _t, cls) => (train === "12138" && cls === "SL" ? { status: "WAITLIST", wl: 2 } : train === "12904" && cls === "SL" ? { status: "AVAILABLE", count: 9 } : null));
    const app = createApp();
    const a = await request(app).post("/api/journey/alternatives").send({ trainNumber: "12138", from: "LDH", to: "CSMT", date: FUTURE, travelClass: "SL" });
    expect(a.status).toBe(200);
    expect(a.body.reason).toBe("waitlist");
    expect(a.body.alternatives[0].trainNumbers).toEqual(["12904"]);
    const c = await request(app).get("/api/capabilities");
    expect(c.status).toBe(200);
    expect(c.body.matrix.RELIABILITY_SCORE.available).toBe(false);
    expect(c.body.matrix.SEARCH_TRAINS.providers).toContain("railcore");
  });
});

describe("Round-18f picker dedupe", () => {
  it("one card per train number even if provider list has spelling/case variants", async () => {
    const { pickTrains } = await import("../server/journey/trainpicker.js");
    const { setScrapeFetch } = await import("../server/railway/webscrape.js");
    const list = JSON.stringify(["12014 - Amritsar Shtabdi", "12014 - AMRITSAR SHTABDI", "12013 - AMRITSAR SHTABDI"]);
    setScrapeFetch((async (url: string) => (String(url).includes("IRTrains") ? new Response(list, { status: 200 }) : new Response("", { status: 503 }))) as unknown as typeof fetch);
    const r = await pickTrains("Amritsar Shatabdi", { enrich: false });
    const nums = r.matches.map((m) => m.number);
    expect(new Set(nums).size).toBe(nums.length);
    expect(nums).toContain("12014");
  }, 30_000);
});
