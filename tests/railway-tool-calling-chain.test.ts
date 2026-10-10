/* Production LLM tool-calling chain — real loop, scripted NVIDIA model, mocked RailCore HTTP.
 * Verifies: railway read-only tools are sent to the model; Muse is primary and GPT-OSS is the
 * fallback; tool results go back to the model; unregistered tools never reach the provider;
 * the iteration limit is deterministic and reported as a typed orchestration error. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENTIC_MAX_STEPS, AGENTIC_TOOLS, runAgenticTurn, setAgenticNvidiaFetch } from "../server/agent/agentic";
import { OrchestrationError, StepBudgetExhaustedError, isOrchestrationError } from "../server/agent/orchestrationErrors";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setProvider } from "../server/providers/index";

const NOW = "2026-10-10T10:00:00+05:30";
const MUSE = "meta/muse-glimmer-30b";
const GPT = "openai/gpt-oss-20b";

/* Read-only railway tools that must be offered to the model (inline list for this test). */
const RAILWAY_READ_TOOLS = [
  "SEARCH_TRAINS",
  "GET_TRAIN_INFO",
  "GET_TIMETABLE",
  "CHECK_AVAILABILITY",
  "GET_FARE",
  "TRACK_TRAIN",
  "CHECK_PNR",
] as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function toolCallMsg(name: string, args: unknown, id = "c1") {
  return { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
}

function chat(model: string, message: unknown) {
  return jsonResponse(200, { model, choices: [{ message }] });
}

type Wire = { model: string; toolNames: string[]; messages: { role: string; content: unknown; name?: string }[] };

function scriptedModel(handler: (wire: Wire, index: number) => Response | Promise<Response>): { wires: Wire[] } {
  const wires: Wire[] = [];
  setAgenticNvidiaFetch(async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const wire: Wire = {
      model: body.model,
      toolNames: ((body.tools ?? []) as { function: { name: string } }[]).map((t) => t.function.name),
      messages: body.messages,
    };
    wires.push(wire);
    return handler(wire, wires.length);
  });
  return { wires };
}

describe("LLM tool-calling chain (production loop)", () => {
  beforeEach(() => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    process.env.RAILKIT_API_KEY = "";
    process.env.NVIDIA_API_KEY = "nvapi_test_key_not_real";
    process.env.NVIDIA_MODEL = MUSE;
    process.env.NVIDIA_FALLBACK_MODEL = GPT;
    process.env.AI_REQUEST_TIMEOUT_MS = "2000";
    setProvider(null);
  });

  afterEach(() => {
    setAgenticNvidiaFetch(null);
    setRailcoreFetch(null);
    process.env.RAILWAY_PROVIDER = "mock";
    process.env.RAILCORE_API_KEY = "";
    process.env.NVIDIA_API_KEY = "";
    setProvider(null);
  });

  it("every read-only railway tool is sent to the model, and no booking/payment tool is offered", () => {
    const sent = AGENTIC_TOOLS.map((t) => t.function.name);
    for (const name of RAILWAY_READ_TOOLS) expect(sent).toContain(name);
    expect(sent.filter((n) => /BOOK|PAYMENT|IRCTC|OTP|CAPTCHA|FINALI/i.test(n))).toEqual([]);
  });

  it("model chain: Muse is tried first, GPT-OSS is the fallback, and the request carries the tool definitions", async () => {
    setRailcoreFetch(async () => jsonResponse(500, {}));
    const { wires } = scriptedModel((w) => {
      if (w.model === MUSE) return jsonResponse(500, { error: "upstream" });
      return chat(GPT, { content: "Abhi fare ki jankari nahi mil paayi." });
    });
    const turn = await runAgenticTurn({ text: "12014 ka CC fare kitna hai", now: NOW, known: { passengers: 1 } });
    expect(wires[0].model).toBe(MUSE);
    expect(wires.some((w) => w.model === GPT)).toBe(true);
    for (const w of wires) expect(w.toolNames).toEqual(expect.arrayContaining([...RAILWAY_READ_TOOLS]));
    expect(turn.modelFallbacks?.some((f) => f.model === MUSE)).toBe(true);
  });

  it("tool call → real executor → tool result is returned to the model → model gives the final answer", async () => {
    let railcoreCalls = 0;
    setRailcoreFetch(async () => {
      railcoreCalls += 1;
      return jsonResponse(500, {});
    });
    const { wires } = scriptedModel((_w, i) => {
      if (i === 1) return chat(MUSE, toolCallMsg("GET_FARE", { train_number: "12014", class_code: "CC", date: "2026-10-11" }));
      return chat(MUSE, { content: "Fare abhi verified data se nahi mila." });
    });
    const turn = await runAgenticTurn({ text: "12014 ka CC fare kitna hai kal", now: NOW, known: { passengers: 1 } });
    expect(railcoreCalls).toBeGreaterThan(0); // the registered executor really ran
    expect(turn.steps[0]?.tool).toBe("GET_FARE");
    expect(turn.steps[0]?.ok).toBe(false); // provider failed → honest failure, not an invented fare
    const second = wires[1];
    expect(second).toBeTruthy();
    const toolMsg = second.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeTruthy();
    expect(String(toolMsg?.content)).not.toMatch(/₹\s?\d/); // no fare was invented
  });

  it("a tool the model invents (not registered) is rejected and never reaches the railway provider", async () => {
    const railPaths: string[] = [];
    setRailcoreFetch(async (input) => {
      railPaths.push(new URL(String(input)).pathname);
      return jsonResponse(500, {});
    });
    scriptedModel((_w, i) => {
      if (i === 1) return chat(MUSE, toolCallMsg("BOOK_TICKET", { train_number: "12014" }));
      return chat(MUSE, { content: "Ye action abhi available nahi hai." });
    });
    const turn = await runAgenticTurn({ text: "12014 book kar do", now: NOW, known: { passengers: 1 } });
    const bad = turn.steps.find((s) => s.tool === "BOOK_TICKET");
    expect(bad?.ok).toBe(false);
    // Pre-LLM schedule lookup for the train number is allowed; no booking/payment path may be hit.
    expect(railPaths.filter((p) => /book|reserv|payment|cancel/i.test(p))).toEqual([]);
  });

  it("iteration limit: a model that keeps requesting tools is stopped deterministically (no infinite loop)", async () => {
    setRailcoreFetch(async () => jsonResponse(500, {}));
    const { wires } = scriptedModel((_w, i) =>
      chat(MUSE, toolCallMsg("GET_FARE", { train_number: "12014", class_code: "CC", date: `2026-10-${String(10 + i).padStart(2, "0")}` }, `c${i}`)),
    );
    const turn = await runAgenticTurn({ text: "12014 ka CC fare kitna hai kal", now: NOW, known: { passengers: 1 } });
    expect(turn.failureReason).toBe("step_budget_exhausted"); // string kept for compatibility
    expect(turn.orchestrationError?.code).toBe("STEP_BUDGET_EXHAUSTED");
    expect(turn.orchestrationError?.maxSteps).toBe(AGENTIC_MAX_STEPS);
    expect(turn.steps.length).toBeLessThanOrEqual(AGENTIC_MAX_STEPS);
    expect(wires.length).toBeLessThanOrEqual(12); // bounded; repairs included
  });

  it("iteration limit is deterministic: identical scripted runs stop at the same step and model-call count", async () => {
    const run = async () => {
      setRailcoreFetch(async () => jsonResponse(500, {}));
      const { wires } = scriptedModel((_w, i) =>
        chat(MUSE, toolCallMsg("GET_FARE", { train_number: "12014", class_code: "CC", date: `2026-10-${String(10 + i).padStart(2, "0")}` }, `c${i}`)),
      );
      const turn = await runAgenticTurn({ text: "12014 ka CC fare kitna hai kal", now: NOW, known: { passengers: 1 } });
      return { calls: wires.length, steps: turn.steps.length, reason: turn.failureReason, err: turn.orchestrationError };
    };
    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
    expect(a.err?.stepsUsed).toBe(a.steps);
  });
});

describe("typed orchestration errors", () => {
  it("StepBudgetExhaustedError carries code, limits and a JSON-safe info object", () => {
    const err = new StepBudgetExhaustedError(6, 6);
    expect(err).toBeInstanceOf(OrchestrationError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StepBudgetExhaustedError");
    expect(err.code).toBe("STEP_BUDGET_EXHAUSTED");
    expect(err.maxSteps).toBe(6);
    expect(err.stepsUsed).toBe(6);
    const info = err.toInfo();
    expect(info).toEqual({ code: "STEP_BUDGET_EXHAUSTED", maxSteps: 6, stepsUsed: 6, message: err.message });
    expect(JSON.parse(JSON.stringify(info))).toEqual(info); // survives serialization (Error objects would not)
  });

  it("isOrchestrationError discriminates typed errors from plain errors and values", () => {
    expect(isOrchestrationError(new StepBudgetExhaustedError(6, 6))).toBe(true);
    expect(isOrchestrationError(new Error("boom"))).toBe(false);
    expect(isOrchestrationError({ code: "STEP_BUDGET_EXHAUSTED" })).toBe(false);
    expect(isOrchestrationError(null)).toBe(false);
  });

  it("AGENTIC_MAX_STEPS is the fixed limit the loop uses (6)", () => {
    expect(AGENTIC_MAX_STEPS).toBe(6);
  });
});
