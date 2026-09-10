/**
 * Round-18 — PROVIDER CAPABILITY REGISTRY.
 *
 * Har provider (API adapters + verified web-scrape sites) ke liye kaun si
 * RailBook internal capability actually usable hai. Backend sirf supported
 * capabilities hi select karta hai; jo kahin available nahi hai (jaise
 * berth-level vacant seats, post-chart vacancy, reliability score) uske liye
 * UI ko honest "unavailable" message jaata hai — kabhi fake nahi.
 *
 * Verified 2026-09-08..10 by probing real endpoints:
 *  - RailCore  https://ir.railcore.tech/v1  (300/day; often credits-exhausted)
 *  - RailKit   SDK v4.1.0 (10 functions, no berth/chart API)
 *  - RailRadar https://api.railradar.in/v1  (/seats, /fare, /live, /coaches, /trains/between, lookup)
 *  - IndianRailAPI (key required — INDIANRAILAPI_KEY abhi set nahi)
 *  - Web: erail (schedule/trains-between/train list/fare), railyatri (SA seat
 *    availability + live), confirmtkt/ixigo/trainspnrstatus (schedule), Wikipedia (facts)
 */
import { env } from "../env.js";
import { railcoreBlockState } from "../railway/railcore.js";

export const CAPABILITIES = [
  "SEARCH_TRAINS",
  "GET_TRAIN_INFO",
  "GET_TIMETABLE",
  "TRACK_TRAIN",
  "TRAIN_HISTORY",
  "CHECK_AVAILABILITY",
  "GET_FARE",
  "CHECK_PNR",
  "GET_CANCELLED_TRAINS",
  "GET_COACH_POSITION",
  "STATION_SEARCH",
  "STATION_BOARD",
  "SEARCH_TRAIN_BY_NUMBER",
  "SEARCH_TRAIN_BY_NAME",
  "RANK_JOURNEY_OPTIONS",
  "FIND_ALTERNATIVE_TRAINS",
  "FIND_CONNECTIONS",
  "FIND_PARTIAL_ROUTE_OPTIONS",
  "FIND_VACANT_SEATS_CLASS_LEVEL",
  "FIND_VACANT_SEATS_BERTH_LEVEL",
  "POST_CHART_VACANCY",
  "SAME_TRAIN_SWITCH",
  "RELIABILITY_SCORE",
  "GENERAL_FACTS",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type CapabilityState = "available" | "unavailable" | "needs_key" | "derived";
export type ProviderId = "railcore" | "railkit" | "railradar" | "indianrailapi" | "web" | "engine";
export type SourceType = "api" | "web_scrape" | "derived" | "local";

export type ProviderCapabilities = {
  id: ProviderId;
  label: string;
  sourceType: SourceType;
  /** Lower = higher priority when two sources disagree. */
  priority: number;
  configured: boolean;
  /** Runtime block (RailCore daily limit etc.) — capabilities still "available" by design, but currently not serving. */
  blocked: boolean;
  capabilities: Partial<Record<Capability, CapabilityState>>;
  note?: string;
};

/* ── Static design-time registry (what each adapter CAN do when configured) ── */
const RAILCORE: Partial<Record<Capability, CapabilityState>> = {
  SEARCH_TRAINS: "available",
  GET_TRAIN_INFO: "available",
  GET_TIMETABLE: "available",
  TRACK_TRAIN: "available",
  TRAIN_HISTORY: "available",
  CHECK_AVAILABILITY: "available",
  GET_FARE: "available",
  CHECK_PNR: "available",
  GET_CANCELLED_TRAINS: "available",
  GET_COACH_POSITION: "available",
  STATION_SEARCH: "available",
  STATION_BOARD: "available",
  SEARCH_TRAIN_BY_NUMBER: "available",
  SEARCH_TRAIN_BY_NAME: "available",
  FIND_VACANT_SEATS_CLASS_LEVEL: "available",
  FIND_VACANT_SEATS_BERTH_LEVEL: "unavailable",
  POST_CHART_VACANCY: "unavailable",
  RELIABILITY_SCORE: "unavailable",
};
const RAILKIT: Partial<Record<Capability, CapabilityState>> = {
  SEARCH_TRAINS: "available",
  GET_TRAIN_INFO: "available",
  GET_TIMETABLE: "available",
  TRACK_TRAIN: "available",
  TRAIN_HISTORY: "available",
  CHECK_AVAILABILITY: "available",
  GET_FARE: "available",
  CHECK_PNR: "available",
  GET_CANCELLED_TRAINS: "available",
  STATION_BOARD: "available",
  SEARCH_TRAIN_BY_NUMBER: "available",
  FIND_VACANT_SEATS_CLASS_LEVEL: "available",
  FIND_VACANT_SEATS_BERTH_LEVEL: "unavailable",
  POST_CHART_VACANCY: "unavailable",
  RELIABILITY_SCORE: "unavailable",
};
const RAILRADAR: Partial<Record<Capability, CapabilityState>> = {
  SEARCH_TRAINS: "available",
  GET_TRAIN_INFO: "available",
  GET_TIMETABLE: "available",
  TRACK_TRAIN: "available",
  TRAIN_HISTORY: "available",
  CHECK_AVAILABILITY: "available",
  GET_FARE: "available",
  GET_COACH_POSITION: "available",
  STATION_SEARCH: "available",
  SEARCH_TRAIN_BY_NUMBER: "available",
  SEARCH_TRAIN_BY_NAME: "available",
  FIND_VACANT_SEATS_CLASS_LEVEL: "available",
  FIND_VACANT_SEATS_BERTH_LEVEL: "unavailable",
  POST_CHART_VACANCY: "unavailable",
  RELIABILITY_SCORE: "unavailable",
};
const INDIANRAILAPI: Partial<Record<Capability, CapabilityState>> = {
  SEARCH_TRAINS: "needs_key",
  GET_TIMETABLE: "needs_key",
  TRACK_TRAIN: "needs_key",
  CHECK_AVAILABILITY: "needs_key",
  GET_FARE: "needs_key",
  GET_COACH_POSITION: "needs_key",
  STATION_SEARCH: "needs_key",
  SEARCH_TRAIN_BY_NAME: "needs_key",
  FIND_VACANT_SEATS_BERTH_LEVEL: "unavailable",
  POST_CHART_VACANCY: "unavailable",
  RELIABILITY_SCORE: "unavailable",
};
/** Verified web sites (Round-16 scrape layer): erail, railyatri, confirmtkt, ixigo, trainspnrstatus, Wikipedia. */
const WEB: Partial<Record<Capability, CapabilityState>> = {
  SEARCH_TRAINS: "available", // erail getTrains
  GET_TRAIN_INFO: "available", // schedule pages
  GET_TIMETABLE: "available", // ixigo / confirmtkt / trainspnrstatus / erail
  TRACK_TRAIN: "available", // railyatri live-train-status
  CHECK_AVAILABILITY: "available", // railyatri SA API (IRCTC data)
  GET_FARE: "available", // railyatri segment fare / erail route fare
  STATION_SEARCH: "available", // erail stations.js + bundled list
  SEARCH_TRAIN_BY_NUMBER: "available", // erail IRTrains.js
  SEARCH_TRAIN_BY_NAME: "available",
  GENERAL_FACTS: "available", // Wikipedia / canonical pages
  CHECK_PNR: "unavailable",
  GET_CANCELLED_TRAINS: "unavailable",
  GET_COACH_POSITION: "unavailable",
  FIND_VACANT_SEATS_BERTH_LEVEL: "unavailable",
  POST_CHART_VACANCY: "unavailable",
  RELIABILITY_SCORE: "unavailable",
};
/** RailBook engine — derived deterministically from the above (no own data). */
const ENGINE: Partial<Record<Capability, CapabilityState>> = {
  RANK_JOURNEY_OPTIONS: "derived",
  FIND_ALTERNATIVE_TRAINS: "derived",
  FIND_CONNECTIONS: "derived",
  FIND_PARTIAL_ROUTE_OPTIONS: "derived",
  SAME_TRAIN_SWITCH: "derived",
  FIND_VACANT_SEATS_CLASS_LEVEL: "derived",
  FIND_VACANT_SEATS_BERTH_LEVEL: "unavailable",
  POST_CHART_VACANCY: "unavailable",
  RELIABILITY_SCORE: "unavailable",
};

export function providerRegistry(): ProviderCapabilities[] {
  const rcBlocked = (() => {
    try {
      return railcoreBlockState().blocked;
    } catch {
      return false;
    }
  })();
  return [
    { id: "railcore", label: "RailCore API", sourceType: "api", priority: 1, configured: Boolean(env.railcoreApiKey), blocked: rcBlocked, capabilities: RAILCORE, note: "300 req/day, 20/min. Segment availability sometimes NOT_FOUND → endpoint fallback (labelled)." },
    { id: "railkit", label: "RailKit SDK", sourceType: "api", priority: 2, configured: Boolean(process.env.RAILKIT_API_KEY), blocked: false, capabilities: RAILKIT },
    { id: "railradar", label: "RailRadar API", sourceType: "api", priority: 3, configured: Boolean(process.env.RAILRADAR_API_KEY), blocked: false, capabilities: RAILRADAR, note: "1,000 req/month free tier." },
    { id: "indianrailapi", label: "Indian Rail API", sourceType: "api", priority: 4, configured: Boolean(process.env.INDIANRAILAPI_KEY), blocked: false, capabilities: INDIANRAILAPI, note: "INDIANRAILAPI_KEY not configured — all capabilities needs_key." },
    { id: "web", label: "Verified web sources (erail / railyatri / confirmtkt / ixigo / Wikipedia)", sourceType: "web_scrape", priority: 5, configured: true, blocked: false, capabilities: WEB, note: "Last-resort scrape; every answer labelled with site + 'as of' time." },
    { id: "engine", label: "RailBook Atlas engine (derived)", sourceType: "derived", priority: 9, configured: true, blocked: false, capabilities: ENGINE },
  ];
}

/** Providers (in priority order) that can serve a capability right now. */
export function supportedProvidersFor(cap: Capability): ProviderCapabilities[] {
  return providerRegistry()
    .filter((p) => p.configured && !p.blocked && (p.capabilities[cap] === "available" || p.capabilities[cap] === "derived"))
    .sort((a, b) => a.priority - b.priority);
}

/** Is a capability available from ANY configured provider? */
export function capabilityAvailable(cap: Capability): boolean {
  return supportedProvidersFor(cap).length > 0;
}

/** Honest user-facing message for capabilities nobody serves. */
export const UNAVAILABLE_MESSAGES: Partial<Record<Capability, string>> = {
  FIND_VACANT_SEATS_BERTH_LEVEL: "Seat recovery data is currently unavailable.",
  POST_CHART_VACANCY: "Seat recovery data is currently unavailable.",
  RELIABILITY_SCORE: "Reliability/punctuality data is currently unavailable.",
};

/** Public payload for /api/capabilities (no secrets). */
export function publicCapabilityPayload() {
  const reg = providerRegistry();
  const matrix: Record<Capability, { available: boolean; providers: ProviderId[]; message?: string }> = {} as never;
  for (const cap of CAPABILITIES) {
    const p = supportedProvidersFor(cap).map((x) => x.id);
    matrix[cap] = { available: p.length > 0, providers: p, ...(p.length ? {} : { message: UNAVAILABLE_MESSAGES[cap] ?? "Currently unavailable from all configured providers." }) };
  }
  return { providers: reg.map((p) => ({ id: p.id, label: p.label, sourceType: p.sourceType, priority: p.priority, configured: p.configured, blocked: p.blocked, capabilities: p.capabilities, note: p.note })), matrix };
}
