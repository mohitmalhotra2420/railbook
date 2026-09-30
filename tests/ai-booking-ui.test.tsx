/* ══ Round-62 (AI Booking) — UI + voice + integration (focused) ════════════════════════════════════════
 * Yahan asli component (src/views/AiBooking.tsx) chalta hai, asli booking context ke saath:
 *   • text/voice dono ek hi state chalate hain,
 *   • search maujooda api (/api/trains) se hota hai — trains list ke bina kuch nahi dikhta,
 *   • train cards maujooda TrainClassBlock hain,
 *   • "AI Book" tab aata hai jab train+class chuni jaaye,
 *   • mic sirf user ke tap par (Listening…), background listening nahi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../src/voice/speakGuide", () => ({
  speakGuide: vi.fn(),
  cancelGuide: vi.fn(),
  /* R63-fix: adapter ab user gesture par TTS unlock karta hai — mock me bhi hona chahiye. */
  unlockSpeech: vi.fn(),
  passengerAskLine: vi.fn(() => ""),
  afterPassengerFill: vi.fn(() => ""),
}));

/* Voice input ko controllable banate hain — asli hook SpeechRecognition maangta hai (jsdom me nahi). */
const voiceState: { listening: boolean; interim: string; transcript: string } = { listening: false, interim: "", transcript: "" };
vi.mock("../src/voice/useVoiceInput", () => ({
  useVoiceInput: (onTranscript: (t: string) => void) => ({
    listening: voiceState.listening,
    supported: true,
    status: voiceState.listening ? "Sun raha hoon" : "Tap to speak",
    interim: voiceState.interim,
    level: 0.4,
    start: async () => {
      voiceState.listening = true;
      return null;
    },
    stop: () => {
      voiceState.listening = false;
    },
    toggle: async () => null,
    commit: () => {
      voiceState.listening = false;
      if (voiceState.transcript) onTranscript(voiceState.transcript);
    },
    cancel: () => {
      voiceState.listening = false;
    },
  }),
}));

import { AiBooking } from "../src/views/AiBooking";
import { BookingProvider } from "../src/booking/context";
import type { TrainResult } from "../src/types";

const ASR = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };
const LDH = { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" };

const train: TrainResult = {
  number: "12014",
  name: "Amritsar Shatabdi",
  type: "Superfast",
  from: ASR,
  to: LDH,
  date: "2026-10-01",
  departure: "07:10",
  arrival: "09:05",
  arrivalDayOffset: 0,
  durationMinutes: 115,
  durationLabel: "1h 55m",
  runsOn: [0, 1, 2, 3, 4, 5, 6],
  classes: [
    { code: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 425, seats: 40 },
    { code: "2S", label: "Second Sitting", status: "WAITLIST", fare: 175, waitlist: 12 },
  ],
};

function mockFetch(trains: TrainResult[] = [train]) {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    const u = String(url);
    const body = u.includes("/api/wallet")
      ? { wallet: { balance: 5000, currency: "INR", transactions: [] } }
      : u.includes("/api/meta")
        ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
        : u.includes("/api/voice/config")
          ? { provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] }
          : u.includes("/pantry")
            ? { pantry: true, providers: ["confirmtkt"], note: null, foodChoiceExpected: true }
          : u.includes("/api/trains")
            ? { trains, recommendations: [], empty: trains.length === 0 }
            : u.includes("/api/availability")
              ? { availability: { code: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 425, seats: 40 }, bookable: true }
              : u.includes("/api/fare")
                ? { fare: { baseFare: 850, serviceFee: 0, total: 850 } }
                : { bookings: [] };
    return { ok: true, json: async () => body } as unknown as Response;
  });
}

function open() {
  return render(
    <BookingProvider>
      <AiBooking open onClose={() => undefined} />
    </BookingProvider>,
  );
}

async function type(text: string) {
  const input = screen.getByLabelText("AI Booking me type karo") as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.submit(input.closest("form") as HTMLFormElement);
  });
}

describe("AI Booking UI — entry, greeting, stages", () => {
  beforeEach(() => {
    sessionStorage.clear();
    voiceState.listening = false;
    voiceState.interim = "";
    voiceState.transcript = "";
    mockFetch();
  });
  afterEach(() => sessionStorage.clear());

  it("khulte hi greeting + stage strip + mic button dikhta hai", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    expect(screen.getAllByText(/kahan se jaana/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Journey").length).toBeGreaterThan(0); // stage strip ka current step
    expect(screen.getByLabelText("🎙️ Talk to RailBook")).toBeTruthy();
    /* jsdom me speechSynthesis nahi hota → chip sach bolti hai ("output nahi"); browser me "device". */
    expect(screen.getByText(/voice: (device|output nahi)/)).toBeTruthy();
  });

  it("text se poori journey: asli search + maujooda TrainBoard screen + dock me train ka sawaal", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("1 October ko Amritsar se Ludhiana jaana hai, 2 passengers hain");
    /* Search ke baad maujooda flow results screen kholta hai → AI Booking dock ban jaata hai
     * (purani screen band nahi hoti, AI neeche rehti hai). */
    await waitFor(() => expect(screen.getByRole("region", { name: "AI Booking" })).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("aib-dock-status").textContent).toMatch(/kaunsi train leni hai/i));
    const calls = ((globalThis as unknown as { fetch: { mock: { calls: unknown[][] } } }).fetch.mock.calls).map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/trains?from=ASR&to=LDH&date=2026-10-01"))).toBe(true);
  });

  it("dock se train batao → AI khud class poochhta hai; class par passenger form khud khulta hai", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Amritsar se Ludhiana 1 October, 2 passengers");
    await waitFor(() => expect(screen.getByRole("region", { name: "AI Booking" })).toBeTruthy());
    await type("12014");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/12014 Amritsar Shatabdi select kar liya/i));
    expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/kaunsi class chahiye/i);
    await type("CC");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/passenger form khol rahi hoon/i));
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/Passenger 1 ka naam/i));
  });

  it("list me na hone wali train par saaf jawab (koi invent nahi)", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Amritsar se Ludhiana 1 October, 2 passengers");
    await waitFor(() => expect(screen.getByRole("region", { name: "AI Booking" })).toBeTruthy());
    await type("99999");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/nahi hai/i));
    expect(screen.queryByTestId("aib-book")).toBeNull();
  });

  it("FULL AUTOMATION: journey → train → class → passengers (food bhi) → review khud → haan par IRCTC khud click", async () => {
    /* Maujooda "Continue to IRCTC" button ki jagah dummy — dekhte hain AI usi ko click karta hai. */
    let irctcClicked = false;
    const dummy = document.createElement("button");
    dummy.id = "irctc-continue";
    dummy.addEventListener("click", () => {
      irctcClicked = true;
    });
    document.body.appendChild(dummy);

    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());

    await type("Amritsar se Ludhiana 1 October, 2 passengers");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/kaunsi train leni hai/i));

    await type("12014");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/kaunsi class chahiye/i));
    await type("CC");

    /* passenger form khud khulta hai; AI ek-ek detail maangta hai (berth → khaana, pantry me food hai) */
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/Passenger 1 ka naam/i));
    await type("Rahul Sharma, 31, male, window");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/khaana/i));
    await type("veg");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/Passenger 2 ka naam/i));
    await type("Neha, 28, female, window");
    /* passenger 2 ka khaana bhi (pantry me food hai) */
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/Passenger 2 ke liye khaana/i));
    await type("no food");

    /* saari details complete → AI khud review booking kholta hai + final question */
    await waitFor(() => expect(screen.getByTestId("aib-summary")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/final details hain ya kuch edit/i));
    const summary = screen.getByTestId("aib-summary").textContent ?? "";
    expect(summary).toMatch(/Amritsar Junction → Ludhiana Junction/);
    expect(summary).toMatch(/Train: 12014/);
    expect(summary).toMatch(/Class: CC/);
    expect(summary).toMatch(/Passenger 1: Rahul Sharma/);
    expect(summary).toMatch(/Passenger 2: Neha/);

    /* user "haan" → AI khud Continue to IRCTC click karta hai (autofill layer waise hi) */
    expect(irctcClicked).toBe(false);
    await type("haan theek hai");
    await waitFor(() => expect(irctcClicked).toBe(true));
    expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/Continue to IRCTC dab rahi hoon/i);
    document.body.removeChild(dummy);
  });

  it('correction "Actually 2 October kar do" → nayi date se FRESH search, route same', async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Amritsar se Ludhiana 1 October, 2 passengers");
    await waitFor(() => expect(screen.getByRole("region", { name: "AI Booking" })).toBeTruthy());
    await type("Actually 2 October kar do");
    await waitFor(() => {
      const calls = ((globalThis as unknown as { fetch: { mock: { calls: unknown[][] } } }).fetch.mock.calls).map((c) => String(c[0]));
      expect(calls.some((u) => u.includes("/api/trains?from=ASR&to=LDH&date=2026-10-02"))).toBe(true);
    });
    /* route/pax preserve: nayi search usi ASR→LDH par, aur flow aage badha (trains ka jawab) */
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/Fri, 2 Oct, 2026 ko 1 train mili/i));
    expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/kaunsi train leni hai/i);
  });

  it("khaali result par honest line (trains invent nahi hote)", async () => {
    mockFetch([]);
    const { container } = open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Amritsar se Ludhiana 1 October, 2 passengers");
    await waitFor(() => expect(screen.getAllByText(/verified train data nahi mila/i).length).toBeGreaterThan(0));
    expect(container.querySelector(".sf-group")).toBeNull();
  });
});

describe("AI Booking UI — voice mode", () => {
  beforeEach(() => {
    sessionStorage.clear();
    voiceState.listening = false;
    voiceState.interim = "Amritsar se Ludhiana";
    voiceState.transcript = "Amritsar se Ludhiana 1 October, 2 passengers";
    mockFetch();
  });
  afterEach(() => sessionStorage.clear());

  it("mic tap par Listening… + voice panel (mute/stop/type/end) — background listening nahi", async () => {
    const { container } = open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    expect(screen.queryByTestId("aib-voice")).toBeNull(); // shuru me kuch sun nahi raha
    await act(async () => {
      fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook"));
    });
    await waitFor(() => expect(screen.getByTestId("aib-voice")).toBeTruthy());
    expect(screen.getByText(/Listening/)).toBeTruthy();
    expect(screen.getByText("🔊 Mute")).toBeTruthy();
    expect(screen.getByText("⏹ Stop")).toBeTruthy();
    expect(screen.getByText("⌨️ Type instead")).toBeTruthy();
    expect(screen.getByText("✕ End voice")).toBeTruthy();
    /* Voice se aaya text bhi wahi flow chalta hai → asli search (maujooda screen + AI dock) */
    await act(async () => {
      fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook")); // ✓ = commit
    });
    await waitFor(() => expect(screen.getByRole("region", { name: "AI Booking" })).toBeTruthy());
    const calls = ((globalThis as unknown as { fetch: { mock: { calls: unknown[][] } } }).fetch.mock.calls).map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/trains"))).toBe(true);
    void container;
  });

  it("voice + typing ek hi booking state use karte hain (Amritsar→Ludhiana voice, date+pax typing)", async () => {
    voiceState.transcript = "Amritsar se Ludhiana";
    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook"));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook"));
    });
    await waitFor(() => expect(screen.getAllByText(/kis date ko/i).length).toBeGreaterThan(0));
    await type("1 October, 2 passengers");
    /* Ship journey voice se, date+pax typing se — dono ek hi flow: asli search chali */
    await waitFor(() => expect(screen.getByRole("region", { name: "AI Booking" })).toBeTruthy());
    const calls = ((globalThis as unknown as { fetch: { mock: { calls: unknown[][] } } }).fetch.mock.calls).map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/trains?from=ASR&to=LDH&date=2026-10-01"))).toBe(true);
  });
});
