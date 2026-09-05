import { afterEach, describe, expect, it } from "vitest";
import { env } from "../server/env";
import { extractWithGemini } from "../server/understand/gemini";
import { runUnderstand } from "../server/understand/index";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";
import { geminiSafetyOk, isForbiddenMoneyTool, sanitizeShadowExtraction } from "../server/understand/safety";
import { parseExtraction } from "../server/understand/schema";
import { neverAutoBook } from "../src/ai/agent";

const NOW = new Date(2026, 7, 23);

function blank() {
  return { ...initialBooking("2026-08-23"), date: "" };
}

describe("Gemini is shadow-only and cannot take money", () => {
  afterEach(() => {
    delete process.env.GEMINI_SHADOW;
  });

  it("Production AI models intentional hain: primary planner DeepSeek, NLU/fallback GPT-OSS", () => {
    // 2026-09-05 intentional switch: DeepSeek V4 Flash primary planner (thinking off),
    // GPT-OSS-20B NLU/fallback layer par. Gemini/RapidAPI shadow-only guard intact.
    expect(env.nvidiaModel).toBe("deepseek-ai/deepseek-v4-flash-0731");
    expect(env.nluModel).toBe("openai/gpt-oss-20b");
    expect(env.geminiShadow).toBe(false);
  });

  it("Vitest never enables Gemini shadow even if a key is present", () => {
    process.env.GEMINI_API_KEY = "test-not-a-real-key";
    process.env.GEMINI_SHADOW = "1";
    expect(env.geminiShadow).toBe(false);
  });

  it("runUnderstand never returns provider=gemini", async () => {
    const res = await runUnderstand({
      text: "Mujhe Amritsar se Ludhiana jaana hai",
      now: NOW.toISOString(),
    });
    expect(res.provider === "gemini").toBe(false);
    expect(res.provider === "nvidia" || res.provider === null).toBe(true);
  });

  it("Haan book kar do never sets confirmBook from AI", () => {
    const turn = planTurn({
      text: "Haan book kar do",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.confirmBook).toBeFalsy();
    expect(neverAutoBook("BOOK_TRAIN", "FARE_REVIEW")).toBe(true);
  });

  it("forbidden money tools are rejected for Gemini", () => {
    expect(isForbiddenMoneyTool("confirmBooking")).toBe(true);
    expect(isForbiddenMoneyTool("debit")).toBe(true);
    expect(isForbiddenMoneyTool("addMoney")).toBe(true);
    expect(isForbiddenMoneyTool("getLiveStatus")).toBe(false);
    const raw = parseExtraction({
      intent: "BOOK_TRAIN",
      origin: "Amritsar",
      destination: "Ludhiana",
      tool: "confirmBooking",
      suggestedAction: "none",
      confidence: 0.9,
      clarificationNeeded: false,
      corrections: [],
      missingFields: [],
    });
    expect(raw).toBeTruthy();
    expect(geminiSafetyOk(raw)).toBe(false);
    const clean = sanitizeShadowExtraction(raw!);
    expect(clean.tool).toBeNull();
    expect(clean.confirmBook as unknown).toBeUndefined();
  });

  it("extractWithGemini without a key does not call the network", async () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "";
    let called = false;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    try {
      const out = await extractWithGemini({
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
      if (prev == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });

  it("Gemini model is configurable via GEMINI_MODEL", () => {
    const prev = process.env.GEMINI_MODEL;
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    expect(env.geminiModel).toBe("gemini-2.0-flash");
    if (prev == null) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prev;
  });
});
