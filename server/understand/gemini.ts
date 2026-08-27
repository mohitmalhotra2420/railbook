import { env } from "../env.js";
import type { Extraction } from "./schema.js";
import { railbookSystemPrompt, llmUserPayload } from "./prompt.js";
import { parseLlmJson } from "./parse-json.js";
import { geminiSafetyOk, sanitizeShadowExtraction } from "./safety.js";

export type GeminiAttempt = {
  model: string;
  latencyMs: number;
  status: number | null;
  ok: boolean;
  failureReason: string | null;
};

export type GeminiOutcome = {
  extraction: Extraction | null;
  source: "ai" | null;
  provider: "gemini" | null;
  modelUsed: string | null;
  latencyMs: number;
  failureReason: string | null;
  attempts: GeminiAttempt[];
  /** Always true for the customer path — Gemini never executes. */
  executeTools: false;
  confirmBook: false;
  safetyOk: boolean;
};

export type ExtractInput = {
  text: string;
  today: string;
  lastAsked: string | null;
  known: {
    origin?: string;
    destination?: string;
    date?: string;
    passengers?: number;
    class?: string;
  };
};

function emptyOutcome(failureReason: string | null, extra: Partial<GeminiOutcome> = {}): GeminiOutcome {
  return {
    extraction: null,
    source: null,
    provider: extra.provider ?? "gemini",
    modelUsed: extra.modelUsed ?? null,
    latencyMs: extra.latencyMs ?? 0,
    failureReason,
    attempts: extra.attempts ?? [],
    executeTools: false,
    confirmBook: false,
    safetyOk: true,
  };
}

function logAttempt(attempt: GeminiAttempt): void {
  const bits = [
    "provider=gemini",
    `model=${attempt.model}`,
    `latency=${attempt.latencyMs}ms`,
    attempt.status != null ? `status=${attempt.status}` : null,
    `ok=${attempt.ok}`,
    attempt.failureReason ? `reason=${attempt.failureReason}` : null,
  ].filter(Boolean);
  console.error(`[gemini-shadow] ${bits.join(" ")}`);
}

function generateUrl(model: string): string {
  const base = env.geminiBaseUrl.replace(/\/$/, "");
  return `${base}/models/${encodeURIComponent(model)}:generateContent`;
}

function textFromGemini(json: unknown): string {
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const candidates = Array.isArray(root?.candidates) ? root!.candidates : [];
  const first = candidates[0] && typeof candidates[0] === "object" ? (candidates[0] as Record<string, unknown>) : null;
  const content = first?.content && typeof first.content === "object" ? (first.content as Record<string, unknown>) : null;
  const parts = Array.isArray(content?.parts) ? content!.parts : [];
  const texts: string[] = [];
  for (const part of parts) {
    if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      texts.push((part as { text: string }).text);
    }
  }
  return texts.join("\n").trim();
}

/**
 * Shadow-only Gemini extraction. Never books, never charges, never mutates state.
 * Callers must not feed this extraction into planTurn / applyTurn / wallet / booking.
 */
export async function extractWithGemini(input: ExtractInput): Promise<GeminiOutcome> {
  const apiKey = env.geminiApiKey;
  if (!apiKey) return emptyOutcome("missing_key");
  const model = env.geminiModel;
  const timeoutMs = Math.max(env.aiRequestTimeoutMs, Number(process.env.GEMINI_EVAL_TIMEOUT_MS ?? 0) || 0);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || env.aiRequestTimeoutMs);

  const payload = {
    system_instruction: { parts: [{ text: railbookSystemPrompt(input.today) }] },
    contents: [{ role: "user", parts: [{ text: llmUserPayload(input) }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  };

  try {
    const res = await fetch(generateUrl(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const attempt: GeminiAttempt = {
        model,
        latencyMs,
        status: res.status,
        ok: false,
        failureReason: `http_${res.status}`,
      };
      logAttempt(attempt);
      return emptyOutcome(attempt.failureReason, { provider: "gemini", modelUsed: model, latencyMs, attempts: [attempt] });
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      const attempt: GeminiAttempt = { model, latencyMs, status: res.status, ok: false, failureReason: "malformed_response" };
      logAttempt(attempt);
      return emptyOutcome("malformed_response", { provider: "gemini", modelUsed: model, latencyMs, attempts: [attempt] });
    }
    const rawText = textFromGemini(json);
    const parsed = rawText ? parseLlmJson(rawText) : null;
    if (!parsed) {
      const attempt: GeminiAttempt = {
        model,
        latencyMs,
        status: res.status,
        ok: false,
        failureReason: rawText ? "malformed_response" : "empty_content",
      };
      logAttempt(attempt);
      return emptyOutcome(attempt.failureReason, { provider: "gemini", modelUsed: model, latencyMs, attempts: [attempt] });
    }
    const safe = sanitizeShadowExtraction(parsed);
    const safetyOk = geminiSafetyOk(parsed);
    const attempt: GeminiAttempt = { model, latencyMs, status: res.status, ok: true, failureReason: null };
    logAttempt(attempt);
    return {
      extraction: safe,
      source: "ai",
      provider: "gemini",
      modelUsed: model,
      latencyMs,
      failureReason: null,
      attempts: [attempt],
      executeTools: false,
      confirmBook: false,
      safetyOk,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const name = err instanceof Error ? err.name : "error";
    const failureReason = name === "AbortError" ? "timeout" : "network";
    const attempt: GeminiAttempt = { model, latencyMs, status: null, ok: false, failureReason };
    logAttempt(attempt);
    return emptyOutcome(failureReason, { provider: "gemini", modelUsed: model, latencyMs, attempts: [attempt] });
  } finally {
    clearTimeout(timer);
  }
}
