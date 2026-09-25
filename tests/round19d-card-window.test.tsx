/* Round-19d (24 Sep, user: "Card filter karo lekin connecting/alternatives mein change na aayein wo waisa
 * hi rahe"): journey card ki DIRECT list usi time window ki dikhe jo user ne bola ("kal subah"), aur AI ka
 * hero bhi window ke andar ka ho. Connecting / alternatives / dates ka data aur unke sections waisa hi
 * rehta hai — sirf direct trains par filter, aur wo bhi client-side (plan/engine untouched). */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { JourneyOptions } from "../src/components/JourneyOptions";
import type { AgentJourneyPlan } from "../src/ai/agent";

const row = (cls: string, status: string, extra: Record<string, unknown> = {}) => ({
  classCode: cls,
  status,
  seats: status === "AVAILABLE" ? 40 : null,
  rac: null,
  waitlist: null,
  fare: 500,
  source: "web_railyatri",
  ...extra,
});

const opt = (num: string, name: string, dep: string, arr: string, extra: Record<string, unknown> = {}) => ({
  id: `D:${num}`,
  trainNumbers: [num],
  trainNames: [name],
  origin: "LDH",
  destination: "BEAS",
  departure: dep,
  arrival: arr,
  arrivalDayOffset: 0,
  durationMinutes: 120,
  durationLabel: "2h 00m",
  changes: 0,
  legs: [],
  probed: true,
  availability: row("2A", "AVAILABLE"),
  classOptions: [row("2A", "AVAILABLE")],
  ...extra,
});

const plan = (over: Record<string, unknown> = {}) =>
  ({
    query: { from: "LDH", to: "BEAS", date: "2026-09-25", travelClass: null, preference: "best_overall", passengers: 1 },
    best: null,
    connections: [
      {
        station: "JUC",
        stationName: "Jalandhar City",
        legs: [
          { trainNumber: "14682", trainName: "JUC-ASR EXP", from: "LDH", fromName: "Ludhiana", to: "JUC", toName: "Jalandhar", departure: "16:20", arrival: "17:05", departureDayOffset: 0, availability: row("2A", "AVAILABLE") },
          { trainNumber: "12029", trainName: "SWARN SHATABDI", from: "JUC", fromName: "Jalandhar", to: "BEAS", toName: "Beas", departure: "17:40", arrival: "18:20", departureDayOffset: 0, availability: row("CC", "AVAILABLE") },
        ],
        layoverMinutes: 35,
        totalDurationMinutes: 120,
        valid: true,
      },
    ],
    alternativeDates: [{ date: "2026-09-26", count: 12, fastest: { number: "12029", durationMinutes: 90 } }],
    directUnavailable: false,
    notes: [],
    sources: ["web_railyatri"],
    routeOptions: [
      opt("14719", "BKN ASR EXP", "04:25", "06:06"),
      opt("14631", "DDN ASR EXPRESS", "04:46", "06:30"),
      opt("12029", "SWARN SHATABDI", "11:11", "12:38"),
      opt("14624", "FZR ASR EXP", "14:25", "16:00"),
      opt("12030", "SWARN SHATABDI", "16:50", "18:20"),
    ],
    recovery: { reason: "", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], boardFromEarlier: [] },
    ...over,
  }) as unknown as AgentJourneyPlan;

const SUBHA = { afterMin: 240, beforeMin: 720, label: "Subah (04:00–12:00)" };

describe("Round-19d — card ki direct list window se filter", () => {
  it("window ke bina: saari direct trains dikhti hain (purana behaviour)", () => {
    const { container } = render(<JourneyOptions plan={plan()} />);
    const rows = [...container.querySelectorAll(".jx-sb-row .jx-no")].map((n) => n.textContent);
    /* pehli 5 rows (default) — 16:50 wali bhi shamil hai */
    expect(rows).toContain("12030");
    expect(container.querySelector(".jx-windowbar")).toBeNull();
  });

  it("'kal subah' window ke saath: sirf subah ki direct trains + window bar + AI hero bhi window ka", () => {
    const p = plan({ best: (plan() as unknown as { routeOptions: unknown[] }).routeOptions[4] }); /* 16:50 wala best */
    const { container, getByText } = render(<JourneyOptions plan={p} window={SUBHA} />);
    const rows = [...container.querySelectorAll(".jx-sb-row .jx-no")].map((n) => n.textContent);
    expect(rows).toContain("14719");
    expect(rows).toContain("14631");
    expect(rows).toContain("12029");
    expect(rows).not.toContain("14624"); /* 14:25 dopahar hai */
    expect(rows).not.toContain("12030"); /* 16:50 shaam hai */
    /* bar + "sabhi dikhao" chip */
    const bar = container.querySelector(".jx-windowbar")!;
    expect(bar.textContent).toContain("Subah (04:00–12:00)");
    expect(bar.textContent).toContain("3 mili");
    /* hero (AI ka best 16:50 tha) ab window ka pehla direct */
    const hero = container.querySelector(".jx-hero")!;
    expect(hero.textContent).toContain("14719");
    expect(hero.textContent).toContain("Window ke hisaab se");
    /* connecting + alternatives waise hi (user ki shart) */
    expect(getByText(/Connecting trains · Leg 1 → Leg 2/)).toBeTruthy();
    expect(getByText(/Alternative trains/)).toBeTruthy();
  });

  /* Round-22 (26 Sep, user screenshot): window toggle ab direct card ke Time chip se chalta hai
   * ("Time: Sab (poori list)" = window hatao; Time chip se window wapas) — duplicate state nahi. */
  it("'Time: Sab (poori list)' dabaate hi poori list wapas (aur Time chip se phir sirf window)", () => {
    const { container, getByText, getByLabelText } = render(<JourneyOptions plan={plan()} window={SUBHA} />);
    fireEvent.click(getByText("Time: Sab (poori list)"));
    let rows = [...container.querySelectorAll(".jx-sb-row .jx-no")].map((n) => n.textContent);
    expect(rows).toContain("12030");
    fireEvent.change(getByLabelText("Time filter"), { target: { value: "240-720" } });
    rows = [...container.querySelectorAll(".jx-sb-row .jx-no")].map((n) => n.textContent);
    expect(rows).not.toContain("12030");
  });

  it("window me koi direct na ho to kuch chhupta nahi — purana hero/list hi rehti hai", () => {
    const p = plan({ routeOptions: [opt("12030", "SWARN SHATABDI", "16:50", "18:20")] });
    const { container, getByText } = render(<JourneyOptions plan={p} window={SUBHA} />);
    expect(container.querySelector(".jx-windowbar")!.textContent).toContain("koi seedha train nahi mila");
    expect(container.querySelector(".jx-windowbar-btn")).toBeNull(); /* filter laga hi nahi to chip bhi nahi */
    expect([...container.querySelectorAll(".jx-sb-row .jx-no")].map((n) => n.textContent)).toContain("12030");
  });
});
