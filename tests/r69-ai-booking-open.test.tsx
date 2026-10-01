/* R69 — "AI Booking khulta hi nahi" ka pakka guard. Asli app me "🎫 AI Booking" dabane par:
 * User: "AI booking open nhi ho rha". Ye test bilkul wahi path chalta hai jo browser/app chalta hai:
 *   BookingProvider → App → Concierge → 🎫 AI Booking click → AiBooking render.
 * Pass hone ka matlab: koi boundary card ("dikha nahi paaya") nahi, dialog/app kholta hai.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../src/voice/speakGuide", () => ({
  speakGuide: vi.fn(),
  cancelGuide: vi.fn(),
  unlockSpeech: vi.fn(),
  passengerAskLine: vi.fn(() => ""),
  afterPassengerFill: vi.fn(() => ""),
}));

vi.mock("../src/voice/useVoiceInput", () => ({
  useVoiceInput: () => ({
    listening: false,
    supported: true,
    status: "Tap to speak",
    interim: "",
    level: 0,
    start: async () => null,
    stop: () => undefined,
    toggle: async () => null,
    commit: () => undefined,
    cancel: () => undefined,
  }),
}));

/* Crash injection: aiBookingSummaryLines sirf AiBooking ke RENDER me use hota hai (grep se
 * confirm) — isse ek render error ban jata hai, jo panel ke naye crash-guard me qaid hona chahiye. */
const boom = { value: false };
vi.mock("../src/ai/aiBookingFlow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ai/aiBookingFlow")>();
  return {
    ...actual,
    aiBookingSummaryLines: (args: Parameters<typeof actual.aiBookingSummaryLines>[0]) => {
      if (boom.value) throw new Error("boom (test injection)");
      return actual.aiBookingSummaryLines(args);
    },
  };
});

import { App } from "../src/App";
import { needsFreshReload } from "../src/views/AiBooking";
import { BookingProvider } from "../src/booking/context";

const junk = {
  trains: [],
  recommendations: [],
  empty: true,
};

function mockFetch(versionCommit?: string) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    const u = String(url);
    const body = u.includes("/api/version")
      ? { commit: versionCommit }
      : u.includes("/api/wallet")
      ? { wallet: { balance: 5000, currency: "INR", transactions: [] } }
      : u.includes("/api/meta")
        ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
        : u.includes("/api/voice/config")
          ? { provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] }
          : u.includes("/api/pantry")
            ? { pantry: true, providers: ["confirmtkt"], note: null, foodChoiceExpected: true }
            : u.includes("/api/trains")
              ? junk
              : u.includes("/api/bookings")
                ? { bookings: [] }
                : { ok: true };
    return { ok: true, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  });
}

describe("R69: asli app se AI Booking entry — khule, toote na, purana bundle pakde", () => {
  let errors: unknown[][] = [];
  beforeEach(() => {
    errors = [];
    sessionStorage.clear();
    mockFetch();
    const orig = console.error;
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errors.push(a);
      orig(...(a as []));
    });
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("App → 🎫 AI Booking dabao → panel khule (koi boundary crash nahi)", async () => {
    render(
      <BookingProvider>
        <App />
      </BookingProvider>,
    );
    const btn = await screen.findByLabelText("AI Booking");
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    /* boundary card nahi hona chahiye */
    expect(document.body.textContent).not.toMatch(/dikha nahi paaya/);
    expect(document.body.textContent).not.toMatch(/Rendered more hooks|#310/);
    const hookErr = errors.find((e) => String(e[0]).match(/hooks|310|Rendered more/i));
    expect(hookErr ?? null).toBeNull();
  });

  it("panel ke andar kuch toote to sirf AIt Booking ka chhota card — poora chat zinda rehta hai", async () => {
    render(
      <BookingProvider>
        <App />
      </BookingProvider>,
    );
    const btn = await screen.findByLabelText("AI Booking");
    boom.value = true;
    await act(async () => {
      fireEvent.click(btn);
    });
    /* panel ki jagah crash-guard card */
    await waitFor(() => expect(document.body.textContent).toMatch(/AI Booking dikha nahi paaya/));
    /* aur poora chat abhi bhi zinda hai (App-level "chat dikha nahi paaya" NAHI) */
    expect(document.body.textContent).not.toMatch(/chat dikha nahi paaya/);
    expect(screen.getByLabelText("AI Booking")).toBeTruthy();
    /* Dobara try se panel wapas khulna chahiye (ab crash ki wajah hata di) */
    boom.value = false;
    await act(async () => {
      fireEvent.click(screen.getByText(/Dobara try/));
    });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
  });

  it("server ka commit hi mera build hai → koi note, koi reload nahi", async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload: reloadSpy } });
    mockFetch("0006eb4");
    render(
      <BookingProvider>
        <App />
      </BookingProvider>,
    );
    const btn = await screen.findByLabelText("AI Booking");
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });
    expect(screen.queryByTestId("aib-fresh-note")).toBeNull();
    expect(sessionStorage.getItem("rb_build_refresh_once")).toBeNull();
  });

  describe("purana bundle pakadna (app me page zinda rehta hai — deploy ke baad bhi purana JS)", () => {
    it("alag commit → taaza karo; same / dev / kachra → kuch nahi", () => {
      expect(needsFreshReload("0006eb4 · 2026-09-30 20:00Z", "0006eb4")).toBe(false);
      expect(needsFreshReload("0006eb4 · x", "c5bee8c")).toBe(true);
      expect(needsFreshReload("c5bee8c", "C5BEE8C")).toBe(false); /* case-insensitive */
      expect(needsFreshReload("dev · x", "c5bee8c")).toBe(false); /* local dev par reload nahi */
      expect(needsFreshReload("test-build", "c5bee8c")).toBe(false); /* test harness */
      expect(needsFreshReload("0006eb4", "")).toBe(false); /* server ne kuch nahi diya */
      expect(needsFreshReload("0006eb4", "unknown")).toBe(false);
      expect(needsFreshReload("", "c5bee8c")).toBe(false);
    });

    it("open hote waqt /api/version check hota hai — purana build mile to saaf bolkar ek baar taaza", async () => {
      mockFetch("deadbee");
      const calls: string[] = [];
      const inner = (globalThis as unknown as { fetch: { mock: { calls: unknown[][] } } }).fetch;
      const spyFetch = vi.fn(async (url: string) => {
        calls.push(String(url));
        return inner(url as unknown as RequestInfo);
      });
      (globalThis as unknown as { fetch: unknown }).fetch = spyFetch;
      render(
        <BookingProvider>
          <App />
        </BookingProvider>,
      );
      const btn = await screen.findByLabelText("AI Booking");
      await act(async () => {
        fireEvent.click(btn);
      });
      await waitFor(() => expect(calls.some((u) => u.includes("/api/version"))).toBe(true));
      /* server "deadbee" bol raha hai, mera build tag alag → saaf note + ek baar reload */
      await waitFor(() => expect(screen.getByTestId("aib-fresh-note").textContent).toMatch(/Naya version/i));
      /* reload ka faisla ho gaya (session me ek hi baar) — page taaza hone ke raste par hai */
      await waitFor(() => expect(sessionStorage.getItem("rb_build_refresh_once")).toBe("1"));
      /* panel bhi khula hai (reload se pehle user ko kuch dikhna chahiye) */
      expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy();
    });
  });
});
