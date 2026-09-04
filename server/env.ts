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
const NVIDIA_DEFAULT_MODEL = "openai/gpt-oss-20b";
const NVIDIA_DEFAULT_FALLBACK_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

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
  walletInitial: Number(process.env.WALLET_INITIAL_BALANCE ?? 5000),
  serviceFee: Number(process.env.SERVICE_FEE_INR ?? 25),
  mockForceFail: process.env.MOCK_FORCE_FAIL === "true",
  /** NVIDIA NIM — never log these values. */
  get nvidiaApiKey() {
    return (process.env.NVIDIA_API_KEY ?? "").trim();
  },
  get nvidiaBaseUrl() {
    const named = (process.env.NVIDIA_BASE_URL ?? "").trim().replace(/\/$/, "");
    return named || NVIDIA_DEFAULT_BASE;
  },
  get nvidiaModel() {
    return (process.env.NVIDIA_MODEL ?? "").trim() || NVIDIA_DEFAULT_MODEL;
  },
  /** Model for the autonomous tool-calling agent. Defaults to NVIDIA_MODEL. */
  get agentModel() {
    return (process.env.AGENT_MODEL ?? "").trim() || this.nvidiaModel;
  },
  get agentAutoEnabled() {
    return (process.env.AGENT_AUTO ?? "1").trim() !== "0";
  },
  /** Secondary agentic model — GPT-OSS fail hone par ek hi retry isi se (default: Nemotron 3.5 Lightning). */
  get nvidiaFallbackModel() {
    return (process.env.NVIDIA_FALLBACK_MODEL ?? "").trim() || NVIDIA_DEFAULT_FALLBACK_MODEL;
  },
  get aiRequestTimeoutMs() {
    const n = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 7000);
    if (!Number.isFinite(n)) return 7000;
    return Math.min(20000, Math.max(50, Math.floor(n)));
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
