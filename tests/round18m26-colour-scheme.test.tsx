/* Round-18m-26 (user): ek colour scheme har jagah — green = available (AVL/RAC), tan = purana/stale data
 * (+ "X din pehle ka data"), blue = WL, red = Not available/Regret; legend card ke upar. Data provider ka hi. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { JourneyOptions } from "../src/components/JourneyOptions";
import type { AgentJourneyPlan } from "../src/ai/agent";

const row = (cls: string, status: string, extra: Record<string, unknown> = {}) => ({ classCode: cls, status, seats: null, rac: null, waitlist: null, fare: 500, source: "web_railyatri", ...extra });
const twelveDaysAgo = new Date(Date.now() - 12 * 86400000).toISOString();

describe("Round-18m-26 colour scheme", () => {
  it("journey card: legend on top; AVL green, stale AVL tan + '12 din pehle ka data', WL blue, N/A red", () => {
    const plan = {
      query: { from: "JAT", to: "NDLS", date: "2030-01-13", travelClass: null, preference: "best_overall", passengers: 1 },
      best: null, connections: [], alternativeDates: [], directUnavailable: false, notes: [], sources: ["web_railyatri"],
      routeOptions: [{ id: "D:19804", trainNumbers: ["19804"], trainNames: ["KOTA EXPRESS"], origin: "JAT", destination: "NDLS", departure: "00:20", arrival: "13:35", arrivalDayOffset: 0, durationMinutes: 795, durationLabel: "13h 15m", changes: 0, legs: [], probed: true,
        availability: row("2A", "AVAILABLE", { seats: 56, stale: true, asOf: twelveDaysAgo }),
        classOptions: [row("2A", "AVAILABLE", { seats: 56, stale: true, asOf: twelveDaysAgo }), row("1A", "AVAILABLE", { seats: 2 }), row("SL", "WAITLIST", { waitlist: 51 }), row("3E", "NOT_AVAILABLE")] }],
      recovery: { reason: "", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], boardFromEarlier: [] },
    } as unknown as AgentJourneyPlan;
    const { container, getByText } = render(<JourneyOptions plan={plan} />);
    const legend = container.querySelector(".jx-legend");
    expect(legend?.textContent).toContain("Available (AVL/RAC)");
    expect(legend?.textContent).toContain("Purana data");
    expect(legend?.textContent).toContain("Waitlist");
    expect(legend?.textContent).toContain("Not available / Regret");
    fireEvent.click(getByText("Fastest"));
    const pill = container.querySelector(".jx-lrow .jx-seat")!;
    expect(pill.className).toContain("jx-seat-stale");
    expect(pill.textContent).toContain("12 din pehle ka data");
    const chips = [...container.querySelectorAll(".jx-lrow .jx-cchip")].map((c) => [c.className, c.textContent]);
    expect(chips.find((c) => c[1]?.startsWith("1A"))?.[0]).toContain("jx-cchip-ok");
    expect(chips.find((c) => c[1]?.startsWith("SL"))?.[0]).toContain("jx-cchip-wl");
    expect(chips.find((c) => c[1]?.startsWith("3E"))?.[0]).toContain("jx-cchip-bad");
    // label untouched — provider's AVL 56 stays, only colour/age differ
    expect(pill.textContent).toContain("2A AVL 56");
  });
  it("CSS: same palette across journey card, results chips and train board; legend present in TrainBoard", () => {
    const css = readFileSync("src/styles.css", "utf8");
    for (const sel of [".jx-cchip-stale", ".jx-seat-stale", ".chip.stale", ".tb-avl.stale", ".jo-avl-stale"]) expect(css).toMatch(new RegExp(sel.replace(/\./g, "\\.") + "[^{]*\\{[^}]*#f4ecdc"));
    for (const sel of [".jx-cchip-wl", ".jx-seat-wl", ".chip.wl", ".tb-avl.wl", ".jo-avl-wl"]) expect(css).toMatch(new RegExp(sel.replace(/\./g, "\\.") + "[^{]*\\{[^}]*#1d4ed8"));
    for (const sel of [".jx-cchip-bad", ".jx-seat-bad", ".chip.no", ".tb-avl.bad"]) expect(css).toMatch(new RegExp(sel.replace(/\./g, "\\.") + "[^{]*\\{[^}]*#9b1c1c"));
    const tb = readFileSync("src/views/TrainBoard.tsx", "utf8");
    expect(tb).toContain('className="tb-legend"');
    expect(tb).toContain("tb-avl-age");
    const res = readFileSync("src/views/Results.tsx", "utf8");
    expect(res).toContain('if (stale) return "stale";');
  });
  it("server propagates provider timestamp: ClassAvailability.updatedAt → RouteAvailability.asOf", () => {
    const router = readFileSync("server/railway/router.ts", "utf8");
    expect(router).toContain("updatedAt:");
    const eng = readFileSync("server/journey/engine.ts", "utf8");
    expect(eng.match(/\.\.\.\(c\.updatedAt \? \{ asOf: c\.updatedAt \} : \{\}\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(eng).toContain("...(pick.updatedAt ? { asOf: pick.updatedAt } : {})");
  });
});
