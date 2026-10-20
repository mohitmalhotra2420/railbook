/**
 * Tool-proof gate + LLM-as-brain tests (2026-10-20).
 *
 * Model scripted hai (setAgenticNvidiaFetch) — real tool execution mock provider par hota hai.
 * Assertions: (a) sahi tool choice (station board → GET_STATION_BOARD, cancelled → GET_CANCELLED_TRAINS),
 * (b) fare/seat/train-fact ka numeric/status claim bina successful tool ke nahi jaata,
 * (c) clarification aur general-knowledge sawaal par gate nahi chalta, (d) seat adequacy tokens.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENTIC_TOOLS,
  PROOF_TOOLS,
  _clearModelHealth,
  hasToolProof,
  replyHasFactClaim,
  requiredProofFamily,
  runAgenticTurn,
  setAgenticNvidiaFetch,
  type ToolTraceStep,
} from "../server/agent/agentic";
import { replyAdequateFor45 } from "../server/agent/run";
import { setProvider } from "../server/providers/index";

const NOW = "2026-10-20T10:00:00+05:30";
const CHAIN = "gpt-oss:120b,gpt-oss:20b,gemma4:31b";

function toolResp(name: string, args: unknown) {
  const id = `call_${name.toLowerCase()}`;
  return new Response(
    JSON.stringify({
      model: "gpt-oss:120b",
      choices: [{ message: { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
function textResp(content: string) {
  return new Response(JSON.stringify({ model: "gpt-oss:120b", choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Har model call ke liye ek scripted response. Khatam ho jaye to aakhri response repeat. */
function scripted(responses: (() => Response)[]) {
  const bodies: any[] = [];
  setAgenticNvidiaFetch(async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const i = Math.min(bodies.length - 1, responses.length - 1);
    return responses[i]();
  });
  return bodies;
}

/** Koi bhi corrective SYSTEM CHECK (tool-proof ya zero-tool) model ko gaya? */
const sawProofRepair = (bodies: any[]) =>
  bodies.some((b) => (b.messages ?? []).some((m: any) => m.role === "user" && String(m.content).includes("SYSTEM CHECK")));

describe("tool-proof: intent → family", () => {
  it.each([
    ["Ludhiana junction station board batao", "station_board"],
    ["LDH station par kaun si trains aa rahi hain", "station_board"],
    ["kal ke cancelled trains batao", "cancelled"],
    ["12014 ka CC fare kitna hai", "fare"],
    ["12014 ki CC seat availability 21 October", "seat"],
    ["12014 kahan hai abhi", "train_fact"],
  ])("%s → %s", (text, fam) => {
    expect(requiredProofFamily(text)).toBe(fam);
  });

  it.each([
    "Amritsar se Delhi trains batao",
    "12014 ko CC me book kar do",
    "WL ka matlab kya hota hai",
    "tatkal kya hai",
  ])("no proof family for: %s", (text) => {
    expect(requiredProofFamily(text)).toBeNull();
  });
});

describe("tool-proof: claim detection and proof check", () => {
  it("detects fact claims (fare, status, time, train no.)", () => {
    expect(replyHasFactClaim("CC fare ₹1,175 hai")).toBe(true);
    expect(replyHasFactClaim("21 Oct ko AVL 12 hai")).toBe(true);
    expect(replyHasFactClaim("Train 16:30 par chalegi")).toBe(true);
    expect(replyHasFactClaim("Kitne passengers honge?")).toBe(false);
  });

  it("proof needs an OK step from the same family", () => {
    const fail: ToolTraceStep = { step: 1, tool: "GET_FARE", args: {}, ok: false, source: null, summary: "x", latencyMs: 1 };
    const okOther: ToolTraceStep = { step: 2, tool: "SEARCH_STATIONS", args: {}, ok: true, source: null, summary: "x", latencyMs: 1 };
    const okFare: ToolTraceStep = { step: 3, tool: "GET_FARE", args: {}, ok: true, source: null, summary: "x", latencyMs: 1 };
    expect(hasToolProof("fare", [fail, okOther])).toBe(false);
    expect(hasToolProof("fare", [okFare])).toBe(true);
    expect(hasToolProof("station_board", [okFare])).toBe(false);
  });

  it("tool specs: station board and cancelled-trains descriptions name the right tool", () => {
    const byName = (n: string) => AGENTIC_TOOLS.find((t) => t.function.name === n)!.function.description ?? "";
    expect(byName("GET_STATION_BOARD")).toMatch(/station board/i);
    expect(byName("SEARCH_STATIONS")).toMatch(/GET_STATION_BOARD/);
    expect(byName("GET_CANCELLED_TRAINS")).toMatch(/kal/);
    expect(PROOF_TOOLS.station_board).toEqual(["GET_STATION_BOARD"]);
  });
});

describe("tool-proof: integration with scripted model", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    _clearModelHealth();
    process.env.AI_LLM_BASE_URL = "https://ollama.com/v1";
    process.env.AI_LLM_API_KEY = "test_key_not_real";
    process.env.AI_LLM_MODELS = CHAIN;
    process.env.RAILWAY_PROVIDER = "mock";
    setProvider(null);
  });
  afterEach(() => {
    setAgenticNvidiaFetch(null);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setProvider(null);
  });

  it("fare claim without a tool → corrective round → model calls GET_FARE and answers", async () => {
    const bodies = scripted([
      () => textResp("12014 CC ka fare ₹1,175 hai."),
      () => toolResp("GET_FARE", { train_number: "12014", date: "2026-10-21", origin: "ASR", destination: "NDLS", class_code: "CC" }),
      () => textResp("12014 CC fare tool ke hisaab se ₹1,125 base hai."),
    ]);
    const turn = await runAgenticTurn({ text: "12014 ka CC fare 21 October Amritsar se Delhi, 1 passenger", now: NOW, known: { passengers: 1, dateProvided: true, date: "2026-10-21" } });
    expect(sawProofRepair(bodies)).toBe(true);
    expect(turn.steps.map((s) => s.tool)).toContain("GET_FARE");
    expect(turn.reply).toContain("₹1,125");
    expect(turn.failureReason).not.toBe("tool_proof_missing");
  });

  it("fare claim repeated with no tool → honest 'verified nahi' reply, no invented fare", async () => {
    scripted([() => textResp("12014 CC ka fare ₹1,175 hai, seat AVL 12 hai.")]);
    const turn = await runAgenticTurn({ text: "12014 ka CC fare 21 October Amritsar se Delhi, 1 passenger", now: NOW, known: { passengers: 1, dateProvided: true, date: "2026-10-21" } });
    expect(turn.failureReason).toBe("tool_proof_missing");
    expect(turn.grounded).toBe(false);
    expect(turn.reply).not.toContain("1,175");
    expect(turn.reply).toMatch(/verified data/);
  });

  it("station board: SEARCH_STATIONS then board-like claim → repair → GET_STATION_BOARD is called", async () => {
    const bodies = scripted([
      () => toolResp("SEARCH_STATIONS", { query: "Ludhiana" }),
      () => textResp("LDH par 10:30 par ek train aayegi."),
      () => toolResp("GET_STATION_BOARD", { station_code: "LDH", hours: 2 }),
      () => textResp("LDH station board: agle 2 ghante mein trains ka list tool se."),
    ]);
    const turn = await runAgenticTurn({ text: "Ludhiana junction station board batao", now: NOW, known: {} });
    expect(sawProofRepair(bodies)).toBe(true);
    expect(turn.steps.map((s) => s.tool)).toContain("GET_STATION_BOARD");
  });

  it("station board: model goes straight to SEARCH_STATIONS and stops → no 'board' claim accepted", async () => {
    scripted([() => toolResp("SEARCH_STATIONS", { query: "Ludhiana" }), () => textResp("Station code LDH hai.")]);
    const turn = await runAgenticTurn({ text: "Ludhiana junction station board", now: NOW, known: {} });
    // Code-only reply: koi fact claim nahi → gate nahi chalta, lekin GET_STATION_BOARD ka claim bhi nahi hai.
    expect(turn.steps.map((s) => s.tool)).not.toContain("GET_STATION_BOARD");
    expect(turn.reply).toMatch(/LDH/);
  });

  it("cancelled trains 'kal' → model calls GET_CANCELLED_TRAINS (no refusal, no extra repair)", async () => {
    const bodies = scripted([
      () => toolResp("GET_CANCELLED_TRAINS", {}),
      () => textResp("Ye aaj ki cancelled trains ki list hai. Kal ki list abhi tool se nahi aati."),
    ]);
    const turn = await runAgenticTurn({ text: "kal ke cancelled trains batao", now: NOW, known: {} });
    expect(turn.steps.map((s) => s.tool)).toContain("GET_CANCELLED_TRAINS");
    expect(sawProofRepair(bodies)).toBe(false);
  });

  it("passenger clarification on fare → no repair, reply kept as-is", async () => {
    const bodies = scripted([() => textResp("Kitne passengers ke liye fare chahiye?")]);
    const turn = await runAgenticTurn({ text: "12014 ka CC fare batao 21 October", now: NOW, known: { dateProvided: true, date: "2026-10-21" } });
    expect(bodies.length).toBe(1);
    expect(turn.reply).toMatch(/passengers/);
  });

  it("general knowledge ('WL kya hota hai') is exempt from the proof gate", async () => {
    const bodies = scripted([() => textResp("WL ka matlab waiting list hai; confirm hone par seat milti hai.")]);
    const turn = await runAgenticTurn({ text: "WL kya hota hai", now: NOW, known: {} });
    // KB authoritative early-return ho sakta hai (model call 0) — dono me gate nahi chalta.
    expect(bodies.length).toBeLessThanOrEqual(1);
    expect(sawProofRepair(bodies)).toBe(false);
    expect(turn.failureReason).not.toBe("tool_proof_missing");
  });
});

describe("LLM-first adequacy (seat replies)", () => {
  it("accepts AVL / CNF / WL status tokens as adequate seat answers", () => {
    expect(replyAdequateFor45("seat", "12014 CC: 21 Oct AVL 12 · ₹1125", "12014 CC seat 21 Oct")).toBe(true);
    expect(replyAdequateFor45("seat", "22 Oct CC CNF, WL 4 bhi hai", "12014 CC seat 22 Oct")).toBe(true);
    expect(replyAdequateFor45("seat", "Kuch pata nahi, andaza nahi lagaunga.", "12014 CC seat 22 Oct")).toBe(false);
  });
});

describe("runAgent: LLM-first adequacy retry (no deterministic rescue when the model can answer)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    _clearModelHealth();
    process.env.AI_LLM_BASE_URL = "https://ollama.com/v1";
    process.env.AI_LLM_API_KEY = "test_key_not_real";
    process.env.AI_LLM_MODELS = CHAIN;
    process.env.RAILWAY_PROVIDER = "mock";
    setProvider(null);
  });
  afterEach(() => {
    setAgenticNvidiaFetch(null);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setProvider(null);
  });

  it("inadequate first seat reply → model retry with a tool → model's own answer is kept (engine agentic)", async () => {
    const { runAgent } = await import("../server/agent/run");
    const bodies = scripted([
      () => textResp("Kuch pata nahi, andaza nahi lagaunga."),
      () => toolResp("CHECK_AVAILABILITY", { train_number: "12014", date: "2026-10-21", origin: "ASR", destination: "NDLS", class_code: "CC" }),
      () => textResp("12014 CC 21 Oct: AVL 12 · ₹1125 (tool data)."),
    ]);
    const res = await runAgent({
      text: "12014 ki CC seat availability 21 October ASR se NDLS, 1 passenger",
      now: NOW,
      history: [],
    } as never);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(String(res.reply)).not.toMatch(/andaza nahi lagaunga/);
    expect(res.engine).toBe("agentic_tool_calling");
  });
});

describe("every approved tool is dispatchable by the orchestrator", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    _clearModelHealth();
    process.env.AI_LLM_BASE_URL = "https://ollama.com/v1";
    process.env.AI_LLM_API_KEY = "test_key_not_real";
    process.env.AI_LLM_MODELS = CHAIN;
    process.env.RAILWAY_PROVIDER = "mock";
    setProvider(null);
  });
  afterEach(() => {
    setAgenticNvidiaFetch(null);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setProvider(null);
  });

  const names = AGENTIC_TOOLS.map((t) => t.function.name);
  it.each(names)("%s is called by the model and the step is recorded (no unknown-tool path)", async (name) => {
    let calls = 0;
    setAgenticNvidiaFetch(async () => {
      calls += 1;
      if (calls === 1) return toolResp(name, {});
      return textResp("Ok.");
    });
    const turn = await runAgenticTurn({ text: `zz-wiring-check ${names.indexOf(name)}`, now: NOW, known: {} });
    const step = turn.steps.find((s) => s.tool === name);
    expect(step, `step for ${name}`).toBeTruthy();
    expect(String(step!.summary)).not.toMatch(/unknown tool|not approved/i);
  });
});
