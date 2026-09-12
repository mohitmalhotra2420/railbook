import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { enoughSeats } from "../server/journey/engine.js";

describe("Round-18m-9: passenger-aware seats + journey card v3", () => {
  it("enoughSeats: AVAILABLE rows must cover the passenger count; RAC = available for any pax (Round-18m-22)", () => {
    expect(enoughSeats({ status: "AVAILABLE", seats: 36 } as never, 2)).toBe(true);
    expect(enoughSeats({ status: "AVAILABLE", seats: 1 } as never, 2)).toBe(false);
    expect(enoughSeats({ status: "AVAILABLE", seats: null } as never, 4)).toBe(true);
    expect(enoughSeats({ status: "RAC", seats: 20 } as never, 2)).toBe(true);
    expect(enoughSeats({ status: "RAC", seats: 20 } as never, 3)).toBe(true); // Round-18m-22: RAC confirm ho jaati hai chart ke baad
    expect(enoughSeats({ status: "WAITLIST", seats: 5 } as never, 1)).toBe(false);
  });
  it("run.ts: passenger gate fires before search and resumes with the answer", () => {
    const run = readFileSync("server/agent/run.ts", "utf8");
    expect(run).toContain("passengerGateAsk(ctx, det, req.text");
    expect(run).toContain('resumeAsk: "passengers"');
    expect(run).toContain("passengers: ctx.paxProvided ? ctx.passengers : null");
    expect(run).toContain('req.lastAsked === "passengers"');
  });
  it("JourneyOptions v3: header pills, hero, why-list, sections, explore tabs", () => {
    const jo = readFileSync("src/components/JourneyOptions.tsx", "utf8");
    for (const c of ["jx-head", "jx-spill", "jx-hero", "jx-strip", "jx-classes", "jx-btn-primary", "jx-btn-dark", "jx-why-list", "jx-sec", "jx-tabs", "jx-foot"]) expect(jo).toContain(c);
    expect(jo).toContain("plan.whyPoints");
    expect(jo).toContain("AI ne ye plan kyun chuna");
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".jx-hero {");
    expect(css).toContain(".jx-why-list");
  });
});

import { buildLegPlans, recommendedOf, whyFactsSheet } from "../server/journey/engine.js";

describe("Round-18m-10: leg-wise joint planning + grounded AI why", () => {
  const leg = (n: string, from: string, to: string, dep: string, arr: string, av: { classCode: string; status: string; seats: number | null } | null) =>
    ({ trainNumber: n, trainName: `T${n}`, from, to, departure: dep, arrival: arr, arrivalDayOffset: 0, durationMinutes: 300, availability: av ? { ...av, rac: null, waitlist: null, fare: 500, source: "railcore" } : null, classOptions: [] }) as never;
  const conn = (a: never, b: never, hub = "NDLS") => ({ station: hub, stationName: "New Delhi", arrivalTrain: (a as { trainNumber: string }).trainNumber, departureTrain: (b as { trainNumber: string }).trainNumber, arrivalAt: "10:00", departsAt: "12:00", arrivalDayOffset: 0, layoverMinutes: 120, valid: true, reason: null, totalDurationMinutes: 720, legs: [a, b], source: "railcore" }) as never;
  it("buildLegPlans: groups by hub, lists EVERY seat-proven train on each leg, picks joint best", () => {
    const a1 = leg("11111", "LDH", "NDLS", "06:00", "10:00", { classCode: "3A", status: "AVAILABLE", seats: 10 });
    const a2 = leg("22222", "LDH", "NDLS", "07:00", "11:00", { classCode: "SL", status: "WAITLIST", seats: null });
    const b1 = leg("33333", "NDLS", "LKO", "12:00", "20:00", { classCode: "2A", status: "AVAILABLE", seats: 4 });
    const b2 = leg("44444", "NDLS", "LKO", "13:00", "21:00", { classCode: "3A", status: "AVAILABLE", seats: 1 });
    const plans = buildLegPlans([conn(a1, b1), conn(a1, b2), conn(a2, b1), conn(a2, b2)], 2);
    expect(plans).toHaveLength(1);
    expect(plans[0].hub).toBe("NDLS");
    expect(plans[0].leg1.map((l) => l.trainNumber)).toEqual(["11111"]); // WL train excluded
    expect(plans[0].leg2.map((l) => l.trainNumber)).toEqual(["33333"]); // AVL 1 < 2 pax excluded
    expect(plans[0].checkedLeg1).toBe(2);
    expect(plans[0].checkedLeg2).toBe(2);
    expect(plans[0].best?.legs.map((l) => l.trainNumber)).toEqual(["11111", "33333"]);
  });
  it("facts sheet marks rejected direct trains and the recommended plan explicitly", () => {
    const plan = {
      query: { from: "LDH", to: "LKO", date: "2026-09-14", travelClass: null, preference: "best_overall", passengers: 2 },
      best: null, routeOptions: [{ rank: 1, category: "direct", badges: [], trainNumbers: ["13042"], trainNames: ["HIMGIRI"], origin: "LDH", destination: "LKO", departure: "03:30", arrival: "15:20", arrivalDayOffset: 0, durationMinutes: 710, durationLabel: "11h 50m", changes: 0, legs: [], layoverMinutes: null, classes: [], availability: { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 32, fare: 410, source: "railcore" }, reliability: null, source: "railcore", why: "" }],
      connections: [], alternativeDates: [], directUnavailable: true,
      recovery: { reason: "", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], alternateStations: [], boardFromEarlier: [{ trainNumber: "13308", trainName: "GANGASATLUJ", bookFrom: "PHR", bookFromName: null, bookFromDeparture: "19:00", boardAt: "LDH", boardAtName: null, boardAtDeparture: "19:55", destination: "LKO", destinationName: null, arrival: "10:35", arrivalDayOffset: 1, availability: { classCode: "2A", status: "AVAILABLE", seats: 36, rac: null, waitlist: null, fare: 1545, source: "web_railyatri" }, classOptions: [], durationMinutes: 880, stopsBefore: 1 }] },
      sources: [], notes: [], summary: null,
    } as never;
    expect(recommendedOf(plan).kind).toBe("bfe");
    const facts = whyFactsSheet(plan);
    expect(facts).toContain("RECOMMENDED PLAN: book-from-earlier — 13308");
    expect(facts).toContain("REJECTED");
    expect(facts).toMatch(/COMPARISON: fastest direct is 13042/);
    expect(facts).toMatch(/2h 50m longer/);
  });
  it("UI: leg-wise connecting section + AI-written tag wired", () => {
    const jo = readFileSync("src/components/JourneyOptions.tsx", "utf8");
    expect(jo).toContain("function LegPlanCard");
    expect(jo).toContain("Leg 1 ·");
    expect(jo).toContain("Leg 2 ·");
    expect(jo).toContain("AI ka joint best combo");
    expect(jo).toContain('plan.whySource === "ai"');
  });
});
