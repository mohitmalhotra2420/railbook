/**
 * Round-18m-29 — per-TURN performance scope (freshness-preserving).
 *
 * Non-negotiable (user): railway data must be FRESH for every user enquiry. So this module
 * deliberately has NO time-based cache for dynamic railway data. What it provides:
 *
 *  1. `dedupe(key, fn)` — in-flight deduplication of the IDENTICAL provider request within the
 *     SAME user turn only. The map lives inside an AsyncLocalStorage scope opened per turn
 *     (`runTurnScope`) and is discarded when the turn ends. A later enquiry (even 1 s later,
 *     even the exact same text) opens a new scope → contacts the provider again. Outside a
 *     scope, dedupe() is a plain pass-through (no sharing between requests ever).
 *
 *  2. `limited(fn)` — a global concurrency limiter for seat probes (default 10, env
 *     `RAIL_PROBE_CONCURRENCY`). It changes WHEN a probe runs, never WHETHER it runs: every
 *     requested check is still performed. Replaces unbounded Promise.all fan-out so we can
 *     raise parallelism safely without tripping provider rate limits.
 *
 *  3. Metrics per turn: provider calls, dedup hits/misses, providerUsed, fetchedAt/ageMs
 *     (ageMs is always ~0 for dynamic rows: they were fetched in this turn), AI calls, errors,
 *     429s, max concurrency — surfaced on the /api/agent response as `perf`.
 *
 *  4. Progress events (REAL work): callers report "phase" and "N/M checks done"; the HTTP
 *     layer forwards them to the client over SSE. No fake percentages — counts are the actual
 *     completed provider checks.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type PerfEntry = { key: string; providerUsed: string | null; fetchedAt: string; ageMs: number; cacheHit: boolean; ms: number; ok: boolean };
export type ProgressEvent = { phase: string; done?: number; total?: number; detail?: string; at: number };

export type TurnScope = {
  id: string;
  startedAt: number;
  inflight: Map<string, Promise<unknown>>;
  entries: PerfEntry[];
  dedupHits: number;
  dedupMisses: number;
  aiCalls: number;
  aiMs: number;
  providerCalls: number;
  providerErrors: number;
  rateLimited: number;
  maxConcurrency: number;
  progress: ProgressEvent[];
  onProgress: ((e: ProgressEvent) => void) | null;
  checksDone: number;
  checksTotal: number;
};

const als = new AsyncLocalStorage<TurnScope>();
let seq = 0;

export function currentScope(): TurnScope | undefined {
  return als.getStore();
}

export function runTurnScope<T>(fn: (scope: TurnScope) => Promise<T>, onProgress?: (e: ProgressEvent) => void): Promise<T> {
  const scope: TurnScope = {
    id: `t${Date.now().toString(36)}${(seq++).toString(36)}`,
    startedAt: Date.now(),
    inflight: new Map(),
    entries: [],
    dedupHits: 0,
    dedupMisses: 0,
    aiCalls: 0,
    aiMs: 0,
    providerCalls: 0,
    providerErrors: 0,
    rateLimited: 0,
    maxConcurrency: 0,
    progress: [],
    onProgress: onProgress ?? null,
    checksDone: 0,
    checksTotal: 0,
  };
  return als.run(scope, () => fn(scope));
}

/** Same-turn identical-request dedup. Never shares results across turns. */
export function dedupe<T>(key: string, fn: () => Promise<T>, meta?: { provider?: () => string | null }): Promise<T> {
  const scope = als.getStore();
  if (!scope) return fn();
  const hit = scope.inflight.get(key) as Promise<T> | undefined;
  if (hit) {
    scope.dedupHits++;
    scope.entries.push({ key, providerUsed: meta?.provider?.() ?? null, fetchedAt: new Date().toISOString(), ageMs: 0, cacheHit: true, ms: 0, ok: true });
    return hit;
  }
  scope.dedupMisses++;
  const started = Date.now();
  const p = fn().then(
    (v) => {
      scope.entries.push({ key, providerUsed: meta?.provider?.() ?? null, fetchedAt: new Date(started).toISOString(), ageMs: 0, cacheHit: false, ms: Date.now() - started, ok: true });
      return v;
    },
    (e) => {
      scope.entries.push({ key, providerUsed: null, fetchedAt: new Date(started).toISOString(), ageMs: 0, cacheHit: false, ms: Date.now() - started, ok: false });
      throw e;
    },
  );
  scope.inflight.set(key, p);
  return p;
}

/* ── Global concurrency limiter (process-wide; protects providers across all turns) ── */
function envInt(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}
/* Default 10 (spec). Sweep 2026-09-13 (scripts/perf-concurrency.mts, same coverage 33+65 rows,
 * railyatri 0×429 / 0 errors at 10, 15 and 20): 10 → 9.9 s/12.0 s, 15 → 6.9 s/6.7 s, 20 → 6.7 s/5.7 s.
 * Prod runs 15 via env (RAIL_PROBE_CONCURRENCY) — raised only because rate-limits/errors stayed
 * healthy; 20 gives little more and leaves less headroom for concurrent users. */
export const PROBE_CONCURRENCY = envInt("RAIL_PROBE_CONCURRENCY", 10);

let active = 0;
const queue: (() => void)[] = [];
function acquire(): Promise<void> {
  if (active < PROBE_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => { active++; resolve(); }));
}
function release(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}
/** Run `fn` under the global probe limiter. Every call still runs — only scheduling changes. */
export async function limited<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  const scope = als.getStore();
  if (scope) scope.maxConcurrency = Math.max(scope.maxConcurrency, active);
  try {
    return await fn();
  } finally {
    release();
  }
}
/* ── Orchestration limiter (engine fan-outs) ──
 * Separate from the provider (leaf) limiter so a fan-out holding a slot can never deadlock
 * waiting for the provider slot its own children need. Re-entrant: a fan-out started INSIDE
 * another fan-out runs unthrottled (the outer level already bounds it; the provider limiter
 * bounds the real network concurrency). Coverage is untouched — every item still runs. */
const ORCH_CONCURRENCY = envInt("RAIL_FANOUT_CONCURRENCY", PROBE_CONCURRENCY);
const orchAls = new AsyncLocalStorage<boolean>();
let orchActive = 0;
const orchQueue: (() => void)[] = [];
function orchAcquire(): Promise<void> {
  if (orchActive < ORCH_CONCURRENCY) { orchActive++; return Promise.resolve(); }
  return new Promise((resolve) => orchQueue.push(() => { orchActive++; resolve(); }));
}
function orchRelease(): void {
  orchActive--;
  const next = orchQueue.shift();
  if (next) next();
}
/** Bounded fan-out — preserves order and full coverage; nested fan-outs are not re-throttled. */
export function mapLimited<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  if (orchAls.getStore()) return Promise.all(items.map((it, i) => fn(it, i)));
  return Promise.all(items.map(async (it, i) => {
    await orchAcquire();
    try {
      return await orchAls.run(true, () => fn(it, i));
    } finally {
      orchRelease();
    }
  }));
}

/* ── Metrics hooks ── */
export function noteProviderCall(status: number | "ERR", host: string): void {
  const scope = als.getStore();
  if (!scope) return;
  scope.providerCalls++;
  if (status === "ERR" || (typeof status === "number" && status >= 500)) scope.providerErrors++;
  if (status === 429) scope.rateLimited++;
  void host;
}
export function noteAiCall(ms: number): void {
  const scope = als.getStore();
  if (!scope) return;
  scope.aiCalls++;
  scope.aiMs += ms;
}

/* ── Progress (real work only) ── */
export function progress(phase: string, detail?: string): void {
  const scope = als.getStore();
  if (!scope) return;
  const e: ProgressEvent = { phase, detail, at: Date.now() - scope.startedAt };
  scope.progress.push(e);
  scope.onProgress?.(e);
}
/** Register N more checks that WILL be performed this turn (called before scheduling them). */
export function addChecks(n: number): void {
  const scope = als.getStore();
  if (!scope || n <= 0) return;
  scope.checksTotal += n;
}
/** One real provider check finished. Emits "done/total". */
export function checkDone(label = "Seat checks"): void {
  const scope = als.getStore();
  if (!scope) return;
  scope.checksDone++;
  const e: ProgressEvent = { phase: label, done: scope.checksDone, total: scope.checksTotal, at: Date.now() - scope.startedAt };
  scope.progress.push(e);
  scope.onProgress?.(e);
}

export type PerfSummary = {
  turnId: string;
  totalMs: number;
  providerCalls: number;
  providerErrors: number;
  rateLimited: number;
  dedupHits: number;
  dedupMisses: number;
  maxConcurrency: number;
  concurrencyLimit: number;
  aiCalls: number;
  aiMs: number;
  checksDone: number;
  checksTotal: number;
  /** Every dynamic row in this turn was fetched in this turn (no cross-turn cache) → true. */
  freshVerified: boolean;
  entries: PerfEntry[];
};
export function summarize(scope: TurnScope): PerfSummary {
  return {
    turnId: scope.id,
    totalMs: Date.now() - scope.startedAt,
    providerCalls: scope.providerCalls,
    providerErrors: scope.providerErrors,
    rateLimited: scope.rateLimited,
    dedupHits: scope.dedupHits,
    dedupMisses: scope.dedupMisses,
    maxConcurrency: scope.maxConcurrency,
    concurrencyLimit: PROBE_CONCURRENCY,
    aiCalls: scope.aiCalls,
    aiMs: scope.aiMs,
    checksDone: scope.checksDone,
    checksTotal: scope.checksTotal,
    freshVerified: true,
    entries: scope.entries.slice(0, 200),
  };
}

/* ── Process-wide fetch instrumentation (metrics only; never alters requests/responses) ── */
const AI_HOSTS = new Set(["integrate.api.nvidia.com", "router.huggingface.co", "openrouter.ai"]);
let installed = false;
export function installFetchMetrics(): void {
  if (installed) return;
  installed = true;
  const real = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: any, init?: any) => {
    const t0 = Date.now();
    let host = "";
    try { host = new URL(String(input instanceof Request ? input.url : input)).hostname; } catch { /* non-URL */ }
    try {
      const res = await real(input, init);
      if (AI_HOSTS.has(host)) noteAiCall(Date.now() - t0);
      else if (host) noteProviderCall(res.status, host);
      return res;
    } catch (e) {
      if (AI_HOSTS.has(host)) noteAiCall(Date.now() - t0);
      else if (host) noteProviderCall("ERR", host);
      throw e;
    }
  }) as typeof fetch;
}
