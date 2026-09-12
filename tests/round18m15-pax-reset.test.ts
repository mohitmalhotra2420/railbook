import { describe, expect, it } from "vitest";
import { emptyAgentContext, mergeAgentContext } from "../server/agent/context.js";

const LDH = { code: "LDH", name: "Ludhiana Jn" };
const SRE = { code: "SRE", name: "Saharanpur" };
const UMB = { code: "UMB", name: "Ambala Cantt" };

describe("Round-18m-15: nayi journey par passenger count dobara poochha jaye", () => {
  it("route change → paxProvided reset (1 assume nahi hota)", () => {
    const prev = { ...emptyAgentContext(), origin: LDH, destination: SRE, date: "2026-09-13", dateProvided: true, passengers: 1, paxProvided: true };
    const next = mergeAgentContext(prev, { intent: "SEARCH_TRAIN", from: LDH, to: UMB, date: "2026-09-15" }, "ludhiana se ambala 15 sept");
    expect(next.paxProvided).toBe(false);
    expect(next.passengers).toBeNull();
  });
  it("same route par follow-up → pax yaad rehta hai", () => {
    const prev = { ...emptyAgentContext(), origin: LDH, destination: SRE, date: "2026-09-13", dateProvided: true, passengers: 3, paxProvided: true };
    const next = mergeAgentContext(prev, { intent: "SEARCH_TRAIN", from: LDH, to: SRE }, "ludhiana se saharanpur sleeper");
    expect(next.paxProvided).toBe(true);
    expect(next.passengers).toBe(3);
  });
  it("nayi journey ke saath pax bola → wahi count lagta hai", () => {
    const prev = { ...emptyAgentContext(), origin: LDH, destination: SRE, passengers: 1, paxProvided: true };
    const next = mergeAgentContext(prev, { intent: "SEARCH_TRAIN", from: LDH, to: UMB, passengerCount: 4 }, "ludhiana se ambala 4 log");
    expect(next.passengers).toBe(4);
    expect(next.paxProvided).toBe(true);
  });
});
