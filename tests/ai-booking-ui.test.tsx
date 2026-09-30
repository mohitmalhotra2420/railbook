/* ══ Round-62 (AI Booking) — UI + voice + integration (focused) ════════════════════════════════════════
 * Yahan asli component (src/views/AiBooking.tsx) chalta hai, asli booking context ke saath:
 *   • text/voice dono ek hi state chalate hain,
 *   • search maujooda api (/api/trains) se hota hai — trains list ke bina kuch nahi dikhta,
 *   • train cards maujooda TrainClassBlock hain,
 *   • "AI Book" tab aata hai jab train+class chuni jaaye,
 *   • mic sirf user ke tap par (Listening…), background listening nahi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
/* R66: voice conversation loop test ke liye — mic kitni baar shuru hua. */
const voiceStartCount = { value: 0 };
vi.mock("../src/voice/useVoiceInput", () => ({
  useVoiceInput: (onTranscript: (t: string) => void) => ({
    listening: voiceState.listening,
    supported: true,
    status: voiceState.listening ? "Sun raha hoon" : "Tap to speak",
    interim: voiceState.interim,
    level: 0.4,
    start: async () => {
      voiceState.listening = true;
      voiceStartCount.value += 1;
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

/* ══ R4 (30 Sep 2026) — user ke screenshots se aaye UI-level fixes ═══════════════════════════════════
 * (a) koi bhi sawaal (chat jaisa) → maujooda chat brain se jawab, booking flow waisi hi.
 * (b) passenger screen ka mic/voice layout: dock ab ek column stack hai (CSS guard).
 * (c) IRCTC autofill: honest line — autofill client ho to "khud bhar di gayi", warna apna button.
 */
describe("R4 — general sawaal, dock layout, IRCTC autofill honesty", () => {
  beforeEach(() => {
    mockFetch();
    sessionStorage.clear();
    voiceState.listening = false;
    voiceState.interim = "";
    voiceState.transcript = "";
  });
  afterEach(() => {
    delete (window as unknown as { __railbookHandoffClaim?: unknown }).__railbookHandoffClaim;
    sessionStorage.clear();
  });

  it("kuch bhi poochho → chat brain se jawab, booking flow state waisi hi rehti hai", async () => {
    const asked: { text?: string }[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/agent")) {
        asked.push(JSON.parse(String(init?.body ?? "{}")) as { text?: string });
        return { ok: true, json: async () => ({ ok: true, fallback: false, reply: "RailBook wallet me ₹5,000 hain.", source: "ai", grounded: true }) } as unknown as Response;
      }
      /* baaki sab wahi purane mock jawab */
      const body = u.includes("/api/wallet")
        ? { wallet: { balance: 5000, currency: "INR", transactions: [] } }
        : u.includes("/api/meta")
          ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
          : u.includes("/api/voice/config")
            ? { provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] }
            : u.includes("/pantry")
              ? { pantry: true, providers: ["confirmtkt"], note: null, foodChoiceExpected: true }
              : u.includes("/api/trains")
                ? { trains: [train], recommendations: [], empty: false }
                : { bookings: [] };
      return { ok: true, json: async () => body } as unknown as Response;
    });

    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Amritsar se Ludhiana 1 October, 2 passengers");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/kaunsi train leni hai/i));

    /* Booking flow ka sawaal chalu hai — beech me general sawaal: jawab brain se aata hai.
     * R67 (user: "edhr bhi AI first rakhein"): brain HAR turn par chalta hai, isliye yahan ek se
     * zyada call normal hai — par sawaal wala text brain tak pahuncha ho aur jawab dikha ho, dono
     * zaroori. */
    await type("wallet me kitne paise hain?");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/wallet me ₹5,000/));
    expect(asked.length).toBeGreaterThanOrEqual(1);
    expect(asked.some((a) => a.text === "wallet me kitne paise hain?")).toBe(true);
    /* flow bilkul nahi badla — train ka sawaal wahi khada hai */
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/kaunsi train leni hai/i));
  });

  it("dock layout: voice controls wrap hote hain, composer apni line par, aur form ke liye jagah (R67)", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const dock = css.slice(css.indexOf(".aib-dock{"), css.indexOf(".aib-dock{") + 420);
    expect(dock).toMatch(/flex-direction:column/);
    /* R67: passenger form par voice panel compact — actions wrap karte hain (overlap nahi). */
    expect(css).toMatch(/\.aib-dock \.aib-voice-actions\{width:auto;flex:1 1 100%;display:flex;flex-wrap:wrap/);
    expect(css).toMatch(/\.aib-dock \.aib-dock-row \.aib-form\{width:100%\}/);
    /* R67: dock khula ho to screen/form ke neeche jagah — aakhri field dock ke peeche na chhupe. */
    expect(css).toMatch(/body\.aib-docked \.passenger-form\{padding-bottom:/);
    /* R67: voice issue line ek compact row (✕ se hataayi ja sakti hai). */
    expect(css).toMatch(/\.aib-voice-issue\{display:flex;align-items:center/);
  });

  it("IRCTC: autofill client na ho to honest line + apna button (jhoothi umeed nahi)", async () => {
    let irctcClicked = false;
    const dummy = document.createElement("button");
    dummy.id = "irctc-continue";
    dummy.addEventListener("click", () => { irctcClicked = true; });
    document.body.appendChild(dummy);

    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Amritsar se Ludhiana 1 October, 1 passenger");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/kaunsi train leni hai/i));
    await type("12014");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/kaunsi class chahiye/i));
    await type("CC");
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/Passenger 1 ka naam/i));
    await type("Rahul Sharma, 31, male, window");
    /* pantry me khaana hai → ek passenger par bhi khaana poochha jaata hai (asli behaviour) */
    await waitFor(() => expect(screen.getByTestId("aib-dock-log").textContent).toMatch(/khaana/i));
    await type("veg");
    await waitFor(() => expect(screen.getByTestId("aib-summary")).toBeTruthy());

    await type("haan");
    /* AI khud handoff karta hai (asli button) → review khula + honest line (koi claim nahi) */
    await waitFor(() => expect(irctcClicked).toBe(true));
    await waitFor(() => expect(screen.getByTestId("aib-handoff-line")).toBeTruthy(), { timeout: 3000 });
    const line = screen.getByTestId("aib-handoff-line").textContent ?? "";
    expect(line).toMatch(/RailBook app \(ya autofill client\) chahiye/);
    /* Is browser me autofill nahi hota — isliye apna button (asli user gesture) */
    const fallback = screen.getByTestId("aib-open-irctc");
    fireEvent.click(fallback);
    expect(irctcClicked).toBe(true);

    /* R4: handoff ke baad bhi koi bhi sawaal → maujooda chat brain (/api/agent) se jawab */
    await type("wallet me kitne paise hain?");
    await waitFor(() => {
      const urls = ((globalThis as unknown as { fetch: { mock: { calls: unknown[][] } } }).fetch.mock.calls).map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/api/agent"))).toBe(true);
    });
    document.body.removeChild(dummy);
  });
});

/* ══ R67 (1 Oct 2026) — AI-first: chat brain (sabhi maujooda tools) har sawaal par, engine wahi ════
 * User: "kyu na hum edhr bhi AI first rakhein … AI ke pass sabhi existing tools ho jo pehle chat mein
 * the, AI khud query samjhe and right tool ka use kare". Do cheezein yahan bandh hoti hain:
 *   • live-status/timing jaisa sawaal (jisme station ka naam ho) ab engine ke "samajh nahi aaya" me
 *     nahi ghulta — jawab brain se aata hai, flow ki state waisi hi rehti hai,
 *   • AI ki apni bola hui line mic ke transcript me ghus kar input nahi banti (echo filter).
 */
/* ══ R68 (1 Oct 2026) — crash fix + har query pehle AI + apne-aap wait messages ═══════════════════════
 * User screenshot: "AI Booking khulte hi — chat dikha nahi paaya / React error #310". Wajah: R67 me ek
 * effect `if (!open) return null` ke NEECHE chala gaya tha → open hote hi ek extra hook (hooks ka kram
 * badla) → crash. Yahan wahi case pin kiya gaya hai, aur saath me naye behaviour ke saath:
 *   • har user message pehle chat brain ke paas jaata hai (slot answers bhi),
 *   • lamba turn me user ki bhasha wali honest line dikhti hai (jargon "Thinking…" nahi).
 */
describe("R68 — crash fix + har query pehle AI + wait line", () => {
  const log = () => (document.querySelector('[data-testid="aib-dock-log"]') ?? document.querySelector(".aib-thread"))?.textContent ?? "";
  const status = () => document.querySelector('[data-testid="aib-dock-status"]')?.textContent ?? "";

  beforeEach(() => {
    sessionStorage.clear();
    voiceState.listening = false;
    voiceState.interim = "";
    voiceState.transcript = "";
  });

  it("AI Booking band se khulta hai — crash nahi (React #310 regression)", async () => {
    const { rerender } = render(
      <BookingProvider>
        <AiBooking open={false} onClose={() => undefined} />
      </BookingProvider>,
    );
    /* Band tha → ab kholte hain (asli app me yahi crash hota tha). */
    rerender(
      <BookingProvider>
        <AiBooking open onClose={() => undefined} />
      </BookingProvider>,
    );
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    /* aur dock mode (screen != home) me jaane par bhi hook ka kram same rehna chahiye */
    await type("Ludhiana se Amritsar, 1 October, 1 passenger");
    await waitFor(() => expect(screen.getByRole("region", { name: "AI Booking" })).toBeTruthy(), { timeout: 8000 });
  }, 25000);

  it("structural guard: early return ke baad koi hook nahi (React #310 dobara na aaye)", () => {
    const src = readFileSync("src/views/AiBooking.tsx", "utf8");
    const idx = src.indexOf("if (!open) return null;");
    expect(idx).toBeGreaterThan(0);
    const tail = src.slice(idx);
    /* JSX/helpers theek hain — bas koi hook (useState/useEffect/useMemo/useCallback/useRef) nahi hona chahiye. */
    const hooks = tail.match(/use(State|Effect|Memo|Callback|Ref|Reducer|LayoutEffect)\s*\(/g) ?? [];
    expect(hooks).toEqual([]);
  });

  it("har query pehle brain ke paas jaati hai (slot answers bhi)", async () => {
    const asked: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/agent")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        asked.push(String(body.text ?? ""));
        return { ok: true, json: async () => ({ ok: true, source: "ai", grounded: true, reply: "" }) } as unknown as Response;
      }
      const body = u.includes("/api/wallet")
        ? { wallet: { balance: 5000, currency: "INR", transactions: [] } }
        : u.includes("/api/meta")
          ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
          : u.includes("/api/voice/config")
            ? { provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] }
            : u.includes("/pantry")
              ? { pantry: false, providers: [], note: null, foodChoiceExpected: false }
              : u.includes("/api/trains")
                ? { trains: [train], recommendations: [], empty: false }
                : { bookings: [] };
      return { ok: true, json: async () => body } as unknown as Response;
    });

    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Ludhiana se Amritsar, 1 October, 1 passenger");
    await waitFor(() => expect(log()).toMatch(/kaunsi train leni hai/i), { timeout: 8000 });
    await type("12014");
    await waitFor(() => expect(log()).toMatch(/kaunsi class chahiye/i), { timeout: 8000 });

    /* dono messages brain tak pahunche — slot answer "12014" bhi */
    expect(asked).toContain("Ludhiana se Amritsar, 1 October, 1 passenger");
    expect(asked).toContain("12014");
  }, 25000);

  it("lamba turn me user ki bhasha wali wait line dikhti hai (jargon nahi)", async () => {
    let release: (() => void) | null = null;
    let delayed = false; /* sirf PEHLI call late karte hain (stream → plain fallback dobara maangta hai) */
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/agent")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        if (!delayed && String(body.text ?? "").includes("kitne baje")) {
          delayed = true;
          /* ye call jaan-bujh kar late karte hain — tab tak UI me wait line honi chahiye */
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return { ok: true, json: async () => ({ ok: true, source: "ai", grounded: true, reply: "12054 ASR se 06:50 par nikalti hai." }) } as unknown as Response;
      }
      const body = u.includes("/api/wallet")
        ? { wallet: { balance: 5000, currency: "INR", transactions: [] } }
        : u.includes("/api/meta")
          ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
          : u.includes("/api/voice/config")
            ? { provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] }
            : u.includes("/pantry")
              ? { pantry: false, providers: [], note: null, foodChoiceExpected: false }
              : u.includes("/api/trains")
                ? { trains: [train], recommendations: [], empty: false }
                : { bookings: [] };
      return { ok: true, json: async () => body } as unknown as Response;
    });

    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Ludhiana se Amritsar, 1 October, 1 passenger");
    await waitFor(() => expect(log()).toMatch(/kaunsi train leni hai/i), { timeout: 8000 });

    await type("12054 ke bare me kitne baje chalegi wo batao");
    await waitFor(() => expect(status()).toMatch(/Thoda samay lagega|process kar rahi hoon/i), { timeout: 4000 });
    expect(document.body.textContent ?? "").not.toMatch(/⏳\s*Thinking…/);
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(log()).toMatch(/06:50/), { timeout: 8000 });
  }, 25000);
});

describe("R67 — AI-first brain + echo-safe voice", () => {
  const log = () => (document.querySelector('[data-testid="aib-dock-log"]') ?? document.querySelector(".aib-thread"))?.textContent ?? "";
  beforeEach(() => {
    sessionStorage.clear();
    voiceState.listening = false;
    voiceState.interim = "";
    voiceState.transcript = "";
  });

  it("live-status sawaal (station ke naam ke saath) par brain ka jawab — engine ki khali line nahi", async () => {
    const asked: { text?: string; lastAsked?: string }[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/agent")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string; lastAsked?: string };
        asked.push({ text: body.text, lastAsked: body.lastAsked ?? undefined });
        return {
          ok: true,
          json: async () => ({
            ok: true,
            source: "ai",
            grounded: true,
            reply: "12054 HW Janshatabdi ASR se 06:50 baje nikalti hai aur HW 13:50 pahunchegi.",
            context: { origin: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" } },
          }),
        } as unknown as Response;
      }
      const body = u.includes("/api/wallet")
        ? { wallet: { balance: 5000, currency: "INR", transactions: [] } }
        : u.includes("/api/meta")
          ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
          : u.includes("/api/voice/config")
            ? { provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] }
            : u.includes("/pantry")
              ? { pantry: false, providers: [], note: null, foodChoiceExpected: false }
              : u.includes("/api/trains")
                ? { trains: [train], recommendations: [], empty: false }
                : { bookings: [] };
      return { ok: true, json: async () => body } as unknown as Response;
    });

    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Ludhiana se Amritsar, 1 October, 1 passenger");
    await waitFor(() => expect(log()).toMatch(/kaunsi train leni hai/i));

    await type("12054 आज अमृतसर कितने बजे पहुंची थी");
    await waitFor(() => expect(log()).toMatch(/06:50/), { timeout: 8000 });
    /* engine ki "samajh nahi aaya" wali line nahi aani chahiye — jawab mil gaya hai */
    expect(log()).not.toMatch(/samajh nahi aaya/i);
    /* brain ko flow ka pending slot bhi pata tha (train chunna baaki hai) */
    const q = asked.find((a) => a.text === "12054 आज अमृतसर कितने बजे पहुंची थी");
    expect(q?.lastAsked).toBe("train");
  }, 25000);

  it("seat/berth preference AI khud poochhta hai — user se poochke hi aage (full automation)", async () => {
    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Ludhiana se Amritsar, 1 October, 2 passengers");
    await waitFor(() => expect(log()).toMatch(/kaunsi train leni hai/i));
    await type("12014");
    await waitFor(() => expect(log()).toMatch(/kaunsi class chahiye/i));
    await type("CC");
    await waitFor(() => expect(log()).toMatch(/Passenger 1 ka naam/i));
    /* naam/age/gender diye, seat (berth) nahi — AI ko khud poochhna chahiye (invent nahi karta) */
    await type("Rahul Sharma, 31, male");
    await waitFor(() => expect(log()).toMatch(/berth preference/i), { timeout: 6000 });
    expect(log()).toMatch(/Lower|Upper|Side|window/i);
    /* seat bata di (CC me berth nahi hota — window/aisle hi sahi options hain) → agla kadam apne aap */
    await type("window");
    await waitFor(() => expect(log()).toMatch(/Passenger 2/i), { timeout: 8000 });
  }, 25000);

  it("AI ki apni boli hui line mic ke transcript me aa jaye to input nahi banti (echo)", async () => {
    const asked: string[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/agent")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        asked.push(String(body.text ?? ""));
        return { ok: true, json: async () => ({ ok: true, source: "ai", grounded: true, reply: "Theek hai." }) } as unknown as Response;
      }
      const body = u.includes("/api/wallet")
        ? { wallet: { balance: 5000, currency: "INR", transactions: [] } }
        : u.includes("/api/meta")
          ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
          : u.includes("/api/voice/config")
            ? { provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] }
            : u.includes("/pantry")
              ? { pantry: false, providers: [], note: null, foodChoiceExpected: false }
              : u.includes("/api/trains")
                ? { trains: [train], recommendations: [], empty: false }
                : { bookings: [] };
      return { ok: true, json: async () => body } as unknown as Response;
    });

    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    /* Voice ON — ab AI bolti hai (aur `speak()` uske lines yaad rakhta hai). */
    fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook"));
    await waitFor(() => expect(screen.getByTestId("aib-voice")).toBeTruthy());

    /* User mic se bolta hai (mock transcript) → ✓ se bhejta hai. */
    voiceState.listening = true;
    voiceState.transcript = "Ludhiana se Amritsar, 1 October, 1 passenger";
    await act(async () => {
      fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook"));
    });
    await waitFor(() => expect(log()).toMatch(/kaunsi train leni hai/i), { timeout: 8000 });
    const before = log().length;

    /* Ab recognizer ne AI ki hi boli hui line pakad li (user screenshot: "20986 … ट्रेन लेनी है"). */
    voiceState.listening = true;
    voiceState.transcript = "11906 HSX AGC EXP 12426 JAMMU RAJDHANI 12446 UTTAR S KRANTI Kaunsi train leni hai";
    await act(async () => {
      fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook"));
    });
    await new Promise((r) => setTimeout(r, 250));
    /* echo chhod diya gaya — koi naya "you" message nahi, log waisa hi */
    expect(log()).not.toMatch(/12426 JAMMU RAJDHANI 12446/);
    expect(log().length).toBe(before);
    expect(asked.some((t) => t.includes("12426"))).toBe(false);
  }, 25000);
});

/* ══ R66 (30 Sep 2026) — "jaise mera AI chat me samajh jaata tha waise hi edhr bhi samjhe" ═════════
 * (a) local engine samajh na paaye to wahi maujooda chat brain (/api/understand) se slot samajh aata
 *     hai — aur wahi canonical jawab purane flow engine ko diya jaata hai (validation wahi),
 * (b) ChatGPT jaisi voice conversation: AI bolne ke baad mic khud wapas sunta hai (sirf voice ON
 *     hone par — background listening nahi), "Type instead"/"End voice" par band.
 */
describe("R66 — brain se samajhna + voice conversation loop", () => {
  /* AI Booking do shakal me dikhta hai: home par full-screen thread, search ke baad dock bar. */
  const log = () => {
    const dock = document.querySelector('[data-testid="aib-dock-log"]');
    const thread = document.querySelector(".aib-thread");
    return (dock ?? thread)?.textContent ?? "";
  };

  beforeEach(() => {
    mockFetch();
    sessionStorage.clear();
    voiceState.listening = false;
    voiceState.interim = "";
    voiceState.transcript = "";
  });

  it("R67 AI-first: chat brain (wahi tools) se slot samajh aata hai, engine wahi verify karta hai", async () => {
    const brainAsk: { text?: string; lastAsked?: string }[] = [];
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const u = String(url);
      if (u.includes("/api/agent")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string; lastAsked?: string };
        brainAsk.push({ text: body.text, lastAsked: body.lastAsked });
        /* Chat brain ka jawab: slot samajh liya (jaise asli /api/agent karta hai — known/context me
         * passengerCount bhejta hai) + ek chhoti reply. */
        return {
          ok: true,
          json: async () => ({
            ok: true,
            reply: "Theek hai, 1 passenger — aage badh rahi hoon.",
            source: "ai",
            grounded: true,
            /* Sirf jab user ne sach me pax bola ho (asli server bhi aisa hi karta hai) — warna
             * har turn me pax bhar kar sawaal skip ho jaata. */
            context:
              body.text === "अकेला जा रहा हूँ"
                ? { origin: { code: "ASR", name: "Amritsar Junction", city: "Amritsar" }, destination: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, date: "2026-10-01", dateProvided: true, passengers: 1, paxProvided: true }
                : { origin: { code: "ASR", name: "Amritsar Junction", city: "Amritsar" }, destination: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, date: "2026-10-01", dateProvided: true },
          }),
        } as unknown as Response;
      }
      const body = u.includes("/api/wallet")
        ? { wallet: { balance: 5000, currency: "INR", transactions: [] } }
        : u.includes("/api/meta")
          ? { provider: { id: "test", name: "Test", mock: false }, serviceFee: 0 }
          : u.includes("/api/voice/config")
            ? { provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] }
            : u.includes("/pantry")
              ? { pantry: false, providers: [], note: null, foodChoiceExpected: false }
              : u.includes("/api/trains")
                ? { trains: [train], recommendations: [], empty: false }
                : { bookings: [] };
      return { ok: true, json: async () => body } as unknown as Response;
    });

    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());
    await type("Amritsar se Ludhiana, 1 October");
    await waitFor(() => expect(log()).toMatch(/kitne passengers/i));

    /* aisa shabd jo local regex nahi samajhta ("अकेला जा रहा हूँ") — brain se pax samajhna chahiye */
    await type("अकेला जा रहा हूँ");
    await waitFor(() => expect(brainAsk.some((a) => a.text === "अकेला जा रहा हूँ")).toBe(true), { timeout: 8000 });
    /* brain ko flow ka pending slot pata tha (lastAsked) — isi liye wo slot bhar saka */
    expect(brainAsk.some((a) => a.text === "अकेला जा रहा हूँ" && a.lastAsked === "passengers")).toBe(true);
  }, 25000);

  it("voice conversation: AI bolne ke baad mic khud wapas sunta hai (sirf voice ON hone par)", async () => {
    voiceStartCount.value = 0;
    open();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "AI Booking" })).toBeTruthy());

    /* mic tap → voice ON + sunna shuru */
    fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook"));
    await waitFor(() => expect(voiceStartCount.value).toBeGreaterThan(0));
    const started = voiceStartCount.value;

    /* voice se bola hua message → AI jawab → AI chup hone par mic KHUD dobara start hona chahiye.
     * (Mock listening true karke mic dobara dabao = asli commit ka raasta.) */
    voiceState.listening = true;
    voiceState.transcript = "Amritsar se Ludhiana, 1 October, 1 passenger";
    await act(async () => {
      fireEvent.click(screen.getByLabelText("🎙️ Talk to RailBook"));
    });
    await waitFor(() => expect(log()).toMatch(/kaunsi train leni hai/i), { timeout: 8000 });
    /* Awaaz khatam hone ka andaza line ki lambai se (max 12s) — mic uske baad khud sunta hai. */
    await waitFor(() => expect(voiceStartCount.value).toBeGreaterThan(started), { timeout: 15000 });

    /* "End voice" → loop band (aur mic nahi khulta) */
    console.log("DBG-VOICEHTML", document.querySelector('[data-testid="aib-voice"]')?.outerHTML?.slice(0, 700));
    console.log("DBG-BODY", document.body.textContent?.slice(-300));
    fireEvent.click(screen.getByText("✕ End voice"));
    const after = voiceStartCount.value;
    await new Promise((r) => setTimeout(r, 600));
    expect(voiceStartCount.value).toBe(after);
  }, 30000);
});
