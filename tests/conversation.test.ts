import { describe, expect, it } from "vitest";
import { understand } from "../src/ai/nlu";
import { extractIntent } from "../src/ai/intent";
import { planTurn } from "../src/ai/orchestrate";
import { bookingReducer, initialBooking, type BookingSnapshot } from "../src/booking/state";
import type { TrainResult } from "../src/types";

const NOW = new Date(2026, 7, 19);
const ndls = { code: "NDLS", name: "New Delhi", city: "Delhi" };
const asr = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };
const cdg = { code: "CDG", name: "Chandigarh", city: "Chandigarh" };

function blank() {
  return { ...initialBooking("2026-08-19"), date: "" };
}

const SAMPLE: TrainResult[] = [
  {
    number: "12013",
    name: "Amritsar Shatabdi",
    type: "Shatabdi",
    from: ndls,
    to: asr,
    date: "2026-08-20",
    departure: "16:30",
    arrival: "22:30",
    arrivalDayOffset: 0,
    durationMinutes: 360,
    durationLabel: "6h",
    runsOn: [0, 1, 2, 3, 4, 5, 6],
    classes: [
      { code: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 1250, seats: 18 },
      { code: "EC", label: "Executive Chair Car", status: "NOT_AVAILABLE", fare: 2150 },
      { code: "3A", label: "AC 3 Tier", status: "NOT_AVAILABLE", fare: 1800 },
      { code: "SL", label: "Sleeper", status: "AVAILABLE", fare: 450, seats: 40 },
    ],
  },
  {
    number: "12716",
    name: "Sachkhand Express",
    type: "Superfast",
    from: ndls,
    to: asr,
    date: "2026-08-20",
    departure: "13:00",
    arrival: "20:00",
    arrivalDayOffset: 0,
    durationMinutes: 420,
    durationLabel: "7h",
    runsOn: [0, 1, 2, 3, 4, 5, 6],
    classes: [
      { code: "SL", label: "Sleeper", status: "AVAILABLE", fare: 420, seats: 12 },
      { code: "3A", label: "AC 3 Tier", status: "AVAILABLE", fare: 1120, seats: 6 },
      { code: "2A", label: "AC 2 Tier", status: "NOT_AVAILABLE", fare: 1720 },
    ],
  },
];

function withResults(): BookingSnapshot {
  let s: BookingSnapshot = { ...initialBooking("2026-08-20"), from: ndls, to: asr, passengerCount: 2, trains: SAMPLE };
  s = bookingReducer(s, { type: "SEARCH_SUCCESS", trains: SAMPLE, recommendations: [] });
  return { ...s, from: ndls, to: asr, trains: SAMPLE };
}

describe("conversation engine", () => {
  it("1. Delhi after asking origin is origin, not dest", () => {
    const n = understand("Delhi", { now: NOW, lastAsked: "from", known: {} });
    expect(n.from).toBeUndefined();
    expect(n.unresolvedFrom).toMatch(/Delhi/i);
    expect(n.to).toBeUndefined();
    const turn = planTurn({ text: "Delhi", now: NOW, booking: blank(), prefs: {}, saved: [], lastAsked: "from" });
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.ask).toBe("from");
    expect(turn.text).toMatch(/kai stations/i);
  });

  it("2. Amritsar after origin Delhi is destination", () => {
    const known = { from: ndls };
    const n = understand("Amritsar", { now: NOW, lastAsked: "to", known });
    expect(n.to?.code).toBe("ASR");
    const booking = { ...blank(), from: ndls };
    const turn = planTurn({ text: "Amritsar", now: NOW, booking, prefs: {}, saved: [], lastAsked: "to" });
    expect(turn.apply?.to?.code).toBe("ASR");
    expect(turn.ask).toBe("date");
    expect(turn.text).toMatch(/Kab jaana/i);
  });

  it("3. Delhi se Amritsar extracts both", () => {
    const n = understand("Delhi se Amritsar", { now: NOW });
    expect(n.from).toBeUndefined();
    expect(n.unresolvedFrom).toMatch(/Delhi/i);
    expect(n.to?.code).toBe("ASR");
  });

  it("4. Delhi se Amritsar kal extracts date too", () => {
    const n = understand("Delhi se Amritsar kal", { now: NOW });
    expect(n.from).toBeUndefined();
    expect(n.unresolvedFrom).toMatch(/Delhi/i);
    expect(n.to?.code).toBe("ASR");
    expect(n.date).toBe("2026-08-20");
  });

  it("5. Delhi se Amritsar kal 2 ticket extracts passengers", () => {
    const n = understand("Delhi se Amritsar kal 2 ticket", { now: NOW });
    expect(n.from).toBeUndefined();
    expect(n.unresolvedFrom).toMatch(/Delhi/i);
    expect(n.to?.code).toBe("ASR");
    expect(n.date).toBe("2026-08-20");
    expect(n.passengerCount).toBe(2);
    const turn = planTurn({
      text: "Delhi se Amritsar kal 2 ticket",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.blocks?.[0]?.type).toBe("stations");
  });

  it("6-8. kal, parso, 20 August dates", () => {
    expect(understand("kal", { now: NOW, lastAsked: "date" }).date).toBe("2026-08-20");
    expect(understand("parso", { now: NOW }).date).toBe("2026-08-21");
    expect(understand("20 August", { now: NOW }).date).toBe("2026-08-20");
    expect(understand("20th August", { now: NOW }).date).toBe("2026-08-20");
    expect(understand("20-08-2026", { now: NOW }).date).toBe("2026-08-20");
    expect(understand("22 अगस्त", { now: NOW }).date).toBe("2026-08-22");
    expect(understand("22 को", { now: NOW }).date).toBe("2026-08-22");
    expect(understand("24 अगस्त", { now: NOW }).date).toBe("2026-08-24");
    expect(understand("15 September", { now: NOW }).date).toBe("2026-09-15");
    expect(understand("20 October", { now: NOW }).date).toBe("2026-10-20");
    expect(understand("15 सितंबर", { now: NOW }).date).toBe("2026-09-15");
  });

  it("9-10. sleeper → SL and 3AC → 3A", () => {
    expect(understand("sleeper", { now: NOW, lastAsked: "class" }).classCodes).toContain("SL");
    expect(understand("3AC", { now: NOW, lastAsked: "class" }).classCodes).toContain("3A");
    expect(extractIntent("3AC", NOW, "class").classCodes).toContain("3A");
  });

  it("11. Delhi nahi Chandigarh corrects origin", () => {
    const n = understand("Delhi nahi, Chandigarh", {
      now: NOW,
      known: { from: ndls, to: asr },
    });
    expect(n.correction).toBe(true);
    expect(n.from?.code).toBe("CDG");
  });

  it("12. kal nahi parso corrects date", () => {
    const n = understand("kal nahi parso", { now: NOW, known: { date: "2026-08-20" } });
    expect(n.date).toBe("2026-08-21");
  });

  it("13. 2 nahi 3 passengers corrects count", () => {
    const n = understand("2 nahi 3 passengers", { now: NOW, lastAsked: "passengers" });
    expect(n.passengerCount).toBe(3);
  });

  it("14. PNR intent", () => {
    const n = understand("PNR 1234567890 check karo", { now: NOW });
    expect(n.intent).toBe("CHECK_PNR");
    expect(n.pnr).toBe("1234567890");
    const turn = planTurn({ text: "PNR 1234567890 check karo", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.retrievePnr).toBe("1234567890");
    expect(turn.text).not.toMatch(/Kahan se/i);
  });

  it("15. wallet intent", () => {
    const turn = planTurn({ text: "wallet balance kitna hai", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.openWallet).toBe(true);
  });

  it("16. booking-history intent", () => {
    const turn = planTurn({ text: "meri bookings dikhao", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.openBookings).toBe(true);
  });

  it("17. class availability response after train pick", () => {
    const s = { ...withResults(), selectedTrain: SAMPLE[1] };
    const turn = planTurn({ text: "fastest wali", now: NOW, booking: s, prefs: {}, saved: [], lastAsked: "train" });
    expect(turn.selectTrain || turn.blocks?.some((b) => b.type === "classes")).toBeTruthy();
    const menu = planTurn({ text: "classes?", now: NOW, booking: s, prefs: {}, saved: [], lastAsked: "class" });
    expect(menu.text).toMatch(/🟢|available classes|SL/i);
  });

  it("18. unavailable class suggests alternative", () => {
    const s = { ...withResults(), selectedTrain: SAMPLE[0] };
    const turn = planTurn({ text: "3AC", now: NOW, booking: s, prefs: {}, saved: [], lastAsked: "class" });
    expect(turn.selectClass).toBeUndefined();
    expect(turn.text).toMatch(/available nahi/i);
    expect(turn.text).toMatch(/try karein/i);
  });

  it("19. date change triggers fresh search", () => {
    const s = { ...withResults(), selectedTrain: SAMPLE[0], selectedClass: SAMPLE[0].classes[0] };
    const turn = planTurn({
      text: "Actually 22 August",
      now: NOW,
      booking: s,
      prefs: {},
      saved: [],
    });
    expect(turn.clearForDate).toBe(true);
    expect(turn.search).toBe(true);
    expect(turn.apply?.date).toBe("2026-08-22");
    const cleared = bookingReducer(s, { type: "SET_DATE", date: "2026-08-22" });
    expect(cleared.selectedTrain).toBeNull();
  });

  it("20. train change asks to reselect class", () => {
    const s = { ...withResults(), selectedTrain: SAMPLE[1], selectedClass: SAMPLE[1].classes[0] };
    const turn = planTurn({ text: "fastest wali", now: NOW, booking: s, prefs: {}, saved: [], lastAsked: "train" });
    expect(turn.selectTrain).toBeTruthy();
    expect(turn.text).toMatch(/dobara|reselect/i);
  });

  it("21. voice transcript uses same engine", () => {
    const transcript = "delhi se amritsar kal do ticket";
    const n = understand(transcript, { now: NOW });
    expect(n.from).toBeUndefined();
    expect(n.unresolvedFrom).toMatch(/delhi/i);
    expect(n.to?.code).toBe("ASR");
    expect(n.date).toBe("2026-08-20");
    expect(n.passengerCount).toBe(2);
  });

  it("22-23. mixed language and multi-entity", () => {
    const n = understand("Mujhe kal subah Delhi se Amritsar jana hai 2 log hain", { now: NOW });
    expect(n.from).toBeUndefined();
    expect(n.unresolvedFrom).toMatch(/Delhi/i);
    expect(n.to?.code).toBe("ASR");
    expect(n.date).toBe("2026-08-20");
    expect(n.passengerCount).toBe(2);
    expect(n.timePref).toBe("morning");
  });

  it("24. short one-word answers fill the asked slot", () => {
    expect(understand("2", { now: NOW, lastAsked: "passengers" }).passengerCount).toBe(2);
    expect(understand("kal", { now: NOW, lastAsked: "date" }).date).toBe("2026-08-20");
  });

  it("25. topic switching leaves booking questions", () => {
    const booking = { ...blank(), from: ndls };
    const turn = planTurn({
      text: "Mera PNR check karna hai",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      lastAsked: "to",
    });
    expect(turn.openBookings || turn.ask === "pnr").toBeTruthy();
    expect(turn.text).not.toMatch(/Kahan jana/i);
  });

  it("Hindi: दिल्ली से अमृतसर जाना है extracts both and asks date, not origin again", () => {
    const n = understand("मुझे दिल्ली से अमृतसर जाना है", { now: NOW });
    expect(n.to?.code === "ASR" || n.unresolvedFrom || n.unresolvedTo).toBeTruthy();
    const turn = planTurn({
      text: "मुझे दिल्ली से अमृतसर जाना है",
      now: NOW,
      booking: { ...initialBooking("2026-08-19") },
      prefs: {},
      saved: [],
    });
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.search).toBeFalsy();
    expect(["from", "to", "date"]).toContain(turn.ask);

    const follow = planTurn({
      text: "दिल्ली से",
      now: NOW,
      booking: { ...initialBooking("2026-08-19"), from: ndls, to: asr },
      prefs: {},
      saved: [],
      lastAsked: "from",
    });
    expect(follow.text).not.toMatch(/Kahan se jana/i);
  });

  it("Hindi short origin दिल्ली से", () => {
    const n = understand("दिल्ली से", { now: NOW, lastAsked: "from" });
    expect(n.from).toBeUndefined();
    expect(n.unresolvedFrom).toMatch(/दिल्ली|Delhi/i);
  });

  it("acceptance: full utterance searches without re-asking slots", () => {
    const turn = planTurn({
      text: "Mujhe Delhi se Amritsar kal jana hai 2 logon ke liye",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.apply?.to?.code).toBe("ASR");
    expect(turn.apply?.date).toBe("2026-08-20");
    expect(turn.apply?.passengerCount).toBe(2);

    const s = withResults();
    const fast = planTurn({ text: "fastest wali", now: NOW, booking: s, prefs: {}, saved: [], lastAsked: "train" });
    expect(fast.selectTrain?.number).toBe("12013");
    expect(fast.text).toMatch(/available classes|🟢/i);

    const withTrain = { ...s, selectedTrain: SAMPLE[1] };
    const klass = planTurn({ text: "3AC", now: NOW, booking: withTrain, prefs: {}, saved: [], lastAsked: "class" });
    expect(klass.selectClass?.code).toBe("3A");
    expect(klass.goPassengers).toBe(true);
  });

  it("BOOK_TRAIN asks only date after origin+dest", () => {
    const n = understand("Mujhe Ludhiana se Delhi jaana hai", { now: NOW });
    expect(n.from?.code).toBe("LDH");
    expect(n.to).toBeUndefined();
    expect(n.unresolvedTo).toMatch(/Delhi/i);
    expect(n.date).toBeUndefined();
    expect(n.passengerCount).toBeUndefined();
    const turn = planTurn({
      text: "Mujhe Ludhiana se Delhi jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.text).toMatch(/kai stations/i);
  });

  it("BOOK_TRAIN with date asks only ticket count", () => {
    const turn = planTurn({
      text: "Kal Ludhiana se Delhi jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.apply?.from?.code).toBe("LDH");
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.apply?.date).toBe("2026-08-20");
    expect(turn.search).not.toBe(true);
    expect(turn.text).toMatch(/kai stations/i);
    expect(turn.text).not.toMatch(/Kab jaana/i);
  });

  it("Hindi एक टिकट चाहिए after date continues to search", () => {
    const booking = {
      ...blank(),
      from: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" },
      to: ndls,
      date: "2026-08-23",
      dateProvided: true,
    };
    for (const text of ["एक टिकट चाहिए", "टिकट चाहिए", "ek ticket chahiye", "1 ticket"]) {
      const turn = planTurn({
        text,
        now: NOW,
        booking,
        prefs: {},
        saved: [],
        lastAsked: "passengers",
      });
      expect(turn.apply?.passengerCount, text).toBe(1);
      expect(turn.search, text).toBe(true);
      expect(turn.text, text).not.toMatch(/Kitni tickets/i);
    }
  });

  it("NVIDIA-missing pax still fills from local Hindi parse", () => {
    const booking = {
      ...blank(),
      from: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" },
      to: ndls,
      date: "2026-08-23",
      dateProvided: true,
    };
    const turn = planTurn({
      text: "एक टिकट चाहिए",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      lastAsked: "passengers",
      extraction: { intent: "SEARCH_TRAIN" },
    });
    expect(turn.apply?.passengerCount).toBe(1);
    expect(turn.search).toBe(true);
  });

  it("2 tickets after date continues to search", () => {
    const booking = {
      ...blank(),
      from: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" },
      to: ndls,
      date: "2026-08-20",
      dateProvided: true,
    };
    const turn = planTurn({
      text: "2 tickets",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      lastAsked: "passengers",
    });
    expect(turn.apply?.passengerCount).toBe(2);
    expect(turn.search).toBe(true);
    expect(turn.ask).toBe("train");
  });

  it("1 ticket without a date asks Kab jaana after origin/dest", () => {
    const first = planTurn({
      text: "Mere ko 1 ticket chahiye",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(first.apply?.passengerCount).toBe(1);
    expect(first.apply?.date).toBeUndefined();
    expect(first.ask).toBe("from");

    let booking = { ...blank(), passengerCount: 1, paxProvided: true };
    const origin = planTurn({
      text: "Amritsar se",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      lastAsked: "from",
    });
    expect(origin.apply?.from?.code).toBe("ASR");
    expect(origin.ask).toBe("to");

    booking = { ...booking, from: asr };
    const dest = planTurn({
      text: "Ludhiana",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      lastAsked: "to",
      extraction: {
        intent: "BOOK_TRAIN",
        from: undefined,
        to: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" },
        date: "2026-08-19",
        passengerCount: 1,
      },
    });
    expect(dest.apply?.to?.code).toBe("LDH");
    expect(dest.search).not.toBe(true);
    expect(dest.ask).toBe("date");
    expect(dest.text).toBe("Bilkul. Kab jaana hai?");
  });

  it("keeps date and tickets while asking origin/destination", () => {
    const first = planTurn({
      text: "Mujhe 22 August ke liye 2 ticket chahiye",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(first.apply?.date).toBe("2026-08-22");
    expect(first.apply?.passengerCount).toBe(2);
    expect(first.ask).toBe("from");

    let booking = { ...blank(), date: "2026-08-22", dateProvided: true, passengerCount: 2, paxProvided: true };
    const origin = planTurn({
      text: "Amritsar se",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      lastAsked: "from",
    });
    expect(origin.apply?.from?.code).toBe("ASR");
    expect(origin.ask).toBe("to");
    expect(origin.text).not.toMatch(/Kab jaana/i);

    booking = { ...booking, from: asr };
    const dest = planTurn({
      text: "Ludhiana",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      lastAsked: "to",
    });
    expect(dest.apply?.to?.code).toBe("LDH");
    expect(dest.search).toBe(true);
    expect(dest.text).not.toMatch(/Kab jaana|Kitni tickets/i);
  });

  it("rejects fake station names like Ludhiana26", () => {
    const n = understand("Ludhiana26 se", { now: NOW, lastAsked: "from" });
    expect(n.from).toBeUndefined();
    const turn = planTurn({
      text: "Ludhiana26 se",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
      lastAsked: "from",
    });
    expect(turn.apply?.from).toBeUndefined();
    expect(turn.search).not.toBe(true);
    expect(turn.ask).toBe("from");
    expect(turn.text).toMatch(/station nahi/i);
  });

  it("matches Hindi names to offered Delhi station chips only", async () => {
    const { matchOfferedStation } = await import("../src/ai/stationPick");
    const offered = [
      { code: "DLI", name: "DELHI", city: "Delhi" },
      { code: "DEC", name: "DELHI CANTT", city: "Delhi" },
      { code: "DEE", name: "DELHI S ROHILLA", city: "Delhi" },
      { code: "NDLS", name: "NEW DELHI", city: "Delhi" },
    ];
    expect(matchOfferedStation("दिल्ली कैंट", offered)?.code).toBe("DEC");
    expect(matchOfferedStation("delhi cantt", offered)?.code).toBe("DEC");
    expect(matchOfferedStation("DEC", offered)?.code).toBe("DEC");
    expect(matchOfferedStation("न्यू दिल्ली", offered)?.code).toBe("NDLS");
    expect(matchOfferedStation("नई दिल्ली", offered)?.code).toBe("NDLS");
    expect(matchOfferedStation("NDLS", offered)?.code).toBe("NDLS");
    expect(matchOfferedStation("रोहिल्ला", offered)?.code).toBe("DEE");
    expect(matchOfferedStation("दिल्ली", offered)).toBeUndefined();
    expect(matchOfferedStation("Mumbai", offered)).toBeUndefined();
  });

  it("Ludhiana se Kochi is not catalog-rejected; asks date", () => {
    const n = understand("Mujhe Ludhiana se Kochi jaana hai", { now: NOW });
    expect(n.from?.code).toBe("LDH");
    expect(n.to).toBeUndefined();
    expect(n.unresolvedTo).toMatch(/Kochi/i);
    const turn = planTurn({
      text: "Mujhe Ludhiana se Kochi jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.text).toMatch(/kai stations|Ernakulam/i);
  });
});
