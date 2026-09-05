import { afterEach, describe, expect, it } from "vitest";
import { env } from "../server/env";
import { extractWithRapidGemini } from "../server/understand/rapid-gemini";
import { runUnderstand } from "../server/understand/index";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";
import { neverAutoBook } from "../src/ai/agent";

const NOW = new Date(2026, 7, 23);

describe("RapidAPI Gemini is shadow-only", () => {
  afterEach(() => {
    delete process.env.RAPIDAPI_GEMINI_SHADOW;
  });

  it("Production models intentional hain (DeepSeek primary, GPT-OSS NLU); RapidAPI is not the default provider", () => {
    // 2026-09-05 intentional switch: DeepSeek V4 Flash primary planner, GPT-OSS NLU/fallback.
    expect(env.nvidiaModel).toBe("deepseek-ai/deepseek-v4-flash-0731");
    expect(env.nluModel).toBe("openai/gpt-oss-20b");
    expect(env.rapidapiGeminiShadow).toBe(false);
  });

  it("Vitest never enables RapidAPI shadow even if a key is present", () => {
    process.env.RAPIDAPI_GEMINI_KEY = "test-not-a-real-key";
    process.env.RAPIDAPI_GEMINI_SHADOW = "1";
    expect(env.rapidapiGeminiShadow).toBe(false);
  });

  it("runUnderstand never returns provider=rapidapi-gemini", async () => {
    const res = await runUnderstand({
      text: "Mujhe Amritsar se Ludhiana jaana hai",
      now: NOW.toISOString(),
    });
    expect(String(res.provider)).not.toBe("rapidapi-gemini");
    expect(res.provider === "nvidia" || res.provider === null).toBe(true);
  });

  it("Haan book kar do never sets confirmBook", () => {
    const turn = planTurn({
      text: "Haan book kar do",
      now: NOW,
      booking: { ...initialBooking("2026-08-23"), date: "" },
      prefs: {},
      saved: [],
    });
    expect(turn.confirmBook).toBeFalsy();
    expect(neverAutoBook("BOOK_TRAIN", "FARE_REVIEW")).toBe(true);
  });

  it("extractWithRapidGemini without a key does not call the network", async () => {
    const prev = process.env.RAPIDAPI_GEMINI_KEY;
    const prev2 = process.env.RAPIDAPI_KEY;
    process.env.RAPIDAPI_GEMINI_KEY = "";
    process.env.RAPIDAPI_KEY = "";
    let called = false;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    try {
      const out = await extractWithRapidGemini({
        text: "Haan book kar do",
        today: "2026-08-23",
        lastAsked: null,
        known: {},
      });
      expect(called).toBe(false);
      expect(out.extraction).toBeNull();
      expect(out.confirmBook).toBe(false);
      expect(out.executeTools).toBe(false);
      expect(out.failureReason).toBe("missing_key");
    } finally {
      globalThis.fetch = real;
      if (prev == null) delete process.env.RAPIDAPI_GEMINI_KEY;
      else process.env.RAPIDAPI_GEMINI_KEY = prev;
      if (prev2 == null) delete process.env.RAPIDAPI_KEY;
      else process.env.RAPIDAPI_KEY = prev2;
    }
  });

  it("RapidAPI host and model are environment-driven", () => {
    const prevH = process.env.RAPIDAPI_GEMINI_HOST;
    const prevM = process.env.RAPIDAPI_GEMINI_MODEL;
    process.env.RAPIDAPI_GEMINI_HOST = "gemini-pro-ai-new.p.rapidapi.com";
    process.env.RAPIDAPI_GEMINI_MODEL = "gemini-2.5-pro";
    expect(env.rapidapiGeminiHost).toBe("gemini-pro-ai-new.p.rapidapi.com");
    expect(env.rapidapiGeminiModel).toBe("gemini-2.5-pro");
    if (prevH == null) delete process.env.RAPIDAPI_GEMINI_HOST;
    else process.env.RAPIDAPI_GEMINI_HOST = prevH;
    if (prevM == null) delete process.env.RAPIDAPI_GEMINI_MODEL;
    else process.env.RAPIDAPI_GEMINI_MODEL = prevM;
  });
});
