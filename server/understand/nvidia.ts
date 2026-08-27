import { env } from "../env.js";

const DEFAULT_BASE = "https://integrate.api.nvidia.com/v1";
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;

export type NvidiaKind = "chat" | "embedding" | "image" | "audio" | "other";

export interface NvidiaModel {
  id: string;
  name: string;
  provider: string | null;
  kind: NvidiaKind;
  capabilities: string[];
  contextLength: number | null;
  description: string | null;
  suitable: boolean;
}

export interface NvidiaCatalog {
  connected: boolean;
  status: "Connected" | "Not configured" | "Auth failed" | "Unavailable" | "Error";
  endpoint: string;
  fetchedAt: string | null;
  modelsAvailable: number;
  suitableCount: number;
  models: NvidiaModel[];
  suitable: NvidiaModel[];
  error: string | null;
}

type Cache = {
  fetchedAt: number;
  models: NvidiaModel[];
  endpoint: string;
};

let cache: Cache | null = null;

export function resetNvidiaCache(): void {
  cache = null;
}

export function nvidiaModelsEndpoint(): string {
  const base = (env.nvidiaBaseUrl || DEFAULT_BASE).replace(/\/$/, "");
  return `${base}/models`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((x): x is string => Boolean(x));
}

const EMBED =
  /embed|retriev|rerank|nv-embed|nvembed|e5-|bge-|clip|nvclip/i;
const IMAGE =
  /imagen|image-gen|flux|sdxl|stable-diffusion|cosmos-predict|vista3d|sana\/|edify|gaussian|nerf/i;
const AUDIO = /whisper|tts|asr|speech-to-text|text-to-speech|audio-only|transcri/i;
const OTHER_SKIP =
  /moderation|content-safety|topic-control|safety-guard|reward|translate|translation|protein|molmim|esmfold|genomics|fourcast|route-opt|synthetic-video-detector/i;

export function classifyNvidiaModel(blob: string): NvidiaKind {
  if (EMBED.test(blob)) return "embedding";
  if (IMAGE.test(blob)) return "image";
  if (AUDIO.test(blob)) return "audio";
  if (OTHER_SKIP.test(blob)) return "other";
  return "chat";
}

export function isNvidiaChatModel(model: Pick<NvidiaModel, "id" | "name" | "description" | "kind">): boolean {
  if (model.kind !== "chat") return false;
  const blob = `${model.id} ${model.name} ${model.description ?? ""}`.toLowerCase();
  if (EMBED.test(blob) || IMAGE.test(blob) || AUDIO.test(blob) || OTHER_SKIP.test(blob)) return false;
  return true;
}

export function parseNvidiaCatalog(raw: unknown): NvidiaModel[] {
  const root = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(root?.data)
      ? root!.data
      : Array.isArray(root?.models)
        ? root!.models
        : [];
  const out: NvidiaModel[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const o = asRecord(item);
    if (!o) continue;
    const id = str(o.id) ?? str(o.model) ?? str(o.slug);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = str(o.name) ?? str(o.display_name) ?? id;
    const provider =
      str(o.owned_by) ??
      str(o.organization) ??
      str(o.provider) ??
      (id.includes("/") ? id.split("/")[0] : null);
    const description = str(o.description);
    const blob = `${id} ${name} ${description ?? ""} ${strList(o.capabilities).join(" ")}`;
    const kind = classifyNvidiaModel(blob);
    const capabilities = strList(o.capabilities);
    if (!capabilities.length) capabilities.push(kind);
    const model: NvidiaModel = {
      id,
      name,
      provider,
      kind,
      capabilities,
      contextLength:
        num(o.context_length) ??
        num(o.contextLength) ??
        num(o.max_model_len) ??
        num(o.max_seq_len) ??
        num(o.context_window) ??
        null,
      description,
      suitable: false,
    };
    model.suitable = isNvidiaChatModel(model);
    out.push(model);
  }
  return out;
}

function snapshot(error: string | null, status: "Connected" | "Not configured" | "Auth failed" | "Unavailable" | "Error"): NvidiaCatalog {
  const models = cache?.models ?? [];
  const suitable = models.filter((m) => m.suitable);
  return {
    connected: status === "Connected",
    status,
    endpoint: cache?.endpoint ?? nvidiaModelsEndpoint(),
    fetchedAt: cache ? new Date(cache.fetchedAt).toISOString() : null,
    modelsAvailable: models.length,
    suitableCount: suitable.length,
    models,
    suitable,
    error,
  };
}

export async function refreshNvidiaCatalog(): Promise<NvidiaCatalog> {
  const endpoint = nvidiaModelsEndpoint();
  const apiKey = env.nvidiaApiKey;
  if (!apiKey) {
    return snapshot("NVIDIA API key is not configured.", "Not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      console.error(`[nvidia] models_failed status=${res.status}`);
      return snapshot("NVIDIA authentication failed.", "Auth failed");
    }
    if (!res.ok) {
      console.error(`[nvidia] models_failed status=${res.status}`);
      const status = res.status >= 500 ? "Unavailable" : "Error";
      return snapshot(`NVIDIA models request failed (${res.status}).`, status);
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      return snapshot("NVIDIA returned an unexpected model list.", "Error");
    }
    const models = parseNvidiaCatalog(raw);
    if (!models.length) {
      return snapshot("NVIDIA returned no models.", "Error");
    }
    cache = { fetchedAt: Date.now(), models, endpoint };
    return snapshot(null, "Connected");
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "AbortError") {
      console.error("[nvidia] models_timeout");
      return snapshot("NVIDIA request timed out.", "Unavailable");
    }
    console.error("[nvidia] models_network");
    return snapshot("Could not reach NVIDIA.", "Unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export async function getNvidiaCatalog(opts: { refresh?: boolean } = {}): Promise<NvidiaCatalog> {
  const fresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (!opts.refresh && fresh) return snapshot(null, "Connected");
  if (!opts.refresh && cache) return snapshot(null, "Connected");
  return refreshNvidiaCatalog();
}

export function publicNvidiaPayload(catalog: NvidiaCatalog) {
  return {
    connected: catalog.connected,
    status: catalog.status,
    label: catalog.connected
      ? `NVIDIA API: Connected`
      : `NVIDIA API: ${catalog.status}`,
    modelsAvailable: catalog.modelsAvailable,
    suitableCount: catalog.suitableCount,
    endpoint: catalog.endpoint,
    fetchedAt: catalog.fetchedAt,
    error: catalog.error,
    models: catalog.models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      kind: m.kind,
      capabilities: m.capabilities,
      contextLength: m.contextLength,
      suitable: m.suitable,
    })),
  };
}
