/* ══ ROUND-52 (29 Sep 2026) — "har query AI ke paas jaaye; model khud samjhe (jaise ChatGPT)" ══
 * User: *"purane builds me model isse apne aap samajh jaata tha, to abh bhi purane build jaisa hi rakho ki
 * model apne aap samjhe sab — AI first for everything … Bss AI pe hi har query jaaye and wo decide kare
 * kon sa tool kon sa API, jaise chatgpt mein hota hai"*.
 *
 * Is round ke teen hisse (sab general, per-question rule nahi):
 *  (a) MODEL HEALTH: prod me primary model (Muse) bade agentic prompt par 30s+ le raha tha → turn
 *      timeout → jawab deterministic rescue se aata tha, user ko lagta tha "AI samajh hi nahi raha".
 *      Ab jo model haal hi me fail hua ho wo chain ke AAKHIR me chalta hai (healthy model pehle) —
 *      config ka order default rehta hai, sirf kharab model peeche jaata hai.
 *  (b) HAR QUERY MODEL KE PAAS: capability/meta sawaal ("tum kya kar sakte ho") bhi ab model ka hai
 *      (system prompt rule 28 me wahi honest sach) — fixed jawab sirf AI-off/model-fail par.
 *  (c) TOOL-LEVEL STATION SAMAJH: user/model ka station arg ("Yaar Ldh", "bhai ldh", "kal katra")
 *      tools me resolve hota hai (pehle khaali lookup → "station resolve nahi hua" → user ko lagta
 *      tha AI wording samajh nahi raha). Kuch invent nahi — na mile to null.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request_1 from "supertest";
import { _clearModelHealth, noteModelOutcome, orderModelChain } from "../server/agent/agentic";
import { matchStation } from "../server/understand/legacy-stations";

const routeBoard = vi.fn();
const classBoard = vi.fn();
const stationSearch = vi.fn();
vi.mock("../server/railway/router.js", () => ({
  routedRouteBoard: (...a: unknown[]) => routeBoard(...a),
  routedClassBoard: (...a: unknown[]) => classBoard(...a),
  routedStationSearch: (...a: unknown[]) => stationSearch(...a),
  enrichTrainsFreshness: async () => 0,
}));
vi.mock("../server/providers/index.js", () => ({
  getProvider: () => ({ searchTrains: async () => [], name: "mock" }),
}));
vi.mock("../server/agent/routeSegment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/agent/routeSegment.js")>();
  return { ...actual, filterTrainsServingSegment: async (trains: { trainNumber: string }[]) => ({ trains, dropped: [] }) };
});

import { resolveStationArg } from "../server/agent/stationArg";
import { runFindSeatsTool } from "../server/agent/seatFinderTool";
import { isBookingMutation } from "../server/agent/run";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";

beforeEach(() => {
  _clearModelHealth();
  routeBoard.mockReset();
  classBoard.mockReset();
  stationSearch.mockReset();
});

describe("Round-52 · (a) model health — kharab model peeche, healthy aage", () => {
  it("recent fail wala model chain ke aakhir me chala jaata hai (config order default)", () => {
    expect(orderModelChain(["muse", "gpt-oss", "glm"])).toEqual(["muse", "gpt-oss", "glm"]);
    noteModelOutcome("muse", false);
    expect(orderModelChain(["muse", "gpt-oss", "glm"])).toEqual(["gpt-oss", "glm", "muse"]);
    /* jawab dene ke baad model wapas apni jagah (chain order preserve) */
    noteModelOutcome("muse", true);
    expect(orderModelChain(["muse", "gpt-oss", "glm"])).toEqual(["muse", "gpt-oss", "glm"]);
    /* do kharab model — dono peeche, par aapas ka order wahi */
    noteModelOutcome("gpt-oss", false);
    expect(orderModelChain(["muse", "gpt-oss", "glm"])).toEqual(["muse", "glm", "gpt-oss"]);
  });

  it("naya/healthy model par koi asar nahi (chain waisi hi)", () => {
    expect(orderModelChain(["a", "b"])).toEqual(["a", "b"]);
    noteModelOutcome("a", true);
    expect(orderModelChain(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("Round-52 · (c) tools user ki wording samajhte hain", () => {
  it("filler/filler+code wale station arg resolve hote hain (local knowledge se)", async () => {
    expect((await resolveStationArg("Yaar Ldh"))?.code).toBe("LDH");
    expect((await resolveStationArg("bhai ldh"))?.code).toBe("LDH");
    expect((await resolveStationArg("kal katra"))?.code).toBe("SVDK");
    expect((await resolveStationArg("smvd katra"))?.code).toBe("SVDK");
    expect((await resolveStationArg("Ldh"))?.code).toBe("LDH");
    expect(stationSearch).not.toHaveBeenCalled(); /* local se hi ho gaya */
  });

  it("jo mila hi nahi wo invent nahi hota (null), aur ambigous city provider ke paas jaati hai", async () => {
    stationSearch.mockResolvedValue({ stations: [], needChoice: false });
    expect(await resolveStationArg("blorp xqz")).toBe(null);
    stationSearch.mockResolvedValue({ stations: [{ code: "NDLS", name: "New Delhi" }], needChoice: true, city: "Delhi" });
    expect((await resolveStationArg("delhi"))?.code).toBe("NDLS");
    expect(matchStation("delhi")).toBeUndefined(); /* local matcher cluster-city par chup rehta hai (choice-flow) */
  });

  it("FIND_SEATS tool filler-wale station arg par bhi chalta hai (route board khulti hai)", async () => {
    routeBoard.mockResolvedValue({
      trains: [{ trainNumber: "20433", trainName: "JAMMU MAIL", classes: [{ code: "1A", status: "AVAILABLE", seats: 1, fare: 1530 }] }],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    const res = await runFindSeatsTool({ from: "Yaar Ldh", to: "svdk", date: "2026-09-30", class_code: "ALL", only_available: true });
    expect(routeBoard).toHaveBeenCalled();
    expect(routeBoard.mock.calls[0][0]).toBe("LDH");
    expect(routeBoard.mock.calls[0][1]).toBe("SVDK");
    expect(res.ok).toBe(true);
    const data = res.data as { rows: { number: string }[] };
    expect(data.rows.map((r) => r.number)).toEqual(["20433"]);
  });
});

describe("Round-52 · (d) booking-hukm detector — SEAT sawaal ko booking hukm mat samjho", () => {
  const mk = (text: string) => isBookingMutation({ text } as never);
  it("asli booking hukm hi mutation hai", () => {
    for (const t of [
      "12919 book kar do",
      "20433 ticket book kar",
      "is train ki booking karo",
      "haan confirm karo",
      "confirm kar do",
      "confirm & book",
      "payment kar do",
      "paise de do",
      "haan book",
    ]) {
      expect(mk(t), t).toBe(true);
    }
  });

  it("'confirm seat/availability' jaisa SEAT sawaal mutation NAHI hai (R52 root cause)", () => {
    for (const t of [
      "Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na",
      "20433 me 2S confirm hai kya",
      "kal ki confirmed seat wali trains batao",
      "3A me confirm seat milegi?",
      "seat availability confirm karo LDH se JAT",
      "is train me kitni seat confirmed hai",
    ]) {
      expect(mk(t), t).toBe(false);
    }
  });

  it("'confirm seat' sawaal par AI-first flow chalta hai (engine agentic, model ke tools)", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-r52_test_key";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    delete process.env.AI_OWNS_FLOW;
    routeBoard.mockResolvedValue({
      trains: [{ trainNumber: "20433", trainName: "JAMMU MAIL", classes: [{ code: "1A", status: "AVAILABLE", seats: 1, fare: 1530 }] }],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const body = (b: Record<string, unknown>) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        return body({
          model: "openai/gpt-oss-20b",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "FIND_SEATS", arguments: JSON.stringify({ from: "LDH", to: "SVDK", date: "2026-09-30", class_code: "ALL" }) } },
                ],
              },
            },
          ],
        });
      }
      return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "LDH→SVDK: 20433 JAMMU MAIL 1A AVL 1 ₹1,530. [NEXT] 1A book => 20433 mein 1A book krdo" } }] });
    });
    const app = (await import("../server/app")).createApp();
    const res = await request_1(app)
      .post("/api/agent")
      .send({ text: "Yaar LDH se SVDK ke liye kal ke liye confirm seat find out karke do na", history: [], known: {} });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("agentic_tool_calling");
    expect((res.body.toolTrace ?? []).map((t: { tool: string }) => t.tool)).toContain("FIND_SEATS");
    setAgenticNvidiaFetch(null);
    process.env.NVIDIA_API_KEY = "";
  });
});
