/* 23 Sep 2026 (user screenshot 21:09, deployed c59ac60): live route-board fill ne seat rows
 * bhar di thi par class chip "undefined AVL 9 · ₹150" dikh rahi thi — kyunki server board ke
 * rows me field `code` hota hai (ClassAvailability) aur UI `classCode` padhti hai. Isse tap
 * karne par IRCTC handoff me class bhi undefined jati. Ye test dono cheezein pakadta hai:
 *  1. live board rows (`{code:"SL", ...}`) render "SL AVL 9" karein, "undefined" kabhi nahi.
 *  2. class chip tap karne par classCode sahi jaaye (booking flow ke liye zaroori). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { JourneyOptions } from "../src/components/JourneyOptions";
import type { AgentJourneyPlan } from "../src/ai/agent";

const DATE = "2026-09-24";

function planWithoutProbe(): AgentJourneyPlan {
  return {
    query: { from: "LDH", to: "BEAS", date: DATE, travelClass: null, preference: "best_overall", passengers: 1 },
    best: null,
    connections: [],
    alternativeDates: [],
    directUnavailable: false,
    notes: [],
    sources: [],
    routeOptions: [
      {
        id: "D:14653",
        rank: 1,
        category: "fastest",
        badges: [],
        trainNumbers: ["14653"],
        trainNames: ["HSR ASR EXPRESS"],
        origin: "LDH",
        destination: "BEAS",
        departure: "04:35",
        arrival: "06:33",
        arrivalDayOffset: 0,
        durationMinutes: 118,
        durationLabel: "1h 58m",
        changes: 0,
        legs: [],
        layups: undefined,
        layoverMinutes: null,
        classes: [],
        availability: null,
        probed: false,
        reliability: null,
        source: "web",
        why: "",
      },
      {
        id: "D:18309",
        rank: 2,
        category: "fastest",
        badges: [],
        trainNumbers: ["18309"],
        trainNames: ["SBP JAT EXPRESS"],
        origin: "LDH",
        destination: "BEAS",
        departure: "05:16",
        arrival: "07:16",
        arrivalDayOffset: 0,
        durationMinutes: 120,
        durationLabel: "2h",
        changes: 0,
        legs: [],
        layoverMinutes: null,
        classes: [],
        availability: null,
        probed: false,
        reliability: null,
        source: "web",
        why: "",
      },
    ],
    recovery: { reason: "", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], boardFromEarlier: [] },
  } as unknown as AgentJourneyPlan;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("seat rows: server `code` shape → UI `classCode` (undefined fix)", () => {
  it("live route board ke rows 'SL AVL 9' dikhate hain, 'undefined' kabhi nahi", async () => {
    /* Server ka asli route-board response (jaisa deployed /api/availability bhejta hai). */
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      source: "web_confirmtkt",
      at: new Date().toISOString(),
      trains: [
        {
          trainNumber: "14653",
          trainName: "HSR ASR EXPRESS",
          classes: [{ code: "SL", label: "Sleeper", status: "AVAILABLE", seats: 9, fare: 150, source: "web_confirmtkt", updatedAt: new Date().toISOString() }],
        },
        {
          trainNumber: "18309",
          trainName: "SBP JAT EXPRESS",
          classes: [{ code: "SL", label: "Sleeper", status: "NOT_AVAILABLE", note: "Train Cancelled", fare: 150, source: "web_confirmtkt" }],
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { container } = render(<JourneyOptions plan={planWithoutProbe()} />);

    await waitFor(() => {
      expect(container.textContent).toContain("SL AVL 9");
    }, { timeout: 4000 });
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).toContain("SL Train Cancelled");
    /* class chip tap → classCode "SL" hi jaye (booking/handoff ke liye) */
    const picks: string[] = [];
    const { container: c2 } = render(
      <JourneyOptions plan={planWithoutProbe()} onPickClass={(q) => picks.push(q.classCode)} />,
    );
    await waitFor(() => expect(c2.textContent).toContain("SL AVL 9"), { timeout: 4000 });
    const chip = Array.from(c2.querySelectorAll("button.jx-cchip-btn")).find((b) => String(b.textContent).includes("SL AVL 9"));
    expect(chip).toBeTruthy();
    fireEvent.click(chip!);
    expect(picks).toContain("SL");
    expect(picks).not.toContain("undefined");
    /* sirf ek hi route-level call (list ke saare trains ek saath) */
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/availability?from=")).length).toBe(2);
  });
});
