/** NVIDIA answers a railway question using ONLY RailCore/RailKit JSON. Never invents. */
import { env } from "../env.js";
import { stripFences } from "./parse-json.js";

export function shouldGroundFact(text: string, lastFactTrain?: string | null): { train: string } | null {
  const t = text.toLowerCase();
  const nums = [...t.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
  const train = nums[0] || (lastFactTrain ?? "").trim() || "";
  if (!/^\d{5}$/.test(train)) return null;
  if (
    /\b(jana hai|jaana hai|ticket|tickets|book kar|book kardo)\b/.test(t) &&
    !/\b(jaati|jati|rukti|kitne|kahan|kaha|late|fare|seat|available|route|time|halt)\b/.test(t)
  ) {
    return null;
  }
  return { train };
}

export function compactScheduleEvidence(schedule: {
  trainNumber?: string;
  trainName?: string;
  stops?: { code?: string; name?: string; arrival?: string | null; departure?: string | null }[];
} | null): unknown {
  if (!schedule) return null;
  const stops = (schedule.stops ?? []).slice(0, 40).map((s) => ({
    code: s.code,
    name: s.name,
    arrival: s.arrival ?? null,
    departure: s.departure ?? null,
  }));
  return {
    trainNumber: schedule.trainNumber,
    trainName: schedule.trainName,
    first: stops[0] ?? null,
    last: stops[stops.length - 1] ?? null,
    stopCount: stops.length,
    stops,
  };
}

function parseReply(content: string): string | null {
  const raw = stripFences(content);
  try {
    const obj = JSON.parse(raw) as { reply?: unknown };
    if (typeof obj.reply === "string" && obj.reply.trim()) return obj.reply.trim().slice(0, 800);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const obj = JSON.parse(raw.slice(start, end + 1)) as { reply?: unknown };
        if (typeof obj.reply === "string" && obj.reply.trim()) return obj.reply.trim().slice(0, 800);
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

export async function answerFromEvidence(input: {
  question: string;
  evidence: unknown;
  today: string;
}): Promise<{ reply: string | null; latencyMs: number; ok: boolean }> {
  if (process.env.VITEST) return { reply: null, latencyMs: 0, ok: false };
  const apiKey = env.nvidiaApiKey;
  if (!apiKey || !input.evidence) return { reply: null, latencyMs: 0, ok: false };

  const system = `You answer ONE railway question using ONLY the JSON evidence (RailCore/RailKit).
Today is ${input.today}.
You NEVER invent stops, fares, seats, live location, PNR, or wallet.
If the evidence does not contain the answer, say so in Hinglish — do not guess.
Yes/no questions start with Haan or Nahi.
2-4 short Hinglish sentences. Never book or charge.
Return ONLY JSON: {"reply":"..."}`;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(env.aiRequestTimeoutMs, 6000));
  try {
    const res = await fetch(`${env.nvidiaBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.nluModel, // NLU layer model
        temperature: 0,
        // reasoning_effort GPT-OSS family specific hai — any other model ko nahi.
        ...(env.nluModel.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
        max_tokens: 256,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({ question: input.question, evidence: input.evidence }),
          },
        ],
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { reply: null, latencyMs, ok: false };
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
    };
    const msg = json.choices?.[0]?.message;
    const reply = parseReply(msg?.content ?? "") || parseReply(msg?.reasoning_content ?? "");
    return { reply, latencyMs, ok: Boolean(reply) };
  } catch {
    return { reply: null, latencyMs: Date.now() - started, ok: false };
  } finally {
    clearTimeout(timer);
  }
}
