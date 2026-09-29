/* ══ ROUND-53 (29 Sep 2026) — text/cards ek hi data, saari trains, aur naya provider sirf env se ══════
 * User (screenshot, build 5877a20):
 *   1) *"Green portion wali trains card mein nahi dikh rhi"* — jawab ke text me 17 trains thi, cards me
 *      kuch aur (kam). Wajah: text model ke FIND_SEATS data se banta tha, par CARDS ke liye app dobara
 *      board fetch karta tha (do alag snapshots + 12-train cap).
 *   2) *"Agar confirm bola to confirm dikhao na sirf"* — confirm par bhi cards me WL trains aa rahi thin.
 *   3) *"kon sa model best work karega … uski key main baad mein dunga"* — naya provider lagane ke liye
 *      code chhedna na pade: AI_LLM_BASE_URL / AI_LLM_API_KEY / AI_LLM_MODELS.
 *
 * Is file me teen cheezein test hoti hain (general, per-question rule nahi):
 *  (a) FIND_SEATS ka data CAPTURE hota hai aur cards usi se bante hain (text = cards = payload).
 *  (b) payload me SAARI trains (12 ka cap sirf TEXT line par, aur wahan saaf likha hota hai ki baaki
 *      trains neeche cards me hain).
 *  (c) AI_LLM_* override se base URL/key/model + poora chain badal jaata hai (NVIDIA default chhoota hai).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

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
  return {
    ...actual,
    filterTrainsServingSegment: async (trains: { trainNumber: string }[]) => ({ trains, dropped: [] }),
    routeDropNote: () => null,
    nearbyCandidatesNote: () => null,
  };
});

import { SEAT_LINE_MAX, SEAT_PAYLOAD_MAX_TRAINS, pickSeatRows, seatFilterFor, seatSummaryLine } from "../server/agent/seatFilter";
import { parseSeatIntent } from "../server/understand/seatIntent";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";

const boardWith = (n: number) => ({
  trains: Array.from({ length: n }, (_, i) => ({
    trainNumber: String(12000 + i),
    trainName: `TRAIN ${12000 + i}`,
    classes: [
      { classCode: "3A", status: i % 4 === 3 ? "WAITLIST" : "AVAILABLE", seats: i % 4 === 3 ? null : 5 + i, waitlist: i % 4 === 3 ? 3 : null, fare: 700 + i },
      { classCode: "2A", status: "WAITLIST", seats: null, waitlist: 9, fare: 900 + i },
    ],
  })),
  provider: "web_confirmtkt",
  at: Date.now(),
});

beforeEach(() => {
  routeBoard.mockReset();
  classBoard.mockReset();
  stationSearch.mockReset();
});

afterEach(() => {
  setAgenticNvidiaFetch(null);
});

describe("Round-53 · (a) text aur cards EK hi data se", () => {
  it("16 trains wala board: payload me SAARI trains (12 ka cap nahi), line par honest pointer", async () => {
    routeBoard.mockResolvedValue(boardWith(16));
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    const slots = parseSeatIntent("LDH se JAT kal confirm seat batao");
    const res = await seatFilterFor({ from: "LDH", to: "JAT", date: "2026-09-30", slots });
    expect(res).not.toBeNull();
    const trains = new Set(res!.rows.map((r) => r.number));
    /* 16 trains me se 12 AVAILABLE hain (i%4===3 wale WL) — payload me sab 12 aane chahiye, cap 12 se
     * kam nahi hone chahiye (pehle SEAT_LINE_MAX=12 trains ka cap payload par lagta tha). */
    expect(trains.size).toBe(12);
    expect(res!.rows.length).toBeGreaterThanOrEqual(trains.size);
    /* payload cap ab bada hai — 12 se zyada trains bhi aayengi. */
    expect(SEAT_PAYLOAD_MAX_TRAINS).toBeGreaterThan(SEAT_LINE_MAX);
  });

  it("FIND_SEATS → capture.seat me poora live data (cards isi se bante hain)", async () => {
    const { runAgenticTurn } = await import("../server/agent/agentic");
    process.env.NVIDIA_API_KEY = "nvapi-r53_test";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    routeBoard.mockResolvedValue(boardWith(16));
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        return body({
          model: "openai/gpt-oss-20b",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "FIND_SEATS", arguments: JSON.stringify({ from: "LDH", to: "JAT", date: "2026-09-30", class_code: "ALL", only_available: true }) } },
                ],
              },
            },
          ],
        });
      }
      return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "12000 3A AVL 5 ₹700 — LDH → JAT. [NEXT] book => 12000 book krdo" } }] });
    });
    const capture = { table: null } as never as { seat?: { rows: unknown[]; trainsSeen: number } };
    const turn = await runAgenticTurn({ text: "LDH se JAT kal confirm seat batao", history: [], capture, known: {} } as never);
    expect(turn.ok).toBe(true);
    const seat = (capture as { seat?: { rows: { number: string }[]; trainsSeen: number; onlyAvailable: boolean } }).seat;
    expect(seat).toBeTruthy();
    /* Capture me SAARI seat-wali trains (12) — model ko jo data mila, wahi cards ko bhi jaata hai. */
    expect(new Set(seat!.rows.map((r) => r.number)).size).toBe(12);
    expect(seat!.onlyAvailable).toBe(true);
    process.env.NVIDIA_API_KEY = "";
  });

  it("app level: 'confirm' par cards me sirf seat-wali trains + usi train ki baaki classes", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-r53_app";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    delete process.env.AI_OWNS_FLOW;
    routeBoard.mockResolvedValue({
      trains: [
        {
          trainNumber: "12265",
          trainName: "JAT DURONTO EXP",
          classes: [
            { classCode: "3A", status: "AVAILABLE", seats: 10, fare: 860 },
            { classCode: "2S", status: "WAITLIST", seats: null, waitlist: 2, fare: 225 },
          ],
        },
        { trainNumber: "13151", trainName: "KOAA JAT EXPRES", classes: [{ classCode: "SL", status: "WAITLIST", seats: null, waitlist: 5, fare: 355 }] },
      ],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        return body({
          model: "openai/gpt-oss-20b",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "FIND_SEATS", arguments: JSON.stringify({ from: "LDH", to: "JAT", date: "2026-09-30", class_code: "ALL", only_available: true }) } },
                ],
              },
            },
          ],
        });
      }
      return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "12265 JAT DURONTO EXP 3A AVL 10 ₹860 (2S WL 2 ₹225). [NEXT] 3A book => 12265 mein 3A book krdo" } }] });
    });
    const { createApp } = await import("../server/app");
    const res = await request(createApp()).post("/api/agent").send({ text: "LDH se JAT kal confirm seat batao", history: [], known: {} });
    expect(res.status).toBe(200);
    const sf = res.body.seatFilter as { rows: { number: string; classCode: string }[]; wlRows: { number: string }[] } | null;
    expect(sf).not.toBeNull();
    expect(sf!.rows.map((r) => `${r.number}:${r.classCode}`)).toContain("12265:3A");
    /* WL rows sirf usi train ki jo seat-wali list me hai (13151 sirf-WL hai → cards me nahi). */
    expect([...new Set(sf!.wlRows.map((r) => r.number))]).toEqual(["12265"]);
    setAgenticNvidiaFetch(null);
    process.env.NVIDIA_API_KEY = "";
  });

  it("Round-53c: 'saari trains' wale jawab me 12 trains likhi hon to cards me bhi wahi 12 (ulta mismatch nahi)", async () => {
    /* Prod probe (50b23b6): "LDH se JAT kal saari trains ki seat availability batao" par model ne 12
     * trains likhi (WL wali bhi) par cards me sirf 4 (seat-wali) reh gayi thin. Ab cards = jawab me likhi
     * trains ∩ payload — isliye 12 hi rehti hain. */
    process.env.NVIDIA_API_KEY = "nvapi-r53c";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    routeBoard.mockResolvedValue({
      trains: [
        { trainNumber: "12265", trainName: "JAT DURONTO EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 10, fare: 860 }, { classCode: "SL", status: "WAITLIST", seats: null, waitlist: 3, fare: 355 }] },
        { trainNumber: "12445", trainName: "UTTAR S KRANTI", classes: [{ classCode: "2A", status: "AVAILABLE", seats: 4, fare: 770 }, { classCode: "3A", status: "WAITLIST", seats: null, waitlist: 9, fare: 565 }] },
        { trainNumber: "13151", trainName: "KOAA JAT EXPRES", classes: [{ classCode: "SL", status: "WAITLIST", seats: null, waitlist: 7, fare: 195 }] },
        { trainNumber: "12425", trainName: "JAMMU RAJDHANI", classes: [{ classCode: "1A", status: "WAITLIST", seats: null, waitlist: 1, fare: 1435 }] },
      ],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        return body({
          model: "openai/gpt-oss-20b",
          choices: [{ message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "FIND_SEATS", arguments: JSON.stringify({ from: "LDH", to: "JAT", date: "2026-09-30", class_code: "ALL" }) } }] } }],
        });
      }
      /* Model ne SAARI trains likhi (seat-wali + WL) — jaise prod probe me. */
      return body({
        model: "openai/gpt-oss-20b",
        choices: [{ message: { role: "assistant", content: "12265 JAT DURONTO EXP – 3A AVL 10 ₹860 · SL WL 3 ₹355 12445 UTTAR S KRANTI – 2A AVL 4 ₹770 · 3A WL 9 ₹565 13151 KOAA JAT EXPRES – SL WL 7 ₹195 12425 JAMMU RAJDHANI – 1A WL 1 ₹1435" } }],
      });
    });
    const { createApp } = await import("../server/app");
    const res = await request(createApp()).post("/api/agent").send({ text: "LDH se JAT kal saari trains ki seat availability batao", history: [], known: {} });
    const sf = res.body.seatFilter as { rows: { number: string }[]; wlRows: { number: string }[] } | null;
    expect(sf).not.toBeNull();
    const cardTrains = [...new Set([...sf!.rows, ...sf!.wlRows].map((r) => r.number))].sort();
    expect(cardTrains).toEqual(["12265", "12425", "12445", "13151"]);
    setAgenticNvidiaFetch(null);
    process.env.NVIDIA_API_KEY = "";
  });

  it("Round-53b: tool me only_available na ho, par user ne confirm maanga ho → cards phir bhi sirf seat-wali trains", async () => {
    /* Prod probe (0bd2aee) me model ne FIND_SEATS `only_available` ke bina call kiya (jawab me sirf
     * confirmed 4 trains likhe) — par cards me poore board ke 12 trains aa gaye (wlRows 52). Fix:
     * capture branch me user ki wording ka seat-intent bhi dekha jaata hai. */
    process.env.NVIDIA_API_KEY = "nvapi-r53b";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    routeBoard.mockResolvedValue({
      trains: [
        {
          trainNumber: "12265",
          trainName: "JAT DURONTO EXP",
          classes: [
            { classCode: "3A", status: "AVAILABLE", seats: 10, fare: 860 },
            { classCode: "2S", status: "WAITLIST", seats: null, waitlist: 2, fare: 225 },
          ],
        },
        { trainNumber: "13151", trainName: "KOAA JAT EXPRES", classes: [{ classCode: "SL", status: "WAITLIST", seats: null, waitlist: 5, fare: 355 }] },
        { trainNumber: "14661", trainName: "SHALIMAR MALANI", classes: [{ classCode: "3A", status: "WAITLIST", seats: null, waitlist: 11, fare: 565 }] },
      ],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        return body({
          model: "openai/gpt-oss-20b",
          choices: [
            {
              message: {
                role: "assistant",
                /* joom: only_available BHEJA HI NAHI (prod jaisa) */
                tool_calls: [{ id: "c1", type: "function", function: { name: "FIND_SEATS", arguments: JSON.stringify({ from: "LDH", to: "JAT", date: "2026-09-30", class_code: "ALL" }) } }],
              },
            },
          ],
        });
      }
      return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "12265 JAT DURONTO EXP 3A AVL 10 ₹860 (2S WL 2 ₹225). [NEXT] 3A book => 12265 mein 3A book krdo" } }] });
    });
    const { createApp } = await import("../server/app");
    const res = await request(createApp()).post("/api/agent").send({ text: "LDH se JAT kal confirm seat batao", history: [], known: {} });
    const sf = res.body.seatFilter as { rows: { number: string }[]; wlRows: { number: string }[] } | null;
    expect(sf).not.toBeNull();
    const cardTrains = [...new Set([...sf!.rows, ...sf!.wlRows].map((r) => r.number))].sort();
    /* Sirf 12265 (jisme seat hai) — 13151/14661 (sirf WL) cards me nahi. */
    expect(cardTrains).toEqual(["12265"]);
    setAgenticNvidiaFetch(null);
    process.env.NVIDIA_API_KEY = "";
  });
});

describe("Round-53 · (b) line par honest pointer, payload par bada cap", () => {
  it("12 se zyada trains ho to line '+N trains neeche cards me' kehti hai (jhootha 'aur bhi hain' nahi)", () => {
    const trains = Array.from({ length: 16 }, (_, i) => ({
      trainNumber: String(12000 + i),
      trainName: `TRAIN ${12000 + i}`,
      classes: [{ classCode: "3A", status: "AVAILABLE" as const, seats: 5, fare: 700 }],
    }));
    const pick = pickSeatRows(trains, { classCodes: [], onlyAvailable: true, departAfterMinute: null, sortBy: null });
    const line = seatSummaryLine({ ...pick, wl: [] }, { classCodes: [], onlyAvailable: true, departAfterMinute: null, sortBy: null, windowLabel: null, classGroup: null } as never, { from: "LDH", to: "JAT" });
    expect(line).toContain(`${16} trains`);
    /* Honest tail: kam rows ka zikr + neeche poori live list ka pointer (R25 ka rule bhi barqarar —
     * "card" shabd use nahi karte, warna purana round-25 test tootta hai). */
    expect(line).toContain("4 trains aur bhi hain — neeche poori live list me");
    expect(line).not.toMatch(/card/i);
    expect(line).not.toMatch(/\bAur bhi trains/);
  });
});

describe("Round-53 · (c) naya provider sirf ENV se (AI_LLM_*)", () => {
  it("AI_LLM_* set karte hi base/key/model/chain badal jaate hain; warna NVIDIA default", async () => {
    const { env } = await import("../server/env");
    const before = { base: env.nvidiaBaseUrl, model: env.nvidiaModel, fb: env.nvidiaFallbackModel };
    process.env.NVIDIA_API_KEY = "nvapi-default";
    process.env.AI_LLM_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.AI_LLM_API_KEY = "gsk_test_key";
    process.env.AI_LLM_MODELS = "llama-3.3-70b-versatile,qwen/qwen3-32b";
    try {
      expect(env.aiLlmOverrideActive).toBe(true);
      expect(env.nvidiaBaseUrl).toBe("https://api.groq.com/openai/v1");
      expect(env.nvidiaApiKey).toBe("gsk_test_key");
      expect(env.nvidiaModel).toBe("llama-3.3-70b-versatile");
      expect(env.nvidiaFallbackModel).toBe("qwen/qwen3-32b");
      const { agenticConfigured } = await import("../server/agent/agentic");
      expect(agenticConfigured()).toBe(true);
    } finally {
      delete process.env.AI_LLM_BASE_URL;
      delete process.env.AI_LLM_API_KEY;
      delete process.env.AI_LLM_MODELS;
      process.env.NVIDIA_API_KEY = "";
    }
    expect(env.aiLlmOverrideActive).toBe(false);
    expect(env.nvidiaBaseUrl).toBe(before.base);
    expect(env.nvidiaModel).toBe(before.model);
    expect(env.nvidiaFallbackModel).toBe(before.fb);
  });

  it("aadha config (key ke bina) override nahi banata — purana path chalta rehta hai", async () => {
    const { env } = await import("../server/env");
    process.env.AI_LLM_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.AI_LLM_MODELS = "llama-3.3-70b-versatile";
    try {
      expect(env.aiLlmOverrideActive).toBe(false);
      expect(env.nvidiaBaseUrl).not.toBe("https://api.groq.com/openai/v1");
    } finally {
      delete process.env.AI_LLM_BASE_URL;
      delete process.env.AI_LLM_MODELS;
    }
  });
});

describe("Round-53d · model sirf tool ke data wali trains likhe (fake train nahi)", () => {
  it("available-only par tool ke data me WL-only trains ki rows hi nahi jaati", async () => {
    const { runFindSeatsTool } = await import("../server/agent/seatFinderTool");
    routeBoard.mockResolvedValue({
      trains: [
        { trainNumber: "11449", trainName: "JBP SVDK EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 6, fare: 625 }] },
        { trainNumber: "12919", trainName: "MALWA EXP", classes: [{ classCode: "SL", status: "WAITLIST", seats: null, waitlist: 18, fare: 270 }] },
      ],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    const res = (await runFindSeatsTool({ from: "LDH", to: "SVDK", date: "2026-09-30", class_code: "ALL", only_available: true })) as {
      ok: boolean;
      summary: string;
      data: { rows: { number: string }[]; wlRows: { number: string }[] };
    };
    expect(res.ok).toBe(true);
    expect([...new Set(res.data.rows.map((r) => r.number))]).toEqual(["11449"]);
    /* WL-only train ka data model ko nahi jaata (warna wo jawab me likh deta hai). */
    expect([...new Set(res.data.wlRows.map((r) => r.number))]).toEqual([]);
    expect(res.summary).toContain("SIRF inhi 1 trains");
    expect(res.summary).toMatch(/baaki 1 trains me sirf WL\/N-A/);
  });

  it("segment-level scrub: ek line me juda fake train hatta hai, asli jawab bacha rehta hai", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-r53e";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    routeBoard.mockResolvedValue({
      trains: [
        { trainNumber: "11449", trainName: "JBP SVDK EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 6, fare: 625 }] },
        { trainNumber: "12919", trainName: "MALWA EXP", classes: [{ classCode: "SL", status: "WAITLIST", seats: null, waitlist: 18, fare: 270 }] },
      ],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "FIND_SEATS", arguments: JSON.stringify({ from: "LDH", to: "SVDK", date: "2026-09-30", class_code: "ALL" }) } }] } }] });
      }
      /* Line me " · " se juda fabricated train (14661) — sirf wahi segment hatna chahiye. */
      return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "11449 JBP SVDK EXP – 3A AVL 6 ₹625 · 14661 SHALIMAR MALANI – 3A WL 4 ₹625" } }] });
    });
    const { createApp } = await import("../server/app");
    const res = await request(createApp()).post("/api/agent").send({ text: "LDH se SVDK kal saari trains batao", history: [], known: {} });
    const reply = String(res.body.reply ?? "");
    expect(reply).toContain("11449");
    expect(reply).not.toContain("14661");
    /* Non-confirm sawaal → cards me tool ka POORA snapshot (12919 bhi, chahe model ne uski line chhodi).
     * Isse pointer/tail line ("N trains ke rows neeche cards me hain") sach rehti hai. */
    const sf = res.body.seatFilter as { rows: { number: string }[]; wlRows: { number: string }[] } | null;
    expect([...new Set([...sf!.rows, ...sf!.wlRows].map((r) => r.number))].sort()).toEqual(["11449", "12919"]);
    setAgenticNvidiaFetch(null);
    process.env.NVIDIA_API_KEY = "";
  });

  it("cards me tool ka POORA snapshot rehta hai (pointer line sach bole)", async () => {
    /* Prod probe: model apni memory se trains jod deta tha (payload 3 trains, jawab 7). */
    process.env.NVIDIA_API_KEY = "nvapi-r53d";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    routeBoard.mockResolvedValue({
      trains: [
        { trainNumber: "11449", trainName: "JBP SVDK EXP", classes: [{ classCode: "3A", status: "AVAILABLE", seats: 6, fare: 625 }] },
        { trainNumber: "12919", trainName: "MALWA EXP", classes: [{ classCode: "SL", status: "WAITLIST", seats: null, waitlist: 18, fare: 270 }] },
      ],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        return body({
          model: "openai/gpt-oss-20b",
          choices: [{ message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "FIND_SEATS", arguments: JSON.stringify({ from: "LDH", to: "SVDK", date: "2026-09-30", class_code: "ALL", only_available: true }) } }] } }],
        });
      }
      /* Model ne apni yaad se 14609/22461 bhi jod diye (data me nahi hain) — wo lines nahi dikhni chahiye. */
      return body({
        model: "openai/gpt-oss-20b",
        choices: [{ message: { role: "assistant", content: "11449 JBP SVDK EXP – 3A AVL 6 ₹625\n14609 HEMKUNT EXP – 3A WL 4 ₹625\n22461 SHRI SHAKTI EXP – 1A WL 6 ₹1,530" } }],
      });
    });
    const { createApp } = await import("../server/app");
    const res = await request(createApp()).post("/api/agent").send({ text: "Yaar LDH se SVDK kal confirm seat find out karke do na", history: [], known: {} });
    const reply = String(res.body.reply ?? "");
    expect(reply).toContain("11449");
    expect(reply).not.toContain("14609");
    expect(reply).not.toContain("22461");
    const sf = res.body.seatFilter as { rows: { number: string }[]; wlRows: { number: string }[] } | null;
    expect(sf!.rows.map((r) => r.number)).toContain("11449");
    /* Ye sawaal confirm-only hai → cards me sirf seat-wali train (R53b/R53d niyam). */
    expect([...new Set([...sf!.rows, ...sf!.wlRows].map((r) => r.number))]).toEqual(["11449"]);
    setAgenticNvidiaFetch(null);
    process.env.NVIDIA_API_KEY = "";
  });
});

describe("Round-53e · jab koi confirmed seat hi na ho", () => {
  it("confirm maanga par kisi train me AVL nahi → cards khaali nahi (WL trains dikhti hain), text se match", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-r53f";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    routeBoard.mockResolvedValue({
      trains: [
        { trainNumber: "12919", trainName: "MALWA EXP", classes: [{ classCode: "SL", status: "WAITLIST", seats: null, waitlist: 18, fare: 270 }] },
        { trainNumber: "12475", trainName: "HAPA SVDK EXP", classes: [{ classCode: "3A", status: "WAITLIST", seats: null, waitlist: 5, fare: 675 }] },
      ],
      provider: "web_confirmtkt",
      at: Date.now(),
    });
    classBoard.mockResolvedValue({ classes: [], provider: "none" });
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "FIND_SEATS", arguments: JSON.stringify({ from: "LDH", to: "SVDK", date: "2026-09-30", class_code: "ALL", only_available: true }) } }] } }] });
      }
      return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "is waqt koi confirmed seat nahi hai. 12919 MALWA EXP – SL WL 18 ₹270 | 12475 HAPA SVDK EXP – 3A WL 5 ₹675" } }] });
    });
    const { createApp } = await import("../server/app");
    const res = await request(createApp()).post("/api/agent").send({ text: "Yaar LDH se SVDK kal confirm seat find out karke do na", history: [], known: {} });
    const sf = res.body.seatFilter as { rows: { number: string }[]; wlRows: { number: string }[] } | null;
    expect(sf).not.toBeNull();
    const cardTrains = [...new Set([...sf!.rows, ...sf!.wlRows].map((r) => r.number))].sort();
    expect(cardTrains).toEqual(["12475", "12919"]);
    expect(String(res.body.reply ?? "")).toContain("koi confirmed seat nahi");
    setAgenticNvidiaFetch(null);
    process.env.NVIDIA_API_KEY = "";
  });
});
