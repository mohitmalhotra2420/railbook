/* Round-23 (26 Sep 2026) — do user requests:

 * 1) "Available selection pe WL wali class bhi show hoti hai jabki sirf available ya RAC show honi chahiye"
 *    → direct card me ✅ Available mode me sirf AVL/RAC class chips (WL/N-A chips chhup jaati hain),
 *      aur jis train me koi AVL/RAC class nahi wo list se hat jati hai.
 * 2) "es page pe bas Continue to IRCTC show hona chahiye — booking summary, wallet hata do; copy
 *    journey+passenger summary dikhana band karo; neeche ka Confirm Booking bhi hata do"
 *    → Review screen par sirf handoff card; Confirm Booking / wallet / base fare / service fee / total
 *      aur copy buttons nahi.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/voice/speakGuide", () => ({ speakGuide: vi.fn(), cancelGuide: vi.fn() }));

import { JourneyOptions } from "../src/components/JourneyOptions";
import { BookingProvider } from "../src/booking/context";
import { FareReview } from "../src/views/ReviewStatus";
import type { AgentJourneyPlan } from "../src/ai/agent";
import type { TrainResult } from "../src/types";

/* ── 1. Available filter: WL chips nahi ── */
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
  legs: [{ trainNumber: num, from: "ASR", to: "NDLS", availability: classes[0], classOptions: classes }],
  availability: classes[0],
  classOptions: classes,
  probed: true,
  badges: [],
});

const planWith = (): AgentJourneyPlan =>
  ({
    query: { from: "ASR", to: "NDLS", date: "2026-09-27", passengers: 1, travelClass: null },
    best: null,
    routeOptions: [
      directOption("12484", "ASR TVCN SF EXP", "05:55", "12:30", [
        avail("SL", "AVAILABLE", { seats: 102, fare: 180 }),
        avail("3A", "WAITLIST", { fare: 480 }),
      ]),
      directOption("20808", "HIRAKUND EXP", "18:20", "01:10", [avail("SL", "WAITLIST", { fare: 160 }), avail("2A", "WAITLIST", { fare: 900 })]),
      directOption("12926", "PASCHIM EXPRESS", "07:20", "13:40", [avail("2A", "RAC", { rac: 9, fare: 1270 })]),
    ],
    connections: [],
    alternativeDates: [],
    recovery: null,
    provenance: { retrievedAt: new Date().toISOString(), sources: [] },
    sources: [],
    notes: [],
    summary: "3 direct trains",
    whyPoints: [],
    directUnavailable: false,
  }) as unknown as AgentJourneyPlan;

beforeEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
});

describe("Round-23 · ✅ Available me sirf AVL/RAC classes", () => {
  it("WL chips chhup jaate hain aur WL-only train list se hat jati hai", async () => {
    const { container } = render(<JourneyOptions plan={planWith()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    /* default (Sabhi trains): 12484 ke saath 3A WL chip bhi dikhta hai */
    const before = [...container.querySelectorAll(".jx-sb-row .sf-cls")].map((el) => el.textContent);
    expect(before).toContain("3A");
    expect(before).toContain("SL");

    fireEvent.click(screen.getByTitle(/Sirf AVAILABLE aur RAC wali trains/));
    await waitFor(() => {
      const nums = [...new Set([...container.querySelectorAll(".jx-sb-row .jx-no")].map((el) => el.textContent))];
      expect(nums).toEqual(["12484", "12926"]); /* 20808 sara WL — hat gaya */
    });
    const codes = [...container.querySelectorAll(".jx-sb-row .sf-cls")].map((el) => el.textContent);
    expect(codes).not.toContain("3A"); /* 12484 ka WL class chhup gaya */
    expect(codes.sort()).toEqual(["2A", "SL"]);
    expect(container.querySelectorAll(".jx-sb-row .sf-badge.wl").length).toBe(0);
    expect(container.querySelectorAll(".jx-sb-row .sf-badge.avl, .jx-sb-row .sf-badge.rac").length).toBe(2);
  });

  it("‘Sabhi trains’ par wapas saari classes (WL bhi) dikhti hain — kuch chhupta nahi", async () => {
    const { container } = render(<JourneyOptions plan={planWith()} onPickClass={vi.fn()} onPickTrain={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/Sirf AVAILABLE aur RAC wali trains/));
    fireEvent.click(screen.getByText(/🚆 Sabhi trains/));
    await waitFor(() => {
      const codes = [...container.querySelectorAll(".jx-sb-row .sf-cls")].map((el) => el.textContent);
      expect(codes).toContain("3A");
    });
    const nums = [...new Set([...container.querySelectorAll(".jx-sb-row .jx-no")].map((el) => el.textContent))];
    expect(nums).toContain("20808");
  });
});

/* ── 2. Review screen: sirf Continue to IRCTC ── */
const train: TrainResult = {
  number: "12484",
  name: "ASR TVCN SF EXP",
  type: "",
  from: { code: "ASR", name: "Amritsar Junction", city: "Amritsar Junction" },
  to: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana Junction" },
  date: "2026-09-27",
  departure: "05:55",
  arrival: "08:20",
  arrivalDayOffset: 0,
  durationMinutes: 145,
  durationLabel: "2h 25m",
  runsOn: [],
  classes: [{ code: "SL", label: "Sleeper", status: "AVAILABLE", seats: 102, fare: 100, source: "web_confirmtkt" }],
};

function seedReview() {
  sessionStorage.setItem(
    "railbook.booking.v1",
    JSON.stringify({
      screen: "review",
      flow: "REVIEW_READY",
      date: "2026-09-27",
      dateProvided: true,
      passengerCount: 1,
      paxProvided: true,
      trains: [train],
      selectedTrain: train,
      selectedClass: train.classes[0],
      seatPreference: "Lower",
      passengers: [{ id: "p1", name: "Mohit", age: "25", gender: "MALE", berthPreference: "Lower" }],
      contact: { mobile: "9876543210", email: "", whatsappOptIn: true },
      previewFare: { baseFare: 100, serviceFee: 0, total: 100 },
    }),
  );
}

describe("Round-23 · review page par sirf Continue to IRCTC", () => {
  beforeEach(() => {
    sessionStorage.clear();
    seedReview();
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
      const u = String(url);
      const body = u.includes("/api/wallet")
        ? { wallet: { balance: 10000, currency: "INR", transactions: [] } }
        : u.includes("/api/meta")
          ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
          : u.includes("/api/bookings")
            ? { bookings: [] }
            : {};
      return { ok: true, json: async () => body };
    });
  });
  afterEach(() => sessionStorage.clear());

  it("sirf handoff card — summary/wallet/Confirm Booking/copy sab nahi", async () => {
    const { container } = render(
      <BookingProvider>
        <FareReview />
      </BookingProvider>,
    );
    await waitFor(() => expect(container.querySelector("#irctc-continue")).toBeTruthy());
    /* Continue button hai (page title aur aria-label bhi wahi hai — role se pakdo) */
    expect(screen.getByRole("button", { name: "Continue to IRCTC" })).toBeTruthy();

    /* ye sab hat gaye */
    expect(container.querySelector(".sticky-cta")).toBeNull();
    expect(container.querySelector(".summary")).toBeNull();
    expect(screen.queryByText(/Confirm Booking/)).toBeNull();
    expect(screen.queryByText(/Wallet/)).toBeNull();
    expect(screen.queryByText(/Base fare/)).toBeNull();
    expect(screen.queryByText(/Service fee/)).toBeNull();
    expect(screen.queryByText(/^Total/)).toBeNull();
    expect(screen.queryByText(/Copy journey \+ passenger summary/)).toBeNull();
    expect(container.querySelector("#irctc-handoff-summary")).toBeNull();
    expect(screen.queryByText(/Copy-ready summary/i)).toBeNull();
    /* honest line rehti hai */
    expect(container.textContent).toMatch(/auto-submit nahi hota/i);
  });
});
