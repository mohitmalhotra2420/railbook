/**
 * AI-driven tool calling — tested as a REAL tool-calling system.
 *
 * Scripted NVIDIA model + mocked RailCore HTTP. Every test verifies the
 * actual loop behaviour: tool selection, argument validity, results fed
 * back into the conversation, subsequent tool calls, grounded final
 * answers, allowlist rejections and honest fallbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { runAgent } from "../server/agent/run";
import {
  AGENTIC_TOOLS,
  executeApprovedTool,
  runAgenticTurn,
  setAgenticNvidiaFetch,
  type ToolTraceStep,
} from "../server/agent/agentic";
import { resetRailcoreBookings, setRailcoreFetch } from "../server/railway/railcore";
import { setProvider } from "../server/providers/index";

const NOW = "2026-09-04T04:00:00.000Z"; // 09:30 IST, Fri 4 Sep 2026

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test_secret";
  process.env.RAILKIT_API_KEY = "";
  process.env.NVIDIA_API_KEY = "nvapi_test_key_not_real";
  process.env.NVIDIA_MODEL = "openai/gpt-oss-20b";
  process.env.AI_REQUEST_TIMEOUT_MS = "2000";
  setProvider(null);
});

afterEach(() => {
  setAgenticNvidiaFetch(null);
  setRailcoreFetch(null);
  resetRailcoreBookings();
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  process.env.RAILKIT_API_KEY = "";
  process.env.NVIDIA_API_KEY = "";
  setProvider(null);
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/* ── Mock RailCore (realistic payload shapes) ────────────────────── */

function railcoreMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const q = url.searchParams;
    if (p.endsWith("/stations/search")) {
      const query = (q.get("q") || "").toLowerCase();
      if (query === "amritsar") {
        return jsonResponse(200, {
          success: true,
          data: { results: [{ station_code: "ASR", station_name: "AMRITSAR JN", city: "Amritsar", confidence: 1 }] },
        });
      }
      // "New Delhi" resolves to a single confident station; bare "delhi"
      // stays ambiguous (3 stations) for the needs_choice test.
      if (query.includes("new delhi")) {
        return jsonResponse(200, {
          success: true,
          data: { results: [{ station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 0.98 }] },
        });
      }
      if (query === "delhi") {
        return jsonResponse(200, {
          success: true,
          data: {
            results: [
              { station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi", confidence: 0.9 },
              { station_code: "DLI", station_name: "DELHI JN", city: "Delhi", confidence: 0.9 },
              { station_code: "NZM", station_name: "H NIZAMUDDIN", city: "Delhi", confidence: 0.85 },
            ],
          },
        });
      }
      if (query === "nagpur") {
        return jsonResponse(200, {
          success: true,
          data: { results: [{ station_code: "NGP", station_name: "NAGPUR JN", city: "Nagpur", confidence: 1 }] },
        });
      }
      return jsonResponse(200, { success: true, data: { results: [] } });
    }
    if (p.endsWith("/routes/trains")) {
      const from = q.get("from");
      const to = q.get("to");
      const date = q.get("date") || "";
      if (from === "NDLS" && to === "NGP") {
        // Night connection out of New Delhi — dep 23:45 (wait 45m after 23:00 arrival).
        return jsonResponse(200, {
          success: true,
          data: {
            from_station_code: "NDLS",
            to_station_code: "NGP",
            trains: [
              {
                train_number: "12722",
                train_name: "DAKSHIN EXPRESS",
                train_type: "Express",
                departure_time: "23:45",
                arrival_time: "05:00",
                duration_minutes: 315,
                running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
                classes: ["SL"],
              },
            ],
          },
        });
      }
      if (from === "ASR" && to === "NDLS" && date === "2026-09-05") {
        return jsonResponse(200, {
          success: true,
          data: {
            from_station_code: "ASR",
            to_station_code: "NDLS",
            trains: [
              {
                train_number: "12014",
                train_name: "AMRITSAR SHATABDI",
                train_type: "Shatabdi",
                departure_time: "18:25",
                arrival_time: "23:00",
                duration_minutes: 275,
                running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
                classes: ["CC", "EC"],
              },
              {
                train_number: "12460",
                train_name: "INTERCITY EXP",
                train_type: "Express",
                departure_time: "21:15",
                arrival_time: "04:15",
                duration_minutes: 420,
                running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
                classes: ["CC", "2S"],
              },
            ],
          },
        });
      }
      // Alternative dates: fewer trains on the 4th/7th, none on the 6th.
      if (from === "ASR" && to === "NDLS" && (date === "2026-09-04" || date === "2026-09-07")) {
        return jsonResponse(200, {
          success: true,
          data: {
            from_station_code: "ASR",
            to_station_code: "NDLS",
            trains: [
              {
                train_number: "12014",
                train_name: "AMRITSAR SHATABDI",
                train_type: "Shatabdi",
                departure_time: "18:25",
                arrival_time: "23:00",
                duration_minutes: 275,
                running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
                classes: ["CC"],
              },
            ],
          },
        });
      }
      return jsonResponse(200, { success: true, data: { from_station_code: "ASR", to_station_code: "NDLS", trains: [] } });
    }
    if (p.endsWith("/schedule")) {
      // Train-aware: the routed search verifies each result's stops through
      // its timetable, so 12722 must serve NDLS->NGP.
      const num = (p.match(/\/trains\/(\d+)\/schedule/) || [])[1] || "12014";
      const stops =
        num === "12722"
          ? [
              { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: null, departure_time: "23:45", day: 1 },
              { station_code: "NGP", station_name: "NAGPUR JN", arrival_time: "05:00", departure_time: null, day: 2 },
            ]
          : [
              { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "18:25", day: 1 },
              { station_code: "BEAS", station_name: "BEAS", arrival_time: "19:10", departure_time: "19:12", day: 1 },
              { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "20:20", departure_time: "20:25", day: 1 },
              { station_code: "UMB", station_name: "AMBALA CANT JN", arrival_time: "21:40", departure_time: "21:42", day: 1 },
              { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "23:00", departure_time: null, day: 1 },
            ];
      return jsonResponse(200, {
        success: true,
        data: {
          train_number: num,
          train_name: num === "12722" ? "DAKSHIN EXPRESS" : "AMRITSAR SHATABDI",
          running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
          total_duration_minutes: num === "12722" ? 315 : 275,
          classes: num === "12722" ? ["SL"] : ["CC", "EC"],
          stops,
        },
      });
    }
    if (p.endsWith("/fares/estimate")) {
      return jsonResponse(200, { success: true, data: { fares: [{ class_code: "CC", fare: 1210 }] } });
    }
    if (p.endsWith("/availability/seats")) {
      return jsonResponse(200, {
        success: true,
        data: {
          journey_date: "2026-09-05",
          quota: "GN",
          classes: [{ class_code: "CC", status: "AVAILABLE", available_count: 47, total_fare: 1210, availability_text: "AVAILABLE-0047" }],
        },
      });
    }
    if (p.includes("/live") || p.includes("/running")) {
      return jsonResponse(200, {
        success: true,
        data: {
          train_number: "12014",
          train_name: "AMRITSAR SHATABDI",
          status_text: "RUNNING",
          delay_minutes: 6,
          current_station_name: "LUDHIANA JN",
          next_stop: { station_code: "UMB", station_name: "AMBALA CANT JN" },
          last_reported_at: "2026-09-04T09:05:00+05:30",
        },
      });
    }
    return jsonResponse(404, { success: false, error: { message: "not found" } });
  });
}

/* ── Scripted NVIDIA model (OpenAI-style chat responses) ─────────── */

type ScriptStep =
  | { tool_calls: { id: string; function: { name: string; arguments: string } }[] }
  | { content: string };

function toolCall(name: string, args: unknown, id = `call_${Math.random().toString(36).slice(2, 8)}`) {
  return { id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
}

function chatResponse(step: ScriptStep) {
  const message =
    "tool_calls" in step
      ? { content: null, tool_calls: step.tool_calls }
      : { content: step.content, tool_calls: undefined };
  return jsonResponse(200, { model: "openai/gpt-oss-20b", choices: [{ message }] });
}

describe("agentic tool-calling layer", () => {
  it("exposes exactly the 15 approved tools", () => {
    const names = AGENTIC_TOOLS.map((t) => t.function.name).sort();
    expect(names).toEqual(
      [
        "CHECK_AVAILABILITY",
        "CHECK_PNR",
        "GENERAL_RAILWAY_ANSWER",
        "GET_CANCELLED_TRAINS",
        "GET_COACH_POSITION",
        "GET_FARE",
        "GET_STATION_BOARD",
        "GET_TIMETABLE",
        "GET_TRAIN_HISTORY",
        "GET_TRAIN_INFO",
        "JOURNEY_ANALYZE",
        "SEARCH_STATIONS",
        "SEARCH_TRAINS",
        "TRACK_TRAIN",
        "TRAIN_NAME_SEARCH",
      ].sort(),
    );
  });

  it("MULTI-STEP: search -> timetable -> fare -> availability, results fed back, grounded answer", async () => {
    railcoreMock();
    const bodies: any[] = [];
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [toolCall("SEARCH_TRAINS", { origin: "Amritsar", destination: "New Delhi", date: "2026-09-05" })] });
      }
      if (toolMsgs === 1) {
        return chatResponse({ tool_calls: [toolCall("GET_TIMETABLE", { train_number: "12014" })] });
      }
      if (toolMsgs === 2) {
        return chatResponse({
          tool_calls: [
            toolCall("GET_FARE", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" }),
            toolCall("CHECK_AVAILABILITY", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" }),
          ],
        });
      }
      return chatResponse({
        content:
          "Sabse fast: 12014 AMRITSAR SHATABDI (18:25 → 23:00, 275 min). CC base fare ₹1210 hai aur availability AVAILABLE hai — 47 seats bachi hain (2026-09-05).",
      });
    });

    const turn = await runAgenticTurn({
      text: "Amritsar se Delhi Saturday ko sabse fast train kaunsi hai aur CC ka fare aur availability kya hai?",
      now: NOW,
    });

    expect(turn.ok).toBe(true);
    expect(turn.grounded).toBe(true);
    expect(turn.reply).toContain("12014");
    expect(turn.reply).toContain("47");
    expect(turn.reply).toContain("1210");
    expect(turn.steps.map((s) => s.tool)).toEqual(["SEARCH_TRAINS", "GET_TIMETABLE", "GET_FARE", "CHECK_AVAILABILITY"]);
    expect(turn.steps.every((s) => s.ok)).toBe(true);
    expect(turn.steps.every((s) => s.source === "railcore")).toBe(true);

    // Model actually received tool results: 2nd request carries SEARCH result, 3rd carries timetable.
    const second = bodies[1].messages.find((m: any) => m.role === "tool");
    expect(second.content).toContain("12014");
    expect(second.content).toContain('"source":"railcore"');
    const third = bodies[2].messages.filter((m: any) => m.role === "tool");
    expect(third.some((m: any) => m.content.includes("BEAS"))).toBe(true);
    // Fare+availability step saw both results.
    const fourth = bodies[3].messages.filter((m: any) => m.role === "tool");
    expect(fourth.some((m: any) => m.content.includes("1210"))).toBe(true);
    expect(fourth.some((m: any) => m.content.includes("AVAILABLE"))).toBe(true);

    // Station names were resolved through the API (Amritsar -> ASR) and the
    // model used the resolved codes in its subsequent GET_FARE args.
    expect(turn.steps[2].args.origin).toBe("ASR");
    expect(turn.steps[2].args.destination).toBe("NDLS");

    // Secrets never leave the server: no railway key inside any message payload.
    for (const b of bodies) {
      expect(JSON.stringify(b.messages)).not.toMatch(/rk_live/);
    }
  });

  it("allowlist: unknown tool and URL-bearing args are rejected, model recovers honestly", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [toolCall("SEARCH_WEB", { url: "https://evil.example.com/api" })] });
      }
      if (toolMsgs === 1) {
        return chatResponse({ content: "Ye data available nahi hai — main sirf approved railway tools use kar sakta hoon." });
      }
      throw new Error("unexpected extra model call");
    });

    const turn = await runAgenticTurn({ text: "google se train data nikalo", now: NOW });
    expect(turn.steps[0].tool).toBe("SEARCH_WEB");
    expect(turn.steps[0].ok).toBe(false);
    expect(turn.steps[0].summary).toMatch(/approved list/i);
    expect(turn.ok).toBe(true);
    expect(turn.reply).toMatch(/available nahi/i);
  });

  it("invalid arguments -> error result -> model retries with valid args", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        // class_code GET_FARE ke liye required hai — iska missing hona ab bhi invalid_args hai.
        return chatResponse({ tool_calls: [toolCall("GET_FARE", { train_number: "12014" })] });
      }
      if (toolMsgs === 1) {
        return chatResponse({
          tool_calls: [
            toolCall("GET_FARE", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" }),
          ],
        });
      }
      const fee = Number(process.env.SERVICE_FEE_INR ?? 25);
      return chatResponse({ content: `12014 CC ka fare ₹${1210 + fee} total hai (2026-09-05).` });
    });

    const fee = Number(process.env.SERVICE_FEE_INR ?? 25);
    const turn = await runAgenticTurn({ text: "12014 CC ka fare batao", now: NOW });
    expect(turn.steps[0].ok).toBe(false);
    expect(turn.steps[0].summary).toMatch(/Invalid arguments/i);
    expect(turn.steps[1].ok).toBe(true);
    expect(turn.grounded).toBe(true);
    expect(turn.reply).toContain(String(1210 + fee));
  });

  it("train-specific fare/availability WITHOUT route/date auto-resolves via timetable + today", async () => {
    railcoreMock();
    const fare = await executeApprovedTool("GET_FARE", { train_number: "12014", class_code: "CC" });
    expect(fare.ok).toBe(true);
    const fareData = fare.data as { resolvedRoute?: { origin?: string; destination?: string; date?: string; autoRoute?: boolean; autoDate?: boolean } };
    expect(fareData.resolvedRoute?.origin).toBe("ASR");
    expect(fareData.resolvedRoute?.destination).toBe("NDLS");
    expect(fareData.resolvedRoute?.autoRoute).toBe(true);
    expect(fareData.resolvedRoute?.autoDate).toBe(true);
    expect(fare.summary).toContain("ASR→NDLS");
    expect(fare.summary).toContain(`₹${1210 + Number(process.env.SERVICE_FEE_INR ?? 25)}`);

    const avail = await executeApprovedTool("CHECK_AVAILABILITY", { train_number: "12014" });
    expect(avail.ok).toBe(true);
    expect(avail.summary).toContain("ASR→NDLS");
    expect(JSON.stringify(avail.data)).toContain("AVAILABLE");
  });

  it("harmony channel tokens in tool names are sanitized, allowlist still enforced", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        // GPT-OSS harmony leak: raw channel marker inside the function name.
        return chatResponse({
          tool_calls: [
            toolCall("CHECK_AVAILABILITY<|channel|>commentary", {
              train_number: "12014",
              date: "2026-09-05",
              origin: "ASR",
              destination: "NDLS",
              class_code: "CC",
            }),
          ],
        });
      }
      return chatResponse({ content: "12014 CC mein 2026-09-05 ko AVAILABLE hai — 47 seats." });
    });

    const turn = await runAgenticTurn({ text: "availability batao", now: NOW });
    expect(turn.steps[0].tool).toBe("CHECK_AVAILABILITY");
    expect(turn.steps[0].ok).toBe(true);
    expect(turn.steps[0].source).toBe("railcore");
    expect(turn.grounded).toBe(true);
  });

  it("repair pass: model asks for info despite tool data -> one corrective call answers", async () => {
    railcoreMock();
    let modelCalls = 0;
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const isRepair = (body.messages as any[]).some((m) => m.role === "user" && String(m.content).includes("SYSTEM CHECK"));
      modelCalls++;
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({
          tool_calls: [toolCall("GET_FARE", { train_number: "12014", class_code: "CC" })],
        });
      }
      const total = 1210 + Number(process.env.SERVICE_FEE_INR ?? 25);
      if (!isRepair) {
        // Dumb temp-0 behaviour: tools succeeded, phir bhi info maango wala jawab.
        return chatResponse({ content: "Fare ke liye route aur date chahiye, batao?" });
      }
      return chatResponse({ content: `12014 CC ASR→NDLS ka fare ₹${total} total hai (2026-09-05, aaj ke liye).` });
    });

    const total = 1210 + Number(process.env.SERVICE_FEE_INR ?? 25);
    const turn = await runAgenticTurn({ text: "12014 ka cc fare btao", now: NOW });
    expect(modelCalls).toBe(3); // tool-call turn + dumb reply + repaired reply
    expect(turn.reply).toContain(String(total));
    expect(turn.grounded).toBe(true);
  });

  it("grounding: hallucinated fare in the final answer gets replaced by provider-backed summary", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [toolCall("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" })] });
      }
      // Model invents a fare that exists nowhere in tool results.
      return chatResponse({ content: "Sabse fast 12014 hai aur CC fare sirf ₹999 hai." });
    });

    const turn = await runAgenticTurn({ text: "ASR se NDLS trains", now: NOW });
    expect(turn.grounded).toBe(false);
    expect(turn.failureReason || "").toMatch(/^ungrounded_numbers/);
    expect(turn.reply).not.toContain("999");
    expect(turn.reply).toContain("2 trains");
  });

  it("JOURNEY_ANALYZE: fastest ranking + alternative dates (engine output, provider-backed)", async () => {
    // Wall-clock-independent: alternatives filter (d >= today) 2026-09-04 waale
    // expectations se match kare isliye system time freeze — production filter
    // past dates drop karna sahi behaviour hai.
    vi.useFakeTimers({ now: new Date("2026-09-04T12:00:00+05:30"), toFake: ["Date"] });
    try {
    railcoreMock();
    const res = await executeApprovedTool("JOURNEY_ANALYZE", {
      origin: "Amritsar",
      destination: "New Delhi",
      date: "2026-09-05",
      preference: "fastest",
      include_alternative_dates: true,
    });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("engine");
    const data = res.data as any;
    expect(data.direct.count).toBe(2);
    expect(data.direct.best.number).toBe("12014");
    expect(data.direct.best.why).toMatch(/duration/i);
    expect(data.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-09-04", count: 1 }),
        expect.objectContaining({ date: "2026-09-06", count: 0 }),
        expect.objectContaining({ date: "2026-09-07", count: 1 }),
      ]),
    );
    expect(data.providers.search).toBe("railcore");
    } finally {
      vi.useRealTimers();
    }
  });

  it("JOURNEY_ANALYZE: connecting journey via NDLS hub with a sane transfer buffer", async () => {
    railcoreMock();
    // ASR→NGP has no direct train in the fixture -> engine suggests connections.
    const res = await executeApprovedTool("JOURNEY_ANALYZE", {
      origin: "Amritsar",
      destination: "Nagpur",
      date: "2026-09-05",
      preference: "fastest",
      include_connections: true,
    });
    expect(res.ok).toBe(true);
    const data = res.data as any;
    expect(data.direct.count).toBe(0);
    expect(data.connections?.length).toBeGreaterThan(0);
    const viaNdls = data.connections.find((c: any) => c.via === "NDLS");
    expect(viaNdls).toBeTruthy();
    expect(viaNdls.waitMinutes).toBeGreaterThanOrEqual(45);
    expect(viaNdls.legs[0].train).toContain("12014");
    expect(viaNdls.legs[1].train).toContain("12722");
  });

  it("JOURNEY_ANALYZE: ambiguous city stays honest (needs_choice), no guessing", async () => {
    railcoreMock();
    const res = await executeApprovedTool("JOURNEY_ANALYZE", {
      origin: "Delhi",
      destination: "Nagpur",
      date: "2026-09-05",
      preference: "fastest",
    });
    expect(res.ok).toBe(false);
    const data = res.data as any;
    expect(data.needs_choice).toBe(true);
    expect(data.stations.map((s: any) => s.code)).toEqual(expect.arrayContaining(["NDLS", "DLI", "NZM"]));
  });

  it("GENERAL_RAILWAY_ANSWER: verified KB facts only", async () => {
    const hit = await executeApprovedTool("GENERAL_RAILWAY_ANSWER", { topic: "tatkal" });
    expect(hit.ok).toBe(true);
    expect(hit.source).toBe("kb");
    expect((hit.data as any).answer).toMatch(/10:00/i);

    const miss = await executeApprovedTool("GENERAL_RAILWAY_ANSWER", { topic: "astrology" as never });
    expect(miss.ok).toBe(false);
    expect(miss.rejected).toBe("invalid_args");
  });

  it("SECURITY: keys never appear in tool results fed to the model", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const blob = JSON.stringify(body.messages);
      expect(blob).not.toMatch(/rk_live_test_secret/);
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) return chatResponse({ tool_calls: [toolCall("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" })] });
      return chatResponse({ content: "2 trains mili ASR se NDLS ko 2026-09-05 par." });
    });
    const turn = await runAgenticTurn({ text: "trains dikhao", now: NOW });
    expect(turn.ok).toBe(true);
  });

  it("MULTI-TURN: known context flows into the system prompt (no re-asking)", async () => {
    railcoreMock();
    let firstSystem = "";
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (!firstSystem) firstSystem = body.messages[0].content;
      return chatResponse({ content: "2026-09-05 ko 2 trains hain — 12014 aur 12460." });
    });
    await runAgenticTurn({
      text: "aur CC ka fare?",
      now: NOW,
      known: { origin: "ASR", destination: "NDLS", date: "2026-09-05", trainNumber: "12014" },
    });
    expect(firstSystem).toContain("origin=ASR");
    expect(firstSystem).toContain("destination=NDLS");
    expect(firstSystem).toContain("date=2026-09-05");
    expect(firstSystem).toContain("train=12014");
    // Deterministic weekday map: NOW is Friday 2026-09-04 (IST) -> Saturday must resolve to 2026-09-05.
    expect(firstSystem).toContain("Aaj ki date (IST): 2026-09-04 (Friday)");
    expect(firstSystem).toContain("Sat=2026-09-05");
  });
});

describe("agent integration: agentic path + deterministic fallback", () => {
  it("/api/agent routes a fact question through agentic TRACK_TRAIN and returns the trace", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({ tool_calls: [toolCall("TRACK_TRAIN", { train_number: "12014" })] });
      }
      return chatResponse({
        content: "12014 AMRITSAR SHATABDI RUNNING hai — LUDHIANA JN ke aage, delay 6 min. Agla stop AMBALA CANT JN.",
      });
    });
    const app = createApp();
    const res = await request(app).post("/api/agent").send({ text: "12014 abhi kaha hai?", now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("agentic_tool_calling");
    expect(res.body.grounded).toBe(true);
    expect(res.body.reply).toContain("LUDHIANA");
    expect(res.body.toolTrace?.[0]?.tool).toBe("TRACK_TRAIN");
    expect(res.body.toolTrace?.[0]?.source).toBe("railcore");
    expect(JSON.stringify(res.body)).not.toMatch(/rk_live_test_secret|nvapi_test_key/);
  });

  it("NVIDIA down -> deterministic fallback answers honestly (architecture preserved)", async () => {
    railcoreMock();
    // Railway tool data exists, but the model call itself fails -> deterministic path.
    setAgenticNvidiaFetch(async () => {
      throw new Error("nvidia unreachable");
    });
    const app = createApp();
    const res = await request(app).post("/api/agent").send({ text: "12014 abhi kaha hai?", now: NOW });
    expect(res.status).toBe(200);
    expect(res.body.engine ?? "deterministic").toBe("deterministic");
    expect(res.body.reply).toBeTruthy();
  });

  it("AI-FIRST: booking-intent goes to the model — it asks for the missing date (no silent assumptions)", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async () => {
      // Model asks for the genuinely missing slot instead of calling tools with an assumed date.
      return chatResponse({ content: "Kis date ko jaana hai?" });
    });
    const result = await runAgent({ text: "Mujhe Amritsar se Delhi jaana hai", now: NOW });
    expect(result.engine).toBe("agentic_tool_calling");
    expect(result.reply).toContain("Kis date ko");
    expect(result.toolTrace ?? []).toEqual([]);
    expect(result.confirmBook).toBe(false);
  });

  it("booking MUTATION (confirm/payment) never reaches the model — deterministic flow owns it", async () => {
    railcoreMock();
    let agenticCalled = false;
    setAgenticNvidiaFetch(async () => {
      agenticCalled = true;
      throw new Error("must not be called for booking mutations");
    });
    const result = await runAgent({
      text: "Haan, book kar do",
      now: NOW,
      bookingFlow: "FARE_REVIEW",
    });
    expect(agenticCalled).toBe(false);
    expect(result.engine ?? "deterministic").toBe("deterministic");
    expect(result.confirmBook).toBe(false);
    // Same guard by text alone (no bookingFlow hint).
    const result2 = await runAgent({ text: "Payment kar do, confirm book kardo", now: NOW });
    expect(result2.engine ?? "deterministic").toBe("deterministic");
    expect(result2.confirmBook).toBe(false);
  });

  it("MULTI-TURN: 'jaana hai' asks the date, then 'Saturday' continues with ASR/NDLS context — no re-asking", async () => {
    railcoreMock();
    const searches: Record<string, unknown>[] = [];
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        // Turn 2: the model already knows origin/destination from context — only the date was asked.
        return chatResponse({
          tool_calls: [toolCall("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" })],
        });
      }
      const called = body.messages.filter((m: any) => m.role === "assistant" && m.tool_calls).flatMap((m: any) => m.tool_calls);
      for (const tc of called) searches.push(JSON.parse(tc.function.arguments));
      return chatResponse({
        content: "Saturday 5 Sep ko ASR→NDLS 2 trains hain: 12014 AMRITSAR SHATABDI (18:25→23:00) aur 12460 INTERCITY EXP (21:15→04:15).",
      });
    });
    // Turn 1 already happened (the model asked "Kis date ko jaana hai?").
    // Turn 2 carries the conversation state: known slots + history.
    const result = await runAgent({
      text: "Saturday",
      now: NOW,
      known: {
        from: { code: "ASR", name: "AMRITSAR JN", city: "Amritsar" },
        to: { code: "NDLS", name: "NEW DELHI", city: "Delhi" },
      },
      history: [
        { role: "user", content: "Amritsar se Delhi jaana hai" },
        { role: "assistant", content: "Kis date ko jaana hai?" },
      ],
    });
    expect(result.engine).toBe("agentic_tool_calling");
    expect(result.toolTrace?.[0]?.tool).toBe("SEARCH_TRAINS");
    expect(result.toolTrace?.[0]?.args).toMatchObject({ origin: "ASR", destination: "NDLS", date: "2026-09-05" });
    expect(result.toolTrace?.[0]?.source).toBe("railcore");
    expect(result.reply).toContain("12014");
    // The model never re-asked origin/destination — it used the carried context.
    expect(searches[0]).toMatchObject({ origin: "ASR", destination: "NDLS" });
  });

  it("AI-FIRST: journey phrasing outside any old regex gate still reaches the model (no deterministic pre-gate)", async () => {
    railcoreMock();
    // First call returns a tool call; second (after the tool result) returns the answer.
    let call = 0;
    setAgenticNvidiaFetch(async () => {
      call += 1;
      if (call === 1) {
        return chatResponse({
          tool_calls: [
            toolCall("JOURNEY_ANALYZE", { origin: "ASR", destination: "NDLS", date: "2026-09-05", preference: "fastest" }),
          ],
        });
      }
      return chatResponse({ content: "Sabse fast: 12014 AMRITSAR SHATABDI — 4h 35m, 18:25→23:00." });
    });
    const res = await request(createApp())
      .post("/api/agent")
      .send({
        // No "fastest/sabse tez/compare" keyword the old gate looked for — the model decides.
        text: "Amritsar se Delhi subah wali sabse achhi train kaunsi hai 5 tareek ko?",
        now: NOW,
      });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("agentic_tool_calling");
    expect(res.body.toolTrace?.[0]?.tool).toBe("JOURNEY_ANALYZE");
    expect(res.body.grounded).toBe(true);
  });

  it("USER EXAMPLE: fastest train + CC fare + availability — model chains SEARCH_TRAINS → GET_FARE → CHECK_AVAILABILITY", async () => {
    railcoreMock();
    const chain: string[] = [];
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return chatResponse({
          tool_calls: [toolCall("SEARCH_TRAINS", { origin: "ASR", destination: "NDLS", date: "2026-09-05" })],
        });
      }
      if (toolMsgs === 1) {
        return chatResponse({
          tool_calls: [toolCall("GET_FARE", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" })],
        });
      }
      if (toolMsgs === 2) {
        return chatResponse({
          tool_calls: [
            toolCall("CHECK_AVAILABILITY", { train_number: "12014", date: "2026-09-05", origin: "ASR", destination: "NDLS", class_code: "CC" }),
          ],
        });
      }
      const called = body.messages.filter((m: any) => m.role === "assistant" && m.tool_calls).flatMap((m: any) => m.tool_calls);
      for (const tc of called) chain.push(tc.function.name);
      return chatResponse({
        content:
          "Sabse fast train: 12014 AMRITSAR SHATABDI (18:25→23:00, 4h 35m). CC fare ₹1210 hai aur 47 seats AVAILABLE hain.",
      });
    });
    const res = await request(createApp())
      .post("/api/agent")
      .send({
        text: "Amritsar se Delhi Saturday ko sabse fast train kaunsi hai aur CC ka fare aur availability kya hai?",
        now: NOW,
      });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe("agentic_tool_calling");
    const tools = (res.body.toolTrace ?? []).map((t: { tool: string }) => t.tool);
    expect(tools).toEqual(["SEARCH_TRAINS", "GET_FARE", "CHECK_AVAILABILITY"]);
    expect(tools).not.toContain("JOURNEY_ANALYZE"); // model was free to choose its own plan
    expect(res.body.reply).toContain("12014");
    expect(res.body.reply).toContain("1210");
    expect(res.body.reply).toContain("47");
    expect(res.body.grounded).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/rk_live_test_secret|nvapi_test_key/);
  });

  it("NVIDIA down mid-conversation → deterministic fallback still answers (architecture preserved)", async () => {
    railcoreMock();
    setAgenticNvidiaFetch(async () => {
      throw new Error("nvidia unreachable");
    });
    const res = await request(createApp())
      .post("/api/agent")
      .send({ text: "12014 abhi kaha hai?", now: NOW, history: [{ role: "user", content: "12014 ki live status" }] });
    expect(res.status).toBe(200);
    expect(res.body.engine ?? "deterministic").toBe("deterministic");
    expect(res.body.reply).toBeTruthy();
  });
});
