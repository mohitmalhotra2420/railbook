/* ══ ROUND-50 (29 Sep 2026) — (a) dikhaayi wali trains ke rows LIVE verify, (b) "JAT tak (aage khud)" section ══
 * User: "maine last step mein findout kri thi ki 12265 mein 2S seat availability IRCTC pe and confirmtkt
 * pe bhi show ho rhi thi but mere app mein nahi" + "Haan banado" (JAT tak wali trains ka alag section).
 *
 * (a) ConfirmTkt ka board row purana/future-dated ho sakta hai (us row par `updatedAt` future me dikhta
 *     hai — CT apna IST time UTC label karta hai), aur usme IRCTC se ulat value ho sakti hai. Ab chat/
 *     card wale seat jawab me bhi wahi freshness pass chalta hai jo /api/availability ke focus trains par
 *     chalta tha — dikhaayi jaane wali trains (seat wali pehle, phir WL wali, max 6) ke stale/UNKNOWN/
 *     future rows ka live probe; live row na mile to purani row waise hi (kuch invent nahi).
 * (b) Jo trains maangi hui destination tak nahi jaati (jaise LDH→SVDK me JAT par khatam), unme se
 *     seat-detih trains alag section me — "JAT tak (aage ka safar khud)" — yahi IRCTC bhi dikhata hai.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const routeBoard = vi.fn();
const classBoard = vi.fn();
const searchTrains = vi.fn();
const stationSearch = vi.fn();
const enrichFresh = vi.fn();

vi.mock("../server/railway/router.js", () => ({
  routedRouteBoard: (...a: unknown[]) => routeBoard(...a),
  routedClassBoard: (...a: unknown[]) => classBoard(...a),
  routedStationSearch: (...a: unknown[]) => stationSearch(...a),
  enrichTrainsFreshness: (...a: unknown[]) => enrichFresh(...a),
}));
vi.mock("../server/providers/index.js", () => ({
  getProvider: () => ({ searchTrains: (...a: unknown[]) => searchTrains(...a), name: "mock" }),
}));

import { clearSegmentCache, nearbyCandidatesNote, setSegmentScheduleResolver } from "../server/agent/routeSegment";
import { seatFilterFor } from "../server/agent/seatFilter";
import { runFindSeatsTool } from "../server/agent/seatFinderTool";
import type { SeatIntentSlots } from "../server/agent/seatIntent";

const ROUTES: Record<string, string[]> = {
  "12265": ["DEE", "LDH", "JAT"], // JAT par khatam — SVDK nahi
  "13151": ["KOAA", "LDH", "JAT"],
  "11449": ["JBP", "LDH", "JAT", "MCTM", "SVDK"],
  "20433": ["SFG", "LDH", "JAT", "MCTM", "SVDK"],
};

/* CT board jaisa row: 2S ka updatedAt future me (IST-ko-UTC label) — jaisa prod me dikha tha. */
const FUTURE = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString();

const boardWith = (trains: unknown[]) => ({ trains, provider: "web_confirmtkt", at: Date.now() });

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
  enrichFresh.mockReset();
  searchTrains.mockResolvedValue([]);
  setSegmentScheduleResolver(async (n: string) => ({ stops: (ROUTES[n] ?? []).map((code) => ({ code })) }));
});

afterEach(() => {
  clearSegmentCache();
  setSegmentScheduleResolver(async () => null);
});

describe("Round-50 · (a) freshness pass — dikhaayi wali trains ke rows live verify", () => {
  it("2S row (future-dated, WL) live probe se AVAILABLE ho jaye to wahi dikhta hai (user ka 12265 case)", async () => {
    routeBoard.mockResolvedValue(
      boardWith([
        {
          trainNumber: "12265",
          trainName: "JAT DURONTO EXP",
          classes: [
            { code: "3A", status: "AVAILABLE", seats: 14, fare: 640, updatedAt: new Date().toISOString() },
            { code: "2A", status: "AVAILABLE", seats: 5, fare: 870, updatedAt: new Date().toISOString() },
            /* 2S: board par WL + future-dated timestamp (IRCTC par AVAILABLE thi) */
            { code: "2S", status: "WAITLIST", waitlist: 3, fare: 225, updatedAt: FUTURE },
          ],
        },
      ]),
    );
    enrichFresh.mockImplementation(async (trains: { trainNumber: string; classes: { code: string }[] }[], numbers: string[]) => {
      expect(numbers).toEqual(["12265"]);
      const t = trains.find((x) => x.trainNumber === "12265");
      const row = t?.classes.find((c) => c.code === "2S");
      if (row) Object.assign(row, { status: "AVAILABLE", seats: 660, waitlist: undefined });
      return 1;
    });
    const res = await seatFilterFor({ from: "LDH", to: "JAT", date: "2026-09-30", slots });
    expect(enrichFresh).toHaveBeenCalledTimes(1);
    const two = res!.rows.find((r) => r.classCode === "2S");
    expect(two).toMatchObject({ status: "AVAILABLE", seats: 660, fare: 225 });
    expect(res!.line).toContain("2S AVL 660");
  });

  it("live probe fail ho to purana board data waise hi chalta hai (kuch invent nahi)", async () => {
    routeBoard.mockResolvedValue(
      boardWith([{ trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ code: "3A", status: "AVAILABLE", seats: 14, fare: 640, updatedAt: FUTURE }] }]),
    );
    enrichFresh.mockRejectedValue(new Error("provider down"));
    const res = await seatFilterFor({ from: "LDH", to: "JAT", date: "2026-09-30", slots });
    expect(res!.rows.map((r) => `${r.classCode}:${r.seats}`)).toEqual(["3A:14"]);
  });

  it("enrichment sirf un trains par jinke rows user ko dikhte hain (max 6, seat pehle)", async () => {
    routeBoard.mockResolvedValue(
      boardWith(
        Array.from({ length: 9 }, (_, i) => ({
          trainNumber: `1220${i}`,
          trainName: `T${i}`,
          classes: [{ code: "3A", status: "AVAILABLE", seats: 5, fare: 600, updatedAt: FUTURE }],
        })),
      ),
    );
    enrichFresh.mockResolvedValue(0);
    await seatFilterFor({ from: "LDH", to: "JAT", date: "2026-09-30", slots });
    expect(enrichFresh).toHaveBeenCalledTimes(1);
    const numbers = enrichFresh.mock.calls[0][1] as string[];
    expect(numbers.length).toBeLessThanOrEqual(6);
  });
});

describe("Round-50 · (b) 'JAT tak (aage ka safar khud)' section", () => {
  it("hataayi gayi JAT trains (seats ke saath) alag section me — main rows me nahi", async () => {
    routeBoard.mockResolvedValue(
      boardWith([
        { trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ code: "3A", status: "AVAILABLE", seats: 14, fare: 640 }, { code: "2A", status: "AVAILABLE", seats: 5, fare: 870 }] },
        { trainNumber: "13151", trainName: "KOAA JAT EXPRES", classes: [{ code: "SL", status: "AVAILABLE", seats: 8, fare: 195 }] },
        { trainNumber: "11449", trainName: "JBP SVDK EXP", classes: [{ code: "1A", status: "AVAILABLE", seats: 1, fare: 1455 }] },
      ]),
    );
    enrichFresh.mockResolvedValue(0);
    const res = await seatFilterFor({ from: "LDH", to: "SVDK", date: "2026-09-30", slots });
    /* main list me sirf SVDK jaane wali */
    expect(res!.rows.map((r) => r.number)).toEqual(["11449"]);
    /* section: JAT tak wali, seats wahi board se */
    expect(res!.nearbyNote).toContain("JAT tak");
    expect(res!.nearbyNote).toContain("12265 JAT DURONTO EXP (3A AVL 14 · 2A AVL 5)");
    expect(res!.nearbyNote).toContain("13151 KOAA JAT EXPRES (SL AVL 8)");
    expect(res!.nearbyNote).toContain("SVDK ka nahi");
    /* reply line me bhi wahi sach */
    expect(res!.line).toContain("JAT tak");
    expect(res!.line).toContain("12265 JAT DURONTO EXP");
  });

  it("jo train seat-detih nahi (sirf WL) wo section me nahi aati — jhootha offer nahi", async () => {
    routeBoard.mockResolvedValue(
      boardWith([
        { trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ code: "3A", status: "WAITLIST", waitlist: 12, fare: 640 }] },
        { trainNumber: "11449", trainName: "JBP SVDK EXP", classes: [{ code: "1A", status: "AVAILABLE", seats: 1, fare: 1455 }] },
      ]),
    );
    enrichFresh.mockResolvedValue(0);
    const res = await seatFilterFor({ from: "LDH", to: "SVDK", date: "2026-09-30", slots });
    expect(res!.nearbyNote).toBe(null);
  });

  it("kuch hati na ho to section hi nahi (SVDK/control dono)", async () => {
    routeBoard.mockResolvedValue(boardWith([{ trainNumber: "11449", trainName: "JBP SVDK EXP", classes: [{ code: "1A", status: "AVAILABLE", seats: 1, fare: 1455 }] }]));
    enrichFresh.mockResolvedValue(0);
    const res = await seatFilterFor({ from: "LDH", to: "SVDK", date: "2026-09-30", slots });
    expect(res!.nearbyNote).toBe(null);
    expect(res!.dropNote).toBe(null);
  });

  it("nearbyCandidatesNote: station-wise group, sirf board rows se, aur WL-only train section me nahi", () => {
    const note = nearbyCandidatesNote(
      [
        { trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ code: "3A", status: "AVAILABLE", seats: 14 }] },
        { trainNumber: "12355", trainName: "ARCHNA EXP", classes: [{ code: "2A", status: "WAITLIST", waitlist: 3 }] },
      ],
      [
        { number: "12265", name: "JAT DURONTO EXP", last: "JAT", reason: "last stop JAT" },
        { number: "12355", name: "ARCHNA EXP", last: "JAT", reason: "last stop JAT" },
      ],
      "LDH",
      "SVDK",
    );
    expect(note).toContain("JAT tak");
    expect(note).toContain("12265 JAT DURONTO EXP (3A AVL 14)");
    expect(note).not.toContain("12355"); /* WL-only train ka offer nahi */
    expect(note).toContain("LDH→JAT tak ka ticket hota hai, SVDK ka nahi");
  });
});

describe("Round-50 · FIND_SEATS (AI path) bhi wahi dono baatein laata hai", () => {
  it("freshness call + NEARBY line summary me", async () => {
    routeBoard.mockResolvedValue(
      boardWith([
        { trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ code: "3A", status: "AVAILABLE", seats: 14, fare: 640 }] },
        { trainNumber: "11449", trainName: "JBP SVDK EXP", classes: [{ code: "1A", status: "AVAILABLE", seats: 1, fare: 1455 }] },
      ]),
    );
    enrichFresh.mockResolvedValue(0);
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    const res = await runFindSeatsTool({ from: "LDH", to: "SVDK", date: "2026-09-30", class_code: "ALL", only_available: true });
    expect(enrichFresh).toHaveBeenCalled();
    expect(res.summary).toContain("NEARBY:");
    expect(res.summary).toContain("JAT tak");
    expect(res.summary).toContain("12265 JAT DURONTO EXP");
    const data = res.data as { rows: { number: string }[] };
    expect(data.rows.map((r) => r.number)).toEqual(["11449"]);
  });
});
