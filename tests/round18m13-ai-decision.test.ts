/* Round-18m-13 — AI (LLM) decides the journey plan; engine only fetches data.
 * Grounding: candidate ids only, WL/unchecked never "seat hai", ₹ only real fares,
 * a faster direct train with STALE AVL must be surfaced as "verify first". */
import { describe, it, expect } from "vitest";
import { buildCandidates, candidateSheet, rulesDecision } from "../server/journey/decide.js";
import type { JourneyPlan, RouteAvailability, RouteOption } from "../server/journey/types.js";

const row = (classCode: string, status: string, seats: number | null, fare: number, stale = false): RouteAvailability => ({ classCode, status, seats, rac: status === "RAC" ? 4 : null, waitlist: status === "WAITLIST" ? 20 : null, fare, source: "test", ...(stale ? { stale: true } : {}) });
const opt = (n: string, dur: number, rows: RouteAvailability[], probed = true): RouteOption => ({ rank: 0, category: "direct", badges: [], trainNumbers: [n], trainNames: [`T${n}`], origin: "LDH", destination: "SRE", departure: "10:00", arrival: "14:00", arrivalDayOffset: 0, durationMinutes: dur, durationLabel: `${dur}m`, changes: 0, legs: [], layoverMinutes: null, classes: [], availability: rows[0] ?? null, classOptions: rows, probed, reliability: null, source: "test", why: "" });

const plan = (): JourneyPlan => ({
  query: { from: "LDH", to: "SRE", date: "2030-01-13", travelClass: null, preference: "best_overall", passengers: 1 },
  best: null,
  routeOptions: [opt("14624", 208, [row("3A", "AVAILABLE", 11, 520, true), row("SL", "AVAILABLE", 8, 150, true)]), opt("13308", 235, [row("3A", "WAITLIST", null, 520)]), opt("12904", 185, [row("SL", "WAITLIST", null, 180)]), opt("04566", 260, [], false)],
  connections: [],
  alternativeDates: [],
  directUnavailable: false,
  directStaleAvailable: true,
  recovery: { reason: "", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], alternateStations: [], boardFromEarlier: [{ trainNumber: "13308", trainName: "T13308", bookFrom: "PHR", bookFromName: "Phillaur", bookFromDeparture: "19:00", boardAt: "LDH", boardAtName: "Ludhiana", boardAtDeparture: "19:55", destination: "SRE", destinationName: "Saharanpur", arrival: "23:50", arrivalDayOffset: 0, availability: row("1A", "AVAILABLE", 11, 1190), classOptions: [row("1A", "AVAILABLE", 11, 1190), row("3A", "RAC", null, 520)], durationMinutes: 235, directStatus: "WAITLIST", stopsBefore: 1, source: "test" }] },
  sources: ["test"],
  notes: [],
  summary: null,
  whyPoints: ["rules point one", "rules point two", "rules point three"],
});

describe("Round-18m-13: AI decision layer (engine = data, AI = decision)", () => {
  it("builds grounded candidates with stable ids and seat tiers", () => {
    const c = buildCandidates(plan());
    const ids = c.map((x) => `${x.id}[${x.seatTier}]`);
    expect(ids).toContain("D:14624[stale]");
    expect(ids).toContain("D:13308[none]");
    expect(ids).toContain("D:04566[none]"); // unprobed → none, never "seat"
    expect(ids).toContain("B:13308:PHR[fresh]");
  });

  it("candidate sheet tells the model every class row incl. STALE + NOT CHECKED", () => {
    const p = plan();
    const sheet = candidateSheet(p, buildCandidates(p));
    expect(sheet).toMatch(/D:14624 .*3A AVL 11 ₹520 \(STALE 24h\+ cache\)/);
    expect(sheet).toMatch(/D:04566 .*NOT CHECKED/);
    expect(sheet).toMatch(/B:13308:PHR \| SAME TRAIN, ticket from PHR/);
  });

  it("rules fallback prefers FRESH over STALE, then direct over bfe, then speed", () => {
    const p = plan();
    const d = rulesDecision(p, buildCandidates(p));
    expect(d.source).toBe("rules");
    expect(d.recommendedId).toBe("B:13308:PHR");
    expect(d.ranking[1]).toBe("D:14624"); // stale-but-fast direct next
  });

  it("decideJourney under VITEST returns rules decision (no network) and never throws", async () => {
    const { decideJourney } = await import("../server/journey/decide.js");
    const d = await decideJourney(plan());
    expect(d.source).toBe("rules");
    expect(d.candidates.length).toBe(5);
  });
});
