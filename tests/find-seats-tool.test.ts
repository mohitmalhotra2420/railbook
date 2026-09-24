/* 24 Sep 2026 — FIND_SEATS / findSeats tool (AI khud seat sawaal ka jawab deta hai).
 *
 * User: "Haan yeh kro — do not specific to 2A, user kuch bhi pooch sakta hai."
 * Ye test sirf ye lock karta hai ki:
 *   • tool dono agents (agentic + autonomous) ke registry me registered hai,
 *   • args se class/filter/sort/time sahi parse hote hain (bhasha bhi — "5 baje ke baad"),
 *   • LIVE layers (routedRouteBoard + routedClassBoard) hi use hote hain — koi naya endpoint nahi,
 *   • jawab me sirf asli rows aati hain (WL par confirm% nahi, class missing honest),
 *   • route board fail ho to saaf fail milta hai (kuch invent nahi).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

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

import { classesFromArg, minutesFromArg, runFindSeatsTool, timeWindowFromWord } from "../server/agent/seatFinderTool";
import { AGENTIC_TOOLS } from "../server/agent/agentic";
import { AUTO_TOOLS } from "../server/agent/toolSpecs";

const board = (trains: unknown[]) => ({ trains, provider: "web_confirmtkt" });

beforeEach(() => {
  routeBoard.mockReset();
  classBoard.mockReset();
  searchTrains.mockReset();
  stationSearch.mockReset();
  stationSearch.mockResolvedValue({ stations: [], provider: "mock" });
});

describe("FIND_SEATS — registry", () => {
  it("agentic tools me FIND_SEATS hai (description + required args)", () => {
    const t = AGENTIC_TOOLS.find((x) => x.function.name === "FIND_SEATS");
    expect(t).toBeTruthy();
    expect(t!.function.description).toMatch(/seat/i);
    expect((t!.function.parameters as { required?: string[] }).required).toEqual(["from", "to", "date"]);
  });
  it("autonomous tools me findSeats hai", () => {
    expect(AUTO_TOOLS.some((t) => t.function.name === "findSeats")).toBe(true);
  });
});

describe("args parsing (user kuch bhi bole)", () => {
  it("class: ALL/AC/ek/ek se zyada", () => {
    expect(classesFromArg("ALL")).toEqual([]);
    expect(classesFromArg("AC")).toEqual(["1A", "2A", "3A", "3E", "CC", "EC"]);
    expect(classesFromArg("2A")).toEqual(["2A"]);
    expect(classesFromArg("SL,3A")).toEqual(["SL", "3A"]);
    expect(classesFromArg(null)).toEqual([]);
  });
  it("time: '17:00', '5 baje ke baad', 'raat 9 ke baad', 'after 5'", () => {
    expect(minutesFromArg("17:00")).toBe(1020);
    expect(minutesFromArg("5 baje ke baad")).toBe(1020);
    expect(minutesFromArg("raat 9 ke baad")).toBe(1260);
    expect(minutesFromArg("after 5")).toBe(300);
    expect(minutesFromArg(600)).toBe(600);
    expect(minutesFromArg("")).toBeNull();
  });
});

describe("runFindSeatsTool — sirf live rows", () => {
  it("2A: per-train board se missing class laata hai (Swarn Shatabdi EC case) aur summary deta hai", async () => {
    routeBoard.mockResolvedValue(
      board([
        { trainNumber: "12029", trainName: "SWARN SHATABDI", classes: [{ classCode: "CC", status: "AVAILABLE", seats: 86, fare: 415 }, { classCode: "EC", status: "UNKNOWN" }] },
        { trainNumber: "12497", trainName: "SHANE PUNJAB", classes: [{ classCode: "2S", status: "AVAILABLE", seats: 87, fare: 80 }] },
      ]),
    );
    classBoard.mockResolvedValue({ classes: [{ code: "EC", status: "AVAILABLE", seats: 6, fare: 660, source: "web_railyatri" }], provider: "web_railyatri" });

    const res = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "2026-09-25", class_code: "2A" });
    expect(res.ok).toBe(true);
    const data = res.data as { rows: { number: string; classCode: string }[]; missingClass: number };
    expect(data.rows).toEqual([]); /* 2A kisi me nahi */
    expect(data.missingClass).toBe(2); /* dono trains me 2A hi nahi — honest */
    expect(res.summary).toContain("2A");
  });

  it("AC maanga → sirf AC classes (2S baahar), aur per-train se EC asli row", async () => {
    routeBoard.mockResolvedValue(
      board([
        { trainNumber: "12029", trainName: "SWARN SHATABDI", classes: [{ classCode: "CC", status: "AVAILABLE", seats: 86, fare: 415 }, { classCode: "EC", status: "UNKNOWN" }] },
        { trainNumber: "12497", trainName: "SHANE PUNJAB", classes: [{ classCode: "2S", status: "AVAILABLE", seats: 87, fare: 80 }] },
      ]),
    );
    /* Per-train board per train (mock): 12029 ke paas EC asli hai, 12497 ke paas nahi. */
    classBoard.mockImplementation(async (n: string) =>
      String(n) === "12029"
        ? { classes: [{ code: "EC", status: "AVAILABLE", seats: 6, fare: 660 }], provider: "web_railyatri" }
        : { classes: [{ code: "CC", status: "WAITLIST", waitlist: 37, fare: 320 }], provider: "web_railyatri" },
    );

    const res = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "2026-09-25", class_code: "AC" });
    const data = res.data as { rows: { number: string; classCode: string }[] };
    expect(data.rows.map((r) => `${r.number} ${r.classCode}`)).toEqual(["12029 CC", "12029 EC"]); /* 2S nahi aaya */
    expect(res.summary).toContain("AC (1A/2A/3A/3E/CC/EC)");
    expect(res.summary).not.toContain("2S");
  });

  it("only_available=false → WL rows bhi (confirm% kabhi nahi)", async () => {
    routeBoard.mockResolvedValue(
      board([{ trainNumber: "18103", trainName: "JALIANWALABAG EX", classes: [{ classCode: "2A", status: "WAITLIST", waitlist: 11, fare: 725 }] }]),
    );
    const res = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "2026-09-25", class_code: "2A", only_available: false });
    const data = res.data as { wlRows: unknown[] };
    expect(data.wlRows).toHaveLength(1);
    expect(res.summary).toContain("WL 11");
    expect(res.summary).not.toMatch(/\d+\s*%/);
  });

  it("sabse sasta → fare se sort (times bhi aate hain)", async () => {
    routeBoard.mockResolvedValue(
      board([
        { trainNumber: "12203", trainName: "GARIB RATH EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 220, fare: 285 }] },
        { trainNumber: "12925", trainName: "PASCHIM EXPRESS", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 3, fare: 565 }] },
      ]),
    );
    searchTrains.mockResolvedValue([
      { number: "12203", departure: "19:20", arrival: "21:05", durationMinutes: 105 },
      { number: "12925", departure: "17:47", arrival: "19:23", durationMinutes: 96 },
    ]);
    const res = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "2026-09-25", class_code: "3A", sort_by: "cheapest" });
    const data = res.data as { rows: { number: string; fare: number }[] };
    expect(data.rows.map((r) => r.number)).toEqual(["12203", "12925"]);
    expect(data.rows[0].fare).toBe(285);
  });

  it("train_numbers diya → sirf wahi trains", async () => {
    routeBoard.mockResolvedValue(
      board([
        { trainNumber: "12029", trainName: "SWARN SHATABDI", classes: [{ classCode: "CC", status: "AVAILABLE", seats: 60, fare: 415 }] },
        { trainNumber: "12203", trainName: "GARIB RATH EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 220, fare: 285 }] },
      ]),
    );
    const res = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "2026-09-25", class_code: "ALL", train_numbers: "12029" });
    const data = res.data as { rows: { number: string }[] };
    expect(data.rows.map((r) => r.number)).toEqual(["12029"]);
  });

  it("board hi nahi aayi → honest fail (kuch invent nahi)", async () => {
    routeBoard.mockRejectedValue(new Error("provider busy"));
    const res = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "2026-09-25", class_code: "2A" });
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/nahi aayi/);
  });

  it("station resolve na ho / date galat → fail (user se poochho)", async () => {
    stationSearch.mockResolvedValue({ stations: [], provider: "mock" });
    const bad = await runFindSeatsTool({ from: "Zzzzz", to: "BEAS", date: "2026-09-25" });
    expect(bad.ok).toBe(false);
    const badDate = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "kal" });
    expect(badDate.ok).toBe(false);
  });
});

/* ── Round-19 (24 Sep 2026, user screenshot) ────────────────────────────────────────────────────
 * "Mujhe kal subha ki trains btana amritsar se ludhiana ki" → poora din ki list aa gayi (16:50,
 * 18:55 bhi). Ab AI "subah/shaam/raat" jaisa window bhej sakta hai aur tool usi window par filter
 * karta hai. Sab kuch wahi live board — koi naya endpoint/guess nahi. */
describe("FIND_SEATS — time window (subah/dopahar/shaam/raat)", () => {
  it("shabd se window: 'subah' = 04:00–12:00, 'raat' = 21:00 → 04:00 (wrap), ghadi ho to null", () => {
    expect(timeWindowFromWord("subah")).toEqual({ after: 240, before: 720, label: "Subah (04:00–12:00)" });
    expect(timeWindowFromWord("सुबह की trains")).toEqual({ after: 240, before: 720, label: "Subah (04:00–12:00)" });
    expect(timeWindowFromWord("shaam")).toEqual({ after: 1020, before: 1260, label: "Shaam (17:00–21:00)" });
    expect(timeWindowFromWord("raat")).toEqual({ after: 1260, before: 240, label: "Raat (21:00 ke baad)" });
    expect(timeWindowFromWord("morning")).toEqual({ after: 240, before: 720, label: "Subah (04:00–12:00)" });
    expect(timeWindowFromWord("5 baje ke baad")).toBeNull(); /* ghadi — minutesFromArg ka kaam */
    expect(timeWindowFromWord(null)).toBeNull();
  });

  it("depart_after='subah' → sirf subah ki trains (shaam ki nahi)", async () => {
    routeBoard.mockResolvedValue(
      board([
        { trainNumber: "12014", trainName: "AMRITSAR SHTABDI", classes: [{ classCode: "CC", status: "AVAILABLE", seats: 410, fare: 490 }] },
        { trainNumber: "12030", trainName: "SWARN SHATABDI", classes: [{ classCode: "CC", status: "AVAILABLE", seats: 100, fare: 490 }] },
      ]),
    );
    searchTrains.mockResolvedValue([
      { number: "12014", departure: "04:55", arrival: "06:57", durationMinutes: 122 },
      { number: "12030", departure: "16:50", arrival: "18:50", durationMinutes: 120 },
    ]);
    const res = await runFindSeatsTool({ from: "ASR", to: "LDH", date: "2026-09-25", class_code: "ALL", depart_after: "subah" });
    const data = res.data as { rows: { number: string }[]; departAfterMinute: number; departBeforeMinute: number };
    expect(data.rows.map((r) => r.number)).toEqual(["12014"]); /* 16:50 subah nahi hai */
    expect(data.departAfterMinute).toBe(240);
    expect(data.departBeforeMinute).toBe(720);
    expect(res.summary).toContain("Subah (04:00–12:00)");
  });

  it("raat window wrap karta hai (23:00 bhi, 00:40 bhi) aur '12 baje se pehle' bhi chalta hai", async () => {
    routeBoard.mockResolvedValue(
      board([
        { trainNumber: "1", trainName: "LATE NIGHT", classes: [{ classCode: "SL", status: "AVAILABLE", seats: 5, fare: 300 }] },
        { trainNumber: "2", trainName: "MIDNIGHT", classes: [{ classCode: "SL", status: "AVAILABLE", seats: 9, fare: 300 }] },
        { trainNumber: "3", trainName: "MORNING", classes: [{ classCode: "SL", status: "AVAILABLE", seats: 40, fare: 300 }] },
        { trainNumber: "4", trainName: "NOON", classes: [{ classCode: "SL", status: "AVAILABLE", seats: 50, fare: 300 }] },
      ]),
    );
    searchTrains.mockResolvedValue([
      { number: "1", departure: "23:05", arrival: "01:00", durationMinutes: 115 },
      { number: "2", departure: "00:40", arrival: "05:55", durationMinutes: 315 },
      { number: "3", departure: "07:20", arrival: "09:30", durationMinutes: 130 },
      { number: "4", departure: "16:50", arrival: "18:50", durationMinutes: 120 },
    ]);
    const night = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "2026-09-25", depart_after: "raat" });
    /* wrap window: 23:05 aur 00:40 dono andar (sort purana hi — ghadi ke hisaab se). */
    expect((night.data as { rows: { number: string }[] }).rows.map((r) => r.number).sort()).toEqual(["1", "2"]);
    const before = await runFindSeatsTool({ from: "LDH", to: "BEAS", date: "2026-09-25", depart_before: "12:00" });
    /* 12:00 se pehle: 07:20 (40 seats) aur 00:40 (9 seats) — 16:50 baahar. Sort purana: zyada seat pehle. */
    expect((before.data as { rows: { number: string }[] }).rows.map((r) => r.number)).toEqual(["3", "2"]);
  });
});
