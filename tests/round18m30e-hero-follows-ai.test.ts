/* Round-18m-30e (user screenshot ASR→BSB): AI ka faisla "via NDLS 11058+22582, 3E AVL 29" tha, lekin
 * hero card "AI RECOMMENDED · DIRECT 12358 SL WL 74" dikha raha tha. Wajah: connecting route legPlans
 * (expand) se aaya tha, routeOptions mein nahi → applyDecision ne best = WL direct chhod diya.
 * Rule: jo AI ne chuna wahi plan.best / routeOptions[0] — direct WL kabhi "recommended" nahi jab AI ne
 * connecting chuna ho. */
import { describe, expect, it } from "vitest";
import { buildCandidates, validateDecision } from "../server/journey/decide.js";
import { finalizeAiDecision } from "../server/journey/engine.js";
import type { JourneyPlan } from "../server/journey/types.js";

const avl = (cls: string, seats: number, fare: number) => ({ classCode: cls, status: "AVAILABLE", seats, rac: null, waitlist: null, fare, source: "railcore", stale: false }) as never;
const wl = (cls: string, n: number) => ({ classCode: cls, status: "WAITLIST", waitlist: n, seats: null, rac: null, fare: 590, source: "railcore", stale: false }) as never;

function plan(): JourneyPlan {
  const direct = { rank: 1, category: "fastest", trainNumbers: ["12358"], trainNames: ["DURGIANA EXP"], origin: "ASR", destination: "BSB", departure: "05:55", arrival: "00:40", arrivalDayOffset: 1, durationMinutes: 1125, durationLabel: "18h 45m", changes: 0, classes: ["SL", "3A"], badges: ["best_overall"], availability: wl("SL", 74), classOptions: [wl("SL", 74), wl("3A", 17)], legs: [], layoverMinutes: null, reliability: null, source: "railcore", why: "" } as never;
  const leg = (tn: string, name: string, from: string, to: string, dep: string, arr: string, a: unknown) => ({ trainNumber: tn, trainName: name, from, fromName: from, to, toName: to, departure: dep, arrival: arr, durationMinutes: 600, classes: ["3E"], availability: a, classOptions: [a] }) as never;
  const conn = { station: "NDLS", stationName: "New Delhi", legs: [leg("11058", "ASR CSMT EXP", "ASR", "NDLS", "06:00", "16:00", avl("3E", 29, 800)), leg("22582", "NDLS MUV SF", "NDLS", "BSB", "18:30", "07:50", avl("3E", 40, 1000))], layoverMinutes: 150, totalDurationMinutes: 1550, arrivalDayOffset: 1, valid: true, source: "railcore" } as never;
  return {
    query: { from: "ASR", to: "BSB", date: "2026-09-14", travelClass: null, passengers: 2 },
    routeOptions: [direct],
    best: direct,
    connections: [conn],
    legPlans: [{ hub: "NDLS", hubName: "New Delhi", leg1: [conn.legs[0]], leg2: [conn.legs[1]], leg1All: [conn.legs[0]], leg2All: [conn.legs[1]], checkedLeg1: 8, checkedLeg2: 3, best: conn }],
    directUnavailable: true,
    notes: [],
    sources: ["railcore"],
    alternativeDates: [],
    recovery: null,
  } as never;
}

describe("Round-18m-30e: hero/best = exactly what the AI chose", () => {
  it("AI picks the connecting route → plan.best is that connecting option, not the WL direct", () => {
    const p = plan();
    const cands = buildCandidates(p);
    expect(cands.some((c) => c.id === "C:NDLS:11058+22582")).toBe(true);
    const d = validateDecision(p, cands, { recommendedId: "C:NDLS:11058+22582", ranking: ["C:NDLS:11058+22582", "D:12358"], verdict: "11058 + 22582 via NDLS book karo, 3E AVL 29 fresh data.", why: ["11058 mein 3E AVL 29 hai, party ke liye seat guarantee."] }, "m");
    expect(d?.source).toBe("ai");
    finalizeAiDecision(p, d!);
    expect(p.best?.trainNumbers).toEqual(["11058", "22582"]);
    expect(p.best?.changes).toBe(1);
    expect(p.routeOptions[0].trainNumbers.join("+")).toBe("11058+22582");
    expect(p.routeOptions[0].badges).toContain("best_overall");
    /* WL direct ab neeche, badge ke bina. */
    const direct = p.routeOptions.find((o) => o.trainNumbers[0] === "12358")!;
    expect(direct.rank).toBe(2);
    expect(direct.badges).not.toContain("best_overall");
  });
});
