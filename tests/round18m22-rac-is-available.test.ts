/* Round-18m-22 (user): RAC ko available seat ki tarah treat karo — label/data provider ka hi (RAC N,
 * kuch fake nahi), lekin bookable + green. Kyunki RAC chart preparation ke baad confirm ho jaati hai.
 * AVL phir bhi RAC se upar rank hota hai jab dono hon. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { enoughSeats, legBookable } from "../server/journey/engine.js";

const RAC = { classCode: "SL", status: "RAC", seats: null, rac: 7, waitlist: null, fare: 300, source: "railcore" } as const;

describe("Round-18m-22: RAC treated as available", () => {
  it("enoughSeats/legBookable accept fresh RAC for any party size; stale RAC stays stale tier", () => {
    for (const pax of [1, 2, 3, 4, 6]) {
      expect(enoughSeats(RAC as never, pax)).toBe(true);
      expect(legBookable(RAC as never, pax)).toBe(true);
    }
    expect(legBookable({ ...RAC, stale: true } as never, 1)).toBe(false);
    expect(legBookable({ ...RAC, status: "WAITLIST", waitlist: 5 } as never, 1)).toBe(false);
  });
  it("label stays the provider's RAC (never rewritten to AVL)", () => {
    const jo = readFileSync("src/components/JourneyOptions.tsx", "utf8");
    expect(jo).toMatch(/if \(a\.status === "RAC"\) return \{ text: `\$\{a\.classCode\} RAC\$\{a\.rac != null \? ` \$\{a\.rac\}` : ""\}\$\{st\}`, tone: a\.stale \? "warn" : "ok" \};/);
    const eng = readFileSync("server/journey/engine.ts", "utf8");
    expect(eng).toContain('if (a.status === "RAC") return true;');
    expect(eng).toContain("AVAILABLE: 0, RAC: 1, WAITLIST: 2"); // AVL still ranks above RAC
  });
  it("UI: RAC is green everywhere (journey card chips, results chips, train board, alternatives card)", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.chip\.rac \{ background: var\(--green-soft\); color: var\(--green\); \}/);
    expect(css).toMatch(/\.tb-avl\.rac \{ color: var\(--green\); \}/);
    const alt = readFileSync("src/components/AlternativesCard.tsx", "utf8");
    expect(alt).toContain('a?.status === "AVAILABLE" || a?.status === "RAC" ? "ok"');
    const tb = readFileSync("src/views/TrainBoard.tsx", "utf8");
    expect(tb).not.toMatch(/const weak = [^\n]*cell\.status === "RAC"/);
  });
  it("AI facts + auto-alternatives: RAC is a seat, not 'poor availability'", () => {
    const dec = readFileSync("server/journey/decide.ts", "utf8");
    expect(dec).toContain("RAC = treated as an AVAILABLE seat for ANY party size");
    const ag = readFileSync("server/agent/agentic.ts", "utf8");
    expect(ag).toContain('|| r.status === "RAC");');
    const eng = readFileSync("server/journey/engine.ts", "utf8");
    expect(eng).toMatch(/if \(reason === "rac"\) \{\n\s+return \{ \.\.\.base, alternatives: \[\]/);
  });
});
