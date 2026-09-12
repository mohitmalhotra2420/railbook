/* Round-18m-21 (user screenshot LDH→INDB via UMB: Leg-1 "15 of 20 with seats" listed, Leg-2 "0 of 2"):
 * agar ek leg par bhi seat nahi → poora hub plan bekaar; doosre leg ki seat-wali trains NAHI dikhani. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Round-18m-21: dead leg → other leg's seated trains hidden", () => {
  const src = readFileSync("src/components/JourneyOptions.tsx", "utf8");
  it("LegPlanCard short-circuits when leg1 or leg2 has zero seated trains and only renders the failing leg", () => {
    expect(src).toMatch(/const deadLeg = lp\.leg1\.length === 0 \? 1 : lp\.leg2\.length === 0 \? 2 : 0;/);
    expect(src).toMatch(/if \(deadLeg\) \{[\s\S]*?jx-legplan-dead[\s\S]*?<LegList title=\{legTitle\} legs=\{\[\]\}[\s\S]*?\}\s*return \(/);
    // Verdict text tells the user why the other leg is not shown.
    expect(src).toContain("dikhane ka matlab nahi, kyunki aage nikal hi nahi paoge");
  });
  it("section title flips when no hub has seats on both legs", () => {
    expect(src).toContain("Connecting · koi route possible nahi");
  });
  it("AI facts mark a dead-leg hub as NOT usable", () => {
    const eng = readFileSync("server/journey/engine.ts", "utf8");
    const dec = readFileSync("server/journey/decide.ts", "utf8");
    expect(eng).toContain("is NOT usable: leg-");
    expect(dec).toContain("is NOT a usable route (one leg has zero seated trains)");
  });
});
