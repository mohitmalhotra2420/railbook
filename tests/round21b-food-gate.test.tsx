/* Round-21b (25 Sep 2026, client) — user: "RailBook me food choice dikh raha hai par IRCTC me nahi.
 * Kuch bhi fake mat rakho — jis train me food choice hai hi nahi to kyun dikha rahe."
 *
 * Verify (jsdom, real Passengers view + /pantry payload):
 *   • foodChoiceExpected true  → "Food choice" dropdown dikhta hai + green catering line (evidence ke saath).
 *   • conflict (erail haan / confirmtkt na) → dropdown NAHI, amber honest line (dono sources likhe hue).
 *   • dono sources na → dropdown NAHI + "pantry/catering nahi mili" line.
 *   • data provider se na aaye (options missing) → dropdown NAHI, honest line (guess nahi).
 * Server ka gate hi single source hai — client khud kuch maan kar nahi dikhata.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../src/voice/speakGuide", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/voice/speakGuide")>();
  return { ...actual, speakGuide: vi.fn(), cancelGuide: vi.fn() };
});

import { BookingProvider } from "../src/booking/context";
import { Passengers } from "../src/views/Passengers";
import type { TrainResult } from "../src/types";

const train: TrainResult = {
  number: "12716",
  name: "SACHKHAND EXP",
  type: "",
  from: { code: "ASR", name: "Amritsar Junction", city: "Amritsar Junction" },
  to: { code: "NDLS", name: "New Delhi", city: "New Delhi" },
  date: "2026-09-26",
  departure: "05:30",
  arrival: "12:45",
  arrivalDayOffset: 0,
  durationMinutes: 435,
  durationLabel: "7h 15m",
  runsOn: [],
  classes: [{ code: "1A", label: "AC First Class", status: "AVAILABLE", seats: 2, fare: 1830, source: "railyatri" }],
};

type PantryBody = Record<string, unknown>;

function stubApi(pantry: PantryBody) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    const u = String(url);
    const body = u.includes("/pantry")
      ? pantry
      : u.includes("/api/meta")
        ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 50 }
        : u.includes("/api/wallet")
          ? { wallet: { balance: 10000, currency: "INR", transactions: [] } }
          : u.includes("/api/bookings")
            ? { bookings: [] }
            : {};
    return { ok: true, json: async () => body };
  });
}

function seed() {
  sessionStorage.setItem(
    "railbook.booking.v1",
    JSON.stringify({
      screen: "passengers",
      flow: "PASSENGERS_PENDING",
      date: "2026-09-26",
      dateProvided: true,
      passengerCount: 1,
      paxProvided: true,
      trains: [train],
      selectedTrain: train,
      selectedClass: train.classes[0],
      seatPreference: "No Preference",
      passengers: [{ id: "p1", name: "", age: "", gender: "", berthPreference: "" }],
      contact: { mobile: "", email: "", whatsappOptIn: true },
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  seed();
});
afterEach(() => sessionStorage.clear());

describe("Round-21b · catering gate (sirf real + saaf data par food choice)", () => {
  it("foodChoiceExpected true → dropdown + green line + evidence dikhti hai", async () => {
    stubApi({
      trainNumber: "12716",
      pantry: true,
      sources: { erail: true, confirmtkt: true },
      conflict: false,
      premiumCatering: false,
      foodChoiceExpected: true,
      evidence: ["erail (IR timetable): pantry available"],
      providers: ["web_erail"],
      note: null,
    });
    const { container } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/Food choice/i)).toBeTruthy());
    const note = container.querySelector(".pax-catering") as HTMLElement;
    expect(note.className).toContain("yes");
    expect(note.textContent).toMatch(/catering hai/i);
    expect(note.textContent).toMatch(/erail \(IR timetable\): pantry available/);
  });

  it("conflict (erail haan, confirmtkt na — 12716 jaisa asli case) → dropdown NAHI, honest line", async () => {
    stubApi({
      trainNumber: "12716",
      pantry: true,
      sources: { erail: true, confirmtkt: false },
      conflict: true,
      premiumCatering: false,
      foodChoiceExpected: false,
      evidence: ["erail (IR timetable): pantry available", "confirmtkt: HasPantry false"],
      providers: ["web_erail", "web_confirmtkt"],
      note: "catering data me sources alag-alag hain",
    });
    const { container } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    const note = await waitFor(() => {
      const el = container.querySelector(".pax-catering");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(note.className).toContain("warn");
    expect(note.textContent).toMatch(/sources aapas me alag/i);
    expect(note.textContent).toMatch(/confirmtkt: HasPantry false/);
    expect(container.querySelector("#food-p1")).toBeNull();
    expect(screen.queryByLabelText(/Food choice/i)).toBeNull();
  });

  it("dono sources na → dropdown nahi + eCatering wali honest line", async () => {
    stubApi({
      trainNumber: "12497",
      pantry: false,
      sources: { erail: false, confirmtkt: false },
      conflict: false,
      premiumCatering: false,
      foodChoiceExpected: false,
      evidence: ["erail (IR timetable): pantry not available", "confirmtkt: HasPantry false"],
      providers: ["web_erail", "web_confirmtkt"],
      note: "is train me pantry/catering nahi mili",
    });
    const { container } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    const note = await waitFor(() => {
      const el = container.querySelector(".pax-catering");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(note.textContent).toMatch(/pantry\/catering nahi mili/i);
    expect(container.querySelector("#food-p1")).toBeNull();
  });

  it("purana payload shape (sirf pantry boolean) → conservatively kuch nahi dikhata (guess nahi)", async () => {
    stubApi({ trainNumber: "12716", pantry: true, providers: ["web_erail"], note: null });
    const { container } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    await waitFor(() => expect(container.querySelector(".pax-trip")).toBeTruthy());
    expect(container.querySelector("#food-p1")).toBeNull();
  });
});
