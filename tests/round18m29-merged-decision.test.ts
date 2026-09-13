/* Round-18m-29: planner decision merged into the agentic final call (AI calls 3 → 2).
 * Grounding unchanged: validateDecision rejects unknown ids / WL picks when fresh exists /
 * invented ₹; rules decision is the fallback. Coverage/data untouched. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildCandidates, parseDecisionJson, rulesDecision, validateDecision } from "../server/journey/decide.js";
import type { JourneyPlan } from "../server/journey/types.js";

const avl = (cls: string, seats: number, fare: number) => ({ classCode: cls, status: "AVAILABLE", seats, fare, source: "railcore", stale: false, fetchedAt: new Date().toISOString() }) as never;
const wl = (cls: string) => ({ classCode: cls, status: "WAITLIST", waitlist: 40, seats: null, fare: 800, source: "railcore", stale: false }) as never;
function plan(): JourneyPlan {
  const o = (n: string, dur: number, rows: unknown[]) => ({ rank: 1, trainNumbers: [n], trainNames: [`T${n}`], departure: "06:00", arrival: "12:00", arrivalDayOffset: 0, durationMinutes: dur, durationLabel: `${dur}m`, changes: 0, classes: [], badges: [], availability: rows[0] ?? null, classOptions: rows, legs: [] }) as never;
  return { query: { from: "LDH", to: "NDLS", date: "2026-09-14", passengers: 2 }, routeOptions: [o("12046", 200, [avl("CC", 30, 700)]), o("12030", 210, [wl("CC")])], best: null, connections: [], notes: [], sources: [] } as never;
}

describe("Round-18m-29 merged decision", () => {
  it("accepts a valid model decision and drops invented facts", () => {
    const p = plan(); const c = buildCandidates(p);
    const d = validateDecision(p, c, { recommendedId: "D:12046", ranking: ["D:12046", "D:12030", "D:99999"], verdict: "12046 T12046 book karo, CC AVL 30 — 2 logon ke liye confirmed.", why: ["12046 mein CC AVL 30 hai, 2 passengers ke liye seat pakki.", "12030 CC WL 40 hai — reject kiya.", "Fare ₹9999 hai — bahut sasta."] }, "meta/muse-glimmer-30b");
    expect(d?.source).toBe("ai");
    expect(d?.recommendedId).toBe("D:12046");
    expect(d?.ranking).toEqual(["D:12046", "D:12030"]); // unknown id dropped
    expect(d?.whyPoints.some((w) => w.includes("₹9999"))).toBe(false); // invented fare dropped
  });
  it("rejects a WL pick when a fresh-seat option exists, and unknown ids", () => {
    const p = plan(); const c = buildCandidates(p);
    expect(validateDecision(p, c, { recommendedId: "D:12030" }, "m")).toBeNull();
    expect(validateDecision(p, c, { recommendedId: "D:77777" }, "m")).toBeNull();
    expect(rulesDecision(p, c).recommendedId).toBe("D:12046");
  });
  it("repairs a model JSON that dropped the final brace, rejects garbage", () => {
    expect(parseDecisionJson('{"recommendedId": "D:12426", "ranking": ["D:12426"], "verdict": "x", "why": ["a", "b"]')).toMatchObject({ recommendedId: "D:12426" });
    expect(parseDecisionJson('{"recommendedId": "D:12426", "why": ["a", "b"')).toMatchObject({ recommendedId: "D:12426" });
    expect(parseDecisionJson("not json at all")).toBeNull();
  });
  it("agentic loop defers the planner decision to the final call and validates it server-side", () => {
    const src = readFileSync("server/agent/agentic.ts", "utf8");
    expect(src).toMatch(/deferDecision: true/);
    expect(src).toMatch(/<decision>/);
    expect(src).toMatch(/validateDecision\(plan, cands, raw/);
    expect(src).toMatch(/finalizeAiDecision\(plan, d\)/);
    const eng = readFileSync("server/journey/engine.ts", "utf8");
    expect(eng).toMatch(/args\.deferDecision && args\.aiWhy !== false/);
    /* no separate decision call in the deferred path */
    expect(eng).toMatch(/plan\.decisionDeferred = true;\s*return plan;/);
  });
});
