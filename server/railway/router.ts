import { scrapeTrainScheduleWeb } from "./webscrape.js";
import { env } from "../env.js";
import { searchStations as searchLocalStations } from "../data/stations.js";
import {
  CLASS_LABELS,
  type ClassAvailability,
  type ClassCode,
  type FareBreakdown,
  type RailwayProvider,
  type SearchQuery,
  type Station,
  type TrainResult,
} from "../providers/types.js";
import {
  RailCoreProvider,
  isUsableLive,
  coachPosition as railcoreCoachPosition,
  liveTrainStatus as railcoreLive,
  searchRailcoreStationsResult,
  trainInfo as railcoreTrainInfo,
  trainSchedule as railcoreSchedule,
  type RailcoreCoachPosition,
  type RailcoreLiveStatus,
  type RailcoreSchedule,
} from "./railcore.js";
import {
  RailKitProvider,
  cancelledTrains as railkitCancelled,
  liveTrainStatus as railkitLive,
  loadClassBoard as railkitClassBoard,
  pnrStatus as railkitPnr,
  searchRailkitStations,
  trainSchedule as railkitSchedule,
  type LiveTrainStatus,
  type PnrLookup,
  type TrainSchedule,
} from "./railkit.js";
import { durationLabel } from "../util.js";
import { MULTI_STATION_CITIES, isClusterStation, pickStations } from "./station-resolve.js";
import { STATIONS as LOCAL_STATIONS } from "../data/stations.js";

function enrichClusterHits(query: string, hits: Station[]): Station[] {
  const key = query.trim().toLowerCase();
  const group = MULTI_STATION_CITIES[key];
  if (!group) return hits;
  const have = new Set(hits.map((s) => s.code.toUpperCase()));
  const anyGroup = [...have].some((code) => group.includes(code));
  // Legacy city naam (Calcutta/Madras/Bombay) par API se koi group member nahi
  // mila — par query EXACT city key hai (city pakki hai). LOCAL dataset ke real
  // stations hi options denge; "not found" bolaate hue model ko improvise
  // (MAS/NBE jaise ungrounded codes) karne par majboor nahi karenge.
  if (!anyGroup) {
    const local = LOCAL_STATIONS.filter((s) => group.includes(s.code.toUpperCase()));
    return local.length ? local : hits;
  }
  // Only complete a real cluster (UMB+UBC). Never invent ERS when API only returned a lookalike.
  const extra = LOCAL_STATIONS.filter((s) => group.includes(s.code.toUpperCase()) && !have.has(s.code.toUpperCase()));
  return extra.length ? [...hits, ...extra] : hits;
}

export type ServedProvider = "railcore" | "railkit_fallback" | "railkit" | "local" | "none" | "web_ixigo" | "web_confirmtkt" | "web_trainspnrstatus";

export type LastRailwayLog = {
  railwayProvider: ServedProvider;
  railwayMethod: string;
  railwayLatencyMs: number;
  railwaySuccess: boolean;
  failureReason?: string;
};

let lastLog: LastRailwayLog | null = null;

export function getLastRailwayLog(): LastRailwayLog | null {
  return lastLog;
}

export function railcoreIsPrimary(): boolean {
  return env.provider === "railcore";
}

function logServed(
  railwayProvider: ServedProvider,
  railwayMethod: string,
  started: number,
  ok: boolean,
  failureReason?: string | null,
): void {
  lastLog = {
    railwayProvider,
    railwayMethod,
    railwayLatencyMs: Date.now() - started,
    railwaySuccess: ok,
    failureReason: failureReason || undefined,
  };
  console.info(JSON.stringify(lastLog));
}

export type StationSearchResult = {
  stations: Station[];
  needChoice: boolean;
  city?: string;
  provider: ServedProvider;
};

export async function routedStationSearch(q: string): Promise<StationSearchResult> {
  const started = Date.now();
  const query = q.trim();
  if (!query) return { stations: [], needChoice: false, provider: "none" };

  if (railcoreIsPrimary()) {
    const remote = await searchRailcoreStationsResult(query);
    if (remote.ok) {
      const pick = pickStations(query, enrichClusterHits(query, remote.stations));
      if (pick.kind === "ambiguous") {
        logServed("railcore", "stationSearch", started, true);
        return { stations: pick.stations, needChoice: true, city: pick.city, provider: "railcore" };
      }
      if (pick.kind === "single") {
        logServed("railcore", "stationSearch", started, true);
        const rest = pick.stations.filter((s) => s.code !== pick.station.code);
        return { stations: [pick.station, ...rest], needChoice: false, provider: "railcore" };
      }
      // RailCore answered but nothing corresponded to the city — do not invent.
      logServed("railcore", "stationSearch", started, true, "no_relevant_station");
      return { stations: [], needChoice: false, provider: "railcore" };
    }
    const local = searchLocalStations(query);
    const pick = pickStations(query, enrichClusterHits(query, local));
    logServed("railkit_fallback", "stationSearch", started, pick.kind !== "none", remote.failureReason);
    if (pick.kind === "ambiguous") {
      return { stations: pick.stations, needChoice: true, city: pick.city, provider: "railkit_fallback" };
    }
    if (pick.kind === "single") {
      return { stations: pick.stations, needChoice: false, provider: "railkit_fallback" };
    }
    return { stations: local, needChoice: false, provider: "railkit_fallback" };
  }

  const local = await searchRailkitStations(query);
  return { stations: local, needChoice: false, provider: env.provider === "railkit" ? "railkit" : "local" };
}

export type RoutedLive = {
  live: (RailcoreLiveStatus | LiveTrainStatus) | null;
  provider: ServedProvider;
};

export async function routedLiveStatus(number: string, dateYmd?: string): Promise<RoutedLive> {
  const started = Date.now();
  if (railcoreIsPrimary()) {
    const primary = await railcoreLive(number, dateYmd);
    if (isUsableLive(primary)) {
      logServed("railcore", "liveStatus", started, true);
      return { live: primary, provider: "railcore" };
    }
    const fb = await railkitLive(number, dateYmd);
    if (fb) {
      logServed("railkit_fallback", "liveStatus", started, true, "railcore_unusable");
      return { live: fb, provider: "railkit_fallback" };
    }
    logServed("none", "liveStatus", started, false, "both_failed");
    return { live: null, provider: "none" };
  }
  const live = await railkitLive(number, dateYmd);
  logServed(live ? "railkit" : "none", "liveStatus", started, Boolean(live));
  return { live, provider: live ? "railkit" : "none" };
}

export type RoutedSchedule = {
  schedule:
    | RailcoreSchedule
    | TrainSchedule
    | null;
  provider: ServedProvider;
};

/** Verified-site web-scrape ka result RailcoreSchedule-shape mein (last-resort). */
function scrapedAsSchedule(sc: Awaited<ReturnType<typeof scrapeTrainScheduleWeb>>): RailcoreSchedule | null {
  if (!sc) return null;
  return {
    trainNumber: sc.trainNumber,
    trainName: sc.trainName ?? "",
    runningDays: [],
    classes: [],
    durationMinutes: null,
    stops: sc.stops.map((st) => ({
      code: st.code,
      name: st.name,
      arrival: st.arrival,
      departure: st.departure,
    })),
  };
}

export async function routedSchedule(number: string): Promise<RoutedSchedule> {
  const started = Date.now();
  if (railcoreIsPrimary()) {
    const primary = await railcoreSchedule(number);
    if (primary && (primary.stops.length || primary.trainName)) {
      logServed("railcore", "timetable", started, true);
      return { schedule: primary, provider: "railcore" };
    }
    const fb = await railkitSchedule(number);
    if (fb) {
      logServed("railkit_fallback", "timetable", started, true, "railcore_unusable");
      return { schedule: fb, provider: "railkit_fallback" };
    }
    /* VERIFIED-SITE WEB SCRAPING (user request 2026-09-06): API dono fail →
     * public verified sites (ixigo/ConfirmTkt/trainspnrstatus) se scrape.
     * Provider label "web_<site>" — reply mein source saaf dikhta hai. */
    const sc = await scrapeTrainScheduleWeb(number);
    if (sc) {
      logServed(sc.provider, "timetable", started, true, "railcore+railkit_failed → web-scrape");
      return { schedule: scrapedAsSchedule(sc), provider: sc.provider };
    }
    logServed("none", "timetable", started, false, "both_failed");
    return { schedule: null, provider: "none" };
  }
  const schedule = await railkitSchedule(number);
  if (schedule) return { schedule, provider: "railkit" };
  const sc2 = await scrapeTrainScheduleWeb(number);
  if (sc2) {
    logServed(sc2.provider, "timetable", started, true, "railkit_failed → web-scrape");
    return { schedule: scrapedAsSchedule(sc2), provider: sc2.provider };
  }
  return { schedule: null, provider: "none" };
}

export async function routedTrainInfo(number: string): Promise<{
  info: { trainNumber: string; trainName: string; runningDays: string[] } | null;
  provider: ServedProvider;
}> {
  const started = Date.now();
  if (railcoreIsPrimary()) {
    const primary = await railcoreTrainInfo(number);
    if (primary?.trainName) {
      logServed("railcore", "trainInfo", started, true);
      return { info: primary, provider: "railcore" };
    }
    const fb = await railkitSchedule(number);
    if (fb) {
      logServed("railkit_fallback", "trainInfo", started, true, "railcore_unusable");
      return {
        info: { trainNumber: fb.trainNumber, trainName: fb.trainName, runningDays: [] },
        provider: "railkit_fallback",
      };
    }
    logServed("none", "trainInfo", started, false, "both_failed");
    return { info: null, provider: "none" };
  }
  const fb = await railkitSchedule(number);
  return {
    info: fb ? { trainNumber: fb.trainNumber, trainName: fb.trainName, runningDays: [] } : null,
    provider: fb ? "railkit" : "none",
  };
}

export type RoutedCoachPosition = {
  coachPosition: RailcoreCoachPosition | null;
  provider: ServedProvider;
};

/**
 * Coach composition is RailCore-only (`GET /v1/trains/:n/coach-position`).
 * RailKit has no such endpoint, so a failed/empty primary call stays honestly
 * empty instead of showing an invented layout.
 */
export async function routedCoachPosition(number: string, stationCode?: string): Promise<RoutedCoachPosition> {
  const started = Date.now();
  if (railcoreIsPrimary() && env.railcoreApiKey) {
    const primary = await railcoreCoachPosition(number, stationCode);
    if (primary) {
      logServed("railcore", "coachPosition", started, true);
      return { coachPosition: primary, provider: "railcore" };
    }
    logServed("none", "coachPosition", started, false, "railcore_unavailable");
    return { coachPosition: null, provider: "none" };
  }
  logServed("none", "coachPosition", started, false, "coach_position_unsupported");
  return { coachPosition: null, provider: "none" };
}

export async function routedPnr(pnr: string): Promise<PnrLookup | null> {
  const started = Date.now();
  const remote = await railkitPnr(pnr);
  logServed(remote ? "railkit" : "none", "checkPNRStatus", started, Boolean(remote), remote ? null : "pnr_unavailable");
  return remote;
}

export async function routedCancelled(): Promise<{ fully: unknown[]; partial: unknown[] } | null> {
  const started = Date.now();
  const list = await railkitCancelled();
  logServed(list ? "railkit" : "none", "cancelList", started, Boolean(list), list ? null : "cancel_list_unavailable");
  return list;
}

const KNOWN_BOARD: ClassCode[] = ["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"];

function asClassCodes(raw: string[] | undefined): ClassCode[] {
  return [...new Set((raw ?? []).map((c) => c.toUpperCase()))].filter((c): c is ClassCode =>
    (KNOWN_BOARD as string[]).includes(c),
  );
}

export async function routedClassBoard(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  quota = "GN",
  hintClasses: string[] = [],
): Promise<{ classes: ClassAvailability[]; provider: ServedProvider }> {
  const started = Date.now();
  const provider = getFallbackProvider();
  if (railcoreIsPrimary()) {
    // Search already returns class codes — skip the extra schedule round-trip.
    let codes = asClassCodes(hintClasses);
    if (!codes.length) {
      const info = await railcoreSchedule(trainNumber);
      codes = asClassCodes(info?.classes);
    }
    if (codes.length) {
      const classes = await Promise.all(
        codes.map((code) => provider.getAvailability(trainNumber, date, from, to, code, quota)),
      );
      const ok = classes.some((c) => c.status !== "UNKNOWN");
      logServed(ok ? "railcore" : "none", "classBoard", started, ok);
      return { classes, provider: ok ? "railcore" : "none" };
    }
    const fb = await railkitClassBoard(trainNumber, date, from, to, quota);
    logServed("railkit_fallback", "classBoard", started, fb.length > 0, "railcore_no_classes");
    return { classes: fb, provider: fb.length ? "railkit_fallback" : "none" };
  }
  const classes = await railkitClassBoard(trainNumber, date, from, to, quota);
  return { classes, provider: "railkit" };
}

function stopIndex(stops: { code: string }[], code: string): number {
  const want = code.toUpperCase();
  return stops.findIndex((s) => s.code.toUpperCase() === want);
}

type StopRow = { code: string; name: string; arrival?: string | null; departure?: string | null };

const scheduleCache = new Map<string, StopRow[] | null>();

export function clearScheduleCache(): void {
  scheduleCache.clear();
}

async function loadStops(trainNumber: string): Promise<StopRow[] | null> {
  const cached = scheduleCache.get(trainNumber);
  if (cached !== undefined) return cached;
  let stops: StopRow[] = ((await railcoreSchedule(trainNumber))?.stops ?? []).map((s) => ({
    code: s.code,
    name: s.name,
    arrival: s.arrival,
    departure: s.departure,
  }));
  if (!stops.length) {
    const kit = await railkitSchedule(trainNumber);
    stops = (kit?.stops ?? []).map((s) => ({
      code: s.code,
      name: s.name,
      arrival: s.arrival && s.arrival !== "--" ? s.arrival : null,
      departure: s.departure && s.departure !== "--" ? s.departure : null,
    }));
  }
  const value = stops.length ? stops : null;
  scheduleCache.set(trainNumber, value);
  return value;
}

function hhmmMinutes(raw: string | null | undefined): number | null {
  const m = String(raw ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Keep only trains whose timetable actually calls both requested stations, in order. */
export async function filterTrainsServingStops(
  trains: TrainResult[],
  from: string,
  to: string,
): Promise<TrainResult[]> {
  if (!trains.length) return trains;
  const kept: TrainResult[] = [];
  await Promise.all(
    trains.map(async (train) => {
      const stops = await loadStops(train.number);
      if (!stops?.length) {
        // Cannot confirm — do not invent a halt, but do not wipe a valid search if timetable is down.
        if (!isClusterStation(from) && !isClusterStation(to)) kept.push(train);
        return;
      }
      const fromIdx = stopIndex(stops, from);
      const toIdx = stopIndex(stops, to);
      if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) return;
      const fromStop = stops[fromIdx];
      const toStop = stops[toIdx];
      const dep = fromStop.departure || train.departure;
      const arr = toStop.arrival || train.arrival;
      const start = hhmmMinutes(dep);
      const end = hhmmMinutes(arr);
      let durationMinutes = train.durationMinutes;
      if (start != null && end != null) {
        durationMinutes = end >= start ? end - start : end + 1440 - start;
      }
      kept.push({
        ...train,
        from: { code: fromStop.code, name: fromStop.name, city: fromStop.name },
        to: { code: toStop.code, name: toStop.name, city: toStop.name },
        departure: dep,
        arrival: arr,
        durationMinutes,
        durationLabel: durationLabel(durationMinutes || 0),
      });
    }),
  );
  kept.sort((a, b) => a.departure.localeCompare(b.departure));
  return kept;
}

export class FallbackRailwayProvider implements RailwayProvider {
  readonly id = "railcore";
  private readonly core = new RailCoreProvider();
  private readonly kit = new RailKitProvider();

  get displayName() {
    return env.railcoreApiKey ? "RailCore (RailKit fallback)" : "RailCore (not configured)";
  }
  get mock() {
    return !env.railcoreApiKey && !env.railkitApiKey;
  }

  async searchTrains(query: SearchQuery): Promise<TrainResult[]> {
    const started = Date.now();
    const primary = await this.core.trySearchTrains(query);
    if (primary.ok) {
      logServed("railcore", "trainSearch", started, true);
      return filterTrainsServingStops(primary.trains, query.from, query.to);
    }
    if (!env.railkitApiKey) {
      logServed("none", "trainSearch", started, false, primary.failureReason ?? "railcore_failed");
      return [];
    }
    const fb = await this.kit.searchTrainsDetailed(query);
    if (!fb.ok) {
      // Dono providers fail — "0 trains" bolna jhooth hai. "none" label hi
      // upstream (SEARCH_TRAINS/JOURNEY_ANALYZE) ko honest unavailable deta hai.
      logServed("none", "trainSearch", started, false, `${primary.failureReason ?? "railcore_failed"}+railkit_failed`);
      return [];
    }
    logServed("railkit_fallback", "trainSearch", started, true, primary.failureReason ?? "railcore_failed");
    return filterTrainsServingStops(fb.trains, query.from, query.to);
  }

  async getAvailability(
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    quotaCode = "GN",
  ): Promise<ClassAvailability> {
    const started = Date.now();
    const unknown: ClassAvailability = {
      code: classCode,
      label: CLASS_LABELS[classCode],
      status: "UNKNOWN",
      fare: 0,
    };
    if (env.railcoreApiKey) {
      const primary = await this.core.getAvailability(trainNumber, date, from, to, classCode, quotaCode);
      if (primary.status !== "UNKNOWN") {
        logServed("railcore", "availability", started, true);
        return primary;
      }
    }
    if (!env.railkitApiKey) {
      logServed("none", "availability", started, false, "both_unavailable");
      return unknown;
    }
    const fb = await this.kit.getAvailability(trainNumber, date, from, to, classCode, quotaCode);
    logServed(
      fb.status === "UNKNOWN" ? "none" : "railkit_fallback",
      "availability",
      started,
      fb.status !== "UNKNOWN",
      "railcore_unusable",
    );
    return fb;
  }

  async getFare(
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    passengerCount: number,
  ): Promise<FareBreakdown> {
    const started = Date.now();
    if (env.railcoreApiKey) {
      const primary = await this.core.getFare(trainNumber, date, from, to, classCode, passengerCount);
      if (primary.railwayAvailable) {
        logServed("railcore", "fare", started, true);
        return primary;
      }
    }
    if (!env.railkitApiKey) {
      const empty = await this.core.getFare(trainNumber, date, from, to, classCode, passengerCount);
      logServed("none", "fare", started, false, "both_unavailable");
      return empty;
    }
    const fb = await this.kit.getFare(trainNumber, date, from, to, classCode, passengerCount);
    logServed("railkit_fallback", "fare", started, Boolean(fb.railwayAvailable), "railcore_unusable");
    return fb;
  }

  async createBooking(req: Parameters<RailwayProvider["createBooking"]>[0]) {
    const fare = await this.getFare(
      req.trainNumber,
      req.date,
      req.from,
      req.to,
      req.classCode,
      req.passengers.length,
    );
    const rec = await this.core.createBooking(req);
    rec.fare = fare;
    return rec;
  }
  confirmBooking(id: string) {
    return this.core.confirmBooking(id);
  }
  getBooking(id: string) {
    return this.core.getBooking(id);
  }
  listBookings() {
    return this.core.listBookings();
  }
  cancelBooking(id: string) {
    return this.core.cancelBooking(id);
  }
}

let fallbackInstance: FallbackRailwayProvider | null = null;

export function getFallbackProvider(): FallbackRailwayProvider {
  if (!fallbackInstance) fallbackInstance = new FallbackRailwayProvider();
  return fallbackInstance;
}

export function resetFallbackProvider(): void {
  fallbackInstance = null;
  clearScheduleCache();
}

/**
 * True when RailCore search should fall back because the primary call itself failed.
 * Empty successful lists are handled by FallbackRailwayProvider.searchTrains.
 * Tests inject failures via setRailcoreFetch.
 */
export async function searchTrainsRouted(query: SearchQuery): Promise<{ trains: TrainResult[]; provider: ServedProvider }> {
  const p = getFallbackProvider();
  if (!railcoreIsPrimary()) {
    const kit = new RailKitProvider();
    const trains = await kit.searchTrains(query);
    return { trains, provider: "railkit" };
  }
  const trains = await p.searchTrains(query);
  return { trains, provider: getLastRailwayLog()?.railwayProvider ?? "railcore" };
}
