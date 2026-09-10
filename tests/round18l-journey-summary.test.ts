/** Round-18l — deterministic AI journey summary + Goa station cluster. */
import { describe, it, expect } from "vitest";
import { journeySummary, dayLabel, clusterSiblings } from "../server/journey/engine.js";
import { MULTI_STATION_CITIES } from "../server/railway/station-resolve.js";
import type { JourneyPlan, RouteOption, Connection } from "../server/journey/types.js";

const opt = (n: string, name: string, av: RouteOption["availability"], extra: Partial<RouteOption> = {}): RouteOption => ({
  rank: 1, category: "best_overall", badges: [], trainNumbers: [n], trainNames: [name], origin: "ASR", destination: "MAO",
  departure: "08:20", arrival: "11:30", arrivalDayOffset: 1, durationMinutes: 1630, durationLabel: "27h 10m", changes: 0, legs: [],
  layoverMinutes: null, classes: ["SL", "3A"], availability: av, reliability: null, source: "railradar", why: "", ...extra,
});
const base = (over: Partial<JourneyPlan>): JourneyPlan => ({
  query: { from: "ASR", to: "MAO", date: "2026-09-13", travelClass: "SL", preference: "best_overall" },
  best: null, routeOptions: [], connections: [], alternativeDates: [], directUnavailable: false, recovery: null, sources: [], notes: [], summary: null, ...over,
});

describe("Round-18l journeySummary", () => {
  it("AVAILABLE best → only the best-plan clause (no fallbacks needed)", () => {
    const best = opt("12484", "AMRITSAR KCVL EXP", { classCode: "SL", status: "AVAILABLE", seats: 42, waitlist: null, rac: null, fare: 830, source: "railradar" } as never);
    const s = journeySummary(base({ best, routeOptions: [best], alternativeDates: [{ date: "2026-09-15", count: 1, fastest: null }] }));
    expect(s).toBe("Best plan: 12484 AMRITSAR KCVL EXP 08:20→11:30, 27h 10m (SL 42 seats open).");
  });
  it("WL best → fallback connecting route + alternative date, all from plan data", () => {
    const best = opt("12484", "AMRITSAR KCVL EXP", { classCode: "SL", status: "WAITLIST", seats: null, waitlist: 18, rac: null, fare: 830, source: "railradar" } as never);
    const conn: Connection = { station: "NZM", stationName: "Hazrat Nizamuddin", arrivalTrain: "12030", departureTrain: "12780", arrivalAt: "13:00", departsAt: "15:05", arrivalDayOffset: 0, layoverMinutes: 125, valid: true, reason: null, totalDurationMinutes: 2400,
      legs: [{ trainNumber: "12030", trainName: "SWARNA SHATABDI", from: "ASR", to: "NZM", departure: "05:00", arrival: "13:00", arrivalDayOffset: 0, durationMinutes: 480 } as never, { trainNumber: "12780", trainName: "GOA EXP", from: "NZM", to: "MAO", departure: "15:05", arrival: "07:00", arrivalDayOffset: 2, durationMinutes: 1800 } as never], source: "railradar" };
    const s = journeySummary(base({ best, routeOptions: [best], directUnavailable: true,
      recovery: { reason: "WL", differentTrain: [], partialRoute: null, connecting: [conn], alternativeDates: [{ date: "2026-09-12", count: 0, fastest: null }, { date: "2026-09-15", count: 1, fastest: { number: "06904", durationMinutes: 6870 } }], alternateStations: [] } }));
    expect(s).toContain("Best plan: 12484 AMRITSAR KCVL EXP 08:20→11:30, 27h 10m (SL WL 18) — kisi option mein confirmed seat nahi");
    expect(s).toContain("If it slips, route via Hazrat Nizamuddin (12030→12780, layover 125 min).");
    /* Round-18m: seat proof nahi → "seat hai" nahi bolte, sirf trains run + unverified. */
    expect(s).toContain("Or shift to Tue 15 Sep — 1 train run, seat status unverified.");
    expect(s).not.toContain("Sat 12 Sep"); // 0-train dates never suggested
  });
  it("prefers a later alternative date over an earlier one", () => {
    const best = opt("12484", "X", { classCode: "SL", status: "WAITLIST", seats: null, waitlist: 3, rac: null, fare: 1, source: "railradar" } as never);
    const s = journeySummary(base({ best, routeOptions: [best], alternativeDates: [{ date: "2026-09-12", count: 5, fastest: null }, { date: "2026-09-15", count: 1, fastest: null }] }));
    expect(s).toContain("Or shift to Tue 15 Sep");
  });
  it("nothing retrieved → null (never invents)", () => {
    expect(journeySummary(base({}))).toBeNull();
  });
  it("dayLabel is UTC-stable", () => {
    expect(dayLabel("2026-09-13")).toBe("Sun 13 Sep");
  });
});

describe("Round-18l Goa is a multi-station region", () => {
  it("goa → MAO/VSG/THVM/KRMI cluster; siblings of MAO exclude itself", () => {
    expect(MULTI_STATION_CITIES.goa).toEqual(["MAO", "VSG", "THVM", "KRMI"]);
    expect(clusterSiblings("MAO")).toEqual(["VSG", "THVM", "KRMI"]);
  });
});
