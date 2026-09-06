import { env } from "../env.js";
import type { Extraction } from "./schema.js";
import { railbookSystemPrompt, llmUserPayload } from "./prompt.js";
import { parseLlmJson } from "./parse-json.js";

export function aiConfigured(): boolean {
  return Boolean(env.nvidiaApiKey);
}

export type AiAttempt = {
  model: string;
  latencyMs: number;
  status: number | null;
  ok: boolean;
  failureReason: string | null;
};

export type LlmOutcome = {
  extraction: Extraction | null;
  source: "ai" | null;
  provider: "nvidia" | null;
  modelUsed: string | null;
  fallbackAttempt: number;
  latencyMs: number;
  failureReason: string | null;
  attempts: AiAttempt[];
};

function chatUrl(): string {
  return `${env.nvidiaBaseUrl.replace(/\/$/, "")}/chat/completions`;
}

function parseContent(content: string): Extraction | null {
  return parseLlmJson(content);
}

type ChatMessage = {
  content?: string | null;
  reasoning_content?: string | null;
};

function extractionFromMessage(msg: ChatMessage | undefined): Extraction | null {
  if (!msg) return null;
  for (const part of [msg.content, msg.reasoning_content]) {
    if (typeof part === "string" && part.trim()) {
      const parsed = parseContent(part);
      if (parsed) return parsed;
    }
  }
  return null;
}

function logAttempt(attempt: AiAttempt): void {
  const bits = [
    "provider=nvidia",
    `model=${attempt.model}`,
    `latency=${attempt.latencyMs}ms`,
    attempt.status != null ? `status=${attempt.status}` : null,
    `ok=${attempt.ok}`,
    attempt.failureReason ? `reason=${attempt.failureReason}` : null,
  ].filter(Boolean);
  console.error(`[nvidia] ${bits.join(" ")}`);
}

function emptyOutcome(failureReason: string | null, extra: Partial<LlmOutcome> = {}): LlmOutcome {
  return {
    extraction: null,
    source: null,
    provider: extra.provider ?? null,
    modelUsed: extra.modelUsed ?? null,
    fallbackAttempt: 0,
    latencyMs: extra.latencyMs ?? 0,
    failureReason,
    attempts: extra.attempts ?? [],
  };
}

export async function extractWithLlm(input: {
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
}): Promise<LlmOutcome> {
  const apiKey = env.nvidiaApiKey;
  if (!apiKey) return emptyOutcome("missing_key");
  const model = env.nluModel; // NLU/fallback layer — NVIDIA_MODEL (primary planner) se alag ho sakta hai
  const timeoutMs = env.aiRequestTimeoutMs;
  const messages = [
    { role: "system", content: railbookSystemPrompt(input.today) },
    { role: "user", content: llmUserPayload(input) },
  ];

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // gpt-oss is a reasoning model: cap tokens and force JSON so CoT cannot eat the timeout.
  // reasoning_effort GPT-OSS family specific hai — any other NLU model ko nahi bhejte.
  const payload = {
    model,
    temperature: 0,
    ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" as const } : {}),
    max_tokens: 768,
    response_format: { type: "json_object" },
    messages,
  };

  try {
    const res = await fetch(chatUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const attempt: AiAttempt = {
        model,
        latencyMs,
        status: res.status,
        ok: false,
        failureReason: `http_${res.status}`,
      };
      logAttempt(attempt);
      return emptyOutcome(attempt.failureReason, { provider: "nvidia", modelUsed: model, latencyMs, attempts: [attempt] });
    }
    const json = (await res.json()) as {
      model?: string;
      choices?: { message?: ChatMessage }[];
    };
    const used = typeof json.model === "string" && json.model.trim() ? json.model.trim() : model;
    const parsed = extractionFromMessage(json.choices?.[0]?.message);
    if (!parsed) {
      const msg = json.choices?.[0]?.message;
      const hasText = Boolean(msg?.content?.trim() || msg?.reasoning_content?.trim());
      const failureReason = hasText ? "malformed_response" : "empty_content";
      const attempt: AiAttempt = { model: used, latencyMs, status: res.status, ok: false, failureReason };
      logAttempt(attempt);
      return emptyOutcome(failureReason, { provider: "nvidia", modelUsed: used, latencyMs, attempts: [attempt] });
    }
    const attempt: AiAttempt = { model: used, latencyMs, status: res.status, ok: true, failureReason: null };
    logAttempt(attempt);
    return {
      extraction: parsed,
      source: "ai",
      provider: "nvidia",
      modelUsed: used,
      fallbackAttempt: 0,
      latencyMs,
      failureReason: null,
      attempts: [attempt],
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const name = err instanceof Error ? err.name : "error";
    const failureReason = name === "AbortError" ? "timeout" : "network";
    const attempt: AiAttempt = { model, latencyMs, status: null, ok: false, failureReason };
    logAttempt(attempt);
    return emptyOutcome(failureReason, { provider: "nvidia", modelUsed: model, latencyMs, attempts: [attempt] });
  } finally {
    clearTimeout(timer);
  }
}

/* ── GENERAL RAILWAY QA (user request 2026-09-06 round-4: "jaise ChatGPT
 * answer karta hai — AI ke paas har cheez ka answer ho"). Ye Wahi NLU
 * provider/model (NVIDIA, env.nluModel) reuse karta hai — koi alag model
 * nahi. Sirf tab chalta hai jab KB + web dono fail ho jayein; live data
 * (status/fare/seats/PNR) par KABHI nahi (rule 15) — wo sirf API se. */

let generalQaFetch: typeof fetch | null = null;

/** Test hook — LLM HTTP call inject karne ke liye (websearch setWebFetch jaisa). */
export function setLlmFetch(fn: typeof fetch | null): void {
  generalQaFetch = fn;
}

const RAILBOOK_QA_PROMPT = [
  "Tu RailBook hai — Indian Railways ka expert assistant. Hinglish (Roman Hindi) mein baat karta hai.",
  "User ka GENERAL railway/trains sawaal hai. 3-6 lines mein seedha, saaf jawab de — Hinglish (Roman script) mein.",
  "Rules:",
  "- Sirf well-established, stable railway facts bata (classes, history, rules, famous trains, technology, zones).",
  "- Koi exact number ya fact GUESS mat kar — jo confidently pata nahi, wo mat bata.",
  "- Superlative claims (sabse tez/lambi/badi train, sabse bada station) par EXTRA careful — naam bilkul sure ho tabhi bata, warna bol ke user web se verify kare.",
  "- LIVE data (running status, aaj ka delay, current fare, seat availability, PNR status) kabhi guess nahi — bol de ki ye live API se poochha jaata hai.",
  "- Agar poora jawab hi reliably nahi pata, seedha bol: \"Ye main abhi confirm nahi kar paya.\"",
  "- Sirf user ke pooche sawaal ka jawab de — koi booking form ya extra sawaal nahi.",
].join("\n");

export async function generalRailwayAnswer(question: string): Promise<string | null> {
  const apiKey = env.nvidiaApiKey;
  const model = env.nluModel;
  /* Test-hook set ho to env-key check skip (prod mein hook null hota hai
   * aur wahi env-gate lagta hai). */
  if (!generalQaFetch && (!apiKey || !model)) return null;
  const q = question.trim().slice(0, 500);
  if (!q) return null;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const payload = {
      model,
      temperature: 0,
      ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" as const } : {}),
      max_tokens: 500,
      messages: [
        { role: "system", content: RAILBOOK_QA_PROMPT },
        { role: "user", content: q },
      ],
    };
    const res = await (generalQaFetch ?? fetch)(chatUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[nvidia-qa] status=${res.status} latency=${Date.now() - started}ms`);
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (text.length < 10) return null;
    console.error(`[nvidia-qa] ok latency=${Date.now() - started}ms chars=${text.length}`);
    return text;
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    console.error(`[nvidia-qa] fail reason=${name === "AbortError" ? "timeout" : "network"} latency=${Date.now() - started}ms`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
