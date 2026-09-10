/* ══ ROUND-17 (2026-09-10) — Journey intelligence (RailBook Atlas) ══
 * F1 deterministic ranking, F2 recovery, F3 vacant seats (honest: no berth
 * level), F4/F5 partial-route + same-train switch (provider-proven only),
 * F6 connections (configurable buffer), F7 planner tools + date guard,
 * F8 grounded: never fabricate. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { setRailcoreFetch } from "../server/railway/railcore";
import { clearScheduleCache, resetFallbackProvider } from "../server/railway/router";
import { setProvider } from "../server/providers/index";
import { setScrapeFetch } from "../server/railway/webscrape";
import {
  JOURNEY_CONFIG,
  evaluateConnection,
  findPartialRouteSeats,
  findVacantSeats,
  planJourney,
  rankRouteOptions,
} from "../server/journey/engine";
import type { RouteLeg } from "../server/journey/types";
import { executeApprovedTool, AGENTIC_TOOLS, setAgenticNvidiaFetch } from "../server/agent/agentic";
import type { TrainResult } from "../server/providers/types";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const FUTURE = (() => {
  const d = new Date(Date.now() + 5 * 86400000);
  return d.toISOString().slice(0, 10);
})();

function train(p: Partial<TrainResult> & { number: string }): TrainResult {
  return {
    number: p.number,
    name: p.name ?? `TRAIN ${p.number}`,
    type: "Superfast",
    from: { code: "LDH", name: "Ludhiana Jn" },
    to: { code: "NDLS", name: "New Delhi" },
    date: FUTURE,
    departure: p.departure ?? "07:00",
    arrival: p.arrival ?? "11:00",
    arrivalDayOffset: p.arrivalDayOffset ?? 0,
    durationMinutes: p.durationMinutes ?? 240,
    durationLabel: p.durationLabel ?? "4h",
    runsOn: [0, 1, 2, 3, 4, 5, 6],
    classes: p.classes ?? [],
  } as TrainResult;
}

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
  setScrapeFetch(async () => new Response("", { status: 404 }));
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  setProvider(null);
  resetFallbackProvider();
  clearScheduleCache();
});

/* ── F1: deterministic ranking ───────────────────────────────────────── */
describe("Round-17 F1: rankRouteOptions is deterministic & honest", () => {
  const trains = [
    train({ number: "12014", departure: "07:02", arrival: "11:02", durationMinutes: 240, classes: [{ code: "CC", label: "Chair Car", status: "UNKNOWN", fare: 0 }] as never }),
    train({ number: "22478", departure: "10:32", arrival: "14:00", durationMinutes: 208 }),
    train({ number: "12030", departure: "18:55", arrival: "22:50", durationMinutes: 235 }),
  ];
  const availability = new Map([
    ["12014", { classCode: "CC", status: "AVAILABLE", seats: 83, rac: null, waitlist: null, fare: 705, source: "railcore" }],
    ["22478", { classCode: "CC", status: "WAITLIST", seats: null, rac: null, waitlist: 12, fare: 1200, source: "railcore" }],
    ["12030", { classCode: "CC", status: "AVAILABLE", seats: 65, rac: null, waitlist: null, fare: 690, source: "railcore" }],
  ]);

  it("same input → identical output (reproducible), ties by train number", () => {
    const a = rankRouteOptions({ origin: "LDH", destination: "NDLS", trains, availability, source: "railcore" });
    const b = rankRouteOptions({ origin: "LDH", destination: "NDLS", trains: [...trains].reverse(), availability, source: "railcore" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.map((o) => o.rank)).toEqual([1, 2, 3]);
  });

  it("badges: fastest=22478, cheapest=12030, best_availability=12014; reliability is null (no provider)", () => {
    const r = rankRouteOptions({ origin: "LDH", destination: "NDLS", trains, availability, source: "railcore" });
    const by = (n: string) => r.find((o) => o.trainNumbers[0] === n)!;
    expect(by("22478").badges).toContain("fastest");
    expect(by("12030").badges).toContain("cheapest");
    expect(by("12014").badges).toContain("best_availability");
    expect(r.every((o) => o.reliability === null)).toBe(true);
    expect(r.every((o) => o.changes === 0 && o.legs.length === 1)).toBe(true);
  });

  it("best_overall prefers an AVAILABLE train over a WL faster one", () => {
    const r = rankRouteOptions({ origin: "LDH", destination: "NDLS", trains, availability, source: "railcore" });
    expect(r[0].badges).toContain("best_overall");
    expect(r[0].availability?.status).toBe("AVAILABLE");
  });

  it("no availability data → availability null (never invented)", () => {
    const r = rankRouteOptions({ origin: "LDH", destination: "NDLS", trains, source: "railcore" });
    expect(r.every((o) => o.availability === null)).toBe(true);
    expect(r[0].trainNumbers[0]).toBe("22478"); // fastest wins when nothing else is known
  });
});

/* ── F6: connections ─────────────────────────────────────────────────── */
describe("Round-17 F6: evaluateConnection — layover = depB − arrA, configurable buffer", () => {
  const legA: RouteLeg = { trainNumber: "12446", trainName: "A", from: "LDH", to: "NDLS", departure: "02:10", arrival: "06:55", arrivalDayOffset: 0, durationMinutes: 285 };
  const legB = (dep: string): RouteLeg => ({ trainNumber: "20504", trainName: "B", from: "NDLS", to: "LKO", departure: dep, arrival: "18:40", arrivalDayOffset: 0, durationMinutes: 435 });

  it("valid connection: 06:55 → 11:25 = 270 min", () => {
    const c = evaluateConnection(legA, legB("11:25"), "NDLS");
    expect(c).toMatchObject({ station: "NDLS", arrivalTrain: "12446", departureTrain: "20504", layoverMinutes: 270, valid: true });
    expect(c.totalDurationMinutes).toBe(285 + 270 + 435);
  });
  it("rejects layover below buffer (default 30) and negative layover", () => {
    expect(evaluateConnection(legA, legB("07:10"), "NDLS")).toMatchObject({ layoverMinutes: 15, valid: false });
    expect(evaluateConnection(legA, legB("06:00"), "NDLS").valid).toBe(false);
  });
  it("buffer is configurable per call", () => {
    expect(evaluateConnection(legA, legB("07:10"), "NDLS", { minTransferMinutes: 10 }).valid).toBe(true);
    expect(evaluateConnection(legA, legB("11:25"), "NDLS", { maxLayoverMinutes: 120 }).valid).toBe(false);
    expect(JOURNEY_CONFIG.minTransferMinutes).toBeGreaterThan(0);
  });
  it("+1d arrival on leg A → same-day departure of B is invalid", () => {
    const c = evaluateConnection({ ...legA, arrivalDayOffset: 1 }, legB("11:25"), "NDLS");
    expect(c.valid).toBe(false);
  });
});

/* ── Provider mock (RailCore shapes) for vacant/partial/plan ───────────── */
type AvailRule = (from: string, to: string, cls: string) => { status: string; count?: number; wl?: number } | null;
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
            { train_number: "12904", train_name: "GOLDEN TEMPLE", departure_time: "12:00", arrival_time: "18:00", duration_minutes: 1800, classes: ["SL", "3A"], running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] },
          ],
        },
      });
    }
    if (p.endsWith("/schedule")) {
      const num = (p.match(/\/trains\/(\d+)\/schedule/) || [])[1];
      return jsonResponse(200, {
        success: true,
        data: {
          train_number: num,
          train_name: num === "12138" ? "PUNJAB MAIL" : "GOLDEN TEMPLE",
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
    if (p.endsWith("/availability/seats")) {
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      const cls = url.searchParams.get("class")!;
      const r = rule(from, to, cls);
      if (!r) return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "no data" } });
      const text = r.status === "AVAILABLE" ? `AVAILABLE-${String(r.count ?? 0).padStart(4, "0")}` : r.status === "WAITLIST" ? `GNWL${r.wl}/WL${r.wl}` : r.status;
      return jsonResponse(200, { success: true, data: { train_number: "12138", journey_date: FUTURE, quota: "GN", classes: [{ class_code: cls, status: r.status, availability_text: text, available_count: r.count, total_fare: cls === "SL" ? 500 : 1300 }] } });
    }
    return jsonResponse(404, { success: false, error: { code: "NOT_FOUND" } });
  });
}

/* ── F3: vacant seats ────────────────────────────────────────────────── */
describe("Round-17 F3: FIND_VACANT_SEATS — class-level real, berth-level honestly unavailable", () => {
  it("returns provider class rows, berths:null, capability.berthLevel=false", async () => {
    railcoreMock((_f, _t, cls) => (cls === "SL" ? { status: "AVAILABLE", count: 42 } : cls === "3A" ? { status: "WAITLIST", wl: 9 } : null));
    const v = await findVacantSeats({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, hintClasses: ["SL", "3A", "2A"] });
    expect(v.rows.map((r) => [r.classCode, r.status, r.seats, r.waitlist])).toEqual([
      ["SL", "AVAILABLE", 42, null],
      ["3A", "WAITLIST", null, 9],
    ]);
    expect(v.rows.every((r) => r.berths === null)).toBe(true);
    expect(v.capability).toMatchObject({ classLevel: true, berthLevel: false, postChart: false });
    expect(v.capability.note).toMatch(/berth/i);
  });
  it("provider gives nothing → rows empty, classLevel=false (no invention)", async () => {
    railcoreMock(() => null);
    const v = await findVacantSeats({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, hintClasses: ["SL"] });
    expect(v.rows).toEqual([]);
    expect(v.capability.classLevel).toBe(false);
  });
});

/* ── F4/F5: partial route + same-train switch ────────────────────────── */
describe("Round-17 F4/F5: partial-route seats & same-train switch (provider-proven only)", () => {
  it("direct WL, LDH→BPL AVL + BPL→CSMT AVL → verified split plan, berth null", async () => {
    railcoreMock((f, t, cls) => {
      if (cls !== "SL") return null;
      if (f === "LDH" && t === "CSMT") return { status: "WAITLIST", wl: 24 };
      if (f === "LDH" && t === "BPL") return { status: "AVAILABLE", count: 32 };
      if (f === "BPL" && t === "CSMT") return { status: "AVAILABLE", count: 5 };
      if (f === "LDH" && t === "NDLS") return { status: "AVAILABLE", count: 90 };
      if (f === "NDLS" && t === "CSMT") return { status: "WAITLIST", wl: 40 };
      return null;
    });
    const pr = await findPartialRouteSeats({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, classCode: "SL" });
    expect(pr.verification).toMatchObject({ stationSequenceValid: true, classValid: true, dateValid: true, trainRunsOnDate: true });
    expect(pr.direct).toMatchObject({ status: "WAITLIST", waitlist: 24, berth: null });
    const ok = pr.plans.filter((p) => p.fullyAvailable);
    expect(ok).toHaveLength(1);
    expect(ok[0].switchStation).toBe("BPL");
    expect(ok[0].segments.map((s) => `${s.from}→${s.to} ${s.status} ${s.seats}`)).toEqual(["LDH→BPL AVAILABLE 32", "BPL→CSMT AVAILABLE 5"]);
    expect(ok[0].segments.every((s) => s.berth === null)).toBe(true);
    expect(ok[0].note).toMatch(/berth number chart ke baad/);
    /* Same-train switch: LDH→NDLS AVL but NDLS→CSMT WL → NOT a switch; BPL plan is full → no switch reported separately. */
    expect(pr.sameTrainSwitch === null || pr.sameTrainSwitch.afterStation === "BPL").toBe(true);
  });

  it("same-train switch: seat available only AFTER NDLS (LDH→NDLS WL, NDLS→CSMT AVL)", async () => {
    railcoreMock((f, t, cls) => {
      if (cls !== "SL") return null;
      if (f === "LDH" && t === "CSMT") return { status: "WAITLIST", wl: 30 };
      if (f === "LDH" && t === "NDLS") return { status: "WAITLIST", wl: 12 };
      if (f === "NDLS" && t === "CSMT") return { status: "AVAILABLE", count: 18 };
      return { status: "WAITLIST", wl: 50 };
    });
    const pr = await findPartialRouteSeats({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, classCode: "SL" });
    expect(pr.plans.filter((p) => p.fullyAvailable)).toHaveLength(0);
    expect(pr.sameTrainSwitch).toMatchObject({ afterStation: "NDLS", segment: { from: "NDLS", to: "CSMT", status: "AVAILABLE", seats: 18, berth: null } });
  });

  it("rejects invalid station order / class not on train / past date — no probes made", async () => {
    const calls: string[] = [];
    railcoreMock(() => ({ status: "AVAILABLE", count: 99 }), calls);
    const rev = await findPartialRouteSeats({ trainNumber: "12138", origin: "CSMT", destination: "LDH", date: FUTURE, classCode: "SL" });
    expect(rev.verification.stationSequenceValid).toBe(false);
    expect(rev.plans).toEqual([]);
    const cls = await findPartialRouteSeats({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, classCode: "CC" });
    expect(cls.verification.classValid).toBe(false);
    const past = await findPartialRouteSeats({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: "2020-01-01", classCode: "SL" });
    expect(past.verification.dateValid).toBe(false);
    expect(calls.filter((c) => c.includes("/availability/seats"))).toHaveLength(0);
  });

  it("direct AVAILABLE → no split needed, no extra probes", async () => {
    const calls: string[] = [];
    railcoreMock(() => ({ status: "AVAILABLE", count: 10 }), calls);
    const pr = await findPartialRouteSeats({ trainNumber: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, classCode: "SL" });
    expect(pr.direct?.status).toBe("AVAILABLE");
    expect(pr.plans).toEqual([]);
    expect(calls.filter((c) => c.includes("/availability/seats"))).toHaveLength(1);
  });
});

/* ── F2: plan + recovery ─────────────────────────────────────────────── */
describe("Round-17 F2: planJourney recovery when direct unavailable", () => {
  it("all direct WL → directUnavailable + recovery (date NOT changed, alt dates only suggested)", async () => {
    railcoreMock((f, t) => (f === "BPL" && t === "CSMT" ? { status: "AVAILABLE", count: 7 } : f === "LDH" && t === "BPL" ? { status: "AVAILABLE", count: 3 } : { status: "WAITLIST", wl: 20 }));
    const plan = await planJourney({ from: "LDH", to: "CSMT", date: FUTURE, travelClass: "SL", preference: "best_overall", includeConnections: false, includeAlternativeDates: true });
    expect(plan.query.date).toBe(FUTURE);
    expect(plan.routeOptions.length).toBe(2);
    expect(plan.directUnavailable).toBe(true);
    expect(plan.recovery).not.toBeNull();
    expect(plan.recovery!.differentTrain).toEqual([]);
    expect(plan.recovery!.partialRoute?.plans.some((p) => p.fullyAvailable && p.switchStation === "BPL")).toBe(true);
    expect(plan.alternativeDates.every((d) => d.date !== FUTURE)).toBe(true);
    expect(plan.best?.reliability).toBeNull();
  });
  it("AVAILABLE direct → no recovery block", async () => {
    railcoreMock(() => ({ status: "AVAILABLE", count: 40 }));
    const plan = await planJourney({ from: "LDH", to: "CSMT", date: FUTURE, travelClass: "SL", preference: "fastest", includeConnections: false, includeAlternativeDates: false });
    expect(plan.directUnavailable).toBe(false);
    expect(plan.recovery).toBeNull();
    expect(plan.best?.trainNumbers).toEqual(["12138"]);
    expect(plan.best?.badges).toContain("fastest");
  });
});

/* ── F7: planner tools + HTTP ────────────────────────────────────────── */
describe("Round-17 F7: tools registered, honest tool summaries, HTTP endpoints", () => {
  it("new tools are in the allowlist", () => {
    for (const t of ["RANK_JOURNEY_OPTIONS", "FIND_VACANT_SEATS", "FIND_PARTIAL_ROUTE_SEATS", "FIND_CONNECTIONS"]) expect(AGENTIC_TOOLS.map((x) => x.function.name)).toContain(t);
  });
  it("FIND_VACANT_SEATS tool summary tells the model berth-level data is not available", async () => {
    railcoreMock((_f, _t, cls) => (cls === "SL" ? { status: "AVAILABLE", count: 12 } : null));
    const r = await executeApprovedTool("FIND_VACANT_SEATS", { train_number: "12138", origin: "LDH", destination: "CSMT", date: FUTURE, travel_class: "SL" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/SL AVAILABLE 12/);
    expect(r.summary).toMatch(/Berth-level .* provider nahi deta/);
  });
  it("RANK_JOURNEY_OPTIONS 'reliable' → summary says reliability data unavailable", async () => {
    railcoreMock(() => ({ status: "AVAILABLE", count: 40 }));
    const r = await executeApprovedTool("RANK_JOURNEY_OPTIONS", { origin: "LDH", destination: "CSMT", date: FUTURE, preference: "reliable", travel_class: "SL" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/BEST: #1 12138/);
    expect(r.summary).toMatch(/Reliability\/punctuality data koi provider nahi deta/);
  });
  it("POST /api/journey/plan + /vacant + /partial + /connections validate & respond", async () => {
    railcoreMock(() => ({ status: "AVAILABLE", count: 40 }));
    const app = createApp();
    const plan = await request(app).post("/api/journey/plan").send({ from: "LDH", to: "CSMT", date: FUTURE, travelClass: "SL", includeConnections: false, includeAlternativeDates: false });
    expect(plan.status).toBe(200);
    expect(plan.body.best.trainNumbers).toEqual(["12138"]);
    const vac = await request(app).post("/api/journey/vacant").send({ trainNumber: "12138", from: "LDH", to: "CSMT", date: FUTURE, travelClass: "SL" });
    expect(vac.status).toBe(200);
    expect(vac.body.capability.berthLevel).toBe(false);
    const part = await request(app).post("/api/journey/partial").send({ trainNumber: "12138", from: "LDH", to: "CSMT", date: FUTURE, travelClass: "SL" });
    expect(part.status).toBe(200);
    expect(part.body.verification.stationSequenceValid).toBe(true);
    const bad = await request(app).post("/api/journey/plan").send({ from: "LDH", to: "CSMT", date: "12-09-2026" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const conn = await request(app).post("/api/journey/connections").send({ from: "LDH", to: "CSMT", date: FUTURE, via: "NDLS" });
    expect(conn.status).toBe(200);
    expect(conn.body.minTransferMinutes).toBe(JOURNEY_CONFIG.minTransferMinutes);
  });
});

/* ── F9 wiring: /api/agent must forward `journey` plan to the UI ─────── */
describe("Round-17 F9: /api/agent returns journey plan for RANK_JOURNEY_OPTIONS", () => {
  afterEach(() => {
    setAgenticNvidiaFetch(null);
    process.env.NVIDIA_API_KEY = "";
  });
  it("journey (BEST OPTION card data) + trains table both present in HTTP response", async () => {
    railcoreMock(() => ({ status: "AVAILABLE", count: 40 }));
    process.env.NVIDIA_API_KEY = "nvapi-test";
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const msg =
        call === 1
          ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "RANK_JOURNEY_OPTIONS", arguments: JSON.stringify({ origin: "LDH", destination: "CSMT", date: FUTURE, preference: "best_overall", travel_class: "SL" }) } }] }
          : { role: "assistant", content: "Best: 12138 Punjab Mail 06:00 → 07:35 (+1d), SL AVAILABLE 40." };
      return jsonResponse(200, { choices: [{ message: msg, finish_reason: call === 1 ? "tool_calls" : "stop" }], model: "test" });
    });
    const app = createApp();
    const r = await request(app).post("/api/agent").send({ text: `LDH se CSMT ${FUTURE} ki best train SL mein`, now: new Date().toISOString() });
    expect(r.status).toBe(200);
    expect(r.body.toolTrace?.[0]?.tool).toBe("RANK_JOURNEY_OPTIONS");
    expect(r.body.journey?.best?.trainNumbers).toEqual(["12138"]);
    expect(r.body.journey?.query?.date).toBe(FUTURE);
    expect(r.body.trains?.rows?.length).toBe(2);
  });
});
