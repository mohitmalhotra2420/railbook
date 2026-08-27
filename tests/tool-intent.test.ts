import { describe, expect, it } from "vitest";
import { understand } from "../src/ai/nlu";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";
import { routeRailwayIntent } from "../src/ai/toolRoute";
import { runUnderstand } from "../server/understand/index";
import type { TrainResult } from "../src/types";

const NOW = new Date(2026, 7, 23);
const asr = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };
const ldh = { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" };
const ndls = { code: "NDLS", name: "New Delhi", city: "Delhi" };

function blank() {
  return { ...initialBooking("2026-08-23"), date: "" };
}

const SAMPLE: TrainResult[] = [
  {
    number: "12014",
    name: "Amritsar Shatabdi",
    type: "Shatabdi",
    from: asr,
    to: ldh,
    date: "2026-08-24",
    departure: "04:55",
    arrival: "06:57",
    arrivalDayOffset: 0,
    durationMinutes: 122,
    durationLabel: "2h 02m",
    runsOn: [0, 1, 2, 3, 4, 5, 6],
    classes: [{ code: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 510, seats: 12 }],
  },
  {
    number: "14542",
    name: "ASR CDG EXP",
    type: "Express",
    from: asr,
    to: ldh,
    date: "2026-08-24",
    departure: "05:10",
    arrival: "07:12",
    arrivalDayOffset: 0,
    durationMinutes: 122,
    durationLabel: "2h 02m",
    runsOn: [0, 1, 2, 3, 4, 5, 6],
    classes: [{ code: "SL", label: "Sleeper", status: "AVAILABLE", fare: 180, seats: 40 }],
  },
];

describe("NVIDIA tool-intent layer + deterministic fallback", () => {
  it("1. 12014 abhi kaha hai → live", () => {
    const n = understand("12014 abhi kaha hai?", { now: NOW });
    expect(n.intent).toBe("LIVE_TRAIN_STATUS");
    expect(n.trainNumber).toBe("12014");
    expect(planTurn({ text: "12014 abhi kaha hai?", now: NOW, booking: blank(), prefs: {}, saved: [] }).liveTrain).toBe("12014");
  });

  it("2. 12014 kitni late hai → live", () => {
    expect(understand("12014 kitni late hai?", { now: NOW }).intent).toBe("LIVE_TRAIN_STATUS");
    expect(routeRailwayIntent("12014 kitni late hai?").tool).toBe("getLiveStatus");
  });

  it("3. 12014 cancel hai → cancelled, not UNKNOWN", () => {
    const n = understand("12014 cancel hai?", { now: NOW });
    expect(n.intent).toBe("CANCELLED_TRAINS");
    expect(n.trainNumber).toBe("12014");
    expect(planTurn({ text: "12014 cancel hai?", now: NOW, booking: blank(), prefs: {}, saved: [] }).cancelled).toBe(true);
  });

  it("4. CC kya hota hai → glossary", () => {
    expect(understand("CC kya hota hai?", { now: NOW }).intent).toBe("GENERAL_RAILWAY_KNOWLEDGE");
    expect(planTurn({ text: "CC kya hota hai?", now: NOW, booking: blank(), prefs: {}, saved: [] }).text).toMatch(/Chair Car/i);
  });

  it("5. 12014 mein CC available hai → availability", () => {
    const n = understand("12014 mein CC available hai?", { now: NOW });
    expect(n.intent).toBe("CHECK_AVAILABILITY");
    expect(n.trainNumber).toBe("12014");
    expect(n.classCodes).toContain("CC");
    const turn = planTurn({ text: "12014 mein CC available hai?", now: NOW, booking: { ...blank(), from: asr, to: ldh, date: "2026-08-24", dateProvided: true }, prefs: {}, saved: [] });
    expect(turn.probeSeats).toBe("12014");
    expect(turn.search).not.toBe(true);
  });

  it("6. 12014 ka CC fare → fare", () => {
    const n = understand("12014 ka CC fare?", { now: NOW });
    expect(n.intent).toBe("CHECK_FARE");
    expect(n.trainNumber).toBe("12014");
    expect(n.classCodes).toContain("CC");
  });

  it("7-9. doosri / pehli / 12014 wali against current results", () => {
    const booking = { ...initialBooking("2026-08-24"), from: asr, to: ldh, trains: SAMPLE };
    expect(understand("doosri wali", { now: NOW }).intent).toBe("SELECT_TRAIN");
    expect(planTurn({ text: "doosri wali", now: NOW, booking, prefs: {}, saved: [] }).selectTrain?.number).toBe("14542");
    expect(planTurn({ text: "pehli wali", now: NOW, booking, prefs: {}, saved: [] }).selectTrain?.number).toBe("12014");
    expect(understand("12014 wali", { now: NOW }).intent).toBe("SELECT_TRAIN");
    expect(planTurn({ text: "12014 wali", now: NOW, booking, prefs: {}, saved: [] }).selectTrain?.number).toBe("12014");
  });

  it("10. compare 12014 vs 14542 uses current list only", () => {
    expect(understand("12014 aur 14542 mein kaunsi better hai?", { now: NOW }).intent).toBe("COMPARE_TRAINS");
    const booking = { ...initialBooking("2026-08-24"), from: asr, to: ldh, trains: SAMPLE };
    const turn = planTurn({ text: "12014 aur 14542 mein kaunsi better hai?", now: NOW, booking, prefs: {}, saved: [] });
    expect(turn.search).not.toBe(true);
    expect(turn.text).toMatch(/12014/);
    expect(turn.text).toMatch(/14542/);
  });

  it("named trains compare without search looks up timetable", () => {
    const text = "Tum muje recommend kroge ke ki better train kon si delhi jaane ke liye 12014 yan 12498";
    expect(understand(text, { now: NOW }).intent).toBe("COMPARE_TRAINS");
    const turn = planTurn({ text, now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.search).not.toBe(true);
    expect(turn.compareTrains).toEqual(["12014", "12498"]);
    expect(turn.compareDestCodes).toEqual(expect.arrayContaining(["NDLS", "DLI", "NZM"]));
    expect(turn.text).not.toMatch(/pehle search results/i);
    expect(turn.text).toMatch(/12014/);
    expect(turn.text).toMatch(/12498/);
    expect(turn.confirmBook).toBeFalsy();
  });

  it("11. fast wali kaunsi hai", () => {
    expect(understand("fast wali kaunsi hai?", { now: NOW }).intent).toBe("SELECT_FASTEST");
  });

  it("12-14. history / PNR / wallet", () => {
    expect(understand("meri ticket history dikhao", { now: NOW }).intent).toBe("VIEW_BOOKINGS");
    expect(planTurn({ text: "meri ticket history dikhao", now: NOW, booking: blank(), prefs: {}, saved: [] }).openBookings).toBe(true);
    expect(understand("PNR check karo", { now: NOW }).intent).toBe("CHECK_PNR");
    expect(planTurn({ text: "PNR check karo", now: NOW, booking: blank(), prefs: {}, saved: [] }).ask).toBe("pnr");
    expect(understand("wallet mein kitne paise hain?", { now: NOW }).intent).toBe("VIEW_WALLET");
    expect(planTurn({ text: "wallet mein kitne paise hain?", now: NOW, booking: blank(), prefs: {}, saved: [] }).openWallet).toBe(true);
  });

  it("15. Jammu se Beas", () => {
    const n = understand("Jammu se Beas jaana hai", { now: NOW });
    expect(n.from?.code).toBe("JAT");
    expect(n.to?.code).toBe("BEAS");
    expect(n.date).toBeUndefined();
    const turn = planTurn({ text: "Jammu se Beas jaana hai", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.search).not.toBe(true);
    expect(turn.ask).toBe("date");
  });

  it("16. Amritsar se cancelled trains", () => {
    expect(understand("Amritsar se cancelled trains batao", { now: NOW }).intent).toBe("CANCELLED_TRAINS");
    expect(planTurn({ text: "Amritsar se cancelled trains batao", now: NOW, booking: blank(), prefs: {}, saved: [] }).cancelled).toBe(true);
  });

  it("17. booking → live interrupt → resume", () => {
    const booking = { ...blank(), from: asr, to: ldh };
    const turn = planTurn({ text: "12014 ka live status batao", now: NOW, booking, prefs: {}, saved: [], lastAsked: "date" });
    expect(turn.liveTrain).toBe("12014");
    expect(turn.resumeAsk).toBe("date");
    expect(turn.apply?.date).toBeUndefined();
    const kal = planTurn({ text: "Kal", now: NOW, booking, prefs: {}, saved: [], lastAsked: "date" });
    expect(kal.apply?.date).toBe("2026-08-24");
    expect(kal.liveTrain).toBeFalsy();
  });

  it("18. booking → fare interrupt → resume", () => {
    const booking = { ...blank(), from: asr, to: ldh, date: "2026-08-24", dateProvided: true };
    const turn = planTurn({ text: "12014 ka CC fare?", now: NOW, booking, prefs: {}, saved: [], lastAsked: "passengers" });
    expect(turn.confirmBook).toBeFalsy();
    expect(understand("12014 ka CC fare?", { now: NOW }).intent).toBe("CHECK_FARE");
  });

  it("19. booking → availability interrupt → resume", () => {
    const booking = { ...blank(), from: asr, to: ldh, date: "2026-08-24", dateProvided: true };
    const turn = planTurn({ text: "12014 mein kitni seats hain?", now: NOW, booking, prefs: {}, saved: [] });
    expect(turn.probeSeats).toBe("12014");
    expect(turn.search).not.toBe(true);
  });

  it("20. origin correction preserves destination", () => {
    const n = understand("Nahi, Ludhiana se jaana hai", {
      now: NOW,
      known: { from: asr, to: ndls },
    });
    expect(n.correction).toBe(true);
    expect(n.from?.code).toBe("LDH");
    expect(n.to?.code).toBe("NDLS");
  });

  it("21. destination correction preserves origin", () => {
    const n = understand("Nahi Delhi jaana hai", {
      now: NOW,
      known: { from: asr, to: ldh },
    });
    expect(n.correction).toBe(true);
    expect(n.to).toBeUndefined();
    expect(n.unresolvedTo).toMatch(/Delhi/i);
    expect(n.from?.code).toBe("ASR");
  });

  it("22. date correction preserves route", () => {
    const n = understand("Nahi, parso", {
      now: NOW,
      known: { from: asr, to: ldh, date: "2026-08-24" },
    });
    expect(n.date).toBe("2026-08-25");
    expect(n.from).toBeUndefined();
    expect(n.to).toBeUndefined();
  });

  it("23. passenger correction preserves route/date", () => {
    const n = understand("Nahi, 3 passengers", {
      now: NOW,
      known: { from: asr, to: ldh, date: "2026-08-24", passengerCount: 2 },
    });
    expect(n.passengerCount).toBe(3);
    expect(n.from).toBeUndefined();
    expect(n.date).toBeUndefined();
  });

  it("24. Hindi/Hinglish variants", () => {
    expect(understand("bhai 12014 abhi kaha hai?", { now: NOW }).intent).toBe("LIVE_TRAIN_STATUS");
    expect(understand("मुझे कल दो टिकट चाहिए अमृतसर से दिल्ली की", { now: NOW }).date).toBe("2026-08-24");
    expect(understand("CC mein seat mil jayegi?", { now: NOW }).classCodes).toContain("CC");
  });

  it("25. NVIDIA timeout → deterministic fallback", async () => {
    const prevKey = process.env.NVIDIA_API_KEY;
    const prevBase = process.env.NVIDIA_BASE_URL;
    const prevModel = process.env.NVIDIA_MODEL;
    const prevTo = process.env.AI_REQUEST_TIMEOUT_MS;
    process.env.NVIDIA_API_KEY = "nvapi-test-not-a-real-key";
    process.env.NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    process.env.AI_REQUEST_TIMEOUT_MS = "40";
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as typeof fetch;
    try {
      const res = await runUnderstand({
        text: "12014 abhi kaha hai?",
        now: NOW.toISOString(),
      });
      expect(res.source).toBe("nlu");
      expect(res.nlu.intent).toBe("LIVE_TRAIN_STATUS");
      expect(res.nlu.trainNumber).toBe("12014");
      expect(res.confirmBook as unknown).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
      if (prevKey == null) delete process.env.NVIDIA_API_KEY;
      else process.env.NVIDIA_API_KEY = prevKey;
      if (prevBase == null) delete process.env.NVIDIA_BASE_URL;
      else process.env.NVIDIA_BASE_URL = prevBase;
      if (prevModel == null) delete process.env.NVIDIA_MODEL;
      else process.env.NVIDIA_MODEL = prevModel;
      if (prevTo == null) delete process.env.AI_REQUEST_TIMEOUT_MS;
      else process.env.AI_REQUEST_TIMEOUT_MS = prevTo;
    }
  });
});
