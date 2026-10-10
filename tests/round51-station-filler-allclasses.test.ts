/* ══ ROUND-51 (29 Sep 2026) — (a) user ki wording (filler words) samajhna, (b) "confirm/available"
 * maangne par bhi har train ki SAARI classes jawab me ══
 *
 * (a) User screenshot (11:10, build b604eaf): `Yaar LDH se SVDK ke liye kal ke liye confirm seat find
 *     out karke do na` → app ne kaha *"Yaar Ldh" ke liye exact station chahiye*. Yaani poora phrase
 *     ("Yaar Ldh") hi unresolved station ban gaya, jabki "Ldh" = LDH. Ab phrase ke andar ka saaf
 *     station word dhoondha jaata hai — par sirf ek (poora route likha ho to nahi) aur cluster-city
 *     (delhi/mumbai) ho to bhi nahi (unke liye clarification hi chahiye).
 * (b) User: *"sabhi class kyu nahi show hoti jabh bhi specifically confirm, available poocho"* — jo
 *     train jawab me hai (usme seat mili), uski baaki classes bhi status ke saath dikhni chahiye
 *     (sirf-available filter trains par lagta hai, train ke andar classes chhupane par nahi).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { matchStation } from "../server/understand/legacy-stations";
import { understand } from "../server/understand/legacy-nlu";
import { seatSummaryLine, type SeatFilterRow } from "../server/agent/seatFilter";

const routeBoard = vi.fn();
const classBoard = vi.fn();
vi.mock("../server/railway/router.js", () => ({
  routedRouteBoard: (...a: unknown[]) => routeBoard(...a),
  routedClassBoard: (...a: unknown[]) => classBoard(...a),
  routedStationSearch: async () => ({ stations: [], needChoice: false }),
  enrichTrainsFreshness: async () => 0,
}));
vi.mock("../server/providers/index.js", () => ({
  getProvider: () => ({ searchTrains: async () => [], name: "mock" }),
}));
vi.mock("../server/agent/routeSegment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/agent/routeSegment.js")>();
  return {
    ...actual,
    /* route verification is test me pehle se resolved — sab trains segment tak jaati hain. */
    filterTrainsServingSegment: async (trains: { trainNumber: string; trainName?: string }[]) => ({ trains, dropped: [] }),
  };
});

import { runFindSeatsTool } from "../server/agent/seatFinderTool";

const row = (number: string, name: string, classCode: string, status: string, extra: Partial<SeatFilterRow> = {}): SeatFilterRow => ({
  number,
  name,
  classCode,
  status,
  seats: null,
  rac: null,
  waitlist: null,
  fare: null,
  departure: null,
  durationMinutes: null,
  ...extra,
});

describe("Round-51 · (a) 'Yaar LDH' jaise phrase bhi samajh aayein", () => {
  it("phrase ke andar ka station word resolve hota hai (yaar/bhai/kal wale case)", () => {
    expect(matchStation("Yaar Ldh")?.code).toBe("LDH");
    expect(matchStation("bhai ldh")?.code).toBe("LDH");
    expect(matchStation("kal ldh")?.code).toBe("LDH");
    expect(matchStation("Yaar Ldh Se")?.code).toBe("LDH");
    expect(matchStation("smvd katra")?.code).toBe("SVDK");
  });

  it("user ka poora wahi sawaal: from=LDH, to=SVDK — koi 'exact station chahiye' nahi", () => {
    for (const t of [
      "Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na",
      "yaar bhai Ldh se svdk",
      "yaar mujhe ldh se katra jana hai kal ka seat batao",
    ]) {
      const n = understand(t, {});
      expect(n.from?.code, t).toBe("LDH");
      expect(n.to?.code, t).toBe("SVDK");
      expect(n.unresolvedFrom, t).toBeUndefined();
      expect(n.unresolvedTo, t).toBeUndefined();
    }
  });

  it("control: cluster-city (delhi) aur bekaar shabd waisa hi clarification maangte hain", () => {
    expect(matchStation("delhi")).toBeUndefined();
    expect(matchStation("mumbai")).toBeUndefined();
    expect(matchStation("blorp xqz")).toBeUndefined();
    /* poora route phaans na jaaye: do station word ho to yahan se kuch nahi */
    const n = understand("ldh se svdk", {});
    expect(n.to?.code).toBe("SVDK");
  });
});

describe("Round-51 · (b) confirm/available maangne par bhi train ki saari classes", () => {
  it("seat wali line me usi train ki WL/N-A classes bhi — sirf-WL train nahi", () => {
    const line = seatSummaryLine(
      {
        seat: [row("12265", "JAT DURONTO EXP", "3A", "AVAILABLE", { seats: 10 }), row("12265", "JAT DURONTO EXP", "2A", "AVAILABLE", { seats: 5 })],
        wl: [
          row("12265", "JAT DURONTO EXP", "1A", "WAITLIST", { waitlist: 1 }),
          row("12265", "JAT DURONTO EXP", "2S", "WAITLIST", { waitlist: 1 }),
          row("14617", "JANSEWA EXP", "SL", "WAITLIST", { waitlist: 14 }),
        ],
        missingClass: 0,
        unknownTime: 0,
      },
      { classCodes: [], classGroup: null, onlyAvailable: true, sortBy: null, departAfterMinute: null },
      { from: "LDH", to: "JAT" },
    );
    expect(line).toContain("seat wali 1 train");
    expect(line).toContain("12265 3A AVL 10 · 2A AVL 5 · 1A WL 1 · 2S WL 1");
    expect(line).not.toContain("14617"); /* WL-only train thopna nahi (R25 ka usool) */
  });

  it("FIND_SEATS (AI path): OTHER CLASSES line milti hai, rows phir bhi seat-only", async () => {
    routeBoard.mockResolvedValue({
      trains: [
        {
          trainNumber: "12265",
          trainName: "JAT DURONTO EXP",
          classes: [
            { code: "3A", status: "AVAILABLE", seats: 10, fare: 860 },
            { code: "2A", status: "AVAILABLE", seats: 5, fare: 870 },
            { code: "2S", status: "WAITLIST", waitlist: 1, fare: 225 },
          ],
        },
      ],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    const res = await runFindSeatsTool({ from: "LDH", to: "JAT", date: "2026-09-30", class_code: "ALL", only_available: true });
    expect(res.summary).toContain("OTHER CLASSES");
    expect(res.summary).toContain("2S");
    expect(res.summary).toMatch(/2S · WL 1/);
    const data = res.data as { rows: { number: string; classCode: string }[] };
    expect(data.rows.map((r) => r.classCode)).toEqual(["3A", "2A"]); /* jawab ka pool wahi seat rows */
  });
});

beforeEach(() => {
  routeBoard.mockReset();
  classBoard.mockReset();
});
afterEach(() => {
  routeBoard.mockReset();
  classBoard.mockReset();
});
