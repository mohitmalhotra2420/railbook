/* ══ ROUND-49 (29 Sep 2026) — sirf wahi trains jo maangi hui destination tak JAATI HAIN ══════════════
 * User (screenshots, 29 Sep): "LDH → SVDK" maanga tha, par board me 12265 JAT DURONTO / 13151 KOAA JAT
 * EXPRES bhi aa gayi — dono Jammu Tawi (JAT) par khatam hoti hain, SVDK (Katra) tak jaati hi nahi.
 * User: "maine to svdk tak maangi hai confirm seat wo fir jammu ki kyu dikha rha beech mein".
 *
 * ConfirmTkt ka route-board paas ke bade station wali trains bhi deta hai (JAT, Katra ke liye). Wo user
 * ke liye unbookable hai — na seat us segment ki, na train wahan jaati hai.
 *
 * Fix (general): board ke HAR train ka route (wahi provider timetable) verify hota hai — jo `to` tak
 * nahi jaati (ya `from` par rukti hi nahi / order ulta) wo list se hat jati hai + ek saaf note aata hai.
 * Route pata na chale to train RAKHI jaati hai (andaza nahi) — sirf verified-negative hataate hain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const routeBoard = vi.fn();
const classBoard = vi.fn();
const searchTrains = vi.fn();
const stationSearch = vi.fn();

vi.mock("../server/railway/router.js", () => ({
  routedRouteBoard: (...a: unknown[]) => routeBoard(...a),
  routedClassBoard: (...a: unknown[]) => classBoard(...a),
  routedStationSearch: (...a: unknown[]) => stationSearch(...a),
}));
vi.mock("../server/providers/index.js", () => ({
  getProvider: () => ({ searchTrains: (...a: unknown[]) => searchTrains(...a), name: "mock" }),
}));

import { clearSegmentCache, filterTrainsServingSegment, routeDropNote, servesSegment, setSegmentScheduleResolver } from "../server/agent/routeSegment";
import { seatFilterFor } from "../server/agent/seatFilter";
import { runFindSeatsTool } from "../server/agent/seatFinderTool";
import type { SeatIntentSlots } from "../server/agent/seatIntent";

/* Asli routes (29 Sep 2026 live provider se verify kiye gaye):
 *   12265 JAT DURONTO   → DEE, LDH, JAT                (SVDK nahi)
 *   13151 KOAA JAT EXPRES → KOAA … JAT                 (SVDK nahi)
 *   11449 JBP SVDK EXP  → JBP … JAT, MCTM, SVDK        (SVDK haan)
 *   20433 JAMMU MAIL    → SFG … JAT, MCTM, SVDK        (SVDK haan)
 */
const ROUTES: Record<string, string[]> = {
  "12265": ["DEE", "LDH", "JAT"],
  "13151": ["KOAA", "LDH", "JAT"],
  "11449": ["JBP", "LDH", "JAT", "MCTM", "SVDK"],
  "20433": ["SFG", "LDH", "JAT", "MCTM", "SVDK"],
};

const boardWith = (trains: { trainNumber: string; trainName: string; classes: { classCode: string; status: string; seats?: number; fare?: number }[] }[]) => ({
  trains,
  provider: "web_confirmtkt",
  at: Date.now(),
});

const slots: SeatIntentSlots = {
  classCodes: [],
  classGroup: null,
  onlyAvailable: true,
  departAfterMinute: null,
  departBeforeMinute: null,
  windowLabel: null,
  sortBy: null,
  seatIntent: true,
};

beforeEach(() => {
  clearSegmentCache();
  routeBoard.mockReset();
  classBoard.mockReset();
  searchTrains.mockReset();
  searchTrains.mockResolvedValue([]);
  setSegmentScheduleResolver(async (n: string) => ({ stops: (ROUTES[n] ?? []).map((code) => ({ code })) }));
});

afterEach(() => {
  clearSegmentCache();
  setSegmentScheduleResolver(async () => null);
});

describe("Round-49 · route segment verification (server)", () => {
  it("servesSegment: to route me nahi → false; order ulta → false; pata nahi → null (keep)", () => {
    const cover = (codes: string[]) => ({ order: new Map(codes.map((c, i) => [c, i])), first: codes[0], last: codes[codes.length - 1] });
    expect(servesSegment(cover(ROUTES["12265"]), "LDH", "SVDK")).toBe(false);
    expect(servesSegment(cover(ROUTES["11449"]), "LDH", "SVDK")).toBe(true);
    expect(servesSegment(cover(ROUTES["11449"]), "SVDK", "LDH")).toBe(false); /* ulta */
    expect(servesSegment(null, "LDH", "SVDK")).toBe(null);
  });

  it("filter: JAT tak wali hatti hai, SVDK wali rehti hai; note saaf", async () => {
    const trains = [
      { trainNumber: "12265", trainName: "JAT DURONTO EXP" },
      { trainNumber: "11449", trainName: "JBP SVDK EXP" },
      { trainNumber: "13151", trainName: "KOAA JAT EXPRES" },
      { trainNumber: "20433", trainName: "JAMMU MAIL" },
    ];
    const { trains: kept, dropped } = await filterTrainsServingSegment(trains, "LDH", "SVDK");
    expect(kept.map((t) => t.trainNumber)).toEqual(["11449", "20433"]);
    expect(dropped.map((d) => `${d.number}:${d.last}`)).toEqual(["12265:JAT", "13151:JAT"]);
    const note = routeDropNote(dropped, "SVDK");
    expect(note).toContain("12265 JAT DURONTO EXP");
    expect(note).toContain("SVDK tak nahi jaati");
    expect(note).toContain("list se hata di");
  });

  it("route pata na chale (resolver fail) → train RAKHI jaati hai (andaza nahi)", async () => {
    setSegmentScheduleResolver(async () => {
      throw new Error("provider down");
    });
    clearSegmentCache();
    const { trains: kept, dropped } = await filterTrainsServingSegment([{ trainNumber: "99999", trainName: "X" }], "LDH", "SVDK");
    expect(kept.map((t) => t.trainNumber)).toEqual(["99999"]);
    expect(dropped).toEqual([]);
  });

  it("seatFilterFor: rows aur line se JAT wali trains hat jaati hain + dropNote", async () => {
    routeBoard.mockResolvedValue(
      boardWith([
        { trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 14, fare: 640 }] },
        { trainNumber: "11449", trainName: "JBP SVDK EXP", classes: [{ classCode: "1A", status: "AVAILABLE", seats: 1, fare: 1455 }] },
      ]),
    );
    const res = await seatFilterFor({ from: "LDH", to: "SVDK", date: "2026-09-30", slots });
    expect(res).not.toBe(null);
    expect(res!.rows.map((r) => r.number)).toEqual(["11449"]);
    expect(res!.line).toContain("11449");
    expect(res!.line).not.toMatch(/12013|12265 *3A|JAT DURONTO EXP · 3A/);
    expect(res!.line).toContain("12265 JAT DURONTO EXP");
    expect(res!.line).toContain("SVDK tak nahi jaati");
    expect(res!.dropNote).toContain("12265 JAT DURONTO EXP");
  });

  it("FIND_SEATS: pool me hi JAT wali nahi jaati (AI unki rows nahi likh sakta) + ROUTE note", async () => {
    routeBoard.mockResolvedValue(
      boardWith([
        { trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 14, fare: 640 }] },
        { trainNumber: "20433", trainName: "JAMMU MAIL", classes: [{ classCode: "1A", status: "AVAILABLE", seats: 1, fare: 1530 }] },
      ]),
    );
    const res = await runFindSeatsTool({ from: "LDH", to: "SVDK", date: "2026-09-30", class_code: "ALL", only_available: true });
    expect(res.ok).toBe(true);
    const data = res.data as { rows: { number: string }[] };
    expect(data.rows.map((r) => r.number)).toEqual(["20433"]);
    expect(res.summary).not.toMatch(/^SEAT[^\n]*12265/m);
    expect(res.summary).toContain("ROUTE:");
    expect(res.summary).toContain("12265 JAT DURONTO EXP");
  });

  it("JAT maanga ho to wahi train list me rehti hai (koi false drop nahi)", async () => {
    routeBoard.mockResolvedValue(
      boardWith([{ trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 14, fare: 640 }] }]),
    );
    const res = await seatFilterFor({ from: "LDH", to: "JAT", date: "2026-09-30", slots });
    expect(res!.rows.map((r) => r.number)).toEqual(["12265"]);
    expect(res!.line).not.toContain("nahi jaati");
  });
});
