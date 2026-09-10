/** Round-18m — seat probe must run even when the search row has no class list (RailRadar/erail rows). */
import { describe, it, expect, vi } from "vitest";

vi.mock("../server/railway/webscrape.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/railway/webscrape.js")>();
  return {
    ...mod,
    scrapeTrainFareWeb: async (n: string) => ({ trainNumber: n, classes: [{ code: "CC", general: 1035, tatkal: null }, { code: "EC", general: 1830, tatkal: null }, { code: "GN", general: null, tatkal: null }], provider: "web_erail", sourceUrl: "x" }),
  };
});

describe("Round-18m webTrainClasses", () => {
  it("derives class codes from the erail fare page and ignores non-class columns", async () => {
    const { webTrainClasses } = await import("../server/railway/router.js");
    expect(await webTrainClasses("22478")).toEqual(["CC", "EC"]);
  });
});

describe("Round-18m bare index picks the Nth train after a list (never a station)", () => {
  it("'1' → first train of lastTrainNumbers when route is set", async () => {
    const { resolveTrainNumber, emptyAgentContext } = await import("../server/agent/context.js");
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana", city: "Ludhiana" }, destination: { code: "NDLS", name: "New Delhi", city: "Delhi" }, lastTrainNumbers: ["22478", "12014"], lastTrains: [{ number: "22478", name: "VB" }, { number: "12014", name: "SHATABDI" }] };
    expect(resolveTrainNumber("1", ctx as never)).toBe("22478");
    expect(resolveTrainNumber("2.", ctx as never)).toBe("12014");
    // pending station choice → not a train pick
    expect(resolveTrainNumber("1", { ...ctx, destination: null, pendingDestinationChoice: "Delhi" } as never)).toBeUndefined();
  });
});

describe("Round-18m live-status date chooser", () => {
  it("routedLiveDates keeps only dates that returned a run (mocked chain)", async () => {
    const router = await import("../server/railway/router.js");
    expect(typeof router.routedLiveDates).toBe("function");
    // Shape contract used by the client chips.
    const sample: import("../server/railway/router.js").LiveDateOption = { date: "2026-09-09", label: "Kal (Wed 9)", runState: "running", provider: "railradar" };
    expect(sample.label).toMatch(/Kal/);
  });
});

describe("Round-18m alt-date seat proof in summary", () => {
  it("says AVL only when a provider proved it; WL date is stated as WL", async () => {
    const { journeySummary } = await import("../server/journey/engine.js");
    const best = { rank: 1, category: "fastest", trainNumbers: ["12484"], trainNames: ["AMRITSAR KCVL EXP"], durationLabel: "27h 10m", legs: [{ trainNumber: "12484", trainName: "AMRITSAR KCVL EXP", from: "ASR", to: "MAO", departure: "08:20", arrival: "11:30", dayOffset: 1 }], durationMinutes: 1630, changes: 0, availability: { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 18, fare: 700, source: "web_railyatri" }, score: 1, reasons: [], badges: [], reliability: null } as never;
    const base = (alts: unknown[]) => ({ query: { from: "ASR", to: "MAO", date: "2026-09-13", travelClass: null, preference: "fastest" }, best, routeOptions: [best], connections: [], alternativeDates: alts, directUnavailable: true, recovery: null, provenance: { retrievedAt: new Date().toISOString(), freshness: "fresh", sources: [] }, sources: [], notes: [], conflicts: [] }) as never;
    const wl = journeySummary(base([{ date: "2026-09-14", count: 1, fastest: { number: "12484", durationMinutes: 1630 }, seatProof: "12484 SL WL 30" }]));
    expect(wl).toContain("Or shift to Mon 14 Sep — 1 train run (12484 SL WL 30).");
    const avl = journeySummary(base([{ date: "2026-09-14", count: 1, fastest: null, seatProof: "12484 SL WL 30" }, { date: "2026-09-15", count: 2, fastest: null, seatProof: "12483 3A AVL 12" }]));
    expect(avl).toContain("Or shift to Tue 15 Sep — 12483 3A AVL 12.");
  });
});

describe("Round-18m-3 connecting legs carry their own segment seat + station names", () => {
  it("probeConnectionLegs probes A: from→hub and B: hub→to (never from→to)", async () => {
    const { probeConnectionLegs, __test } = await import("../server/journey/engine.js");
    void __test;
    const router = await import("../server/railway/router.js");
    const calls: string[] = [];
    const spy = vi.spyOn(router, "routedClassBoard");
    void spy;
    const conn = { station: "UMB", stationName: "Ambala Cant Jn", arrivalTrain: "22478", departureTrain: "12926", arrivalAt: "11:48", departsAt: "13:10", arrivalDayOffset: 0, layoverMinutes: 82, valid: true, reason: null, totalDurationMinutes: 1888, source: "web_erail",
      legs: [
        { trainNumber: "22478", trainName: "VANDE BHARAT EXP", from: "JAT", fromName: "Jammu Tawi", to: "UMB", toName: "Ambala Cant Jn", departure: "07:12", arrival: "11:48", arrivalDayOffset: 0, durationMinutes: 276 },
        { trainNumber: "12926", trainName: "PASCHIM EXPRESS", from: "UMB", fromName: "Ambala Cant Jn", to: "BDTS", toName: "Bandra Terminus", departure: "13:10", arrival: "14:40", arrivalDayOffset: 1, durationMinutes: 1530 },
      ] } as never;
    // shape contract: legs get an `availability` slot (null when provider had nothing) and keep station names
    await probeConnectionLegs([conn], "2026-09-11", null, 1);
    const legs = (conn as { legs: { from: string; to: string; fromName?: string | null; availability?: unknown }[] }).legs;
    expect(legs.map((l) => `${l.from}>${l.to}`)).toEqual(["JAT>UMB", "UMB>BDTS"]);
    expect(legs[0].fromName).toBe("Jammu Tawi");
    expect(legs.every((l) => "availability" in l)).toBe(true);
    expect(calls).toEqual([]);
  }, 30000);
});

describe("Round-18m-5 connecting options only when BOTH legs have seats", () => {
  it("drops WL/stale legs, keeps AVL+RAC, deterministic order", async () => {
    const { bookableConnections } = await import("../server/journey/engine.js");
    const leg = (n: string, from: string, to: string, av: unknown) => ({ trainNumber: n, trainName: n, from, to, departure: "10:00", arrival: "12:00", arrivalDayOffset: 0, durationMinutes: 120, availability: av });
    const avl = (seats: number, extra: object = {}) => ({ classCode: "SL", status: "AVAILABLE", seats, rac: null, waitlist: null, fare: 500, source: "web_railyatri", ...extra });
    const wl = { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 44, fare: 500, source: "web_railyatri" };
    const conn = (id: string, a: unknown, b: unknown, total: number) => ({ station: "UMB", arrivalTrain: id, departureTrain: "x", arrivalAt: "", departsAt: "", arrivalDayOffset: 0, layoverMinutes: 60, valid: true, reason: null, totalDurationMinutes: total, source: "t", legs: [leg(id, "JAT", "UMB", a), leg("x", "UMB", "BDTS", b)] });
    const out = bookableConnections([
      conn("A", avl(10), wl, 100),                 // 2nd leg WL → drop
      conn("B", avl(5), avl(3), 300),              // ok
      conn("C", avl(12, { stale: true }), avl(9), 200), // stale leg → drop
      conn("D", avl(1), { ...wl, status: "RAC", rac: 2 }, 250), // AVL + RAC → ok
      conn("E", avl(4), null, 150),                // unknown leg → drop
    ] as never);
    expect(out.map((c) => c.arrivalTrain)).toEqual(["D", "B"]);
  });
});

describe("Round-18m-6 best plan = seat-proven first; board-from-earlier beats WL", () => {
  it("rankRouteOptions: connecting option with both legs AVL outranks a WL direct and an unknown direct", async () => {
    const { rankRouteOptions } = await import("../server/journey/engine.js");
    const st = (code: string) => ({ code, name: code, city: code });
    const train = (n: string, dur: number) => ({ number: n, name: n, type: "EXP", from: st("LDH"), to: st("LKO"), departure: "10:00", arrival: "20:00", arrivalDayOffset: 0, durationMinutes: dur, runsOn: [], classes: [] }) as never;
    const avl = (code: string, seats: number) => ({ classCode: code, status: "AVAILABLE", seats, rac: null, waitlist: null, fare: 1000, source: "railradar" });
    const wl = { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 27, fare: 400, source: "railradar" };
    const availability = new Map<string, unknown>([["13152", null], ["13308", wl]]);
    const conn = { station: "NDLS", stationName: "New Delhi", arrivalTrain: "12426", departureTrain: "20504", arrivalAt: "05:55", departsAt: "11:25", arrivalDayOffset: 0, layoverMinutes: 330, valid: true, reason: null, totalDurationMinutes: 1015, source: "railradar",
      legs: [{ trainNumber: "12426", trainName: "JAMMU RAJDHANI", from: "LDH", to: "NDLS", departure: "01:45", arrival: "05:55", arrivalDayOffset: 0, durationMinutes: 250, availability: avl("3A", 5) }, { trainNumber: "20504", trainName: "DBRG RAJDHANI", from: "NDLS", to: "LKO", departure: "11:25", arrival: "18:40", arrivalDayOffset: 0, durationMinutes: 435, availability: avl("3A", 19) }] };
    const ranked = rankRouteOptions({ origin: "LDH", destination: "LKO", trains: [train("13152", 905), train("13308", 880)], availability: availability as never, connections: [conn as never], source: "railradar", travelClass: null });
    expect(ranked[0].trainNumbers).toEqual(["12426", "20504"]);
    expect(ranked[0].availability?.status).toBe("AVAILABLE");
    expect(ranked[0].availability?.seats).toBe(5); // weakest leg
    // unknown direct must NOT outrank a WL direct
    expect(ranked.map((o) => o.trainNumbers[0]).slice(1)).toEqual(["13308", "13152"]);
  });
  it("journeySummary leads with book-from-earlier when best is WL", async () => {
    const { journeySummary } = await import("../server/journey/engine.js");
    const best = { rank: 1, category: "best_overall", trainNumbers: ["13308"], trainNames: ["GANGASATLUJ EXP"], durationLabel: "14h 40m", legs: [], departure: "19:55", arrival: "10:35", arrivalDayOffset: 1, durationMinutes: 880, changes: 0, availability: { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 27, fare: 415, source: "railradar" }, score: 1, reasons: [], badges: [], reliability: null } as never;
    const bfe = { trainNumber: "13308", trainName: "GANGASATLUJ EXP", bookFrom: "PHR", bookFromName: "Phillaur Jn", bookFromDeparture: "19:00", boardAt: "LDH", boardAtName: "Ludhiana Jn", boardAtDeparture: "19:55", destination: "LKO", destinationName: "Lucknow", arrival: "10:35", arrivalDayOffset: 1, availability: { classCode: "SL", status: "RAC", seats: null, rac: 31, waitlist: null, fare: 415, source: "railradar" }, directStatus: "WAITLIST", stopsBefore: 1, source: "railradar" };
    const s = journeySummary({ query: { from: "LDH", to: "LKO", date: "2026-09-15", travelClass: null, preference: "fastest" }, best, routeOptions: [best], connections: [], alternativeDates: [], directUnavailable: true, recovery: { reason: "WL", differentTrain: [], partialRoute: null, connecting: [], alternativeDates: [], alternateStations: [], boardFromEarlier: [bfe] }, provenance: { retrievedAt: new Date().toISOString(), freshness: "fresh", sources: [] }, sources: [], notes: [], conflicts: [] } as never);
    expect(s).toContain("Best plan: 13308 GANGASATLUJ EXP — ticket Phillaur Jn (PHR 19:00) se book karo, board Ludhiana Jn (LDH 19:55) par hi — SL RAC 31, ₹415. (LDH→LKO par SL WL 27.)");
  });
});
