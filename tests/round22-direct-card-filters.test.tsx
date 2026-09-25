/* Round-22 (26 Sep 2026, user screenshot 3) — Seat Finder ke filter chips:
 *   "yeh filter direct train ke card mein starting mein add kro"
 *
 * Verify (jsdom, REAL JourneyOptions):
 *   • Direct trains card ke shuru me wahi chips row (Available / Sabhi trains / class chips / AC /
 *     Time / Sabse jaldi / Sabse sasta) — shared SeatFilterBar (Seat Finder card bhi wahi use karta hai).
 *   • ✅ Available → sirf woh direct trains jinme AVL/RAC row hai.
 *   • class chip (2A) → sirf 2A wali trains, aur unke blocks me sirf 2A chip (baaki chhupi).
 *   • Time chip → us window ki trains; "Sab" par wapas poori list.
 *   • 💰 Sabse sasta → sasti train pehle (asli fares se).
 *   • Filter SIRF direct list par — alternatives/connecting ka data waise hi (plan payload untouched).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/voice/speakGuide", () => ({ speakGuide: vi.fn(), cancelGuide: vi.fn() }));

import { JourneyOptions } from "../src/components/JourneyOptions";
import type { AgentJourneyPlan } from "../src/ai/agent";

const avail = (classCode: string, status: string, extra: Record<string, unknown> = {}) => ({
  classCode,
  status,
  seats: status === "AVAILABLE" ? 40 : null,
  rac: status === "RAC" ? 12 : null,
  waitlist: status === "WAITLIST" ? 30 : null,
  fare: 500,
  source: "web_confirmtkt",
  stale: false,
  ...extra,
});

const directOption = (num: string, name: string, dep: string, arr: string, classes: ReturnType<typeof avail>[]) => ({
  id: `D:${num}`,
  trainNumbers: [num],
  trainNames: [name],
  origin: "ASR",
  destination: "NDLS",
  departure: dep,
  arrival: arr,
  arrivalDayOffset: 0,
  durationMinutes: 400,
  durationLabel: "6h 40m",
  changes: 0,
  legs: [
    {
      trainNumber: num,
      from: "ASR",
      to: "NDLS",
      availability: classes[0],
      classOptions: classes,
    },
  ],
  availability: classes[0],
  classOptions: classes,
  probed: true,
  badges: [],
});

const plan = (): AgentJourneyPlan =>
  ({
    query: { from: "ASR", to: "NDLS", date: "2026-09-27", passengers: 2, travelClass: null },
    best: null,
    routeOptions: [
      directOption("12030", "SWARN SHATABDI", "16:50", "22:50", [avail("CC", "AVAILABLE", { fare: 1200 }), avail("EC", "AVAILABLE", { fare: 2200 })]),
      directOption("12484", "ASR TVCN SF EXP", "05:55", "12:30", [avail("SL", "AVAILABLE", { seats: 102, fare: 180 }), avail("3A", "WAITLIST", { fare: 480 })]),
      directOption("15708", "ASR KIR EXPRESS", "07:40", "14:20", [avail("SL", "AVAILABLE", { seats: 42, fare: 150 })]),
      directOption("20808", "HIRAKUND EXP", "18:20", "01:10", [avail("SL", "WAITLIST", { fare: 160 }), avail("2A", "WAITLIST", { fare: 900 })]),
    ],
    connections: [],
    alternativeDates: [],
    recovery: null,
    provenance: { retrievedAt: new Date().toISOString(), sources: [] },
    sources: [],
    notes: [],
    summary: "4 direct trains",
    whyPoints: [],
    directUnavailable: false,
  }) as unknown as AgentJourneyPlan;

/** Har train ek hi baar — row ka header bhi .jx-no deta hai aur TrainClassBlock ke header me bhi
 * wahi class hai, isliye dedupe (order wahi rehta hai). */
function trainRowNumbers(container: HTMLElement): string[] {
  return [...new Set([...container.querySelectorAll(".jx-sb-row .jx-no")].map((el) => el.textContent ?? ""))];
}

beforeEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
});

describe("Round-22 · direct card ke shuru me Seat Finder wale filters", () => {
  it("chips card ke starting me hain (same shared bar)", () => {
    const { container } = render(<JourneyOptions plan={plan()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    const bar = container.querySelector(".jx-sb-filters .sf-chips") ?? container.querySelector(".sf-chips");
    expect(bar).toBeTruthy();
    const labels = [...container.querySelectorAll(".sf-chip")].map((b) => (b.textContent ?? "").trim());
    for (const want of ["✅ Available", "🚆 Sabhi trains", "Sab class", "1A", "2A", "3A", "3E", "SL", "CC", "2S", "EC", "❄️ AC", "⚡ Sabse jaldi", "💰 Sabse sasta"]) {
      expect(labels).toContain(want);
    }
    expect(screen.getByLabelText("Time filter")).toBeTruthy();
  });

  it("✅ Available → sirf AVL/RAC wali trains (WL-only train hat jati hai)", async () => {
    const { container } = render(<JourneyOptions plan={plan()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    expect(trainRowNumbers(container)).toContain("20808");
    fireEvent.click(screen.getByTitle(/Sirf AVAILABLE aur RAC wali trains/));
    await waitFor(() => expect(trainRowNumbers(container)).not.toContain("20808"));
    expect(trainRowNumbers(container)).toEqual(["12030", "12484", "15708"]);
  });

  it("class chip 2A → sirf 2A wali trains aur unke block me sirf 2A chip", async () => {
    const { container } = render(<JourneyOptions plan={plan()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    fireEvent.click([...container.querySelectorAll(".sf-chip")].find((b) => (b.textContent ?? "").trim() === "2A") as HTMLElement);
    await waitFor(() => expect(trainRowNumbers(container)).toEqual(["20808"]));
    const codes = [...container.querySelectorAll(".jx-sb-row .sf-cls")].map((el) => el.textContent);
    expect(codes).toEqual(["2A"]);
  });

  it("Time chip Subah (04:00–12:00) → sirf subah wali trains, 'Sab' par poori list", async () => {
    const { container } = render(<JourneyOptions plan={plan()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    const sel = screen.getByLabelText("Time filter") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "240-720" } });
    await waitFor(() => expect(trainRowNumbers(container)).toEqual(["12484", "15708"]));
    fireEvent.change(sel, { target: { value: "-" } });
    await waitFor(() => expect(trainRowNumbers(container)).toContain("12030"));
  });

  it("💰 Sabse sasta → sasti train pehle (asli fares se, koi guess nahi)", async () => {
    const { container } = render(<JourneyOptions plan={plan()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    fireEvent.click(screen.getByText(/Sabse sasta/));
    await waitFor(() => expect(trainRowNumbers(container)[0]).toBe("15708")); /* ₹150 sabse sasta */
  });

  it("class filter ke saath 'Sabse sasta' usi filtered class ke fare par chalta hai (dikh raha data)", async () => {
    /* 12484 ke paas SL ₹180 hai par 2A ₹900; 15708 ke paas 2A ₹1500. 2A + sabse sasta → 12484 pehle
     * (2A ka fare compare hua, SL ka nahi — jo chip me dikh raha wahi). */
    const p = plan();
    (p.routeOptions[1] as unknown as { classOptions: ReturnType<typeof avail>[] }).classOptions = [
      avail("SL", "AVAILABLE", { seats: 102, fare: 180 }),
      avail("2A", "AVAILABLE", { seats: 8, fare: 900 }),
    ];
    (p.routeOptions[2] as unknown as { classOptions: ReturnType<typeof avail>[] }).classOptions = [
      avail("SL", "AVAILABLE", { seats: 42, fare: 150 }),
      avail("2A", "AVAILABLE", { seats: 3, fare: 1500 }),
    ];
    const { container } = render(<JourneyOptions plan={p} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    fireEvent.click([...container.querySelectorAll(".sf-chip")].find((b) => (b.textContent ?? "").trim() === "2A") as HTMLElement);
    fireEvent.click(screen.getByText(/Sabse sasta/));
    await waitFor(() => expect(trainRowNumbers(container)).toEqual(["12484", "20808", "15708"]));
    /* aur fare asli me badhta hua ho (2A ke fares: 900 → 1100 → 1500) */
    const fares = [...container.querySelectorAll(".jx-sb-row .sf-cfare")].map((el) => Number(String(el.textContent).replace(/[^\d]/g, "")));
    expect(fares).toEqual([...fares].sort((a, b) => a - b));
  });

  it("filter note honest line + Clear sab reset karta hai", async () => {
    const { container } = render(<JourneyOptions plan={plan()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/Sirf AVAILABLE aur RAC wali trains/));
    const note = await waitFor(() => {
      const el = container.querySelector(".jx-sb-filternote");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(note.textContent).toMatch(/Available \(AVL\/RAC\)/);
    fireEvent.click(container.querySelector(".jx-sb-filternote-clear") as HTMLElement);
    await waitFor(() => expect(container.querySelector(".jx-sb-filternote")).toBeNull());
    expect(trainRowNumbers(container)).toContain("20808");
  });

  it("connecting/alternatives ka data filter se nahi chhua (sirf direct list badalti hai)", () => {
    const { container } = render(<JourneyOptions plan={plan()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    const before = container.querySelectorAll(".jx-pagecard").length;
    fireEvent.click(screen.getByTitle(/Sirf AVAILABLE aur RAC wali trains/));
    expect(container.querySelectorAll(".jx-pagecard").length).toBe(before);
  });
});
