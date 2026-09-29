import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(here, "../.env") });
  dotenv.config({ path: path.resolve(here, "../.env.local") });
} catch {
  dotenv.config();
}

const NVIDIA_DEFAULT_BASE = "https://integrate.api.nvidia.com/v1";
/**
 * Round-14 (2026-09-07): PRIMARY = meta/muse-glimmer-30b (bench 11/12 manual,
 * 1.9s p50 — best Hinglish samajh + multi-tool). FALLBACK = openai/gpt-oss-20b
 * (3-hafte prod-proven, 10/12). Per-model timeout stagger (Round-13) se dead
 * primary fallback ko nahi maarta. Env NVIDIA_MODEL / NVIDIA_FALLBACK_MODEL override.
 */
/* Round-52 (29 Sep 2026, user: "AI first for everything — model khud samjhe, deterministic path chale hi na"):
 * prod par primary `meta/muse-glimmer-30b` bade agentic prompt par 30s+ le raha tha → turn timeout → jawab
 * deterministic rescue se aa jaata tha (user ko laga "naya build meri wording nahi samajh raha"). Default
 * chain ab FAST se shuru hoti hai (gpt-oss-20b ~3-7s, reasoning_effort low) aur Nemotron Lightning
 * (thinking off) doosre slot me — bhaari reasoning model chain ke aakhir me. Ops chahe to env se badal sakta hai. */
const NVIDIA_DEFAULT_MODEL = "openai/gpt-oss-20b";
const NVIDIA_DEFAULT_FALLBACK_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

/** Production default. Explicit `mock` / `railkit` / `authorized` still override. */
export const DEFAULT_RAILWAY_PROVIDER = "railcore";

export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "*",
  get provider() {
    const named = (process.env.RAILWAY_PROVIDER ?? "").trim().toLowerCase();
    if (named === "mock" || named === "railkit" || named === "authorized") return named;
    return DEFAULT_RAILWAY_PROVIDER;
  },
  railwayApiBaseUrl: process.env.RAILWAY_API_BASE_URL ?? "",
  railwayApiKey: process.env.RAILWAY_API_KEY ?? "",
  railwayApiSecret: process.env.RAILWAY_API_SECRET ?? "",
  get railkitApiKey() {
    return (process.env.RAILKIT_API_KEY ?? "").trim();
  },
  get railcoreApiKey() {
    return (process.env.RAILCORE_API_KEY ?? "").trim();
  },
  /** Round-16o: ADDITIONAL fallback providers (optional). Unset = skipped. */
  get railradarApiKey() {
    return (process.env.RAILRADAR_API_KEY ?? "").trim();
  },
  get indianRailApiKey() {
    return (process.env.INDIANRAILAPI_KEY ?? "").trim();
  },
  walletInitial: Number(process.env.WALLET_INITIAL_BALANCE ?? 5000),
  serviceFee: Number(process.env.SERVICE_FEE_INR ?? 25),
  mockForceFail: process.env.MOCK_FORCE_FAIL === "true",
  /** 24 Sep 2026 (user: "seat intent questions AI khud samjhe aur filter kare, client layer fallback rahe").
   *  Server-side seat filter DEFAULT ON. SEAT_FILTER_SERVER=0 karo to behaviour aaj jaisa
   *  (sirf client layer) — koi code revert nahi chahiye. */
  get seatFilterServer() {
    const v = (process.env.SEAT_FILTER_SERVER ?? "1").trim().toLowerCase();
    return !(v === "0" || v === "false" || v === "off");
  },
  /* ── Round-53 (user: "kon sa model best work karega mere railbook ke liye, uski key main baad mein
   * dunga"): naya provider sirf ENV se lag jaata hai — code chhedne ki zaroorat nahi. Ye teen var set
   * karte hi poora AI stack (agentic brain + NLU/extraction + journey decisions) usi OpenAI-compatible
   * endpoint par chala jaata hai:
   *     AI_LLM_BASE_URL=https://api.groq.com/openai/v1     (OpenAI/OpenRouter/Cerebras/Together/Gemini-compat…)
   *     AI_LLM_API_KEY=...
   *     AI_LLM_MODELS=llama-3.3-70b-versatile,qwen/qwen3-32b      (chain — pehla primary, aage fallback)
   * Neeche ke getters isi override ko sabse pehle dekhte hain; warna NVIDIA wala purana path bilkul
   * waisa hi rehta hai (default NVIDIA, backward compatible). */
  get aiLlmBaseUrl() {
    return (process.env.AI_LLM_BASE_URL ?? "").trim().replace(/\/$/, "");
  },
  get aiLlmApiKey() {
    return (process.env.AI_LLM_API_KEY ?? "").trim();
  },
  /** Chain (comma-separated). Khaali = override off. */
  get aiLlmModels(): string[] {
    return (process.env.AI_LLM_MODELS ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
  },
  get aiLlmOverrideActive() {
    return Boolean(this.aiLlmBaseUrl && this.aiLlmApiKey && this.aiLlmModels.length);
  },
  /** NVIDIA NIM (ya AI_LLM_* override) — never log these values. */
  get nvidiaApiKey() {
    if (this.aiLlmOverrideActive) return this.aiLlmApiKey;
    return (process.env.NVIDIA_API_KEY ?? "").trim();
  },
  get nvidiaBaseUrl() {
    if (this.aiLlmOverrideActive) return this.aiLlmBaseUrl;
    const named = (process.env.NVIDIA_BASE_URL ?? "").trim().replace(/\/$/, "");
    return named || NVIDIA_DEFAULT_BASE;
  },
  get nvidiaModel() {
    if (this.aiLlmOverrideActive) return this.aiLlmModels[0];
    return (process.env.NVIDIA_MODEL ?? "").trim() || NVIDIA_DEFAULT_MODEL;
  },
  /** NLU/fallback layer ka model. Default = NVIDIA_MODEL (backward compat).
   *  Primary planner DeepSeek hote hue bhi fast NLU (GPT-OSS) rakhne ke liye
   *  NLU_MODEL=openai/gpt-oss-20b set hota hai. */
  get nluModel() {
    return (process.env.NLU_MODEL ?? "").trim() || this.nvidiaModel;
  },
  /** BENCHMARK-ONLY override: AGENTIC_MODEL set ho to agentic engine usi single model ko
   *  chalata hai (chain fallback ke bina). Prod mein kabhi set nahi hota — default path
   *  (NVIDIA_MODEL = GPT-OSS-20B) bilkul unchanged rehta hai. */
  get agenticModelOverride() {
    return (process.env.AGENTIC_MODEL ?? "").trim();
  },
  /** Model for the autonomous tool-calling agent. Defaults to NVIDIA_MODEL. */
  get agentModel() {
    return (process.env.AGENT_MODEL ?? "").trim() || this.nvidiaModel;
  },
  get agentAutoEnabled() {
    return (process.env.AGENT_AUTO ?? "1").trim() !== "0";
  },
  /** Hugging Face router (OpenAI-compatible) — GLM etc. Never log these values. */
  get hfToken() {
    return (process.env.HF_TOKEN ?? "").trim();
  },
  get hfModel() {
    return (process.env.HF_MODEL ?? "").trim();
  },
  get hfBaseUrl() {
    const b = (process.env.HF_BASE_URL ?? "").trim().replace(/\/$/, "");
    return b || "https://router.huggingface.co/v1";
  },
  /** Agentic engine ka model provider: "nvidia" (default, GPT-OSS-20B) | "hf" (GLM).
   *  Railway providers isse unaffected — RailCore primary, RailKit fallback. */
  get agenticProvider() {
    return (process.env.AGENTIC_PROVIDER ?? "").trim().toLowerCase() || "nvidia";
  },
  /** Secondary agentic model — GPT-OSS fail hone par ek hi retry isi se (default: Nemotron 3.5 Lightning). */
  get nvidiaFallbackModel() {
    /* Round-53: AI_LLM_* override lagne par chain user ki di hui hai (AI_LLM_MODELS ka doosra model);
     * koi doosra model na ho to "" — fallback slot khaali. */
    if (this.aiLlmOverrideActive) return this.aiLlmModels[1] ?? "";
    return (process.env.NVIDIA_FALLBACK_MODEL ?? "").trim() || NVIDIA_DEFAULT_FALLBACK_MODEL;
  },
  get aiRequestTimeoutMs() {
    const n = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 7000);
    if (!Number.isFinite(n)) return 7000;
    /* Round-52: cap 20s → 25s (bhaari sawaal par 7s kam pad jaata tha aur AI ka jawab aane se pehle
     * timeout ho jaata tha) — default wahi 7s, par tuning ki gunjaish zyada. */
    return Math.min(25000, Math.max(50, Math.floor(n)));
  },
  /** Gemini — shadow/eval only. Never log these values. Never send to the browser. */
  get geminiApiKey() {
    return (process.env.GEMINI_API_KEY ?? "").trim();
  },
  get geminiModel() {
    return (process.env.GEMINI_MODEL ?? "").trim() || "gemini-3.5-flash";
  },
  get geminiBaseUrl() {
    const named = (process.env.GEMINI_BASE_URL ?? "").trim().replace(/\/$/, "");
    return named || "https://generativelanguage.googleapis.com/v1beta";
  },
  /**
   * Shadow A/B only. Off during Vitest so NVIDIA fetch mocks stay isolated.
   * Production default stays NVIDIA; this never swaps the customer path.
   */
  get geminiShadow() {
    if (process.env.VITEST) return false;
    if ((process.env.GEMINI_SHADOW ?? "1").trim() === "0") return false;
    return Boolean((process.env.GEMINI_API_KEY ?? "").trim());
  },
  /** RapidAPI Gemini Pro AI New — shadow/eval only. Never log. Never send to the browser. */
  get rapidapiGeminiKey() {
    return (process.env.RAPIDAPI_GEMINI_KEY ?? process.env.RAPIDAPI_KEY ?? "").trim();
  },
  get rapidapiGeminiHost() {
    return (process.env.RAPIDAPI_GEMINI_HOST ?? "").trim() || "gemini-pro-ai-new.p.rapidapi.com";
  },
  get rapidapiGeminiUrl() {
    const named = (process.env.RAPIDAPI_GEMINI_URL ?? "").trim();
    if (named) return named;
    return `https://${this.rapidapiGeminiHost}/`;
  },
  get rapidapiGeminiModel() {
    return (process.env.RAPIDAPI_GEMINI_MODEL ?? "").trim() || "gemini-2.5-pro";
  },
  get rapidapiGeminiShadow() {
    if (process.env.VITEST) return false;
    if ((process.env.RAPIDAPI_GEMINI_SHADOW ?? "1").trim() === "0") return false;
    return Boolean((process.env.RAPIDAPI_GEMINI_KEY ?? process.env.RAPIDAPI_KEY ?? "").trim());
  },
};

export function assertProviderConfig(): void {
  if (env.provider === "authorized") {
    if (!env.railwayApiBaseUrl || !env.railwayApiKey) {
      throw new Error(
        `RAILWAY_PROVIDER=authorized requires RAILWAY_API_BASE_URL and RAILWAY_API_KEY on the server.`,
      );
    }
  }
}
