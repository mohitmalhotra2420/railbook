import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _clearModelHealth, runAgenticTurn, setAgenticNvidiaFetch } from "../server/agent/agentic";
import { setProvider } from "../server/providers/index";

const CHAIN = ["gpt-oss:120b", "gpt-oss:20b", "gemma4:31b"];
const NOW = "2026-10-20T10:00:00+05:30";

function ok(model: string) {
  return new Response(JSON.stringify({ model, choices: [{ message: { content: "Theek hai." } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AI_LLM_MODELS chain (ordered primary -> fallback -> next)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    _clearModelHealth(); // health ordering state ko test ke beech leak mat hone do
    process.env.AI_LLM_BASE_URL = "https://ollama.com/v1";
    process.env.AI_LLM_API_KEY = "test_key_not_real";
    process.env.AI_LLM_MODELS = CHAIN.join(",");
    process.env.RAILWAY_PROVIDER = "mock";
    setProvider(null);
  });
  afterEach(() => {
    setAgenticNvidiaFetch(null);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    setProvider(null);
  });

  it("tries all three models in order when the first two fail", async () => {
    const seen: string[] = [];
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      seen.push(body.model);
      if (body.model === "gemma4:31b") return ok(body.model);
      return new Response(JSON.stringify({ error: "upstream" }), { status: 503 });
    });
    const turn = await runAgenticTurn({ text: "hello", now: NOW, known: {} });
    expect(seen.slice(0, 3)).toEqual(CHAIN);
    expect(turn.reply).toBeTruthy();
  });

  it("stops at the primary when it answers (no extra model calls)", async () => {
    const seen: string[] = [];
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      seen.push(body.model);
      return ok(body.model);
    });
    await runAgenticTurn({ text: "hello", now: NOW, known: {} });
    expect(seen[0]).toBe("gpt-oss:120b");
    expect(seen.every((m) => m === "gpt-oss:120b")).toBe(true);
  });
});
