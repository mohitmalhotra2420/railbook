/**
 * Round-19 turn-level regression (user ka sawaal: "test pe pass hota to latest build mein kyu nhi").
 *
 * Pehle seat-line ka faisla (💺 line lagani hai ya nahi) kisi test me cover hi nahi tha — isliye
 * patch "pass" hone ke bawajood live par jawab card ke andar chhup jata tha. Ye file us asli
 * assembly ko test karti hai (server/app.ts runAgentTurn):
 *   1) Journey/plan CARD ke saath bhi seat line UPAR dikhe (round-19 fix #2) — chahe AI ne khud
 *      FIND_SEATS call kiya ho.
 *   2) Card na ho aur AI ne khud seat tool call kiya ho → duplicate line NAHI (round-17 dedupe).
 *   3) AI ne seat tool call nahi kiya → purani safety-net line lagti hai.
 *   4) AI ka jawab fail/none → line akele chalti hai + seatFilterFallback true.
 *   5) "kal subah" ka TIME WINDOW slots me seatFilterFor tak pahunchta hai (round-19 fix #1).
 *
 * Koi network nahi: runAgent aur seatFilterFor dono mock hain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";

const runAgentMock = vi.fn();
const seatFilterForMock = vi.fn();

vi.mock("../server/agent/run.js", () => ({
  runAgent: (...args: unknown[]) => runAgentMock(...args),
}));
vi.mock("../server/agent/seatFilter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/agent/seatFilter.js")>();
  return { ...actual, seatFilterFor: (...args: unknown[]) => seatFilterForMock(...args) };
});

const SEAT_LINE = "💺 2A me seat wali 1 train (Subah (04:00–12:00)) — 14719 2A AVL 84 ₹725 (04:25). (LDH → BEAS · live board)";
const ROW = {
  number: "14719",
  name: "BKN ASR EXP",
  classCode: "2A",
  status: "AVAILABLE",
  seats: 84,
  rac: null,
  waitlist: null,
  fare: 725,
  departure: "04:25",
  durationMinutes: 101,
};
const KNOWN = { from: { code: "LDH" }, to: { code: "BEAS" }, date: "2026-09-25", passengerCount: 1 };

const agentResult = (over: Record<string, unknown> = {}) => ({
  reply: "Kal 25 Sep 2026 LDH → BEAS, 2A: 14719 BKN ASR EXP — AVAILABLE 84 seats · ₹725.",
  nlu: null,
  source: "ai",
  tool: null,
  toolOk: null,
  journey: null,
  alternatives: null,
  toolTrace: [],
  ...over,
});

const seatResult = (over: Record<string, unknown> = {}) => ({
  line: SEAT_LINE,
  rows: [ROW],
  wlRows: [],
  trainsSeen: 10,
  source: "web_railyatri",
  ...over,
});

describe("round-19: 💺 seat line turn assembly (/api/agent)", () => {
  beforeEach(() => {
    runAgentMock.mockReset();
    seatFilterForMock.mockReset();
    seatFilterForMock.mockResolvedValue(seatResult());
  });
  afterEach(() => {
    runAgentMock.mockReset();
    seatFilterForMock.mockReset();
  });

  it("journey card ke saath bhi seat line upar aati hai (AI ne khud FIND_SEATS call kiya ho to bhi)", async () => {
    runAgentMock.mockResolvedValue(
      agentResult({
        reply: "Direct plan: 14719 BKN ASR EXP 04:25→06:06 (2A AVL 84).",
        toolTrace: [{ tool: "FIND_SEATS" }],
        journey: { routeOptions: [{ trainNumber: "14719", departureTime: "04:25" }] },
      }),
    );
    const res = await request(createApp())
      .post("/api/agent")
      .send({ text: "LDH se BEAS kal subah 2A me seat hai kya", known: KNOWN })
      .expect(200);

    expect(res.body.reply).toContain("→06:06");
    expect(res.body.reply).toContain(SEAT_LINE);
    expect(res.body.seatFilter?.line).toBe(SEAT_LINE);
    expect(res.body.seatFilterFallback).toBe(false);
  });

  it("card na ho + AI ne khud seat tool call kiya → duplicate line NAHI, rows phir bhi milti hain", async () => {
    runAgentMock.mockResolvedValue(
      agentResult({
        reply: "💺 2A me seat wali 1 train — 14719 2A AVL 84 ₹725 (04:25).",
        toolTrace: [{ tool: "FIND_SEATS" }],
      }),
    );
    const res = await request(createApp())
      .post("/api/agent")
      .send({ text: "LDH se BEAS kal subah 2A me seat hai kya", known: KNOWN })
      .expect(200);

    expect(res.body.reply).not.toContain("live board)"); /* line dobara nahi lagi */
    expect(res.body.seatFilter?.line).toBeNull();
    expect(res.body.seatFilter?.rows?.length).toBe(1);
  });

  it("AI ne seat tool call nahi kiya → safety-net line lagti hai", async () => {
    runAgentMock.mockResolvedValue(agentResult({ reply: "Kal LDH → BEAS 2A ka board ye hai." }));
    const res = await request(createApp())
      .post("/api/agent")
      .send({ text: "LDH se BEAS kal 2A me seat hai kya", known: KNOWN })
      .expect(200);

    expect(res.body.reply).toContain("Kal LDH → BEAS 2A ka board ye hai.");
    expect(res.body.reply).toContain(SEAT_LINE);
    expect(res.body.seatFilterFallback).toBe(false);
  });

  it("AI ka jawab nahi aaya → seat line akele chalti hai (fallback true)", async () => {
    runAgentMock.mockResolvedValue(agentResult({ reply: "" }));
    const res = await request(createApp())
      .post("/api/agent")
      .send({ text: "LDH se BEAS kal 2A me seat hai kya", known: KNOWN })
      .expect(200);

    expect(res.body.reply).toBe(SEAT_LINE);
    expect(res.body.seatFilterFallback).toBe(true);
  });

  it("'kal subah' ka time window + class server-side seatFilterFor tak jaata hai", async () => {
    runAgentMock.mockResolvedValue(agentResult({ toolTrace: [{ tool: "FIND_SEATS" }] }));
    await request(createApp())
      .post("/api/agent")
      .send({ text: "Mujhe LDH se BEAS kal subah ki 2A seat wali trains batao", known: KNOWN })
      .expect(200);

    expect(seatFilterForMock).toHaveBeenCalledTimes(1);
    const call = seatFilterForMock.mock.calls[0][0] as {
      from: string;
      to: string;
      date: string;
      slots: { seatIntent: boolean; classCodes: string[]; departAfterMinute: number | null; departBeforeMinute: number | null; windowLabel: string | null };
    };
    expect(call).toMatchObject({ from: "LDH", to: "BEAS", date: "2026-09-25" });
    expect(call.slots.seatIntent).toBe(true);
    expect(call.slots.classCodes).toEqual(["2A"]);
    expect(call.slots.departAfterMinute).toBe(240); /* 04:00 */
    expect(call.slots.departBeforeMinute).toBe(720); /* 12:00 */
    expect(String(call.slots.windowLabel)).toMatch(/Subah/);
  });

  it("window ke bina sawaal par koi fake window nahi lagti (slots honest)", async () => {
    runAgentMock.mockResolvedValue(agentResult({ toolTrace: [{ tool: "FIND_SEATS" }] }));
    await request(createApp())
      .post("/api/agent")
      .send({ text: "LDH se BEAS kal 2A me seat hai kya", known: KNOWN })
      .expect(200);

    const call = seatFilterForMock.mock.calls[0][0] as {
      slots: { departAfterMinute: number | null; departBeforeMinute: number | null; windowLabel: string | null };
    };
    expect(call.slots.departAfterMinute).toBeNull();
    expect(call.slots.departBeforeMinute).toBeNull();
    expect(call.slots.windowLabel).toBeNull();
  });
});
