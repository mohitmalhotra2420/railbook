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
 *   VOICE_TTS_MODEL    = tts-1 | eleven_multilingual_v2 …  (optional; openai ka default "tts-1")
 *   VOICE_TTS_VOICE    = hi-IN-SwaraNeural | alloy | Rachel … (optional; openai ka default Hindi
 *                        female "hi-IN-SwaraNeural", male ke liye sirf env badlo → "hi-IN-MadhurNeural")
 *   VOICE_TTS_BASE_URL = custom base (optional, self-hosted OpenAI-compatible)
 *
 * Round "Voice Agent R2" (30 Sep 2026): provider ke default sirf itne badle ki openai-edge-tts
 * (https://github.com/travisvn/openai-edge-tts — OpenAI-compatible, POST /v1/audio/speech) bina model/
 * voice set kiye bhi sahi chale. Baaki poora adapter (validation, fallback, no-store, key server-side)
 * waise hi hai — koi rewrite nahi, koi naya endpoint nahi, AI/railway/booking code ko haath nahi lagaya.
 */
import type { Express, Request, Response } from "express";

const MAX_TEXT = 700;

/* ══ R67 (1 Oct 2026, user screenshot: "Server voice abhi nahi aayi — device voice chala di") ═══════
 * Asli wajah: provider (railbook-edge-tts) Render par sota hai — pehla call 20-25s leta hai, aur hamara
 * proxy usse pehle hi gir jaata tha → client "server-failed" par fallback. Ab:
 *   • upstream ke liye timeout (env se) + ek retry (cold start ke liye),
 *   • retry ke baad bhi fail → chhota (pehla vaakya) text try — awaaz aana zyada zaroori hai,
 *   • chhota in-memory cache (same line dobara — booking me baar baar wahi sawaal aate hain),
 *   • config maangte hi background me ek chhota warm-up call (jawab ka intezaar nahi).
 * Sab kuch isi file me — koi naya endpoint nahi, provider/keys waise hi, AI/railway code ko haath nahi. */
const UPSTREAM_TIMEOUT_MS = Math.max(3000, Number(process.env.VOICE_TTS_TIMEOUT_MS ?? 28000) || 28000);
const CACHE_MAX = 80;
let warmedUp = false;
const ttsCache = new Map<string, { body: Buffer; contentType: string }>();

function cacheKey(provider: string, text: string, lang: string): string {
  return `${provider}|${process.env.VOICE_TTS_MODEL ?? ""}|${process.env.VOICE_TTS_VOICE ?? ""}|${lang}|${text}`;
}
/** Cache khaali karo (tests/e2e ke liye — production me iski zaroorat nahi). */
export function clearTtsCache(): void {
  ttsCache.clear();
  warmedUp = false;
}
function cacheGet(k: string) {
  const hit = ttsCache.get(k);
  if (!hit) return null;
  ttsCache.delete(k);
  ttsCache.set(k, hit); /* LRU: hamesha end me */
  return hit;
}
function cacheSet(k: string, body: Buffer, contentType: string) {
  ttsCache.set(k, { body, contentType });
  while (ttsCache.size > CACHE_MAX) {
    const oldest = ttsCache.keys().next().value;
    if (oldest === undefined) break;
    ttsCache.delete(oldest);
  }
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("tts upstream timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
/** Lamba text fail ho to shuru ka poora vaakya — awaaz choti par sach me aaye. */
function shortenForRetry(text: string): string {
  if (text.length <= 90) return text;
  const cut = text.slice(0, 160);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("। "));
  return (end > 25 ? cut.slice(0, end + 1) : text.slice(0, 90)).trim();
}

/* OpenAI-compatible provider ke default (env se hamesha override ho sakte hain):
 * openai-edge-tts ke liye yahi do value kaam karti hain — Hindi female voice + tts-1 model. */
const OPENAI_DEFAULT_MODEL = "tts-1";
const OPENAI_DEFAULT_VOICE = "hi-IN-SwaraNeural";

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
    model: process.env.VOICE_TTS_MODEL?.trim() || (provider === "elevenlabs" ? "eleven_multilingual_v2" : provider === "openai" ? OPENAI_DEFAULT_MODEL : null),
    languages: ["hi-IN", "en-IN"],
  };
}

async function synthOpenAi(text: string, lang: string, key: string): Promise<{ status: number; body: ArrayBuffer | string; contentType: string }> {
  const base = String(process.env.VOICE_TTS_BASE_URL ?? "").trim() || "https://api.openai.com/v1";
  const res = await withTimeout(fetch(`${base.replace(/\/$/, "")}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.VOICE_TTS_MODEL?.trim() || OPENAI_DEFAULT_MODEL,
      voice: process.env.VOICE_TTS_VOICE?.trim() || OPENAI_DEFAULT_VOICE,
      input: text,
      response_format: "mp3",
    }),
  }), UPSTREAM_TIMEOUT_MS);
  if (!res.ok) return { status: res.status, body: await res.text().catch(() => ""), contentType: "application/json" };
  return { status: 200, body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
}

async function synthElevenLabs(text: string, key: string): Promise<{ status: number; body: ArrayBuffer | string; contentType: string }> {
  const voiceId = process.env.VOICE_TTS_VOICE?.trim() || "Rachel";
  const res = await withTimeout(fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": key },
    body: JSON.stringify({
      text,
      model_id: process.env.VOICE_TTS_MODEL?.trim() || "eleven_multilingual_v2",
    }),
  }), UPSTREAM_TIMEOUT_MS);
  if (!res.ok) return { status: res.status, body: await res.text().catch(() => ""), contentType: "application/json" };
  return { status: 200, body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
}

/** Routes mount — app.ts me ek line se lagta hai (koi existing route chhua nahi jata). */
export function registerVoiceRoutes(app: Express): void {
  app.get("/api/voice/config", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(voicePublicConfig());
    /* R67: app khulte hi (config call par) provider ko background me jaga do — user bolna shuru kare
     * tab tak wo garam ho. Fire-and-forget: jawab ka intezaar nahi, koi error client tak nahi. */
    void warmUpProvider();
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
    const synth = (t: string) => (provider === "openai" ? synthOpenAi(t, lang, key) : synthElevenLabs(t, key));

    /* R67: same line dobara (booking me wahi sawaal baar-baar) → cache se turant. */
    const ck = cacheKey(provider, text, lang);
    const cached = cacheGet(ck);
    if (cached) {
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-RailBook-TTS", "cache");
      res.send(cached.body);
      return;
    }

    /* R67: cold-start ke liye 3 koshish — (1) seedha, (2) ek retry, (3) chhota text. */
    const attempts: string[] = [text, text]; /* 2nd = retry (provider sota hai → pehla call aksar fail) */
    const short = shortenForRetry(text);
    if (short && short !== text) attempts.push(short);

    let lastStatus = 0;
    for (let i = 0; i < attempts.length; i += 1) {
      try {
        const out = await synth(attempts[i]);
        if (out.status === 200 && typeof out.body !== "string") {
          const buf = Buffer.from(out.body);
          if (attempts[i] === text) cacheSet(ck, buf, out.contentType);
          res.setHeader("Content-Type", out.contentType);
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-RailBook-TTS", attempts[i] === text ? (i === 0 ? "upstream" : "upstream-retry") : "upstream-short");
          res.send(buf);
          return;
        }
        lastStatus = out.status;
      } catch {
        lastStatus = 0; /* timeout / network */
      }
    }
    res.status(502).json({ error: "voice provider failed", provider, status: lastStatus });
  });
}

/** R67: provider ko background me jaga do (ek chhoti si phrase) — pehli asli awaaz late na ho.
 *  Sirf ek baar per process, fail ho to chup-chaap ignore (koi user-facing asar nahi). */
export async function warmUpProvider(): Promise<void> {
  if (warmedUp) return;
  const provider = providerName();
  const key = apiKeyFor(provider);
  if (provider === "none" || !key) return;
  warmedUp = true;
  try {
    const out = provider === "openai" ? await synthOpenAi("hmm", "hi-IN", key) : await synthElevenLabs("hmm", key);
    if (out.status !== 200) warmedUp = false; /* agli config call par phir try karega */
  } catch {
    warmedUp = false;
  }
}
