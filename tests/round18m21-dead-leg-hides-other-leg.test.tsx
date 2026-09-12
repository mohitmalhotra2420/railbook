/* Round-18m-21: real render — leg-2 dead → leg-1 ki 15 seated trains render NAHI honi chahiye. */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { JourneyOptions } from "../src/components/JourneyOptions";
import type { AgentJourneyPlan, AgentRouteLeg } from "../src/ai/agent";

const leg = (n: string, from: string, to: string, seated: boolean): AgentRouteLeg => ({
  trainNumber: n, trainName: `TRAIN ${n}`, from, to, departure: "10:00", arrival: "13:00", arrivalDayOffset: 0, durationMinutes: 180,
  availability: seated ? { classCode: "SL", status: "AVAILABLE", seats: 5, rac: null, waitlist: null, fare: 200, source: "railcore" } : { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 30, fare: 200, source: "railcore" },
  classOptions: seated ? [{ classCode: "SL", status: "AVAILABLE", seats: 5, rac: null, waitlist: null, fare: 200, source: "railcore" }] : [{ classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 30, fare: 200, source: "railcore" }],
} as AgentRouteLeg);

const basePlan = (legPlans: NonNullable<AgentJourneyPlan["legPlans"]>): AgentJourneyPlan => ({
  query: { from: "LDH", to: "INDB", date: "2030-01-13", travelClass: null, preference: "best_overall", passengers: 2 },
  best: null, routeOptions: [], connections: [], alternativeDates: [], directUnavailable: true,
  recovery: { reason: "x", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], boardFromEarlier: [] } as unknown as AgentJourneyPlan["recovery"],
  notes: [], sources: ["railcore"], legPlans,
} as unknown as AgentJourneyPlan);

describe("Round-18m-21 render: dead leg-2 hides leg-1's seated trains", () => {
  it("leg-2 0 seated → no leg-1 train rows, verdict shown", () => {
    const leg1 = ["14632", "11906", "13152", "20808"].map((n) => leg(n, "LDH", "UMB", true));
    const leg2All = [leg("19326", "UMB", "INDB", false), leg("12920", "UMB", "INDB", false)];
    const { container, queryByText, getByText } = render(<JourneyOptions plan={basePlan([{ hub: "UMB", hubName: "Ambala Cant Jn", leg1, leg2: [], checkedLeg1: 20, checkedLeg2: 2, best: null, leg1All: leg1, leg2All }])} />);
    expect(container.querySelector(".jx-legplan-dead")).not.toBeNull();
    expect(container.querySelector(".jx-legplan-verdict")).not.toBeNull();
    // Leg-1 seated trains must NOT appear.
    expect(queryByText("TRAIN 14632")).toBeNull();
    expect(queryByText("TRAIN 20808")).toBeNull();
    expect(queryByText(/15 of 20 with seats|4 of 20 with seats/)).toBeNull();
    // Failing leg shown with its checked count.
    expect(container.querySelectorAll(".jx-leglist-head").length).toBe(1);
    expect(container.querySelector(".jx-leglist-head")?.textContent).toMatch(/Leg 2 · UMB → INDB/);
    expect(getByText(/0 of 2 with seats/)).toBeTruthy();
    expect(getByText(/koi route possible nahi/)).toBeTruthy();
  });
  it("both legs seated → normal card with Leg 1 and Leg 2 lists", () => {
    const leg1 = [leg("14632", "LDH", "UMB", true)];
    const leg2 = [leg("19326", "UMB", "INDB", true)];
    const { container, getByText } = render(<JourneyOptions plan={basePlan([{ hub: "UMB", hubName: "Ambala Cant Jn", leg1, leg2, checkedLeg1: 20, checkedLeg2: 2, best: null }])} />);
    expect(container.querySelector(".jx-legplan-dead")).toBeNull();
    expect(getByText("TRAIN 14632")).toBeTruthy();
    expect(getByText("TRAIN 19326")).toBeTruthy();
  });
});
