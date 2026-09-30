/* ══ AI BOOKING — server-side VOICE (TTS) proxy (ADDITIVE, Round-62) ═══════════════════════════════════
 * User: "Voice ke liye dedicated adapter banao… Provider configurable hona chahiye. Do not hardcode
 * secret/API key in frontend. Secrets server-side environment variables me rahenge."
 *
 * Do endpoints, dono naye (maujooda koi route/behaviour nahi badla):
 *   GET  /api/voice/config → provider kaun hai (keys KABHI nahi, sirf naam/flags)
 *   POST /api/voice/tts    → { text, lang } → audio/mpeg  (server hi provider ko call karta hai)
 *
 * Default: kuch bhi configured nahi → `serverTts:false` + 501. Client us case me device ki
 * speechSynthesis (maujooda `speakGuide`) use karta hai — booking flow kabhi rukta nahi.
 *
 * Env (sab optional; Render dashboard me set karna hai):
 *   VOICE_TTS_PROVIDER = openai | elevenlabs | none        (default none)
 *   VOICE_TTS_API_KEY  = <provider key>                    (ya OPENAI_API_KEY / ELEVENLABS_API_KEY)
 *   VOICE_TTS_MODEL    = gpt-4o-mini-tts | eleven_multilingual_v2 … (optional)
 *   VOICE_TTS_VOICE    = alloy | Rachel …                 (optional)
 *   VOICE_TTS_BASE_URL = custom base (optional, self-hosted OpenAI-compatible)
 */
import type { Express, Request, Response } from "express";

const MAX_TEXT = 700;

type ProviderName = "openai" | "elevenlabs" | "none";

function providerName(): ProviderName {
  const raw = String(process.env.VOICE_TTS_PROVIDER ?? "none").trim().toLowerCase();
  if (raw === "openai" || raw === "elevenlabs") return raw;
  return "none";
}

function apiKeyFor(provider: ProviderName): string {
  const explicit = String(process.env.VOICE_TTS_API_KEY ?? "").trim();
  if (explicit) return explicit;
  if (provider === "openai") return String(process.env.OPENAI_API_KEY ?? "").trim();
  if (provider === "elevenlabs") return String(process.env.ELEVENLABS_API_KEY ?? "").trim();
  return "";
}

/** Config public shape — keys/paths kabhi expose nahi hote. */
export function voicePublicConfig(): {
  provider: string;
  serverTts: boolean;
  model: string | null;
  languages: string[];
} {
  const provider = providerName();
  const keyed = provider !== "none" && Boolean(apiKeyFor(provider));
  return {
    provider: provider === "none" ? "browser" : provider,
    serverTts: keyed,
    model: process.env.VOICE_TTS_MODEL?.trim() || (provider === "elevenlabs" ? "eleven_multilingual_v2" : provider === "openai" ? "gpt-4o-mini-tts" : null),
    languages: ["hi-IN", "en-IN"],
  };
}

async function synthOpenAi(text: string, lang: string, key: string): Promise<{ status: number; body: ArrayBuffer | string; contentType: string }> {
  const base = String(process.env.VOICE_TTS_BASE_URL ?? "").trim() || "https://api.openai.com/v1";
  const res = await fetch(`${base.replace(/\/$/, "")}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.VOICE_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
      voice: process.env.VOICE_TTS_VOICE?.trim() || "alloy",
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) return { status: res.status, body: await res.text().catch(() => ""), contentType: "application/json" };
  return { status: 200, body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
}

async function synthElevenLabs(text: string, key: string): Promise<{ status: number; body: ArrayBuffer | string; contentType: string }> {
  const voiceId = process.env.VOICE_TTS_VOICE?.trim() || "Rachel";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": key },
    body: JSON.stringify({
      text,
      model_id: process.env.VOICE_TTS_MODEL?.trim() || "eleven_multilingual_v2",
    }),
  });
  if (!res.ok) return { status: res.status, body: await res.text().catch(() => ""), contentType: "application/json" };
  return { status: 200, body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
}

/** Routes mount — app.ts me ek line se lagta hai (koi existing route chhua nahi jata). */
export function registerVoiceRoutes(app: Express): void {
  app.get("/api/voice/config", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(voicePublicConfig());
  });

  app.post("/api/voice/tts", async (req: Request, res: Response) => {
    const text = String((req.body as { text?: unknown })?.text ?? "").trim();
    const lang = String((req.body as { lang?: unknown })?.lang ?? "hi-IN");
    if (!text) {
      res.status(400).json({ error: "text is required." });
      return;
    }
    if (text.length > MAX_TEXT) {
      res.status(400).json({ error: `text too long (max ${MAX_TEXT} chars).` });
      return;
    }
    const provider = providerName();
    const key = apiKeyFor(provider);
    if (provider === "none" || !key) {
      res.status(501).json({
        error: "voice provider not configured",
        hint: "Set VOICE_TTS_PROVIDER + VOICE_TTS_API_KEY on the server (Render env). Client falls back to device speech.",
        lang,
      });
      return;
    }
    try {
      const out = provider === "openai" ? await synthOpenAi(text, lang, key) : await synthElevenLabs(text, key);
      if (out.status !== 200 || typeof out.body === "string") {
        /* Provider ka error message wapas bhejna theek hai, par key/path kabhi nahi. */
        res.status(502).json({ error: "voice provider failed", provider, status: out.status });
        return;
      }
      res.setHeader("Content-Type", out.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.send(Buffer.from(out.body));
    } catch {
      res.status(502).json({ error: "voice provider unreachable", provider });
    }
  });
}
