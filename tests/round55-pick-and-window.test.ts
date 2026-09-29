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
const schedule = vi.fn();
vi.mock("../server/railway/router.js", () => ({
  routedRouteBoard: (...a: unknown[]) => routeBoard(...a),
  routedClassBoard: (...a: unknown[]) => classBoard(...a),
  routedSchedule: (...a: unknown[]) => schedule(...a),
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

import { executeApprovedTool, setAgenticNvidiaFetch } from "../server/agent/agentic";
import { runAgent } from "../server/agent/run";
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
  schedule.mockReset().mockResolvedValue({
    schedule: { trainName: "MOCK EXP", stops: [{ code: "ASR" }, { code: "LDH" }] },
    provider: "mock",
  });
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
  schedule.mockReset();
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

describe("Round-55 · (c) schema pick ke liye kaafi chauda ho", () => {
  it("12-candidate comma string (71 chars) schema-fail nahi hota (pehle max 60 tha)", async () => {
    const twelve = ["15708", "18104", "14624", "18238", "13006", "14632", "12926", "12904", "20808", "14542", "18102", "12716"];
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { from: "ASR", to: "LDH", date: "2026-09-30", class_code: "3A", train_numbers: twelve.join(",") },
      { userText: "esmein se best train batao", pickCandidates: twelve },
    );
    expect(res.ok).toBe(true);
    expect(res.summary).not.toMatch(/Invalid arguments/);
    expect(rowNums(res)).toContain("12716");
  });
});

describe("Round-55 · (d) sirf train number diya (station nahi) → poora route khud", () => {
  it("time-table se origin→destination liya jaata hai (station poochne ke bajaye)", async () => {
    schedule.mockResolvedValue({
      schedule: { trainName: "ASR JAT EXP", stops: [{ code: "LDH" }, { code: "ASR" }, { code: "JAT" }] },
      provider: "web_confirmtkt",
    });
    routeBoard.mockResolvedValue({
      trains: [{ trainNumber: "12094", trainName: "ASR JAT EXP", classes: [{ code: "3A", status: "AVAILABLE", seats: 5, fare: 700 }] }],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { date: "2026-09-30", class_code: "3A", train_numbers: "12094" },
      { userText: "12094 me 3A me kitni seat khali hai kal" },
    );
    expect(res.ok).toBe(true);
    const d = res.data as { from?: string; to?: string; rows?: { number: string }[] };
    expect(d.from).toBe("LDH");
    expect(d.to).toBe("JAT");
    expect(res.summary).toMatch(/POORA route timetable se liya gaya/);
    expect(rowNums(res)).toContain("12094");
  });

  it("model train_numbers na bheje (sirf user ke text me number) → sawaal se number utha kar route nikalti hai", async () => {
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { from: "", to: "", date: "2026-09-30", class_code: "3A" },
      { userText: "12094 me 3A me kitni seat khali hai kal" },
    );
    expect(res.ok).toBe(true);
    expect(res.summary).not.toMatch(/Station resolve nahi hua/);
    expect((res.data as { trainNumbers?: string[] }).trainNumbers).toEqual(["12094"]);
  });

  it("sort_by ka ulta-seedha shabd poora call fail nahi karta (ignored ho jaata hai)", async () => {
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { from: "ASR", to: "LDH", date: "2026-09-30", class_code: "3A", sort_by: "availability" },
      { userText: "ASR se LDH 3A me seat batao" },
    );
    expect(res.ok).toBe(true);
    expect(res.summary).not.toMatch(/Invalid enum value/);
  });

  it("model khaali string bheje ('' / '  ') to bhi wahi hota hai — schema reject nahi karta", async () => {
    for (const empty of ["", "  "]) {
      const res = await executeApprovedTool(
        "FIND_SEATS",
        { from: empty, to: empty, date: "2026-09-30", class_code: "3A", train_numbers: "12094" },
        { userText: "12094 me 3A me kitni seat khali hai kal" },
      );
      expect(res.ok, `from/to='${empty}'`).toBe(true);
      expect(res.summary).not.toMatch(/Invalid arguments/);
      expect((res.data as { from?: string }).from).toBe("ASR"); /* default mock schedule ASR → LDH */
    }
  });
});

describe("Round-55 · (g) model fail/timeout par bhi pick ka chhota jawab (dump nahi)", () => {
  it("model pura fail ho jaye → rescue EK best + runner-up deta hai, poori list nahi", async () => {
    process.env.AI_OWNS_FLOW = "";
    process.env.NVIDIA_API_KEY = "test-key";
    process.env.NVIDIA_BASE_URL = "https://example.invalid/v1";
    process.env.NVIDIA_MODEL = "test-model";
    setAgenticNvidiaFetch(async () => {
      throw new Error("network_down");
    });
    const res = await runAgent({
      text: "esmein se best train batao",
      history: [
        { role: "user", content: "ASR se LDH kal 3A me seat batao" },
        {
          role: "assistant",
          content:
            "15708 ASR KIR EXP – 3A AVAILABLE 12 seats ₹520 | 18104 ASR TATA EXP – 3A AVAILABLE 69 seats ₹520 | 12926 PASCHIM EXPR – 3A AVAILABLE 73 seats ₹565 | 12716 SACHKHAND EXP – 3A N/A ₹565",
        },
      ],
      known: {
        from: { code: "ASR", name: "Amritsar Jn" },
        to: { code: "LDH", name: "Ludhiana Jn" },
        date: "2026-09-30",
      },
      today: "2026-09-29",
    });
    const reply = String(res.reply ?? "");
    const nums = [...new Set(reply.match(/\b\d{5}\b/g) ?? [])];
    expect(reply).toMatch(/Best|best/);
    expect(nums.length).toBeGreaterThan(0);
    expect(nums.length).toBeLessThanOrEqual(4);
    expect(reply).toMatch(/Kyun/);
    setAgenticNvidiaFetch(null);
  });
});

describe("Round-55 · (f) soft-field safety net — ek kharab field poora call na maare", () => {
  it("passengers: 0 → call chalti hai, field gira kar model ko note milta hai", async () => {
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { from: "LDH", to: "JAT", date: "2026-09-30", class_code: "3A", passengers: 0 },
      { userText: "LDH se JAT kal 3A me seat" },
    );
    expect(res.ok).toBe(true);
    expect(res.summary).not.toMatch(/Invalid arguments/);
    expect(res.summary).toMatch(/chhod diya gaya/);
    expect(res.summary).toMatch(/passengers/);
    expect(rowNums(res)).toContain("12716");
  });

  it("control: zaroori field (date) kharab ho to call waise hi fail hoti hai", async () => {
    const res = await executeApprovedTool(
      "FIND_SEATS",
      { from: "LDH", to: "JAT", date: "kal", class_code: "3A" },
      { userText: "LDH se JAT kal 3A me seat" },
    );
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/Invalid arguments/);
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
