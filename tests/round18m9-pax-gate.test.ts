import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { enoughSeats } from "../server/journey/engine.js";

describe("Round-18m-9: passenger-aware seats + journey card v3", () => {
  it("enoughSeats: AVAILABLE rows must cover the passenger count; RAC only for ≤2 pax", () => {
    expect(enoughSeats({ status: "AVAILABLE", seats: 36 } as never, 2)).toBe(true);
    expect(enoughSeats({ status: "AVAILABLE", seats: 1 } as never, 2)).toBe(false);
    expect(enoughSeats({ status: "AVAILABLE", seats: null } as never, 4)).toBe(true);
    expect(enoughSeats({ status: "RAC", seats: 20 } as never, 2)).toBe(true);
    expect(enoughSeats({ status: "RAC", seats: 20 } as never, 3)).toBe(false);
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
