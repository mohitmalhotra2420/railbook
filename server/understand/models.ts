const DEFAULT_BASE = "";
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface SafeModel {
  id: string;
  name: string;
  provider: string | null;
  description: string | null;
  contextLength: number | null;
  inputPricing: string;
  outputPricing: string;
  capabilities: string[];
  modalities: string[];
  suitable: boolean;
}

export interface CatalogSnapshot {
  ok: boolean;
  endpoint: string;
  fetchedAt: string | null;
  models: SafeModel[];
  suitable: SafeModel[];
  selectedId: string | null;
  selectedSource: "env" | "auto" | "none";
  fallbackIds: string[];
  error: string | null;
  status: number | null;
}

type Cache = {
  fetchedAt: number;
  models: SafeModel[];
  autoSelectedId: string | null;
  endpoint: string;
};

let cache: Cache | null = null;

export function resetModelCache(): void {
  cache = null;
}

export function modelsEndpoint(): string {
  return `${DEFAULT_BASE}/models`;
}

function friendlyError(status: number | null, kind: string): string {
  if (kind === "missing_key") return "API key is not configured.";
  if (kind === "timeout") return "Request timed out.";
  if (kind === "network") return "Could not reach model catalog.";
  if (kind === "malformed") return "Unexpected model list.";
  if (kind === "empty") return "No models returned.";
  if (status === 401) return "Authentication failed.";
  if (status === 403) return "Access denied.";
  if (status === 429) return "Rate limit. Try again later.";
  if (status != null && status >= 500) return "Catalog temporarily unavailable.";
  return "Could not load models.";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
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

function formatPrice(v: unknown): string {
  if (v == null) return "unknown";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  return "unknown";
}

function priceValue(label: string): number | null {
  if (!label || label === "unknown") return null;
  const n = Number(label);
  return Number.isFinite(n) ? n : null;
}

export function parseModelCatalog(raw: unknown): SafeModel[] {
  const root = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(root?.data)
      ? root!.data
      : Array.isArray(root?.models)
        ? root!.models
        : [];
  const out: SafeModel[] = [];
  for (const item of list) {
    const o = asRecord(item);
    if (!o) continue;
    const id = str(o.id) ?? str(o.model) ?? str(o.slug);
    if (!id) continue;
    const pricing = asRecord(o.pricing) ?? {};
    const arch = asRecord(o.architecture) ?? {};
    const modalities = [
      ...strList(o.modalities),
      ...strList(arch.modality ? [arch.modality] : []),
      ...strList(arch.input_modalities),
      ...strList(arch.output_modalities),
    ];
    const capabilities = [
      ...strList(o.capabilities),
      ...strList(o.supported_parameters),
    ];
    const model: SafeModel = {
      id,
      name: str(o.name) ?? str(o.display_name) ?? id,
      provider: str(o.provider) ?? str(o.owned_by) ?? str(o.organization) ?? null,
      description: str(o.description),
      contextLength:
        num(o.context_length) ??
        num(o.contextLength) ??
        num(o.max_context) ??
        num(o.context_window) ??
        null,
      inputPricing: formatPrice(pricing.prompt ?? pricing.input ?? o.input_price ?? o.inputPricing),
      outputPricing: formatPrice(
        pricing.completion ?? pricing.output ?? o.output_price ?? o.outputPricing,
      ),
      capabilities,
      modalities,
      suitable: false,
    };
    model.suitable = isSuitableChatModel(model);
    out.push(model);
  }
  return out;
}

const UNSUITABLE =
  /embed|whisper|tts|dall-?e|imagen|image-gen|moderation|audio-only|speech-to-text|text-to-speech|rerank|clip/i;

export function isSuitableChatModel(model: SafeModel): boolean {
  if (/^auto(:|$)/i.test(model.id)) return false;
  const blob = `${model.id} ${model.name} ${model.description ?? ""}`.toLowerCase();
  if (UNSUITABLE.test(blob)) return false;
  const mods = model.modalities.join(" ").toLowerCase();
  if (mods && !/text/.test(mods) && /(image|audio|video)/.test(mods)) return false;
  return true;
}

export function isFreeModel(model: SafeModel): boolean {
  if (/:free$/i.test(model.id)) return true;
  const a = priceValue(model.inputPricing);
  const b = priceValue(model.outputPricing);
  return a === 0 && b === 0;
}

const MAX_CHAIN = 3;

/** Catalog-only chain. Never invents ids. Env ids that left the catalog are dropped. */
export function buildModelChain(models: SafeModel[]): string[] {
  const suitable = models.filter((m) => m.suitable);
  const byId = new Map(suitable.map((m) => [m.id, m]));
  const inCatalog = (id: string) => byId.has(id);

  const envPrimary = "";
  const autoId = selectChatModel(models);
  const primary = (envPrimary && inCatalog(envPrimary) ? envPrimary : null) || autoId;
  if (!primary) return [];

  const chain: string[] = [primary];
  const push = (id: string) => {
    if (!id || chain.includes(id) || !inCatalog(id) || chain.length >= MAX_CHAIN) return;
    chain.push(id);
  };

  const primaryRow = byId.get(primary);
  if (primaryRow && isFreeModel(primaryRow)) {
    const otherFree = suitable.filter((m) => m.id !== primary && isFreeModel(m));
    otherFree.sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0));
    for (const m of otherFree) push(m.id);
  }

  const extraFallbacks: string[] = [];
  for (const id of extraFallbacks) push(id);
  return chain;
}

export function selectChatModel(models: SafeModel[]): string | null {
  const suitable = models.filter((m) => m.suitable);
  if (!suitable.length) return null;
  const priced = suitable.filter((m) => {
    const a = priceValue(m.inputPricing);
    const b = priceValue(m.outputPricing);
    return a != null || b != null;
  });
  if (priced.length) {
    const roomy = priced.filter((m) => (m.contextLength ?? 0) >= 8192);
    const pool = roomy.length ? roomy : priced;
    pool.sort((x, y) => {
      const cx = (priceValue(x.inputPricing) ?? 0) + (priceValue(x.outputPricing) ?? 0);
      const cy = (priceValue(y.inputPricing) ?? 0) + (priceValue(y.outputPricing) ?? 0);
      if (cx !== cy) return cx - cy;
      return (y.contextLength ?? 0) - (x.contextLength ?? 0);
    });
    return pool[0].id;
  }
  suitable.sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0));
  return suitable[0]?.id ?? null;
}

function snapshotFromCache(error: string | null, status: number | null): CatalogSnapshot {
  const models = cache?.models ?? [];
  const envId = null;
  const autoId = cache?.autoSelectedId ?? null;
  const selectedId = envId || autoId;
  const chain = models.length ? buildModelChain(models) : [];
  return {
    ok: !error,
    endpoint: cache?.endpoint ?? modelsEndpoint(),
    fetchedAt: cache ? new Date(cache.fetchedAt).toISOString() : null,
    models,
    suitable: models.filter((m) => m.suitable),
    selectedId,
    selectedSource: envId ? "env" : autoId ? "auto" : "none",
    fallbackIds: chain.slice(1),
    error,
    status,
  };
}

export async function refreshModelCatalog(): Promise<CatalogSnapshot> {
  return snapshotFromCache(friendlyError(null, "missing_key"), null);
}

export async function getModelCatalog(opts: { refresh?: boolean } = {}): Promise<CatalogSnapshot> {
  const fresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (!opts.refresh && fresh) return snapshotFromCache(null, 200);
  if (!opts.refresh && cache) return snapshotFromCache(null, 200);
  return refreshModelCatalog();
}

/** Env model wins only if it is still in the catalog. Never invents an id. */
export async function resolveChatModel(): Promise<string | null> {
  const chain = await resolveModelChain();
  return chain[0] ?? null;
}

export async function resolveModelChain(): Promise<string[]> {
  const snap = await getModelCatalog();
  if (!snap.models.length) return [];
  return buildModelChain(snap.models);
}

export function getCachedCatalog(): CatalogSnapshot {
  return snapshotFromCache(cache ? null : "Catalog has not been loaded yet.", null);
}
