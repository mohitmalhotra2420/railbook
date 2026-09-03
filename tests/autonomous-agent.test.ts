import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { setProvider } from "../server/providers/index";
import { resetFallbackProvider, clearScheduleCache } from "../server/railway/router";
import { setRailcoreFetch, resetRailcoreBlock, railcoreBlockState, railcoreRequest } from "../server/railway/railcore";
import { setRailkitSdk } from "../server/railway/railkit";
import { cleanToolName, emptyAutoState, groundingIssues, resetAgentProtocol, runAutonomousAgent } from "../server/agent/autonomous";
import { runAutoTool } from "../server/agent/autoTools";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

type ChatBody = { messages: { role: string; content?: string | null; tool_calls?: unknown[]; name?: string }[]; tools?: unknown[]; model: string };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function assistant(msg: Record<string, unknown>) {
  return json(200, { model: "openai/gpt-oss-20b", choices: [{ message: { role: "assistant", ...msg } }] });
}

/** Scripted NVIDIA: each call pops the next response. Records every request body. */
function scriptNvidia(script: ((body: ChatBody, callIndex: number) => Response)[]) {
  const seen: ChatBody[] = [];
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== NVIDIA_URL) throw new Error(`unexpected fetch ${url}`);
    expect(String(init?.body)).not.toMatch(/nvapi-test-secret/);
    const body = JSON.parse(String(init?.body)) as ChatBody;
    seen.push(body);
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    return step(body, i - 1);
  }) as typeof fetch;
  return seen;
}

/** Mocked RailCore HTTP (real adapter code runs). */
function mockRailcore(overrides: Partial<Record<string, (url: string) => Response>> = {}) {
  setRailcoreFetch(async (input) => {
    const url = String(input);
    for (const [frag, fn] of Object.entries(overrides)) {
      if (fn && url.includes(frag)) return fn(url);
    }
    if (url.includes("/stations/search")) {
      const q = new URL(url).searchParams.get("q")?.toLowerCase() ?? "";
      const rows =
        q.startsWith("amrit") ? [{ station_code: "ASR", station_name: "AMRITSAR JN" }]
        : q.startsWith("ludh") ? [{ station_code: "LDH", station_name: "LUDHIANA JN" }, { station_code: "DDL", station_name: "DHANDARI KALAN" }]
        : q.startsWith("delhi") ? [{ station_code: "NDLS", station_name: "NEW DELHI" }, { station_code: "DLI", station_name: "DELHI JN" }, { station_code: "NZM", station_name: "H NIZAMUDDIN" }]
        : [];
      return json(200, { success: true, data: { results: rows } });
    }
    if (url.includes("/routes/trains")) {
      return json(200, {
        success: true,
        data: {
          from_station_code: "ASR",
          to_station_code: "LDH",
          trains: [
            { train_number: "12014", train_name: "AMRITSAR SHTABDI", departure_time: "04:55", arrival_time: "06:57", duration_minutes: 122, classes: ["CC", "EC"] },
            { train_number: "14542", train_name: "ASR CDG EXP", departure_time: "05:10", arrival_time: "07:12", duration_minutes: 122, classes: ["SL", "3A", "2S"] },
          ],
        },
      });
    }
    if (url.includes("/schedule")) {
      const n = url.match(/trains\/(\d{5})/)?.[1] ?? "12014";
      return json(200, {
        success: true,
        data: {
          train_number: n,
          train_name: n === "12014" ? "AMRITSAR SHTABDI" : "ASR CDG EXP",
          classes: n === "12014" ? ["CC", "EC"] : ["SL", "3A"],
          stops: [
            { station_code: "ASR", station_name: "AMRITSAR JN", departure_time: n === "12014" ? "04:55" : "05:10" },
            { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: n === "12014" ? "06:57" : "07:12", departure_time: "07:00" },
            { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "11:02" },
          ],
        },
      });
    }
    if (url.includes("/availability/seats")) {
      return json(200, {
        success: true,
        data: { journey_date: "2026-09-04", quota: "GN", classes: [{ class_code: "CC", status: "AVAILABLE", available_count: 45, total_fare: 510 }] },
      });
    }
    if (url.includes("/fares/estimate")) {
      return json(200, { success: true, data: { fares: [{ class_code: "CC", fare: 510 }] } });
    }
    if (url.includes("/live")) {
      return json(200, {
        success: true,
        data: { train_number: "12014", train_name: "AMRITSAR SHTABDI", status: "RUNNING", delay_minutes: 12, current_station_name: "Ludhiana Jn", last_updated_at: "2026-09-03T06:50:00+05:30" },
      });
    }
    return json(404, { success: false, error: { message: "endpoint not found" } });
  });
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const originalFetch = globalThis.fetch;

describe("autonomous agent — NVIDIA tool loop over real adapters", () => {
  beforeEach(() => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    process.env.NVIDIA_API_KEY = "nvapi-test-secret";
    process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_PROTOCOL;
    delete process.env.AGENT_AUTO;
    setProvider(null);
    resetFallbackProvider();
    clearScheduleCache();
    resetRailcoreBlock();
    resetAgentProtocol();
    setRailkitSdk(null);
    mockRailcore();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setRailcoreFetch(null);
    setRailkitSdk(null);
    setProvider(null);
    process.env.NVIDIA_API_KEY = "";
    process.env.RAILCORE_API_KEY = "";
  });

  it("1. model resolves stations then searches trains; reply is grounded and UI gets real trains", async () => {
    const date = tomorrow();
    const seen = scriptNvidia([
      () =>
        assistant({
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "searchStations", arguments: JSON.stringify({ query: "Amritsar" }) } },
            { id: "c2", type: "function", function: { name: "searchStations", arguments: JSON.stringify({ query: "Ludhiana" }) } },
          ],
        }),
      () =>
        assistant({
          content: null,
          tool_calls: [{ id: "c3", type: "function", function: { name: "searchTrains", arguments: JSON.stringify({ from: "ASR", to: "LDH", date }) } }],
        }),
      () => assistant({ content: `Kal ${date} ko Amritsar se Ludhiana 2 trains hain:\n12014 AMRITSAR SHTABDI · 04:55 → 06:57\n14542 ASR CDG EXP · 05:10 → 07:12\nKaunsi book karein?` }),
    ]);

    const res = await runAutonomousAgent({ text: `Kal Amritsar se Ludhiana jaana hai`, now: new Date().toISOString() });

    expect(res.ok).toBe(true);
    expect(res.fallback).toBe(false);
    expect(res.source).toBe("ai");
    expect(res.grounded).toBe(true);
    expect(res.confirmBook).toBe(false);
    expect(res.toolsUsed.map((t) => t.name)).toEqual(["searchStations", "searchStations", "searchTrains"]);
    expect(res.toolsUsed.every((t) => t.ok)).toBe(true);
    expect(res.ui.trains?.map((t) => t.number)).toEqual(["12014", "14542"]);
    expect(res.ui.from?.code).toBe("ASR");
    expect(res.ui.to?.code).toBe("LDH");
    expect(res.state.lastTrains.map((t) => t.number)).toEqual(["12014", "14542"]);
    expect(res.state.date).toBe(date);
    expect(res.reply).toContain("12014");
    // tool schemas were sent, tool results were fed back in OpenAI format
    expect(Array.isArray(seen[0].tools)).toBe(true);
    const toolMsgs = seen[2].messages.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBe(3); // 2× searchStations + 1× searchTrains fed back
    expect(toolMsgs[2].content).toContain("12014");
    expect(JSON.stringify(seen)).not.toMatch(/rk_live_test|nvapi/);
  });

  it("2. hallucinated train number is caught by the grounding guard and repaired", async () => {
    const date = tomorrow();
    let repairAsked = false;
    scriptNvidia([
      () => assistant({ content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "searchTrains", arguments: JSON.stringify({ from: "ASR", to: "LDH", date }) } }] }),
      () => assistant({ content: "12014 aur 12903 available hain, ₹999 fare." }),
      (body) => {
        repairAsked = body.messages.some((m) => m.role === "user" && /SYSTEM CHECK FAILED/.test(String(m.content)));
        return assistant({ content: "12014 AMRITSAR SHTABDI · 04:55 → 06:57 aur 14542 ASR CDG EXP · 05:10 → 07:12 hain. Fare ke liye class batao." });
      },
    ]);
    const res = await runAutonomousAgent({ text: `${date} ko ASR se LDH`, state: { ...emptyAutoState(), origin: { code: "ASR", name: "Amritsar Jn", city: "Amritsar" }, destination: { code: "LDH", name: "Ludhiana Jn", city: "Ludhiana" } } });
    expect(repairAsked).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.source).toBe("ai");
    expect(res.reply).not.toMatch(/12903|999/);
    expect(res.reply).toContain("14542");
  });

  it("3. model keeps hallucinating → deterministic evidence summary is returned instead (never the fake text)", async () => {
    const date = tomorrow();
    scriptNvidia([
      () => assistant({ content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "searchTrains", arguments: JSON.stringify({ from: "ASR", to: "LDH", date }) } }] }),
      () => assistant({ content: "Train 12903 hai, ₹999." }),
      () => assistant({ content: "Phir se: 12903 hi best hai, ₹999." }),
    ]);
    const res = await runAutonomousAgent({ text: `${date} ko ASR se LDH` });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("evidence");
    expect(res.failureReason).toBe("ungrounded_reply");
    expect(res.reply).not.toMatch(/12903|999/);
    expect(res.reply).toContain("12014");
    expect(res.reply).toContain("14542");
  });

  it("4. seat availability + fare come from the provider; numbers in reply are checked", async () => {
    const date = tomorrow();
    const fee = Number(process.env.SERVICE_FEE_INR ?? 25);
    scriptNvidia([
      () =>
        assistant({
          content: null,
          tool_calls: [
            { id: "a", type: "function", function: { name: "getAvailability", arguments: JSON.stringify({ trainNumber: "12014", from: "ASR", to: "LDH", date, classCode: "CC" }) } },
            { id: "f", type: "function", function: { name: "getFare", arguments: JSON.stringify({ trainNumber: "12014", from: "ASR", to: "LDH", date, classCode: "CC", passengers: 2 }) } },
          ],
        }),
      () => assistant({ content: `12014 CC (${date}) · AVAILABLE 45 seats · ₹510 per passenger. 2 logon ka total ₹1020 + service ₹${fee * 2} = ₹${1020 + fee * 2}.` }),
    ]);
    const res = await runAutonomousAgent({ text: "12014 mein CC 2 logon ke liye available hai? fare kitna?", state: { ...emptyAutoState(), date, lastTrains: [{ number: "12014", name: "AMRITSAR SHTABDI", dep: "04:55", arr: "06:57", classes: ["CC"] }] } });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("ai");
    expect(res.toolsUsed.map((t) => `${t.name}:${t.ok}`)).toEqual(["getAvailability:true", "getFare:true"]);
    expect(res.reply).toContain("45 seats");
    expect(res.reply).toContain(`₹${1020 + fee * 2}`);
    expect(res.state.classCode).toBe("CC");
    expect(res.state.selectedTrain?.number).toBe("12014");
    expect(res.state.passengers).toBe(2);
  });

  it("4b. wrong fare arithmetic from the model is rejected by the guard", async () => {
    const date = tomorrow();
    scriptNvidia([
      () => assistant({ content: null, tool_calls: [{ id: "f", type: "function", function: { name: "getFare", arguments: JSON.stringify({ trainNumber: "12014", from: "ASR", to: "LDH", date, classCode: "CC", passengers: 2 }) } }] }),
      () => assistant({ content: "2 logon ka total ₹1070 hai." }),
      () => assistant({ content: "Total ₹1070." }),
    ]);
    const res = await runAutonomousAgent({ text: "12014 CC 2 log fare", state: { ...emptyAutoState(), date } });
    expect(res.source).toBe("evidence");
    expect(res.reply).not.toContain("1070");
    expect(res.reply).toContain("₹1020");
  });

  it("5. provider down → tool returns ok:false and the reply says data is unavailable; no invented seats", async () => {
    mockRailcore({ "/availability/seats": () => json(429, { success: false, error: { message: "Daily rate limit exceeded" } }) });
    scriptNvidia([
      () => assistant({ content: null, tool_calls: [{ id: "a", type: "function", function: { name: "getAvailability", arguments: JSON.stringify({ trainNumber: "12014", from: "ASR", to: "LDH", date: tomorrow(), classCode: "CC" }) } }] }),
      (body) => {
        const toolMsg = body.messages.find((m) => m.role === "tool");
        expect(String(toolMsg?.content)).toContain('"ok":false');
        return assistant({ content: "12014 CC ki availability abhi railway provider se nahi mil rahi. Main seats ka andaza nahi lagaunga — thodi der baad try karein." });
      },
    ]);
    const res = await runAutonomousAgent({ text: "12014 CC seats?" });
    expect(res.ok).toBe(true);
    expect(res.toolsUsed[0].ok).toBe(false);
    expect(res.reply).toMatch(/nahi mil/);
    expect(res.reply).not.toMatch(/\d+\s*seats/);
  });

  it("6. model cannot book or move money: forbidden tools are refused, confirmBook always false", async () => {
    scriptNvidia([
      () =>
        assistant({
          content: null,
          tool_calls: [
            { id: "b", type: "function", function: { name: "confirmBooking", arguments: "{}" } },
            { id: "m", type: "function", function: { name: "addMoney", arguments: JSON.stringify({ amount: 5000 }) } },
          ],
        }),
      (body) => {
        const tools = body.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
        expect(tools.every((t) => /forbidden/.test(t))).toBe(true);
        return assistant({ content: "Booking aur wallet money sirf app ke Confirm & Book / Wallet screen se hoti hai — main nahi kar sakta." });
      },
    ]);
    const res = await runAutonomousAgent({ text: "book kar do aur 5000 wallet mein daal do" });
    expect(res.confirmBook).toBe(false);
    expect(res.toolsUsed.map((t) => t.ok)).toEqual([false, false]);
    const blocked = await runAutoTool("createBooking", {});
    expect(blocked.ok).toBe(false);
    expect(String(blocked.payload.error)).toMatch(/forbidden/);
  });

  it("7. train pick hands over to the booking UI (selectTrain) without booking", async () => {
    scriptNvidia([
      () => assistant({ content: null, tool_calls: [{ id: "s", type: "function", function: { name: "selectTrainForBooking", arguments: JSON.stringify({ trainNumber: "12014" }) } }] }),
      () => assistant({ content: "12014 AMRITSAR SHTABDI select ho gayi. Ab class chuno — booking Confirm & Book se hogi." }),
    ]);
    const res = await runAutonomousAgent({ text: "12014 wali book karo", state: { ...emptyAutoState(), lastTrains: [{ number: "12014", name: "AMRITSAR SHTABDI", dep: "04:55", arr: "06:57", classes: ["CC"] }] } });
    expect(res.ui.selectTrain).toBe("12014");
    expect(res.state.selectedTrain?.number).toBe("12014");
    expect(res.confirmBook).toBe(false);
  });

  it("8. selecting a train that was never in a real search is refused (no invented train)", async () => {
    scriptNvidia([
      () => assistant({ content: null, tool_calls: [{ id: "s", type: "function", function: { name: "selectTrainForBooking", arguments: JSON.stringify({ trainNumber: "12903" }) } }] }),
      () => assistant({ content: "12903 pichhli search mein nahi thi. Pehle route aur date batao, main real trains dhoondta hoon." }),
    ]);
    const res = await runAutonomousAgent({ text: "12903 book karo" });
    expect(res.ui.selectTrain).toBeUndefined();
    expect(res.toolsUsed[0].ok).toBe(false);
  });

  it("9. endpoint rejects native tools (400) → switches to JSON protocol in the same turn", async () => {
    const date = tomorrow();
    const seen = scriptNvidia([
      () => json(400, { error: { message: "tools not supported" } }),
      () => assistant({ content: JSON.stringify({ action: "tool", calls: [{ name: "searchTrains", args: { from: "ASR", to: "LDH", date } }] }) }),
      () => assistant({ content: JSON.stringify({ action: "reply", text: "12014 AMRITSAR SHTABDI 04:55 → 06:57 aur 14542 ASR CDG EXP 05:10 → 07:12." }) }),
    ]);
    const res = await runAutonomousAgent({ text: `${date} ASR se LDH` });
    expect(res.ok).toBe(true);
    expect(res.protocol).toBe("json");
    expect(seen[1].tools).toBeUndefined();
    expect(seen[2].messages.some((m) => m.role === "user" && /toolResults/.test(String(m.content)))).toBe(true);
    expect(res.ui.trains?.length).toBe(2);
  });

  it("10. NVIDIA timeout/unreachable with no tool output → fallback:true (legacy flow takes over)", async () => {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error("boom"), { name: "TypeError" });
    }) as typeof fetch;
    const res = await runAutonomousAgent({ text: "Kal Amritsar se Ludhiana" });
    expect(res.ok).toBe(false);
    expect(res.fallback).toBe(true);
    expect(res.reply).toBeNull();
    expect(res.failureReason).toBe("network");
  });

  it("11. off-topic never reaches the model", async () => {
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return assistant({ content: "x" });
    }) as typeof fetch;
    const res = await runAutonomousAgent({ text: "python mein code likh do" });
    expect(called).toBe(0);
    expect(res.reply).toMatch(/railway/i);
  });

  it("12. HTTP route works and never leaks secrets", async () => {
    scriptNvidia([() => assistant({ content: "Kahan se kahan jaana hai, aur kis date ko?" })]);
    const app = createApp();
    const res = await request(app).post("/api/agent/auto").send({ text: "ticket chahiye" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.confirmBook).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/nvapi|rk_live|Bearer/);
    const bad = await request(app).post("/api/agent/auto").send({});
    expect(bad.status).toBe(400);
  });

  it("13. searchTrains tool refuses past dates and never assumes today", async () => {
    const past = await runAutoTool("searchTrains", { from: "ASR", to: "LDH", date: "2020-01-01" });
    expect(past.ok).toBe(false);
    expect(String(past.payload.error)).toMatch(/past/);
    const noDate = await runAutoTool("searchTrains", { from: "ASR", to: "LDH" });
    expect(noDate.ok).toBe(false);
    expect(String(noDate.payload.error)).toMatch(/never assume today/);
  });

  it("14. multi-station city → needChoice surfaces as a stationChoice for the UI", async () => {
    scriptNvidia([
      () => assistant({ content: null, tool_calls: [{ id: "s", type: "function", function: { name: "searchStations", arguments: JSON.stringify({ query: "Delhi" }) } }] }),
      () => assistant({ content: "Delhi mein 3 stations hain — New Delhi (NDLS), Delhi Jn (DLI), H Nizamuddin (NZM). Kaunsa?" }),
    ]);
    const res = await runAutonomousAgent({ text: "Delhi jaana hai" });
    expect(res.ui.stationChoice?.stations.map((s) => s.code)).toEqual(expect.arrayContaining(["NDLS", "DLI"]));
    expect(res.ui.stationChoice?.stations.length).toBeGreaterThan(1);
  });

  it("15. grounding guard unit checks", () => {
    const ev = { trainNumbers: new Set(["12014"]), numbers: new Set(["510", "45", "12"]), codes: new Set(["ASR"]) };
    expect(groundingIssues("12014 CC · AVAILABLE 45 seats · ₹510, delay 12 min", ev, true)).toEqual([]);
    expect(groundingIssues("12903 hai ₹999 mein, 30 seats, 40 min late", ev, true)).toEqual([
      "train 12903 not in tool evidence",
      "amount ₹999 not in tool evidence",
      "seat count 30 not in tool evidence",
      "delay 40 min not in tool evidence",
    ]);
  });

  it("19. harmony-leaked tool names (\"searchStations<|channel|>\") are sanitised and still executed", async () => {
    const date = tomorrow();
    scriptNvidia([
      () =>
        assistant({
          content: null,
          tool_calls: [
            { id: "c1", type: "function", function: { name: "searchStations<|channel|>", arguments: JSON.stringify({ query: "Amritsar" }) } },
            { id: "c2", type: "function", function: { name: "functions.searchStations", arguments: JSON.stringify({ query: "Ludhiana" }) } },
          ],
        }),
      () =>
        assistant({
          content: null,
          tool_calls: [{ id: "c3", type: "function", function: { name: "searchTrains<|channel|>commentary", arguments: JSON.stringify({ from: "ASR", to: "LDH", date }) } }],
        }),
      () => assistant({ content: `12014 AMRITSAR SHTABDI · 04:55 → 06:57 aur 14542 ASR CDG EXP · 05:10 → 07:12 — kaunsi?` }),
    ]);
    const res = await runAutonomousAgent({ text: "Kal Amritsar se Ludhiana", now: new Date().toISOString() });
    expect(res.toolsUsed.map((t) => t.name)).toEqual(["searchStations", "searchStations", "searchTrains"]);
    expect(res.toolsUsed.every((t) => t.ok)).toBe(true);
    expect(res.source).toBe("ai");
    expect(cleanToolName("getFare<|channel|>commentary")).toBe("getFare");
    expect(cleanToolName("functions.getLiveStatus")).toBe("getLiveStatus");
    expect(cleanToolName("createBooking")).toBe("createBooking"); // unknown stays unknown → refused by executor
  });

  it("20. 'aaj/kal' resolve against IST even when the server clock is UTC (client `today` wins)", async () => {
    const seen = scriptNvidia([() => assistant({ content: "Kis date ko jaana hai?" })]);
    // 19:30 UTC = 01:00 IST next day
    const res = await runAutonomousAgent({ text: "Ludhiana se Delhi", now: "2026-09-03T19:30:00.000Z" });
    expect(res.ok).toBe(true);
    expect(seen[0].messages[0].content).toContain("Today is 2026-09-04");
    scriptNvidia([() => assistant({ content: "Kis date ko jaana hai?" })]);
    const seen2 = scriptNvidia([() => assistant({ content: "Kis date ko jaana hai?" })]);
    await runAutonomousAgent({ text: "Ludhiana se Delhi", now: "2026-09-03T19:30:00.000Z", today: "2026-09-03" });
    expect(seen2[0].messages[0].content).toContain("Today is 2026-09-03");
  });

  it("21. searchTrains with city names: ambiguous 'Delhi' → needChoice for slot 'to', resolved origin kept, no trains invented", async () => {
    const date = tomorrow();
    scriptNvidia([
      () =>
        assistant({
          content: null,
          tool_calls: [{ id: "c1", type: "function", function: { name: "searchTrains", arguments: JSON.stringify({ from: "Ludhiana", to: "Delhi", date }) } }],
        }),
      () => assistant({ content: "Delhi ke kaunse station se? NEW DELHI (NDLS), DELHI JN (DLI) ya H NIZAMUDDIN (NZM)?" }),
    ]);
    const res = await runAutonomousAgent({ text: "Ludhiana se Delhi kal", now: new Date().toISOString() });
    expect(res.ok).toBe(true);
    expect(res.toolsUsed).toEqual([expect.objectContaining({ name: "searchTrains", ok: false })]);
    expect(res.ui.stationChoice?.slot).toBe("to");
    expect(res.ui.stationChoice?.stations.map((s) => s.code)).toContain("NDLS");
    expect(res.ui.trains).toBeUndefined();
    expect(res.state.origin?.code).toBe("LDH");
    expect(res.state.destination).toBeNull();
    expect(res.state.date).toBe(date);
    expect(res.state.lastTrains).toEqual([]);
  });
});

describe("RailCore circuit breaker", () => {
  beforeEach(() => {
    process.env.RAILCORE_API_KEY = "rk_live_test";
    resetRailcoreBlock();
  });
  afterEach(() => {
    setRailcoreFetch(null);
    process.env.RAILCORE_API_KEY = "";
  });

  it("remembers a daily-limit 429 and short-circuits further calls until reset", async () => {
    let hits = 0;
    const reset = Math.floor(Date.now() / 1000) + 3600;
    setRailcoreFetch(async () => {
      hits += 1;
      return json(
        429,
        { success: false, error: { code: "RATE_LIMITED", message: "Daily rate limit exceeded" } },
        { "x-railcore-ratelimit-day-remaining": "0", "x-railcore-ratelimit-day-reset": String(reset) },
      );
    });
    const first = await railcoreRequest("/trains/12014");
    expect(first.status).toBe(429);
    expect(railcoreBlockState()).toMatchObject({ blocked: true, reason: "railcore_daily_limit" });
    const second = await railcoreRequest("/trains/12014");
    expect(second.ok).toBe(false);
    expect(second.latencyMs).toBe(0);
    expect(hits).toBe(1);
  });

  it("does not block on a normal 200", async () => {
    setRailcoreFetch(async () => json(200, { success: true, data: { results: [] } }));
    await railcoreRequest("/stations/search", { q: "x" });
    expect(railcoreBlockState().blocked).toBe(false);
  });
});
