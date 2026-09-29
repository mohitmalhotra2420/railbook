/* ══ ROUND-55 (29 Sep 2026) — (a) "in me se best" follow-up samajhna, (b) chupke se lagaye gaye
 * time-window filter band karna (list turn-to-turn badalni nahi chahiye) ══
 *
 * User ke 2 screenshots (29 Sep): pehli baar ASR→LDH 3A list me SACHKHAND 12716 dikhi, agli baar gayab;
 * aur "esmein se best train btao" par AI ne poori list dobara dump kar di (jabki ChatGPT ne ek best
 * chun kar kyun bataya). Root causes: (1) model ne khud se `depart_after: subah` jaisa window lagaya
 * (user ne waqt bola hi nahi) → window ke bahar wali trains chhup gayin; (2) follow-up ("in me se best")
 * ka koi handling nahi tha → naya board + poora dump.
 *
 * Is test me dono kaam ka guard naapa jaata hai:
 *   - seatPick.ts ke pure functions (ask window / drop window / pick followup detect / candidates)
 *   - executeApprovedTool("FIND_SEATS") ka asli behaviour: window drop hone par bahar wali train bhi
 *     aati hai (aur model ko "hataya gaya" note milta hai); window maange jaane par filter lagta hai;
 *     pick follow-up me sirf pichhli list ke candidates check hote hain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const routeBoard = vi.fn();
const classBoard = vi.fn();
const searchTrains = vi.fn();
vi.mock("../server/railway/router.js", () => ({
  routedRouteBoard: (...a: unknown[]) => routeBoard(...a),
  routedClassBoard: (...a: unknown[]) => classBoard(...a),
  routedStationSearch: async () => ({ stations: [], needChoice: false }),
  routedLiveStatus: async () => null,
  enrichTrainsFreshness: async () => 0,
}));
vi.mock("../server/providers/index.js", () => ({
  getProvider: () => ({ searchTrains: (...a: unknown[]) => searchTrains(...a), name: "mock" }),
}));
vi.mock("../server/agent/routeSegment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/agent/routeSegment.js")>();
  return { ...actual, filterTrainsServingSegment: async (trains: { trainNumber: string; trainName?: string }[]) => ({ trains, dropped: [] }) };
});

import { executeApprovedTool } from "../server/agent/agentic";
import { askedTimeWindow, dropUnaskedWindow, isPickFollowup, previousListTrains } from "../server/agent/seatPick";

const HISTORY = [
  { role: "user", content: "ASR se LDH 3A me seat batao" },
  {
    role: "assistant",
    content:
      "**ASR → LDH 3A** | 15708 ASR KIR EXP AVAILABLE 12 | 18104 ASR TATA EXP AVAILABLE 69 | " +
      "12926 PASCHIM EXP AVAILABLE 73 | 14542 ASR CDG EXP N/A | 12716 SACHKHAND EXP N/A",
  },
];

const board = () => ({
  trains: [
    { trainNumber: "12716", trainName: "SACHKHAND EXP", classes: [{ code: "3A", status: "AVAILABLE", seats: 12, fare: 565 }] },
    { trainNumber: "13006", trainName: "ASR HWH MAIL", classes: [{ code: "3A", status: "AVAILABLE", seats: 3, fare: 520 }] },
    { trainNumber: "15708", trainName: "ASR KIR EXP", classes: [{ code: "3A", status: "AVAILABLE", seats: 8, fare: 520 }] },
  ],
  provider: "web_confirmtkt",
  at: Date.now(),
});

const rowNums = (res: { data: unknown }): string[] => {
  const d = res.data as { rows?: { number: string }[] } | null;
  return [...new Set((d?.rows ?? []).map((r) => r.number))];
};

beforeEach(() => {
  routeBoard.mockReset().mockResolvedValue(board());
  classBoard.mockReset().mockResolvedValue({ classes: [], provider: "none" });
  searchTrains.mockReset().mockResolvedValue([
    { number: "12716", departure: "09:30", arrival: "12:10", durationMinutes: 160 },
    { number: "13006", departure: "19:45", arrival: "22:30", durationMinutes: 165 },
    { number: "15708", departure: "07:40", arrival: "10:35", durationMinutes: 175 },
  ]);
});
afterEach(() => {
  routeBoard.mockReset();
  classBoard.mockReset();
  searchTrains.mockReset();
});

describe("Round-55 · (a) 'in me se best' follow-up ka pata chale", () => {
  it("pichhli assistant list se candidates nikalte hain (last message, max 12, unique)", () => {
    expect(previousListTrains(HISTORY)).toEqual(["15708", "18104", "12926", "14542", "12716"]);
    expect(previousListTrains(undefined)).toEqual([]);
    /* history me sirf user ho to koi candidate nahi (purani list hi nahi) */
    expect(previousListTrains([{ role: "user", content: "12716 ka seat" }])).toEqual([]);
  });

  it("'esmein se best train batao' = pick follow-up (≥2 candidates + chunav wale shabd)", () => {
    for (const t of [
      "esmein se best train batao",
      "in me se best kaunsi hai",
      "isme se sabse acchi train konsi hai",
      "among these which one is best",
      "inme se recommend karo",
    ]) {
      expect(isPickFollowup(t, HISTORY), t).toBe(true);
    }
  });

  it("control: normal sawaal pick nahi hain (fabricated chunav nahi hota)", () => {
    expect(isPickFollowup("ASR se LDH 3A me seat batao", HISTORY)).toBe(false);
    expect(isPickFollowup("LDH ka mausam kaisa hai", HISTORY)).toBe(false);
    /* purani list hi na ho to "best" bhi pick nahi (naya board laana hi sahi hai) */
    expect(isPickFollowup("esmein se best train batao", [])).toBe(false);
  });

  it("pick turn me sirf pichhli list ke candidates check hote hain — naya board nahi", async () => {
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { from: "ASR", to: "LDH", date: "2026-09-30", class_code: "3A" },
      { userText: "esmein se best train batao", pickCandidates: ["12716", "15708"] },
    );
    expect(res.ok).toBe(true);
    expect(rowNums(res).sort()).toEqual(["12716", "15708"]);
    expect(rowNums(res)).not.toContain("13006"); /* board me hai par list me nahi thi → dump nahi */
  });
});

describe("Round-55 · (b) chupke se lagaya time-window khud hat jaaye", () => {
  it("waqt ke shabd pata karta hai (aur na hone par safai se 'nahi')", () => {
    for (const t of ["subah 8 baje nikalna hai", "raat ko chalo", "12:30 ke baad ki train", "evening train", "dopahar me"]) {
      expect(askedTimeWindow(t), t).toBe(true);
    }
    for (const t of ["ASR se LDH 3A me seat batao", "kal ki train batao", "sabse sasti train dikhao"]) {
      expect(askedTimeWindow(t), t).toBe(false);
    }
  });

  it("dropUnaskedWindow: model ne chupke lagaya to hat jaata hai, maanga ho to rehta hai", () => {
    const hidden = dropUnaskedWindow("ASR se LDH 3A me seat batao", { depart_after: "subah", depart_before: "12:00", from: "ASR" });
    expect(hidden.dropped).toBe(true);
    expect(hidden.args.depart_after).toBeNull();
    expect(hidden.args.depart_before).toBeNull();
    expect(hidden.args.from).toBe("ASR");

    const asked = dropUnaskedWindow("ASR se LDH kal subah 3A me seat batao", { depart_after: "subah", depart_before: "12:00" });
    expect(asked.dropped).toBe(false);
    expect(asked.args.depart_after).toBe("subah");
  });

  it("user ne waqt nahi bola → 19:45 wali train bhi jawab me aati hai (list se gayab nahi hoti)", async () => {
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { from: "ASR", to: "LDH", date: "2026-09-30", class_code: "3A", depart_after: "04:00", depart_before: "12:00" },
      { userText: "ASR se LDH 3A me seat batao" },
    );
    expect(res.ok).toBe(true);
    const nums = rowNums(res);
    expect(nums).toContain("12716"); /* Sachkhand wapas (user ka asli complaint) */
    expect(nums).toContain("13006"); /* 19:45 departure — window ke bahar, phir bhi dikhe */
    /* model ko sach milta hai taaki wo jawab me jhoothi window na likhe */
    expect(res.summary).toMatch(/hata diya/);
    expect(res.summary).toMatch(/POORE din/);
  });

  it("user ne khud waqt maanga → filter lagta hai (aur koi 'hataya' note nahi)", async () => {
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { from: "ASR", to: "LDH", date: "2026-09-30", class_code: "3A", depart_after: "subah" },
      { userText: "ASR se LDH kal subah 3A me seat batao" },
    );
    expect(res.ok).toBe(true);
    const nums = rowNums(res);
    expect(nums.sort()).toEqual(["12716", "15708"]); /* subah wali (09:30, 07:40) */
    expect(nums).not.toContain("13006"); /* 19:45 raat me — maangi hui subah window ke bahar */
    expect(res.summary).not.toMatch(/hata diya/);
  });
});
