/**
 * Round-18 — PROVENANCE, FRESHNESS & DATA-CONFLICT RESOLUTION.
 *
 * Har dynamic railway value ke saath: retrievedAt, source, sourceType,
 * requestDate, travelDate, freshness. Do sources disagree karein to:
 *   - kabhi combine/average NAHI (10 + 15 ≠ 25)
 *   - source priority (API > web) + freshness + data-type rule
 *   - safely resolve na ho → `conflict: true` + user message
 *     "Data sources are conflicting right now. Please retry."
 */
import { providerRegistry, type SourceType } from "./capabilities.js";

export type Freshness = "live" | "fresh" | "recent" | "stale" | "unknown";

export type Provenance = {
  source: string;
  sourceType: SourceType;
  /** When RailBook fetched the value (ISO). */
  retrievedAt: string;
  /** Provider's own "last updated" if it gives one (ISO or raw string). */
  providerUpdatedAt?: string | null;
  /** Date the user asked on (IST YYYY-MM-DD). */
  requestDate: string;
  /** Travel date the value is about (YYYY-MM-DD) if applicable. */
  travelDate?: string | null;
  freshness: Freshness;
  /** Human label for the UI/LLM, e.g. "railyatri.in (IRCTC data) · as of 10:05". */
  label: string;
};

export type Sourced<T> = { value: T; provenance: Provenance };

export const CONFLICT_MESSAGE = "Data sources are conflicting right now. Please retry.";

/** Priority: lower is better. Unknown sources sort last. */
export function sourcePriority(source: string): number {
  const s = source.toLowerCase();
  if (s.startsWith("railcore")) return 1;
  if (s.startsWith("railkit")) return 2;
  if (s === "railradar") return 3;
  if (s === "indianrailapi") return 4;
  if (s.startsWith("web_")) return 5;
  if (s === "local") return 6;
  return 9;
}

export function sourceTypeOf(source: string): SourceType {
  const s = source.toLowerCase();
  if (s.startsWith("web_")) return "web_scrape";
  if (s === "local") return "local";
  if (s === "engine" || s === "derived") return "derived";
  return "api";
}

export type DataKind = "live_status" | "availability" | "fare" | "schedule" | "static";

/** Freshness thresholds per data type (minutes). Schedule/static data does not go stale by the minute. */
const STALE_AFTER_MIN: Record<DataKind, { fresh: number; recent: number }> = {
  live_status: { fresh: 5, recent: 20 },
  availability: { fresh: 15, recent: 60 },
  fare: { fresh: 24 * 60, recent: 7 * 24 * 60 },
  schedule: { fresh: 30 * 24 * 60, recent: 90 * 24 * 60 },
  static: { fresh: 365 * 24 * 60, recent: 365 * 24 * 60 },
};

function parseWhen(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return t;
  /* "10:05" / "10:05 AM" style (railyatri) — today IST assumed by provider; treat as unknown clock to avoid lying. */
  return null;
}

export function freshnessOf(kind: DataKind, retrievedAt: string, providerUpdatedAt?: string | null, now = Date.now()): Freshness {
  const basis = parseWhen(providerUpdatedAt) ?? parseWhen(retrievedAt);
  if (basis == null) return "unknown";
  const ageMin = Math.max(0, (now - basis) / 60000);
  const th = STALE_AFTER_MIN[kind];
  if (kind === "live_status" && ageMin <= 2) return "live";
  if (ageMin <= th.fresh) return "fresh";
  if (ageMin <= th.recent) return "recent";
  return "stale";
}

export function makeProvenance(args: {
  source: string;
  kind: DataKind;
  requestDate: string;
  travelDate?: string | null;
  providerUpdatedAt?: string | null;
  retrievedAt?: string;
  now?: number;
}): Provenance {
  const retrievedAt = args.retrievedAt ?? new Date(args.now ?? Date.now()).toISOString();
  const sourceType = sourceTypeOf(args.source);
  const freshness = freshnessOf(args.kind, retrievedAt, args.providerUpdatedAt, args.now);
  const reg = providerRegistry().find((p) => args.source.toLowerCase().startsWith(p.id));
  const siteLabel = args.source.startsWith("web_") ? `${args.source.slice(4)} (web, verified site)` : (reg?.label ?? args.source);
  const upd = args.providerUpdatedAt ? ` · provider updated ${args.providerUpdatedAt}` : "";
  const staleTag = freshness === "stale" ? " · STALE" : "";
  return {
    source: args.source,
    sourceType,
    retrievedAt,
    providerUpdatedAt: args.providerUpdatedAt ?? null,
    requestDate: args.requestDate,
    travelDate: args.travelDate ?? null,
    freshness,
    label: `${siteLabel}${upd}${staleTag}`,
  };
}

/* ── Conflict resolution ──────────────────────────────────────────────── */
export type Candidate<T> = { value: T; source: string; retrievedAt?: string; providerUpdatedAt?: string | null };

export type Resolution<T> =
  | { ok: true; value: T; source: string; conflict: false; discarded: { source: string; value: T }[]; rule: string }
  | { ok: false; conflict: true; message: string; candidates: { source: string; value: T }[]; rule: string };

/**
 * Pick ONE value from candidates that may disagree.
 *  - `equals`: how to compare values of this data type.
 *  - Priority rule: highest-priority (API before web) verified value wins.
 *  - Freshness rule (live_status/availability only): if a lower-priority
 *    source is materially fresher (>15 min newer) than the winner, that is a
 *    conflict we do NOT auto-resolve → conflict message (never blend).
 * Never merges/averages values.
 */
export function resolveConflict<T>(kind: DataKind, candidates: Candidate<T>[], equals: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)): Resolution<T> {
  const usable = candidates.filter((c) => c.value != null);
  if (!usable.length) return { ok: false, conflict: true, message: CONFLICT_MESSAGE, candidates: [], rule: "no_values" };
  const sorted = [...usable].sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source));
  const winner = sorted[0];
  const disagree = sorted.slice(1).filter((c) => !equals(c.value, winner.value));
  if (!disagree.length) return { ok: true, value: winner.value, source: winner.source, conflict: false, discarded: [], rule: "agree_or_single" };
  if (kind === "live_status" || kind === "availability") {
    const wT = parseWhen(winner.providerUpdatedAt) ?? parseWhen(winner.retrievedAt);
    const fresher = disagree.find((c) => {
      const t = parseWhen(c.providerUpdatedAt) ?? parseWhen(c.retrievedAt);
      return wT != null && t != null && t - wT > 15 * 60000;
    });
    if (fresher) {
      return { ok: false, conflict: true, message: CONFLICT_MESSAGE, candidates: sorted.map((c) => ({ source: c.source, value: c.value })), rule: "lower_priority_materially_fresher" };
    }
  }
  return { ok: true, value: winner.value, source: winner.source, conflict: false, discarded: disagree.map((c) => ({ source: c.source, value: c.value })), rule: "priority" };
}

/** Availability equality: status + seats/wl/rac must match; fare differences alone are not a conflict. */
export function availabilityEquals(a: { status: string; seats?: number | null; waitlist?: number | null; rac?: number | null }, b: typeof a): boolean {
  return a.status === b.status && (a.seats ?? null) === (b.seats ?? null) && (a.waitlist ?? null) === (b.waitlist ?? null) && (a.rac ?? null) === (b.rac ?? null);
}
