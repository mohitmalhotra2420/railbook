/* ══ ROUND-54b — ZERO-TOOL SELF-REPAIR (ChatGPT ka feedback loop) ═════════════════════════════════════
 * User ka sawaal (29 Sep): "ChatGPT har sawaal par sahi tool kaise chun leta hai? Humara AI bhi waisa
 * kare." ChatGPT ka ek asli hissa feedback loop hai: jawab ground nahi hua to wo khud sudhar kar dobara
 * tool chalata hai. Wahi yahan: LIVE-data sawaal par agar model ne koi tool hi nahi chalaya aur jawab me
 * data jaise numbers (ya "mere paas access nahi hai") likh diya — to server ek corrective round bhejta
 * hai ("ye live sawaal hai, abhi sahi tool chalao") aur model se dobara jawab leta hai. Test yahi loop
 * kaam kar raha hai ya nahi — ye dekhta hai.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const routeBoard = vi.fn();
const classBoard = vi.fn();
const stationSearch = vi.fn();
const liveStatus = vi.fn();
vi.mock("../server/railway/router.js", () => ({
  routedRouteBoard: (...a: unknown[]) => routeBoard(...a),
  routedClassBoard: (...a: unknown[]) => classBoard(...a),
  routedStationSearch: (...a: unknown[]) => stationSearch(...a),
  routedLiveStatus: (...a: unknown[]) => liveStatus(...a),
  routedTrainInfo: async () => ({ info: { trainName: "GURUMUKHI SF EXPRESS" } }),
  enrichTrainsFreshness: async () => 0,
}));
vi.mock("../server/providers/index.js", () => ({ getProvider: () => ({ searchTrains: async () => [], name: "mock" }) }));

import { setAgenticNvidiaFetch, runAgenticTurn } from "../server/agent/agentic";

beforeEach(() => {
  liveStatus.mockReset();
  routeBoard.mockReset();
  classBoard.mockReset();
});

afterEach(() => {
  setAgenticNvidiaFetch(null);
  process.env.NVIDIA_API_KEY = "";
});

describe("Round-54b · live sawaal par bina tool jawab → AI khud sudhare", () => {
  it("pehla jawab data-jaise number ke saath aaya par koi tool nahi chala → corrective round, phir asli tool", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-r54b";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    liveStatus.mockResolvedValue({ status: "Running late by 25 min", delayMinutes: 25, provider: "mock", source: "mock" });

    const seen: string[] = [];
    let call = 0;
    setAgenticNvidiaFetch(async (_url: unknown, init: { body?: unknown } = {}) => {
      seen.push(String(init?.body ?? ""));
      call += 1;
      const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (call === 1) {
        /* BINA tool: seedha "12326 25 min late hai" — ye bilkul wahi galti hai jo user ne pakdi thi. */
        return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "12326 Gurumukhi SF Express 25 minute late chal rahi hai (platform 3)." } }] });
      }
      if (call === 2) {
        return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "TRACK_TRAIN", arguments: JSON.stringify({ train_number: "12326", date: "2026-09-29" }) } }] } }] });
      }
      return body({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "12326 — provider ke hisaab se delay 25 min. (Live data, mock provider.)" } }] });
    });

    const capture = { table: null } as never;
    const turn = await runAgenticTurn({ text: "12326 late hai kya", history: [], capture, known: {} } as never);

    /* Corrective round bheji gayi (hint text model ki request me hai) */
    expect(seen.some((b) => b.includes("SYSTEM CHECK: ye LIVE data ka sawaal hai"))).toBe(true);
    /* Aur us ke baad ASLI tool chala (mock provider ke data ke saath) */
    expect(call).toBeGreaterThanOrEqual(3);
    expect((turn.steps ?? []).some((s: { tool?: string }) => s.tool === "TRACK_TRAIN")).toBe(true);
    /* Final jawab tool ke data se hai (25 min), aur user ko koi system line nahi dikhi */
    expect(String(turn.reply)).toMatch(/25/);
    expect(String(turn.reply)).not.toMatch(/SYSTEM CHECK/);
  });

  it("legit clarification (station/passenger/date poochna) self-repair trigger nahi karta", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-r54b2";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.NVIDIA_FALLBACK_MODEL;
    const seen: string[] = [];
    setAgenticNvidiaFetch(async (_url: unknown, init: { body?: unknown } = {}) => {
      seen.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", content: "Kaunsa station chahiye — LDH (Ludhiana) ya DOA (Dhandari)?" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const capture = { table: null } as never;
    await runAgenticTurn({ text: "LDH se DLI seat batao", history: [], capture, known: {} } as never);
    /* Sirf ek hi call — koi corrective round nahi (poochhna yahan sahi hai). */
    expect(seen.filter((b) => b.includes("SYSTEM CHECK: ye LIVE data")).length).toBe(0);
  });
});
