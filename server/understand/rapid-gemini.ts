import { env } from "../env.js";
import type { Extraction } from "./schema.js";
import { railbookSystemPrompt, llmUserPayload } from "./prompt.js";
import { parseLlmJson } from "./parse-json.js";
import { geminiSafetyOk, sanitizeShadowExtraction } from "./safety.js";
import type { ExtractInput } from "./gemini.js";

export type RapidGeminiOutcome = {
  extraction: Extraction | null;
  source: "ai" | null;
  provider: "rapidapi-gemini" | null;
  modelUsed: string | null;
  latencyMs: number;
  httpStatus: number | null;
  failureReason: string | null;
  executeTools: false;
  confirmBook: false;
  safetyOk: boolean;
};

function emptyOutcome(failureReason: string | null, extra: Partial<RapidGeminiOutcome> = {}): RapidGeminiOutcome {
  return {
    extraction: null,
    source: null,
    provider: extra.provider ?? "rapidapi-gemini",
    modelUsed: extra.modelUsed ?? null,
    latencyMs: extra.latencyMs ?? 0,
    httpStatus: extra.httpStatus ?? null,
    failureReason,
    executeTools: false,
    confirmBook: false,
    safetyOk: true,
  };
}

function logAttempt(bits: Record<string, string | number | null | boolean>): void {
  const parts = Object.entries(bits)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  console.error(`[rapidapi-gemini-shadow] ${parts.join(" ")}`);
}

function textFromBody(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const o = json as Record<string, unknown>;
  const candidates = Array.isArray(o.candidates) ? o.candidates : [];
  if (candidates[0] && typeof candidates[0] === "object") {
    const content = (candidates[0] as Record<string, unknown>).content;
    if (content && typeof content === "object") {
      const parts = Array.isArray((content as Record<string, unknown>).parts)
        ? ((content as Record<string, unknown>).parts as unknown[])
        : [];
      const texts = parts
        .map((p) => (p && typeof p === "object" ? String((p as { text?: unknown }).text ?? "") : ""))
        .filter(Boolean);
      if (texts.length) return texts.join("\n");
    }
  }
  const choices = Array.isArray(o.choices) ? o.choices : [];
  if (choices[0] && typeof choices[0] === "object") {
    const msg = (choices[0] as Record<string, unknown>).message;
    if (msg && typeof msg === "object") {
      const c = (msg as { content?: unknown }).content;
      if (typeof c === "string") return c;
    }
    if (typeof (choices[0] as { text?: unknown }).text === "string") {
      return String((choices[0] as { text: string }).text);
    }
  }
  for (const k of ["text", "result", "output", "response", "message"]) {
    if (typeof o[k] === "string" && (o[k] as string).trim()) return o[k] as string;
  }
  return "";
}

/**
 * Shadow-only RapidAPI Gemini Pro AI New extraction.
 * Never books, never charges, never mutates state, never selected as production provider.
 */
export async function extractWithRapidGemini(input: ExtractInput): Promise<RapidGeminiOutcome> {
  const apiKey = env.rapidapiGeminiKey;
  if (!apiKey) return emptyOutcome("missing_key");
  const host = env.rapidapiGeminiHost;
  const url = env.rapidapiGeminiUrl;
  const model = env.rapidapiGeminiModel;
  const timeoutMs = Math.max(env.aiRequestTimeoutMs, Number(process.env.RAPIDAPI_GEMINI_EVAL_TIMEOUT_MS ?? 0) || 0);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || env.aiRequestTimeoutMs);

  const prompt = `${railbookSystemPrompt(input.today)}\n\nUser payload:\n${llmUserPayload(input)}`;
  const payload = {
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": host,
        "x-rapidapi-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      logAttempt({
        provider: "rapidapi-gemini",
        host,
        model,
        latency: latencyMs,
        status: res.status,
        ok: false,
        reason: `http_${res.status}`,
      });
      return emptyOutcome(`http_${res.status}`, {
        provider: "rapidapi-gemini",
        modelUsed: model,
        latencyMs,
        httpStatus: res.status,
      });
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      logAttempt({ provider: "rapidapi-gemini", model, latency: latencyMs, status: res.status, ok: false, reason: "malformed_response" });
      return emptyOutcome("malformed_response", { modelUsed: model, latencyMs, httpStatus: res.status });
    }
    const rawText = textFromBody(json);
    const parsed = rawText ? parseLlmJson(rawText) : null;
    if (!parsed) {
      logAttempt({
        provider: "rapidapi-gemini",
        model,
        latency: latencyMs,
        status: res.status,
        ok: false,
        reason: rawText ? "malformed_response" : "empty_content",
      });
      return emptyOutcome(rawText ? "malformed_response" : "empty_content", {
        modelUsed: model,
        latencyMs,
        httpStatus: res.status,
      });
    }
    const safe = sanitizeShadowExtraction(parsed);
    logAttempt({ provider: "rapidapi-gemini", model, latency: latencyMs, status: res.status, ok: true });
    return {
      extraction: safe,
      source: "ai",
      provider: "rapidapi-gemini",
      modelUsed: model,
      latencyMs,
      httpStatus: res.status,
      failureReason: null,
      executeTools: false,
      confirmBook: false,
      safetyOk: geminiSafetyOk(parsed),
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const name = err instanceof Error ? err.name : "error";
    const failureReason = name === "AbortError" ? "timeout" : "network";
    logAttempt({ provider: "rapidapi-gemini", model, latency: latencyMs, ok: false, reason: failureReason });
    return emptyOutcome(failureReason, { modelUsed: model, latencyMs });
  } finally {
    clearTimeout(timer);
  }
}
