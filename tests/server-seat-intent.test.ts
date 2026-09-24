/* 24 Sep 2026 — SERVER-side seat intent (user: "yeh jo seat intent questions hain AI khud samjhe and
 * filter kare, jaisa tum plan kar rahe the; client side wala fallback me use karo").
 *
 * Ye tests sirf bhasha + filter lock karte hain — koi network, koi provider, koi LLM.
 * (Client ke tests/seat-finder.test.ts = fallback layer; ye = server truth.) */
import { describe, expect, it } from "vitest";
import { departAfterMinute, parseSeatIntent } from "../server/understand/seatIntent";
import { pickSeatRows, seatSummaryLine } from "../server/agent/seatFilter";

describe("server seat intent — bhasha (Hindi / Devanagari / English / Hinglish)", () => {
  it("class: teenon bhasha me 2A, aur 'sab class' par koi filter nahi", () => {
    expect(parseSeatIntent("2A mein seats hai?").classCodes).toEqual(["2A"]);
    expect(parseSeatIntent("2nd AC seat available?").classCodes).toEqual(["2A"]);
    expect(parseSeatIntent("दूसरी एसी में सीट है क्या?").classCodes).toEqual(["2A"]);
    expect(parseSeatIntent("sleeper me jagah hai?").classCodes).toEqual(["SL"]);
    expect(parseSeatIntent("स्लीपर में जगह").classCodes).toEqual(["SL"]);
    expect(parseSeatIntent("chair car me seat").classCodes).toEqual(["CC"]);
    expect(parseSeatIntent("sab class me seat dikhao").classCodes).toEqual([]);
    expect(parseSeatIntent("koi bhi class me seat hai?").classCodes).toEqual([]);
  });

  it("seat intent: seat/सीट/jagah/khali par true; train/PNR sawaal par false", () => {
    expect(parseSeatIntent("2A mein seats hai?").seatIntent).toBe(true);
    expect(parseSeatIntent("दूसरी एसी में सीट है क्या?").seatIntent).toBe(true);
    expect(parseSeatIntent("2A hai?").seatIntent).toBe(true); /* class + sawaal */
    expect(parseSeatIntent("kal ki trains dikhao").seatIntent).toBe(false);
    expect(parseSeatIntent("PNR 1234567890 status").seatIntent).toBe(false);
  });

  it("'sirf confirmed' / sort / quota slots", () => {
    expect(parseSeatIntent("sirf confirmed seats dikhao").confirmedOnly).toBe(true);
    expect(parseSeatIntent("सिर्फ कन्फर्म सीट दिखाओ").confirmedOnly).toBe(true);
    expect(parseSeatIntent("1A me sabse fast train batao").sortBy).toBe("fastest");
    expect(parseSeatIntent("sleeper me low fare train").sortBy).toBe("cheapest");
    expect(parseSeatIntent("सबसे सस्ती सीट वाली ट्रेन").sortBy).toBe("cheapest");
    expect(parseSeatIntent("tatkal me 3A seat").quota).toBe("TQ");
    expect(parseSeatIntent("2A me seat").quota).toBeNull();
  });

  it("time: '5 baje ke baad' / 'after 5' / 'शाम 5' / 'रात 9' / 'सुबह 6' / '17:30'", () => {
    expect(departAfterMinute("5 baje ke baad ki train")).toBe(17 * 60);
    expect(departAfterMinute("after 5 trains")).toBe(5 * 60); /* English "after 5" = literal */
    expect(departAfterMinute("शाम 5 के बाद")).toBe(17 * 60);
    expect(departAfterMinute("रात 9 के बाद")).toBe(21 * 60);
    expect(departAfterMinute("सुबह 6 के बाद")).toBe(6 * 60);
    expect(departAfterMinute("17:30 ke baad")).toBe(17 * 60 + 30);
    expect(departAfterMinute("2A me seat hai")).toBeNull();
  });
});

describe("server seat filter — asli board rows par (koi andaza nahi)", () => {
  const board = [
    {
      trainNumber: "11078",
      trainName: "JHELUM EXPRESS",
      classes: [
        { classCode: "2A", code: "2A", status: "AVAILABLE", seats: 29, fare: 825 },
        { classCode: "3A", code: "3A", status: "WAITLIST", waitlist: 12, fare: 585 },
      ],
    },
    {
      trainNumber: "20986",
      trainName: "SWARAJ EXPRESS",
      classes: [{ classCode: "2A", code: "2A", status: "RAC", rac: 9, fare: 890 }],
    },
    {
      trainNumber: "14617",
      trainName: "JANSEWA EXP",
      classes: [{ classCode: "2A", code: "2A", status: "NOT_AVAILABLE", fare: 300 }],
    },
  ];

  it("class filter + onlyAvailable (AVL + RAC dono) + WL alag", () => {
    const pick = pickSeatRows(board, { classCodes: ["2A"], onlyAvailable: true, departAfterMinute: null, sortBy: null });
    expect(pick.seat.map((r) => `${r.number}:${r.status}`)).toEqual(["11078:AVAILABLE", "20986:RAC"]);
    expect(pick.wl).toEqual([]); /* WL is mode me nahi */
    const all = pickSeatRows(board, { classCodes: ["2A"], onlyAvailable: false, departAfterMinute: null, sortBy: null });
    expect(all.wl.map((r) => r.number)).toEqual(["14617"]); /* N-A neeche */
    expect(all.missingClass).toBe(0);
  });

  it("jis train me wo class hi nahi → missingClass ginti (jhooth nahi)", () => {
    const pick = pickSeatRows(board, { classCodes: ["1A"], onlyAvailable: true, departAfterMinute: null, sortBy: null });
    expect(pick.seat).toEqual([]);
    expect(pick.wl).toEqual([]);
    expect(pick.missingClass).toBe(3);
  });

  it("'5 baje ke baad': time pata ho to filter, pata na ho to seat list se bahar (unknownTime)", () => {
    const times = new Map([
      ["11078", { departure: "04:30", arrival: "11:15", durationMinutes: 405 }],
      ["20986", { departure: "18:40", arrival: "23:55", durationMinutes: 315 }],
    ]);
    const pick = pickSeatRows(board, { classCodes: ["2A"], onlyAvailable: true, departAfterMinute: 17 * 60, sortBy: null }, times);
    expect(pick.seat.map((r) => r.number)).toEqual(["20986"]); /* 11078 04:30 — filter se pehle */
    /* onlyAvailable mode me 14617 (NOT_AVAILABLE) waise hi list me nahi aata → unknownTime 0. */
    expect(pick.unknownTime).toBe(0);
    /* "sabhi trains" mode me wahi row time ke bina aati hai → unknownTime 1 (jhooth nahi bolte). */
    const all = pickSeatRows(board, { classCodes: ["2A"], onlyAvailable: false, departAfterMinute: 17 * 60, sortBy: null }, times);
    expect(all.unknownTime).toBe(1);
  });

  it("cheapest / fastest sort", () => {
    const times = new Map([
      ["11078", { departure: "04:30", durationMinutes: 405 }],
      ["20986", { departure: "18:40", durationMinutes: 315 }],
    ]);
    const cheap = pickSeatRows(board, { classCodes: ["2A"], onlyAvailable: true, departAfterMinute: null, sortBy: "cheapest" }, times);
    expect(cheap.seat.map((r) => r.number)).toEqual(["11078", "20986"]); /* ₹825 < ₹890 */
    const fast = pickSeatRows(board, { classCodes: ["2A"], onlyAvailable: true, departAfterMinute: null, sortBy: "fastest" }, times);
    expect(fast.seat.map((r) => r.number)).toEqual(["20986", "11078"]); /* 5h15m < 6h45m */
  });

  it("summary line: asli numbers, WL honest, koi confirm% nahi", () => {
    const pick = pickSeatRows(board, { classCodes: ["2A"], onlyAvailable: true, departAfterMinute: null, sortBy: null });
    const line = seatSummaryLine(pick, { classCodes: ["2A"], sortBy: null, departAfterMinute: null }, { from: "LDH", to: "NDLS" });
    expect(line).toContain("11078");
    expect(line).toContain("AVL 29");
    expect(line).toContain("RAC 9");
    expect(line).not.toMatch(/\d+\s*%/);
    expect(line).toContain("LDH → NDLS");

    const none = pickSeatRows(
      [{ trainNumber: "14617", trainName: "JANSEWA EXP", classes: [{ classCode: "2A", code: "2A", status: "WAITLIST", waitlist: 14, fare: 300 }] }],
      { classCodes: ["2A"], onlyAvailable: true, departAfterMinute: null, sortBy: null },
    );
    expect(none.seat).toEqual([]);
    const wlOnly = pickSeatRows(
      [{ trainNumber: "14617", trainName: "JANSEWA EXP", classes: [{ classCode: "2A", code: "2A", status: "WAITLIST", waitlist: 14, fare: 300 }] }],
      { classCodes: ["2A"], onlyAvailable: false, departAfterMinute: null, sortBy: null },
    );
    const line2 = seatSummaryLine(wlOnly, { classCodes: ["2A"], sortBy: null, departAfterMinute: null }, { from: "LDH", to: "NDLS" });
    expect(line2).toContain("WL 14");
    expect(line2).toContain("AVAILABLE/RAC wali koi train nahi");
  });
});
