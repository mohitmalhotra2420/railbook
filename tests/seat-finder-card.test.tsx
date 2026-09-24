/* 24 Sep 2026 — Seat Finder CARD ka render test (jsdom, koi browser nahi).
 * Verify: card dikhta hai, SEAT upar + WAITLIST neeche, "Available" / "Sabhi trains" chips
 * sach me list badalte hain, "data nahi aayi" wali trains alag list me aati hain (seat nahi maani jaati).
 * Sab client-side — AI/server/API touch nahi. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/voice/speakGuide", () => ({ speakGuide: vi.fn(), cancelGuide: vi.fn() }));

import { SeatFinder } from "../src/components/SeatFinder";
import type { SeatIntent } from "../src/seatfinder";

const intent = (over: Partial<SeatIntent> = {}): SeatIntent => ({
  wants: false,
  classCode: null,
  confirmedOnly: false,
  afterMin: null,
  earliest: false,
  cheapest: false,
  ...over,
});

const search = [
  { number: "11078", name: "JHELUM EXPRESS", departure: "04:30", arrival: "11:15", durationLabel: "6h 45m", arrivalDayOffset: 0 },
  { number: "20986", name: "SWARAJ EXPRESS", departure: "00:40", arrival: "05:55", durationLabel: "5h 15m", arrivalDayOffset: 0 },
  { number: "14617", name: "PRNC-ASR JANSEWA EXP", departure: "14:01", arrival: "17:05", durationLabel: "3h 04m", arrivalDayOffset: 0 },
];

const boardRows = [
  {
    trainNumber: "11078",
    trainName: "JHELUM EXPRESS",
    classes: [
      { classCode: "2A", code: "2A", status: "AVAILABLE", seats: 29, rac: null, waitlist: null, fare: 825, source: "web_confirmtkt" },
      { classCode: "3A", code: "3A", status: "WAITLIST", seats: null, rac: null, waitlist: 12, fare: 585, source: "web_confirmtkt" },
    ],
  },
  {
    trainNumber: "20986",
    trainName: "SWARAJ EXPRESS",
    classes: [{ classCode: "2A", code: "2A", status: "RAC", seats: null, rac: 9, waitlist: null, fare: 890, source: "web_confirmtkt" }],
  },
];

function stubFetch(rows: unknown) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({ trains: rows }) }));
}

beforeEach(() => stubFetch(boardRows));

describe("Seat Finder card (jsdom)", () => {
  it("card render hota hai: SEAT upar, WAITLIST neeche, aur 'data nahi aayi' alag list", async () => {
    render(<SeatFinder from="AAAB" to="BBBB" date="2026-09-25" rows={search} intent={intent()} onChip={() => {}} />);
    expect(await screen.findByText("Seat Finder")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/JHELUM EXPRESS/).length).toBeGreaterThan(0));

    /* Seat wali (AVL/RAC) upar */
    expect(screen.getByText(/Seat mil jayegi/)).toBeTruthy();
    expect(screen.getByText("AVL 29")).toBeTruthy();
    expect(screen.getByText("RAC 9")).toBeTruthy();
    /* WL neeche */
    expect(screen.getByText(/Seat pakki nahi/)).toBeTruthy();
    expect(screen.getByText("WL 12")).toBeTruthy();
    /* 14617 ka board data nahi aaya → "seat nahi" nahi, alag list */
    expect(screen.getByText(/Seat data provider se nahi aayi/)).toBeTruthy();
    expect(screen.getByText(/data nahi aayi/)).toBeTruthy();
  });

  it("'✅ Available' chip = sirf AVL + RAC (WL section hat jata hai); '🚆 Sabhi trains' = sab wapas", async () => {
    render(<SeatFinder from="AAAC" to="BBBC" date="2026-09-25" rows={search} intent={intent()} onChip={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Seat pakki nahi/)).toBeTruthy());

    fireEvent.click(screen.getByText("✅ Available"));
    await waitFor(() => expect(screen.queryByText(/Seat pakki nahi/)).toBeNull());
    expect(screen.getByText("AVL 29")).toBeTruthy(); /* AVL */
    expect(screen.getByText("RAC 9")).toBeTruthy(); /* RAC bhi — user ne kaha dono */
    expect(screen.queryByText("WL 12")).toBeNull(); /* WL nahi */

    fireEvent.click(screen.getByText("🚆 Sabhi trains"));
    await waitFor(() => expect(screen.getByText(/Seat pakki nahi/)).toBeTruthy());
    expect(screen.getByText("WL 12")).toBeTruthy();
  });

  it("class chip (2A) sirf us class ki rows dikhata hai — 3A WL row hat jati hai", async () => {
    render(<SeatFinder from="AAAD" to="BBBD" date="2026-09-25" rows={search} intent={intent()} onChip={() => {}} />);
    await waitFor(() => expect(screen.getByText("WL 12")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "2A" })[0]);
    await waitFor(() => expect(screen.queryByText("WL 12")).toBeNull());
    expect(screen.getByText("AVL 29")).toBeTruthy();
    expect(screen.getByText("RAC 9")).toBeTruthy();
  });

  it("user ne 'sirf confirmed' bola ho → card seedha Available mode me khulta hai", async () => {
    render(<SeatFinder from="AAAE" to="BBBE" date="2026-09-25" rows={search} intent={intent({ confirmedOnly: true })} onChip={() => {}} />);
    await waitFor(() => expect(screen.queryByText(/Seat pakki nahi/)).toBeNull());
    expect(screen.getByText("AVL 29")).toBeTruthy();
  });

  it("row tap karne par wahi purana utterance jata hai (train + class + date + route)", async () => {
    const onChip = vi.fn();
    render(<SeatFinder from="AAAF" to="BBBF" date="2026-09-25" rows={search} intent={intent()} onChip={onChip} />);
    await waitFor(() => expect(screen.getByText("AVL 29")).toBeTruthy());
    fireEvent.click(screen.getByText("AVL 29"));
    expect(onChip).toHaveBeenCalledWith("11078 ki seat availability 2A 2026-09-25 ko AAAF se BBBF");
  });

  it("WL ka 'confirm %' kahin nahi dikhaya jata (hamare paas wo data hai hi nahi)", async () => {
    const { container } = render(<SeatFinder from="AAAG" to="BBBG" date="2026-09-25" rows={search} intent={intent()} onChip={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Seat pakki nahi/)).toBeTruthy());
    expect(container.textContent).not.toMatch(/\d+\s*%/); /* koi "83% confirm" jaisa andaza nahi */
    expect(container.textContent).toMatch(/confirm % hum nahi dete/i);
  });
});
