import { describe, expect, it } from "vitest";
import {
  bookingInProgress,
  classifyFollowUp,
  decideTool,
  emptyAgentContext,
  factReplyUnavailable,
  isStationPickInterrupt,
  mergeAgentContext,
  neverAutoBook,
  resolveTrainNumber,
  resumeBookingLine,
} from "../src/ai/agent";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";
import { understand } from "../src/ai/nlu";
import type { TrainResult } from "../src/types";

const NOW = new Date(2026, 7, 19);
const asr = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };
const ldh = { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" };
const ndls = { code: "NDLS", name: "New Delhi", city: "Delhi" };

function blank() {
  return { ...initialBooking("2026-08-19"), date: "" };
}

const SAMPLE: TrainResult[] = [
  {
    number: "12014",
    name: "Amritsar Shatabdi",
    type: "Shatabdi",
    from: asr,
    to: ndls,
    date: "2026-08-20",
    departure: "07:20",
    arrival: "13:25",
    arrivalDayOffset: 0,
    durationMinutes: 365,
    durationLabel: "6h",
    runsOn: [0, 1, 2, 3, 4, 5, 6],
    classes: [{ code: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 1250, seats: 18 }],
  },
];

describe("agent context + follow-ups", () => {
  it("1. booking with missing date asks date only", () => {
    const turn = planTurn({
      text: "Mujhe Amritsar se Ludhiana jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.ask).toBe("date");
    expect(turn.apply?.from?.code).toBe("ASR");
    expect(turn.apply?.to?.code).toBe("LDH");
    expect(turn.text).toMatch(/Kab jaana/i);
  });

  it("2. booking with missing passengers asks tickets", () => {
    const turn = planTurn({
      text: "Kal Amritsar se Ludhiana jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.ask).toBe("passengers");
    expect(turn.search).not.toBe(true);
  });

  it("3. booking with all information searches", () => {
    const turn = planTurn({
      text: "Mujhe 22 August ko Amritsar se Ludhiana 2 tickets chahiye",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).toBe(true);
    expect(turn.apply?.from?.code).toBe("ASR");
    expect(turn.apply?.to?.code).toBe("LDH");
    expect(turn.apply?.date).toBe("2026-08-22");
    expect(turn.apply?.passengerCount).toBe(2);
    expect(turn.confirmBook).toBeFalsy();
  });

  it("4. date follow-up kal", () => {
    const booking = { ...blank(), from: asr, to: ldh };
    const turn = planTurn({ text: "kal", now: NOW, booking, prefs: {}, saved: [], lastAsked: "date" });
    expect(turn.apply?.date).toBe("2026-08-20");
    expect(turn.ask).toBe("passengers");
  });

  it("5. passenger follow-up 2 log", () => {
    const booking = { ...blank(), from: asr, to: ldh, date: "2026-08-20", dateProvided: true };
    const turn = planTurn({ text: "2 log", now: NOW, booking, prefs: {}, saved: [], lastAsked: "passengers" });
    expect(turn.apply?.passengerCount).toBe(2);
    expect(turn.search).toBe(true);
  });

  it("6. train selection follow-up 12014 wali", () => {
    const booking = { ...initialBooking("2026-08-20"), from: asr, to: ndls, trains: SAMPLE };
    const turn = planTurn({ text: "12014 wali", now: NOW, booking, prefs: {}, saved: [] });
    expect(turn.selectTrain?.number).toBe("12014");
    expect(classifyFollowUp("12014 wali")).toBe("train_pick");
  });

  it("yesterday / kal live uses completed run, not today's live", () => {
    const now = new Date(2026, 7, 23);
    const y = understand("मुझे 12054 का यस्टरडे का लाइव स्टेटस चाहिए", { now });
    expect(y.trainNumber).toBe("12054");
    expect(y.date).toBe("2026-08-22");
    const turn = planTurn({
      text: "कल का लाइव स्टेटस चाहिए 12054 का",
      now,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.liveTrain).toBeFalsy();
    expect(turn.trainHistory).toBe("12054");
    expect(turn.historyDate).toBe("2026-08-22");
    expect(turn.apply?.date).toBeUndefined();
    const dated = planTurn({
      text: "22 अगस्त का लाइव स्टेटस देना 12014 का",
      now,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(dated.trainHistory).toBe("12014");
    expect(dated.historyDate).toBe("2026-08-22");
    expect(dated.liveTrain).toBeFalsy();
  });

  it("7. live-status interruption during booking resumes date ask", () => {
    const nlu = understand("12014 ka live status kya hai", { now: NOW });
    expect(nlu.intent).toBe("LIVE_TRAIN_STATUS");
    expect(nlu.trainNumber).toBe("12014");
    const booking = { ...blank(), from: asr, to: ndls };
    const turn = planTurn({
      text: "Waise 12014 ka live status kya hai?",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      lastAsked: "date",
    });
    expect(turn.liveTrain).toBe("12014");
    expect(turn.resumeAsk).toBe("date");
    // 2026-09-05 user instruction: no proactive "continue kar sakte hain" phrasing —
    // seedha slot-filling sawaal (date) aana chahiye.
    expect(turn.resumeText).toMatch(/kis date ko jaana hai\?/i);
    expect(turn.resumeText).not.toMatch(/continue/i);
    expect(turn.confirmBook).toBeFalsy();
  });

  it("8. fare question during booking does not invent", () => {
    const booking = {
      ...initialBooking("2026-08-20"),
      from: asr,
      to: ndls,
      date: "2026-08-20",
      dateProvided: true,
      selectedTrain: SAMPLE[0],
      selectedClass: SAMPLE[0].classes[0],
    };
    const turn = planTurn({ text: "iska fare kitna hai?", now: NOW, booking, prefs: {}, saved: [] });
    expect(turn.lookupFare).toBe(true);
    expect(turn.text).toMatch(/provider se/i);
    expect(turn.text).not.toMatch(/₹500 approx/i);
  });

  it("9. cancelled-train question", () => {
    expect(classifyFollowUp("Amritsar se chalne wali cancelled trains batao")).toBe("cancelled");
    const turn = planTurn({
      text: "cancelled trains batao",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.cancelled).toBe(true);
  });

  it("10. ticket-history question", () => {
    expect(classifyFollowUp("meri tickets dikhao")).toBe("bookings");
    const turn = planTurn({ text: "meri tickets dikhao", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.openBookings).toBe(true);
  });

  it("11. PNR question", () => {
    const n = understand("mera PNR check karo", { now: NOW });
    expect(n.intent).toBe("CHECK_PNR");
    const turn = planTurn({ text: "mera PNR check karo", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.ask).toBe("pnr");
    expect(turn.confirmBook).toBeFalsy();
  });

  it("12. timetable question", () => {
    const n = understand("12014 ka timetable dikhao", { now: NOW });
    expect(n.intent).toBe("TRAIN_SCHEDULE");
    expect(n.trainNumber).toBe("12014");
  });

  it("station chips do not swallow 12014 seat questions", () => {
    expect(classifyFollowUp("Mujhe seat btana 12014 mei hai")).toBe("availability");
    expect(classifyFollowUp("Mujhe seat btana 12014 mein hai ?")).toBe("availability");
    expect(classifyFollowUp("12014 ka seat")).toBe("availability");
    expect(classifyFollowUp("Confirmed seat chahiye")).not.toBe("availability");
    expect(isStationPickInterrupt("Mujhe seat btana 12014 mei hai")).toBe(true);
    expect(isStationPickInterrupt("दिल्ली कैंट")).toBe(false);
    const booking = { ...blank(), from: asr, to: ndls, date: "2026-08-24", dateProvided: true };
    const turn = planTurn({
      text: "Mujhe seat btana 12014 mein hai ?",
      now: new Date(2026, 7, 23),
      booking,
      prefs: {},
      saved: [],
      lastAsked: "to",
    });
    expect(turn.probeSeats).toBe("12014");
    expect(turn.lookupAvailability).not.toBe(true);
    expect(turn.confirmBook).toBeFalsy();
    expect(turn.text).toMatch(/12014/i);
    expect(turn.text).not.toMatch(/Kahan se jana/i);
  });

  it("12053 seats + date stays on chat, does not search train list", () => {
    const now = new Date(2026, 7, 23);
    const hw = { code: "HW", name: "Haridwar Junction", city: "Haridwar" };
    const booking = {
      ...initialBooking("2026-08-24"),
      from: ldh,
      to: hw,
      date: "2026-08-24",
      dateProvided: true,
      trains: SAMPLE,
    };
    const turn = planTurn({
      text: "12053 ki seat availability btana 23 august ki",
      now,
      booking,
      prefs: {},
      saved: [],
    });
    expect(classifyFollowUp("12053 ki seat availability btana 23 august ki")).toBe("availability");
    expect(turn.search).not.toBe(true);
    expect(turn.apply?.date).toBeUndefined();
    expect(turn.probeSeats).toBe("12053");
    expect(turn.probeSeatsDate).toBe("2026-08-23");
    expect(turn.selectTrain).toBeFalsy();
    expect(turn.text).toMatch(/12053/);
    expect(turn.text).toMatch(/train list nahi/i);
  });

  it("13. availability question", () => {
    expect(classifyFollowUp("12014 mein seat available hai?")).toBe("availability");
    const booking = {
      ...initialBooking("2026-08-20"),
      from: asr,
      to: ndls,
      date: "2026-08-20",
      selectedTrain: SAMPLE[0],
      selectedClass: SAMPLE[0].classes[0],
    };
    const turn = planTurn({ text: "seat available hai?", now: NOW, booking, prefs: {}, saved: [] });
    expect(turn.lookupAvailability).toBe(true);
  });

  it("14. aur koi train hai", () => {
    const booking = { ...initialBooking("2026-08-20"), from: asr, to: ndls, trains: SAMPLE };
    const turn = planTurn({ text: "aur koi train hai?", now: NOW, booking, prefs: {}, saved: [] });
    expect(turn.blocks?.some((b) => b.type === "more")).toBe(true);
  });

  it("15-17. Hindi / Hinglish / Devanagari map to same slots", () => {
    const a = understand("Mujhe kal Delhi jaana hai", { now: NOW });
    const b = understand("मुझे कल दिल्ली जाना है", { now: NOW });
    const c = understand("Kal 2 ticket chahiye", { now: NOW });
    expect(a.to).toBeUndefined();
    expect(a.unresolvedTo).toMatch(/Delhi/i);
    expect(a.date).toBe("2026-08-20");
    expect(b.to).toBeUndefined();
    expect(b.unresolvedTo || b.to?.city).toBeTruthy();
    expect(b.date).toBe("2026-08-20");
    expect(c.date).toBe("2026-08-20");
    expect(c.passengerCount).toBe(2);
  });

  it("23. AI never authorizes booking — only Confirm UI may charge", () => {
    expect(neverAutoBook("CONFIRM_YES", "PASSENGERS_PENDING")).toBe(true);
    expect(neverAutoBook("BOOK_TRAIN", "SEARCHING")).toBe(true);
    expect(neverAutoBook("BOOK_TRAIN", "FARE_REVIEW")).toBe(true);
    const collecting = { ...blank(), from: asr, to: ndls, selectedTrain: SAMPLE[0], selectedClass: SAMPLE[0].classes[0] };
    const haan = planTurn({ text: "haan", now: NOW, booking: collecting, prefs: {}, saved: [] });
    expect(haan.confirmBook).toBeFalsy();
    const review = {
      ...collecting,
      flow: "FARE_REVIEW" as const,
      previewFare: { baseFare: 1000, serviceFee: 20, total: 1020 },
      passengers: [{ id: "1", name: "Asha Kaur", age: "28", gender: "FEMALE" as const, berthPreference: "Window" }],
    };
    const bookText = planTurn({ text: "Book kar do", now: NOW, booking: review, prefs: {}, saved: [], walletBalance: 5000 });
    expect(bookText.confirmBook).toBeFalsy();
    expect(bookText.text).toMatch(/Confirm & Book|Yes, Book It/i);
  });

  it("24. context preserved after interruption", () => {
    let ctx = emptyAgentContext();
    ctx = mergeAgentContext(ctx, understand("Mujhe Amritsar se Delhi jaana hai", { now: NOW }), "Mujhe Amritsar se Delhi jaana hai");
    expect(ctx.origin?.code).toBe("ASR");
    expect(ctx.destination).toBeFalsy();
    expect(bookingInProgress(ctx)).toBe(true);
    ctx = mergeAgentContext(ctx, understand("kal", { now: NOW, lastAsked: "date" }), "kal");
    expect(ctx.date).toBe("2026-08-20");
    const resume = resumeBookingLine(ctx);
    expect(resume?.ask).toBe("to");
  });

  it("22. hallucination protection copy never invents fare/live", () => {
    expect(factReplyUnavailable("live")).toMatch(/fake location nahi/i);
    expect(factReplyUnavailable("fare")).toMatch(/invent nahi/i);
    expect(factReplyUnavailable("getAvailability")).toMatch(/invent nahi/i);
  });

  it("resolves pehli wali / ye wali from context", () => {
    const ctx = {
      ...emptyAgentContext(),
      lastTrainNumbers: ["12014", "12498"],
      selectedTrainNumber: "12014",
    };
    expect(resolveTrainNumber("pehli wali", ctx)).toBe("12014");
    expect(resolveTrainNumber("yeh wali", ctx)).toBe("12014");
    expect(resolveTrainNumber("12498", ctx)).toBe("12498");
    expect(resolveTrainNumber("doosri wali", ctx)).toBe("12498");
    expect(resolveTrainNumber("2nd train", ctx)).toBe("12498");
  });

  it("V2: glossary, compare, interrupt resume, no re-ask", () => {
    const now = new Date(2026, 7, 23);
    const cc = planTurn({ text: "CC kya hota hai?", now, booking: blank(), prefs: {}, saved: [] });
    expect(cc.text).toMatch(/Chair Car/i);
    expect(cc.search).not.toBe(true);
    expect(cc.confirmBook).toBeFalsy();
    const rac = planTurn({ text: "RAC kya hota hai?", now, booking: blank(), prefs: {}, saved: [] });
    expect(rac.text).toMatch(/Reservation Against Cancellation/i);
    const booking = {
      ...initialBooking("2026-08-24"),
      from: asr,
      to: ndls,
      date: "2026-08-24",
      dateProvided: true,
      trains: SAMPLE,
    };
    const cmp = planTurn({
      text: "12014 ya 14542 kaunsi better?",
      now,
      booking: { ...booking, trains: [...SAMPLE, { ...SAMPLE[0], number: "14542", name: "Unchahar Express", durationLabel: "8h", departure: "08:00", arrival: "16:00" }] },
      prefs: {},
      saved: [],
    });
    expect(cmp.search).not.toBe(true);
    expect(cmp.text).toMatch(/12014/);
    expect(cmp.text).toMatch(/14542/);
    expect(cmp.search).not.toBe(true);
    const mid = { ...blank(), from: asr, to: ndls };
    const live = planTurn({
      text: "Waise 12014 ka live status kya hai?",
      now,
      booking: mid,
      prefs: {},
      saved: [],
      lastAsked: "date",
    });
    expect(live.liveTrain).toBe("12014");
    expect(live.resumeAsk).toBe("date");
    const full = planTurn({
      text: "Mujhe 22 August ko Amritsar se Ludhiana 2 tickets chahiye",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(full.search).toBe(true);
    expect(full.text).not.toMatch(/Kahan se|Kahan jana|Kab jaana|Kitni tickets/i);
  });

  it("guides a confused user one step at a time and never auto-books", () => {
    expect(classifyFollowUp("samajh nahi aaya")).toBe("guide");
    expect(classifyFollowUp("ab kya karna hai")).toBe("guide");
    expect(classifyFollowUp("kaise book karun")).toBe("guide");
    const mid = { ...blank(), from: asr, to: ndls };
    const turn = planTurn({ text: "samajh nahi aaya", now: NOW, booking: mid, prefs: {}, saved: [] });
    expect(turn.ask).toBe("date");
    expect(turn.search).not.toBe(true);
    expect(turn.confirmBook).toBeFalsy();
    expect(turn.text).toMatch(/Kab jaana/i);
    const review = {
      ...mid,
      flow: "FARE_REVIEW" as const,
      previewFare: { baseFare: 1000, serviceFee: 20, total: 1020 },
      selectedTrain: SAMPLE[0],
      selectedClass: SAMPLE[0].classes[0],
    };
    const g = planTurn({ text: "ab kya karun?", now: NOW, booking: review, prefs: {}, saved: [] });
    expect(g.confirmBook).toBeFalsy();
    expect(g.text).toMatch(/Confirm & Book|Yes, Book It/i);
  });

  it("decides tools without inventing", () => {
    const ctx = mergeAgentContext(emptyAgentContext(), understand("Amritsar se Ludhiana jaana hai", { now: NOW }), "x");
    expect(decideTool("live", { ...ctx, selectedTrainNumber: "12014" }, "LIVE_TRAIN_STATUS")).toBe("getLiveStatus");
    expect(decideTool("cancelled", ctx)).toBe("getCancelledTrains");
    expect(decideTool("pnr", ctx)).toBe("checkPNR");
    expect(decideTool("fare", { ...ctx, classCode: "CC", date: "2026-08-20", dateProvided: true, selectedTrainNumber: "12014" })).toBe("getFare");
  });
});
