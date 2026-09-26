/* Round-24 (26 Sep 2026, user screenshots) — teen cheezein:

 * 1) "Review fare ki jagah Review journey aana chahiye" → CTA + voice prompt + prompt line me
 *    "Review journey".
 * 2) "Uski page pe journey summary (jo bhi user ne details fill ki hongi) show ho aur uske NEECHE
 *    Continue to IRCTC — uske elawa us page pe kuch mat rakhna" → review page = journey receipt
 *    (Train/Date/From → To/Class/Seat/Passengers/Base fare/Service fee/Total) + passenger/contact
 *    rows, phir handoff card. Wallet / Confirm Booking / copy / note nahi.
 * 3) Device par passengers page khaali (sirf background) dikh raha tha + "SAB READY" ke saath
 *    bharne ke liye kuch nahi tha → (a) passengers list khaali ho to blank card khud banta hai,
 *    (b) screen khulte hi scroll top par + resize par clamp (keyboard ke baad blank na dikhe).
 *    Saath me purane WebView ke liye `vh` / explicit-offset fallbacks CSS me.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("../src/voice/speakGuide", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/voice/speakGuide")>();
  return { ...actual, speakGuide: vi.fn(), cancelGuide: vi.fn() };
});

import { BookingProvider } from "../src/booking/context";
import { FareReview } from "../src/views/ReviewStatus";
import { Passengers } from "../src/views/Passengers";
import type { TrainResult } from "../src/types";

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

const filledPax = { id: "p1", name: "Mohit Kumar", age: "38", gender: "MALE", berthPreference: "Lower" };
const secondPax = { id: "p2", name: "Asha Devi", age: "35", gender: "FEMALE", berthPreference: "Upper", foodChoice: "VEG" };

function stubApi(pantry: boolean | null) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    const u = String(url);
    const body = u.includes("/pantry")
      ? { trainNumber: "12484", pantry, sources: { erail: pantry === true, confirmtkt: pantry === true }, conflict: false, foodChoiceExpected: pantry === true, evidence: [], providers: pantry == null ? [] : ["web_erail"], note: null }
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

function seed(extra: Record<string, unknown> = {}) {
  sessionStorage.setItem(
    "railbook.booking.v1",
    JSON.stringify({
      screen: "review",
      flow: "FARE_REVIEW",
      date: "2026-09-27",
      dateProvided: true,
      passengerCount: 2,
      paxProvided: true,
      trains: [train],
      selectedTrain: train,
      selectedClass: train.classes[0],
      seatPreference: "Lower",
      passengers: [filledPax, secondPax],
      contact: { mobile: "9876543210", email: "mohit@example.com", whatsappOptIn: true },
      previewFare: { baseFare: 200, serviceFee: 50, total: 250 },
      ...extra,
    }),
  );
}

function renderReview() {
  return render(
    <BookingProvider>
      <FareReview />
    </BookingProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  stubApi(true);
});
afterEach(() => sessionStorage.clear());

describe("Round-24 · review page = journey receipt + sirf Continue to IRCTC", () => {
  it("journey summary me wahi data jo user ne bhara (train/date/route/class/seat/passengers/fare)", async () => {
    seed();
    const { container } = renderReview();
    const receipt = await waitFor(() => {
      const el = container.querySelector("#rv-journey");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const text = receipt.textContent ?? "";
    expect(text).toContain("12484 ASR TVCN SF EXP");
    /* date formatter engine/locale ke hisaab se "Sun, 27 Sept, 2026" ya "27 September 2026" deta hai. */
    expect(text).toMatch(/27 Sept?e?m?b?e?r?,? 2026/);
    expect(text).toContain("ASR → LDH");
    expect(text).toContain("Sleeper");
    expect(text).toContain("Lower");
    expect(text).toContain("Mohit Kumar, Asha Devi");
    expect(text).toContain("₹200"); /* base fare — server/preview fare se */
    expect(text).toContain("₹50"); /* service fee */
    expect(text).toContain("₹250"); /* total */
  });

  it("passenger + contact ki poori detail dikhti hai (naam · umar · gender · berth · khaana)", async () => {
    seed();
    const { container } = renderReview();
    const block = await waitFor(() => {
      const el = container.querySelector("#rv-passengers");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    const rows = [...block.querySelectorAll(".row")].map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("Passenger 1");
    expect(rows[0]).toContain("Mohit Kumar");
    expect(rows[0]).toContain("38 yrs");
    expect(rows[0]).toContain("Male");
    expect(rows[0]).toContain("Lower");
    expect(rows[1]).toContain("Passenger 2");
    expect(rows[1]).toContain("Asha Devi");
    expect(rows[1]).toContain("35 yrs");
    expect(rows[1]).toContain("Female");
    expect(rows[1]).toContain("Veg meal"); /* food choice (jab bhara ho) */
    expect(block.textContent).toContain("9876543210");
    expect(block.textContent).toContain("mohit@example.com");
  });

  it("Continue to IRCTC summary ke NEECHE hai — aur page par uske elawa kuch nahi", async () => {
    seed();
    const { container } = renderReview();
    const button = await waitFor(() => {
      const el = container.querySelector("#irctc-continue");
      expect(el).toBeTruthy();
      return el as HTMLButtonElement;
    });
    expect(button.textContent).toBe("Continue to IRCTC");
    const summary = container.querySelector("#rv-journey") as HTMLElement;
    /* DOM order: summary pehle, button baad me (neeche). */
    expect(summary.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    /* wallet / Confirm Booking / copy / purane notes — sab gayab */
    expect(screen.queryByText(/Wallet/)).toBeNull();
    expect(screen.queryByText(/Confirm Booking/)).toBeNull();
    expect(container.querySelector(".sticky-cta")).toBeNull();
    expect(screen.queryByText(/Copy journey \+ passenger summary/)).toBeNull();
    expect(screen.queryByText(/Copy-ready summary/i)).toBeNull();
    expect(screen.queryByText(/Nothing is confirmed/i)).toBeNull();
    expect(screen.queryByText(/IRCTC par booking/)).toBeNull();
    /* honest baat button ke title par (UI me extra line nahi) */
    expect(button.getAttribute("title")).toMatch(/auto-submit nahi/i);
    /* page title bhi Review journey */
    expect(container.textContent).toContain("Review journey");
  });

  it("fare unknown ho (railway fare nahi aaya) to guess nahi — honest line", async () => {
    seed({ previewFare: { baseFare: 0, serviceFee: 0, total: 0, railwayAvailable: false } });
    const { container } = renderReview();
    const receipt = await waitFor(() => {
      const el = container.querySelector("#rv-journey");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(receipt.textContent).toContain("Fare unavailable");
    expect(receipt.textContent).not.toContain("₹0");
  });
});

describe("Round-24 · Passengers screen — Review journey + khaali page ka guard", () => {
  const seedPassengers = (passengers: unknown[]) =>
    seed({
      screen: "passengers",
      flow: "PASSENGERS_PENDING",
      passengers,
    });

  it("CTA aur prompt dono 'Review journey' kehte hain", async () => {
    seedPassengers([filledPax]);
    render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    const cta = await waitFor(() => {
      const el = document.querySelector(".sticky-cta button") as HTMLButtonElement | null;
      expect(el).toBeTruthy();
      return el as HTMLButtonElement;
    });
    await waitFor(() => expect(cta.textContent).toBe("Review journey"));
    await waitFor(() => expect(document.querySelector(".vb-prompt")?.textContent).toMatch(/Review journey dabaiye/));
    expect(document.body.textContent).not.toMatch(/Review fare/);
  });

  it("passengers list khaali mil jaye to khud ek card banata hai (khaali blank page nahi)", async () => {
    seedPassengers([]);
    render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll(".pax-card").length).toBeGreaterThan(0));
    expect(document.body.textContent).toMatch(/Passenger 1/);
  });

  it("screen khulte hi scroller top par hota hai (device par blank hissa na dikhe)", async () => {
    seedPassengers([filledPax]);
    const { container } = render(
      <BookingProvider>
        <Passengers />
      </BookingProvider>,
    );
    const scroller = await waitFor(() => {
      const el = container.querySelector(".dock-scroll");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    scroller.scrollTop = 640;
    window.dispatchEvent(new Event("resize"));
    expect(scroller.scrollTop).toBeLessThanOrEqual(1);
  });
});

describe("Round-24 · purane Android WebView ke liye CSS fallback", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
  it("dvh se pehle vh, inset se pehle explicit offsets", () => {
    expect(css).toMatch(/min-height: 100vh;\s*\n\s*min-height: 100dvh;/);
    /* Round-28: overlay ab viewport se bandha hai (fixed + vh/dvh fallback) — dekho round28 test. */
    expect(css).toMatch(/\.overlay-screen \{[^}]*position: fixed;[^}]*height: 100vh;\s*\n\s*height: 100dvh;/);
    expect(css).toContain(".jx-page{position:fixed;top:0;right:0;bottom:0;left:0;inset:0;");
    expect(css).toContain(".vs-scrim{position:fixed;top:0;right:0;bottom:0;left:0;inset:0;");
  });
});
