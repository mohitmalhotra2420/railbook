/* Round-20 (25 Sep 2026) — user:
 *   1. "direct trains card ka UI bhi bilkul Seat Finder jaisa same to same chip wala ho"
 *   2. "kisi bhi class pe tap krne pe seedha passenger form khulna chahiye, upar automatically
 *       train number, date, from, to station aaye"
 *
 * Ye test sirf CLIENT side verify karta hai:
 *   • Journey card ke class chip ka payload me poora row + option jaata hai (booking ke liye kaafi).
 *   • Payload → booking mapping (bookingFromChipPayload / bookingFromSeatRow) sahi train+class deta hai.
 *   • Reducer: SELECT_TRAIN_AND_CLASS (toPassengers) → seedha "passengers" screen.
 *   • Seat Finder chip tap: bookable (AVL/RAC/WL) → onBook (passenger form), warna purana chat flow.
 *   • Direct card + Seat Finder ek hi block markup (TrainClassBlock) use karte hain — same chips.
 * AI / server tools / planner ko chhua nahi gaya. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/voice/speakGuide", () => ({ speakGuide: vi.fn(), cancelGuide: vi.fn() }));

import { JourneyOptions } from "../src/components/JourneyOptions";
import { SeatFinder } from "../src/components/SeatFinder";
import { bookingFromChipPayload, bookingFromSeatRow, stationOf } from "../src/booking/fromOption";
import { bookingReducer, initialBooking } from "../src/booking/state";
import type { SeatIntent, SeatRow } from "../src/seatfinder";
import type { AgentJourneyPlan } from "../src/ai/agent";

const intent = (over: Partial<SeatIntent> = {}): SeatIntent => ({
  wants: false,
  classCode: null,
  acOnly: false,
  confirmedOnly: false,
  afterMin: null,
  beforeMin: null,
  windowLabel: null,
  earliest: false,
  cheapest: false,
  ...over,
});

const row = (cls: string, status: string, extra: Record<string, unknown> = {}) => ({
  classCode: cls,
  status,
  seats: status === "AVAILABLE" ? 40 : null,
  rac: null,
  waitlist: null,
  fare: 500,
  source: "web_confirmtkt",
  ...extra,
});

const opt = (num: string, name: string, dep: string, arr: string, extra: Record<string, unknown> = {}) => ({
  id: `D:${num}`,
  trainNumbers: [num],
  trainNames: [name],
  origin: "ASR",
  destination: "LDH",
  departure: dep,
  arrival: arr,
  arrivalDayOffset: 0,
  durationMinutes: 122,
  durationLabel: "2h 02m",
  changes: 0,
  probed: true,
  availability: row("CC", "AVAILABLE", { seats: 410, fare: 490 }),
  classOptions: [
    row("CC", "AVAILABLE", { seats: 410, fare: 490 }),
    row("EC", "AVAILABLE", { seats: 35, fare: 770 }),
    row("1A", "NOT_AVAILABLE", { fare: 1270 }),
  ],
  legs: [
    {
      trainNumber: num,
      trainName: name,
      from: "ASR",
      to: "LDH",
      fromName: "Amritsar Junction",
      toName: "Ludhiana Junction",
      departure: dep,
      arrival: arr,
      arrivalDayOffset: 0,
      durationMinutes: 122,
      availability: row("CC", "AVAILABLE", { seats: 410, fare: 490 }),
    },
  ],
  ...extra,
});

const plan = (over: Record<string, unknown> = {}) =>
  ({
    query: { from: "ASR", to: "LDH", date: "2026-09-26", travelClass: null, preference: "best_overall", passengers: 1 },
    best: null,
    connections: [],
    alternativeDates: [],
    directUnavailable: false,
    notes: [],
    sources: ["web_confirmtkt"],
    routeOptions: [opt("12014", "AMRITSAR SHATABDI", "04:55", "06:57")],
    recovery: { reason: "", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], boardFromEarlier: [] },
    ...over,
  }) as unknown as AgentJourneyPlan;

beforeEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ trains: [], classes: [] }) }));
});

describe("Round-20 · chip tap → passenger form", () => {
  it("journey card ke class chip par tap karne se poora row + option payload milta hai", async () => {
    const picks: { classCode: string; row?: { status?: string | null } | null; trainName?: string | null; toName?: string | null }[] = [];
    render(<JourneyOptions plan={plan()} onPickClass={(q) => picks.push(q)} />);

    const chip = await waitFor(() => {
      const c = [...document.querySelectorAll("button.sf-cchip")].find((b) => String(b.textContent).includes("CC"));
      expect(c).toBeTruthy();
      return c as HTMLButtonElement;
    });
    fireEvent.click(chip);

    expect(picks).toHaveLength(1);
    expect(picks[0].classCode).toBe("CC");
    expect(picks[0].row?.status).toBe("AVAILABLE");
    expect(picks[0].trainName).toBe("AMRITSAR SHATABDI");
    expect(picks[0].toName).toBe("Ludhiana Junction");
  });

  it("direct card aur Seat Finder ke chips ek hi block markup use karte hain (same to same)", async () => {
    const { container } = render(<JourneyOptions plan={plan()} onPickClass={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".sf-group").length).toBeGreaterThan(0));
    const grp = container.querySelector(".sf-group") as HTMLElement;
    /* header: number + naam + time + class count (Seat Finder jaisa) */
    expect(grp.querySelector(".sf-group-t strong")?.textContent).toBe("12014");
    expect(grp.textContent).toContain("3 classes (2 me seat)");
    expect(grp.querySelectorAll(".sf-cchip").length).toBe(3);
    /* N/A class halki (off) — rangdar sirf AVL/RAC */
    expect(grp.querySelectorAll(".sf-cchip.off").length).toBe(1);
  });

  it("payload → booking mapping: chip me jo dikha wahi jaata hai", () => {
    const { train, klass } = bookingFromChipPayload({
      trainNumber: "12014",
      classCode: "EC",
      from: "ASR",
      to: "LDH",
      requestDate: "2026-09-26",
      row: { status: "AVAILABLE", seats: 35, rac: null, waitlist: null, fare: 770, source: "web_confirmtkt", asOf: "2026-09-25T03:00:00Z" },
      trainName: "AMRITSAR SHATABDI",
      departure: "04:55",
      arrival: "06:57",
      arrivalDayOffset: 0,
      durationLabel: "2h 02m",
      fromName: "Amritsar Junction",
      toName: "Ludhiana Junction",
    });
    expect(train.number).toBe("12014");
    expect(train.date).toBe("2026-09-26");
    expect(train.from).toEqual({ code: "ASR", name: "Amritsar Junction", city: "Amritsar Junction" });
    expect(train.to.code).toBe("LDH");
    expect(train.to.name).toBe("Ludhiana Junction");
    expect(klass.code).toBe("EC");
    expect(klass.status).toBe("AVAILABLE");
    expect(klass.seats).toBe(35);
    expect(klass.fare).toBe(770);
  });

  it("Seat Finder row → booking mapping bhi real row se hi", () => {
    const row: SeatRow = {
      number: "12926",
      name: "PASCHIM EXPRESS",
      departure: "09:40",
      arrival: "16:20",
      durationLabel: "6h 40m",
      classCode: "2A",
      status: "RAC",
      seats: null,
      rac: 12,
      waitlist: null,
      fare: 980,
      seat: true,
      timesKnown: true,
      source: "web_confirmtkt",
    };
    const { train, klass } = bookingFromSeatRow(row, {
      from: stationOf("LDH", "Ludhiana"),
      to: stationOf("NDLS", "New Delhi"),
      date: "2026-09-26",
    });
    expect(train.number).toBe("12926");
    expect(klass.status).toBe("RAC");
    expect(klass.rac).toBe(12);
    expect(train.from.name).toBe("Ludhiana");
    expect(train.date).toBe("2026-09-26");
  });

  it("reducer: toPassengers=true par berth step skip karke seedha passenger form", () => {
    let s = initialBooking("2026-09-26");
    const { train, klass } = bookingFromChipPayload({
      trainNumber: "12014",
      classCode: "CC",
      from: "ASR",
      to: "LDH",
      requestDate: "2026-09-26",
      row: { status: "AVAILABLE", seats: 410, fare: 490, source: "web_confirmtkt" },
    });
    s = bookingReducer(s, { type: "SELECT_TRAIN_AND_CLASS", train, klass, toPassengers: true });
    expect(s.screen).toBe("passengers");
    expect(s.flow).toBe("PASSENGERS_PENDING");
    expect(s.selectedTrain?.number).toBe("12014");
    expect(s.selectedClass?.code).toBe("CC");
    /* purana flow (toPassengers nahi) waisa hi — berth screen */
    let t = initialBooking("2026-09-26");
    t = bookingReducer(t, { type: "SELECT_TRAIN_AND_CLASS", train, klass });
    expect(t.screen).toBe("seat");
  });

  it("N/A class par reducer book nahi karta (jhoothi booking nahi)", () => {
    const s0 = initialBooking("2026-09-26");
    const { train, klass } = bookingFromChipPayload({
      trainNumber: "12014",
      classCode: "1A",
      from: "ASR",
      to: "LDH",
      requestDate: "2026-09-26",
      row: { status: "NOT_AVAILABLE", fare: 1270 },
    });
    const s = bookingReducer(s0, { type: "SELECT_TRAIN_AND_CLASS", train, klass, toPassengers: true });
    expect(s.screen).not.toBe("passengers");
    expect(s.notice).toBeTruthy();
  });

  it("Seat Finder chip: AVL/RAC/WL → onBook (passenger form), N/A → purana chat flow", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        trains: [
          {
            trainNumber: "11078",
            trainName: "JHELUM EXPRESS",
            classes: [
              { classCode: "2A", code: "2A", status: "AVAILABLE", seats: 29, fare: 825, source: "web_confirmtkt" },
              { classCode: "1A", code: "1A", status: "NOT_AVAILABLE", fare: 1200, source: "web_confirmtkt" },
            ],
          },
        ],
      }),
    }));
    const booked: string[] = [];
    const chatted: string[] = [];
    render(
      <SeatFinder
        from="LDH"
        to="NDLS"
        date="2026-09-26"
        rows={[{ number: "11078", name: "JHELUM EXPRESS", departure: "04:30", arrival: "11:15", durationLabel: "6h 45m", arrivalDayOffset: 0 }]}
        intent={intent()}
        onChip={(t) => chatted.push(t)}
        onBook={(r) => booked.push(`${r.number} ${r.classCode}`)}
      />,
    );
    const avlChip = await waitFor(() => {
      const c = [...document.querySelectorAll("button.sf-cchip")].find((b) => String(b.textContent).includes("2A"));
      expect(c).toBeTruthy();
      return c as HTMLButtonElement;
    });
    fireEvent.click(avlChip);
    expect(booked).toEqual(["11078 2A"]);
    expect(chatted).toHaveLength(0);

    const naChip = [...document.querySelectorAll("button.sf-cchip")].find((b) => String(b.textContent).includes("1A")) as HTMLButtonElement;
    fireEvent.click(naChip);
    expect(booked).toHaveLength(1);
    expect(chatted.length).toBeGreaterThan(0);
    expect(screen.getByText(/Seat Finder/)).toBeTruthy();
  });
});
