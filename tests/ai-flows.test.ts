import { describe, expect, it } from "vitest";
import { extractIntent } from "../src/ai/intent";
import { filterTrains, pickFastest } from "../src/ai/filter";
import { planTurn, resultsTurn } from "../src/ai/orchestrate";
import { bookingReducer, initialBooking } from "../src/booking/state";
import type { TrainResult } from "../src/types";

const NOW = new Date(2026, 7, 19); // Wed 19 Aug 2026

const asr = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };
const ndls = { code: "NDLS", name: "New Delhi", city: "Delhi" };

function train(partial: Partial<TrainResult> & Pick<TrainResult, "number" | "departure" | "durationMinutes">): TrainResult {
  return {
    name: "Test Express",
    type: "Express",
    from: asr,
    to: ndls,
    date: "2026-08-20",
    arrival: "13:30",
    arrivalDayOffset: 0,
    durationLabel: `${Math.floor(partial.durationMinutes / 60)}h`,
    runsOn: [0, 1, 2, 3, 4, 5, 6],
    classes: [
      { code: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 1250, seats: 20 },
      { code: "EC", label: "Executive Chair Car", status: "NOT_AVAILABLE", fare: 2150 },
    ],
    ...partial,
  };
}

const SAMPLE: TrainResult[] = [
  train({ number: "12014", name: "Amritsar Shatabdi", departure: "07:20", arrival: "13:25", durationMinutes: 365 }),
  train({ number: "12498", name: "Shane Punjab", departure: "15:10", arrival: "21:55", durationMinutes: 405, classes: [
    { code: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 890 },
    { code: "2S", label: "Second Sitting", status: "AVAILABLE", fare: 265 },
  ]}),
  train({ number: "15708", name: "Amrapali Express", departure: "07:45", arrival: "16:30", durationMinutes: 525, classes: [
    { code: "SL", label: "Sleeper", status: "AVAILABLE", fare: 540 },
    { code: "3A", label: "AC 3 Tier", status: "WAITLIST", fare: 1460, waitlist: 12 },
  ]}),
];

function blank() {
  return { ...initialBooking("2026-08-19"), date: "" };
}

describe("intent extraction", () => {
  it("Flow A: understands kal Amritsar se Delhi 2 log", () => {
    const i = extractIntent("Mujhe kal Amritsar se Delhi 2 logon ke liye jaana hai.", NOW);
    expect(i.from?.code).toBe("ASR");
    expect(i.to).toBeUndefined();
    expect(i.unresolvedTo).toMatch(/Delhi/i);
    expect(i.date).toBe("2026-08-20");
    expect(i.passengerCount).toBe(2);
  });

  it("parses aaj, parso, 25 August, 25/08, Sunday", () => {
    expect(extractIntent("aaj ki ticket", NOW).date).toBe("2026-08-19");
    expect(extractIntent("parso jaana hai", NOW).date).toBe("2026-08-21");
    expect(extractIntent("25 August", NOW).date).toBe("2026-08-25");
    expect(extractIntent("25/08", NOW).date).toBe("2026-08-25");
    expect(extractIntent("Sunday wali train", NOW).date).toBe("2026-08-23");
  });

  it("parses Hinglish class, time and confirmed prefs", () => {
    const i = extractIntent("Subah ki confirmed AC train chahiye.", NOW);
    expect(i.timePref).toBe("morning");
    expect(i.acOnly).toBe(true);
    expect(i.confirmedOnly).toBe(true);
  });
});

describe("user flows", () => {
  it("Flow A: understands then searches", () => {
    const turn = planTurn({
      text: "Mujhe kal Amritsar se Delhi 2 logon ke liye jaana hai.",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.apply?.from?.code).toBe("ASR");
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.apply?.date).toBe("2026-08-20");
    expect(turn.apply?.passengerCount).toBe(2);
    expect(turn.text).toMatch(/kai stations/i);
  });

  it("Flow B: filters morning confirmed AC", () => {
    let s = initialBooking("2026-08-20");
    s = { ...s, from: asr, to: ndls, trains: SAMPLE };
    const turn = planTurn({
      text: "Subah ki confirmed AC train chahiye.",
      now: NOW,
      booking: s,
      prefs: {},
      saved: [],
    });
    expect(turn.prefs.timePref).toBe("morning");
    expect(turn.prefs.acOnly).toBe(true);
    expect(turn.prefs.confirmedOnly).toBe(true);
    const filtered = filterTrains(SAMPLE, turn.prefs);
    expect(filtered.every((t) => Number(t.departure.slice(0, 2)) < 12)).toBe(true);
    expect(filtered.some((t) => t.number === "12014")).toBe(true);
    expect(turn.blocks?.some((b) => b.type === "train" || b.type === "more")).toBe(true);
  });

  it("Flow C: selects fastest AVAILABLE option", () => {
    let s = initialBooking("2026-08-20");
    s = { ...s, from: asr, to: ndls, trains: SAMPLE };
    const turn = planTurn({
      text: "Jo fastest hai wo book karo.",
      now: NOW,
      booking: s,
      prefs: {},
      saved: [],
    });
    expect(turn.selectTrain?.number).toBe(pickFastest(SAMPLE)?.number);
    expect(turn.confirmBook).toBeUndefined();
  });

  it("Flow D: Sunday date change clears stale selection", () => {
    let s = initialBooking("2026-08-20");
    s = { ...s, from: asr, to: ndls };
    s = bookingReducer(s, { type: "SEARCH_SUCCESS", trains: SAMPLE, recommendations: [] });
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: SAMPLE[0] });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: SAMPLE[0].classes[0] });
    expect(s.selectedTrain?.number).toBe("12014");

    const turn = planTurn({
      text: "Iski jagah Sunday wali train dikhao.",
      now: NOW,
      booking: s,
      prefs: {},
      saved: [],
    });
    expect(turn.clearForDate).toBe(true);
    expect(turn.search).toBe(true);
    expect(turn.apply?.date).toBe("2026-08-23");
    expect(turn.text).toMatch(/date change/i);

    s = bookingReducer(s, { type: "SET_DATE", date: "2026-08-23" });
    expect(s.selectedTrain).toBeNull();
    expect(s.selectedClass).toBeNull();
    expect(s.trains).toHaveLength(0);
  });

  it("Flow E: AC available hai checks real classes", () => {
    let s = initialBooking("2026-08-20");
    s = { ...s, from: asr, to: ndls, selectedTrain: SAMPLE[0] };
    const turn = planTurn({
      text: "AC available hai?",
      now: NOW,
      booking: s,
      prefs: {},
      saved: [],
    });
    expect(turn.text).toMatch(/available/i);
    expect(turn.blocks?.some((b) => b.type === "classes")).toBe(true);
  });

  it("Flow F: no seat suggests alternate train/date", () => {
    let s = initialBooking("2026-08-20");
    s = { ...s, from: asr, to: ndls, trains: SAMPLE };
    const turn = planTurn({
      text: "No seat?",
      now: NOW,
      booking: s,
      prefs: { confirmedOnly: true, classCodes: ["EC"] },
      saved: [],
    });
    expect(turn.text).toMatch(/nahi mili|alternate|options/i);
  });

  it("Flow G: Book kar do does not book before fare confirmation", () => {
    let s = initialBooking("2026-08-20");
    s = {
      ...s,
      from: asr,
      to: ndls,
      selectedTrain: SAMPLE[0],
      selectedClass: SAMPLE[0].classes[0],
      passengers: [
        { id: "1", name: "", age: "", gender: "", berthPreference: "" },
        { id: "2", name: "", age: "", gender: "", berthPreference: "" },
      ],
    };
    const early = planTurn({ text: "Book kar do.", now: NOW, booking: s, prefs: {}, saved: [] });
    expect(early.confirmBook).toBeFalsy();
    expect(early.goPassengers || early.blocks?.some((b) => b.type === "passengers")).toBeTruthy();

    const ready = {
      ...s,
      flow: "FARE_REVIEW" as const,
      previewFare: { baseFare: 2500, serviceFee: 50, total: 2550 },
      passengers: [
        { id: "1", name: "Asha Kaur", age: "28", gender: "FEMALE" as const, berthPreference: "Window" },
        { id: "2", name: "Ravi Singh", age: "34", gender: "MALE" as const, berthPreference: "Aisle" },
      ],
    };
    const go = planTurn({ text: "Book kar do.", now: NOW, booking: ready, prefs: {}, saved: [], walletBalance: 5000 });
    expect(go.confirmBook).toBeFalsy();
    expect(go.text).toMatch(/Confirm & Book|Yes, Book It/i);
  });

  it("Flow H: voice transcript is processed as an utterance", () => {
    const transcript = "Mujhe kal Delhi jaana hai Amritsar se, subah ki koi confirmed AC train dekhna.";
    const i = extractIntent(transcript, NOW);
    expect(i.from?.code).toBe("ASR");
    expect(i.to).toBeUndefined();
    expect(i.unresolvedTo).toMatch(/Delhi/i);
    expect(i.date).toBe("2026-08-20");
    expect(i.timePref).toBe("morning");
    expect(i.acOnly).toBe(true);
    expect(i.confirmedOnly).toBe(true);
    const turn = planTurn({ text: transcript, now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.search).not.toBe(true);
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.text).toMatch(/kai stations/i);
  });

  it("asks only the next missing slot", () => {
    const turn = planTurn({
      text: "Delhi jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).toBeFalsy();
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.text).toMatch(/kai stations/i);
  });

  it("does not hide trains that have no class/fare payload", () => {
    const bare = train({ number: "12497", departure: "06:40", durationMinutes: 455, classes: [] });
    const filtered = filterTrains([bare], {});
    expect(filtered).toHaveLength(1);
    let s = initialBooking("2026-08-22");
    s = { ...s, from: ndls, to: asr, trains: [bare] };
    const turn = resultsTurn(s, {}, []);
    expect(turn.text).toMatch(/trains mil gayi/i);
    expect(turn.blocks?.some((b) => b.type === "train")).toBe(true);
  });

  it("resultsTurn never invents trains", () => {
    let s = initialBooking("2026-08-20");
    s = { ...s, from: asr, to: ndls, trains: SAMPLE, recommendations: [{ trainNumber: "12014", kind: "best", label: "Best for you", reason: "Fastest · AC" }] };
    const turn = resultsTurn(s, {}, []);
    const featured = turn.blocks?.find((b) => b.type === "train");
    expect(featured && featured.type === "train" && featured.train.number).toBe("12014");
    const more = turn.blocks?.find((b) => b.type === "more");
    if (more && more.type === "more") {
      expect(more.trains.length).toBe(SAMPLE.length - 1);
    }
  });
});
