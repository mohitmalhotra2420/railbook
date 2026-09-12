import {
  scrapeCoachPositionWeb,
  scrapeLiveStatusWeb,
  scrapeTrainScheduleWeb,
  scrapeLiveStatusRailEnquiry,
  scrapeTrainFareWeb,
  scrapeStationLookupWeb,
  scrapeSeatAvailabilityWeb,
  scrapeStationSearchWeb,
  scrapeTrainsBetweenWeb,
  scrapeTrainNameSearchWeb,
  type ScrapedTrainRow,
} from "./webscrape.js";
/* Round-16o: ADDITIONAL API fallbacks (optional keys) — RailCore → RailKit →
 * RailRadar → IndianRailAPI → verified-site web-scrape. Existing web-scrape
 * fallbacks untouched; ye sirf unse PEHLE ek aur API try hai. */
import {
  railradarAvailability,
  railradarCoachPosition,
  railradarFare,
  railradarLive,
  railradarRequest,
  railradarSchedule,
  railradarSearchTrains,
  railradarStationSearch,
  railradarTrainNameSearch,
} from "./railradar.js";
import {
  indianRailApiAvailability,
  indianRailApiCoachPosition,
  indianRailApiFare,
  indianRailApiLive,
  indianRailApiSchedule,
  indianRailApiStationSearch,
  indianRailApiTrainNameSearch,
} from "./indianrailapi.js";
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
  railcoreBlockState,
  isUsableLive,
  coachPosition as railcoreCoachPosition,
  liveTrainStatus as railcoreLive,
  railcoreRequest,
  searchRailcoreStationsResult,
  searchRailcoreTrainsByName,
  trainInfo as railcoreTrainInfo,
  type RailcoreTrainNameResult,
  trainSchedule as railcoreSchedule,
  type RailcoreCoachPosition,
  type RailcoreLiveStatus,
  type RailcoreSchedule,
} from "./railcore.js";
import {
  RailKitProvider,
  cancelledTrains as railkitCancelled,
  liveTrainStatus as railkitLive,
  trainHistory as railkitHistory,
  loadClassBoard as railkitClassBoard,
  pnrStatus as railkitPnr,
  searchRailkitStations,
  trainSchedule as railkitSchedule,
  type LiveTrainStatus,
  type PnrLookup,
  type TrainSchedule,
} from "./railkit.js";
import { durationLabel, weekday } from "../util.js";
import { MULTI_STATION_CITIES, isClusterStation, pickStations } from "./station-resolve.js";
import { STATIONS as LOCAL_STATIONS } from "../data/stations.js";

/* Round-16m (user: chat mein HWH ka naam "KOLKATA - ALL STATIONS" aata tha,
 * Howrah nahi): RailCore kuch codes ko marketing/cluster naam deta hai. Jahan
 * hamare curated dataset mein proper naam hai (Howrah Junction, New Delhi…),
 * wahi dikhao — code same rehta hai, sirf label sahi hota hai. */
function preferLocalNames(hits: Station[]): Station[] {
  return hits.map((s) => {
    const local = LOCAL_STATIONS.find((l) => l.code.toUpperCase() === s.code.toUpperCase());
    if (!local) return s;
    const remoteName = String(s.name ?? "").trim();
    const generic = !remoteName || /all stations|^[A-Z .-]+$/.test(remoteName) || remoteName.toUpperCase() === s.code.toUpperCase();
    return generic ? { ...s, name: local.name, city: s.city && s.city !== remoteName ? s.city : local.city } : s;
  });
}

function enrichClusterHits(query: string, hits: Station[]): Station[] {
  hits = preferLocalNames(hits);
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

/* Round-16n: erail rows → TrainResult (provider-neutral shape). */
function webTrainsToResults(rows: ScrapedTrainRow[], query: SearchQuery): TrainResult[] {
  const want = { from: query.from.toUpperCase(), to: query.to.toUpperCase() };
  const out: TrainResult[] = [];
  for (const r of rows) {
    /* erail cluster-search mein DLI maangne par NDLS/NZM/DEE waali rows bhi
     * aati hain — user ne EXACT station chuna hai, wahi rakho. */
    if (r.fromCode !== want.from || r.toCode !== want.to) continue;
    const depMin = hhmmMinutes(r.departure) ?? 0;
    const dayOffset = Math.floor((depMin + r.durationMinutes) / 1440);
    const classes = r.classes.filter((c): c is ClassCode => (KNOWN_CLASSES as string[]).includes(c));
    out.push({
      number: r.number,
      name: r.name,
      type: r.type,
      from: { code: r.fromCode, name: r.fromName, city: r.fromName },
      to: { code: r.toCode, name: r.toName, city: r.toName },
      date: query.date,
      departure: r.departure,
      arrival: r.arrival,
      arrivalDayOffset: dayOffset,
      durationMinutes: r.durationMinutes,
      durationLabel: durationLabel(r.durationMinutes),
      runsOn: r.runsOn,
      classes: classes.map((code) => ({ code, label: CLASS_LABELS[code], status: "UNKNOWN" as const, fare: 0 })),
      haltVerified: true,
    });
  }
  out.sort((a, b) => a.departure.localeCompare(b.departure));
  return out;
}
const KNOWN_CLASSES: ClassCode[] = ["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"];

export type ServedProvider =
  | "railcore"
  | "railkit_fallback"
  | "railkit"
  | "railradar"
  | "indianrailapi"
  | "local"
  | "none"
  | "web_ixigo"
  | "web_confirmtkt"
  | "web_trainspnrstatus"
  | "web_railyatri"
  | "web_railenquiry"
  | "web_erail";

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

/* Round-7: erail.in fare-scrape helper — API-fail hone par hi call hota hai.
 * Quota GN → General column, Tatkal → Tatkal column. */
async function erailFareForClass(
  trainNumber: string,
  classCode: string,
  quotaCode: string,
  from?: string | null,
  to?: string | null,
): Promise<number | null> {
  try {
    /* Round-18m-23: from/to diye ho to SIRF segment fare (erail ?from&to, page-verified); poore route ka
     * fare segment ke naam par kabhi nahi — user ko "reference" ke naam par galat number nahi. */
    const scraped = await scrapeTrainFareWeb(trainNumber, from, to);
    if (!scraped) return null;
    const row = scraped.classes.find((c) => c.code === String(classCode).toUpperCase());
    if (!row) return null;
    const quotaUpper = String(quotaCode ?? "GN").toUpperCase();
    if (quotaUpper === "TQ" || quotaUpper === "TATKAL") return row.tatkal ?? row.general;
    return row.general ?? row.tatkal;
  } catch {
    return null;
  }
}

/* Round-7: erail fare ko FareBreakdown shape mein. Service fee erail batata
 * nahi — 0, total = per-passenger fare × passengers. */
async function erailFareBreakdown(
  trainNumber: string,
  date: string,
  classCode: ClassCode,
  passengerCount: number,
  from?: string | null,
  to?: string | null,
): Promise<FareBreakdown | null> {
  const perPax = await erailFareForClass(trainNumber, classCode, "GN", from, to);
  if (perPax == null) return null;
  const pax = Math.max(1, passengerCount || 1);
  return {
    trainNumber,
    date,
    classCode,
    passengerCount: pax,
    baseFare: perPax,
    serviceFee: 0,
    total: perPax * pax,
    currency: "INR",
    railwayAvailable: true,
    source: "web_erail",
  };
}

/* Round-7: code-like query par local/API kuch nahi diya — railenquiry.in
 * station page se real name verify karke lo (SSR title-parse). */
async function stationWebLookup(codeLike: string): Promise<Station | null> {
  if (!/^[A-Za-z]{2,5}$/.test(codeLike)) return null;
  try {
    const scraped = await scrapeStationLookupWeb(codeLike);
    if (!scraped) return null;
    return { code: scraped.code, name: scraped.name, city: scraped.city };
  } catch {
    return null;
  }
}

/* Round-16: NAME query par bhi web — erail.in ki full station list se
 * (code-lookup railenquiry sirf code accept karta hai). Code-like query
 * pehle railenquiry (verified name), phir erail list. */
async function stationWebSearch(query: string): Promise<Station[]> {
  const viaCode = await stationWebLookup(query);
  if (viaCode) return [viaCode];
  try {
    const hits = await scrapeStationSearchWeb(query, 6);
    return hits.map((h) => ({ code: h.code, name: h.name, city: h.city }));
  } catch {
    return [];
  }
}

/* Round-16: RailYatri SA (IRCTC-sourced) se seats+status — dono API fail
 * hone par. ClassAvailability shape, source="web_railyatri" + webNote. */
async function railyatriAvailability(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  quotaCode: string,
): Promise<ClassAvailability | null> {
  try {
    const sc = await scrapeSeatAvailabilityWeb(trainNumber, date, from, to, classCode, quotaCode);
    if (!sc) return null;
    return {
      code: classCode,
      label: CLASS_LABELS[classCode],
      status: sc.status,
      seats: sc.seats ?? undefined,
      rac: sc.rac ?? undefined,
      waitlist: sc.waitlist ?? undefined,
      fare: sc.totalFare ?? sc.ticketFare ?? 0,
      quota: sc.quota,
      date,
      source: "web_railyatri",
      webNote: `web: railyatri.in (IRCTC data${sc.cacheText ? `, ${sc.cacheText.toLowerCase()}` : ""}) — status "${sc.statusText}"${sc.stale ? " — ⚠ STALE (24h+ purana), book se pehle refresh" : ""}`,
      ...(sc.stale ? { stale: true } : {}),
      ...(sc.lastUpdatedAt ? { updatedAt: String(Date.parse(String(sc.lastUpdatedAt).replace(" +0530", "+05:30").replace(" ", "T")) > 0 ? new Date(Date.parse(String(sc.lastUpdatedAt).replace(" +0530", "+05:30").replace(" ", "T"))).toISOString() : sc.lastUpdatedAt) } : {}),
    };
  } catch {
    return null;
  }
}

/* Round-16: fare bhi RailYatri SA se (segment-specific, erail se better —
 * erail poore route ka fare deta hai). */
async function railyatriFareBreakdown(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  passengerCount: number,
): Promise<FareBreakdown | null> {
  try {
    const sc = await scrapeSeatAvailabilityWeb(trainNumber, date, from, to, classCode, "GN");
    const perPax = sc?.totalFare ?? sc?.ticketFare ?? null;
    if (perPax == null || perPax <= 0) return null;
    const pax = Math.max(1, passengerCount || 1);
    return {
      trainNumber,
      date,
      classCode,
      passengerCount: pax,
      baseFare: perPax,
      serviceFee: 0,
      total: perPax * pax,
      currency: "INR",
      railwayAvailable: true,
      source: "web_railyatri",
    };
  } catch {
    return null;
  }
}

/* ── Round-16o: extra-API helpers (RailRadar → IndianRailAPI). Har ek key na
 * hone par null deta hai (koi network call nahi). ────────────────────── */
async function extraApiStationSearch(q: string): Promise<{ stations: Station[]; provider: ServedProvider } | null> {
  const rr = await railradarStationSearch(q);
  if (rr && rr.length) return { stations: preferLocalNames(rr), provider: "railradar" };
  const ira = await indianRailApiStationSearch(q);
  if (ira && ira.length) return { stations: preferLocalNames(ira), provider: "indianrailapi" };
  return null;
}

async function extraApiSchedule(number: string): Promise<{ schedule: RailcoreSchedule; provider: ServedProvider } | null> {
  const rr = await railradarSchedule(number);
  if (rr && (rr.stops.length || rr.trainName)) return { schedule: rr, provider: "railradar" };
  const ira = await indianRailApiSchedule(number);
  if (ira && (ira.stops.length || ira.trainName)) return { schedule: ira, provider: "indianrailapi" };
  return null;
}

async function extraApiCoachPosition(number: string, stationCode?: string): Promise<{ coachPosition: RailcoreCoachPosition; provider: ServedProvider } | null> {
  const rr = await railradarCoachPosition(number, stationCode);
  if (rr) return { coachPosition: rr, provider: "railradar" };
  const ira = await indianRailApiCoachPosition(number);
  if (ira) return { coachPosition: { ...ira, stationCode: stationCode ?? null }, provider: "indianrailapi" };
  return null;
}

async function extraApiAvailability(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  quotaCode: string,
): Promise<ClassAvailability | null> {
  const rr = await railradarAvailability(trainNumber, date, from, to, classCode, quotaCode);
  if (rr && rr.status !== "UNKNOWN") return withFareFilled(rr, trainNumber, date, from, to, classCode, quotaCode);
  const ira = await indianRailApiAvailability(trainNumber, date, from, to, classCode, quotaCode);
  if (ira && ira.status !== "UNKNOWN") return withFareFilled(ira, trainNumber, date, from, to, classCode, quotaCode);
  return null;
}

/* Round-18g: RailRadar/IndianRailAPI seat rows fare nahi dete (fare 0) → card
 * par "Fare on select" aur "Lowest fare" chip gayab. Fare alag se bharo:
 * RailRadar fare API → erail (web) fare. Seats/status untouched, fare ka
 * source alag se record hota hai (fareSource) — do sources mix nahi hote. */
async function withFareFilled(
  row: ClassAvailability,
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  quotaCode: string,
): Promise<ClassAvailability> {
  if (row.fare > 0) return row;
  try {
    const rr = await railradarFare(trainNumber, date, from, to, classCode, 1);
    if (rr?.railwayAvailable && rr.baseFare > 0) return { ...row, fare: rr.baseFare, fareSource: "railradar" };
  } catch {
    /* fall through */
  }
  try {
    const web = await erailFareForClass(trainNumber, classCode, quotaCode, from, to);
    if (web != null && web > 0) return { ...row, fare: web, fareSource: "web_erail" };
  } catch {
    /* fall through */
  }
  return row;
}

async function extraApiFare(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  passengerCount: number,
): Promise<FareBreakdown | null> {
  const rr = await railradarFare(trainNumber, date, from, to, classCode, passengerCount);
  if (rr?.railwayAvailable) return rr;
  const ira = await indianRailApiFare(trainNumber, date, from, to, classCode, passengerCount);
  if (ira?.railwayAvailable) return ira;
  return null;
}

/** Round-16o: train NAME search chain — RailCore → RailRadar → IndianRailAPI →
 * erail.in train-list (web). Pehle sirf RailCore tha: daily limit par
 * "naam se koi train nahi mili" (Vivek Express / Shatabdi jaise sawaal fail). */
export async function routedTrainNameSearch(q: string): Promise<{ trains: RailcoreTrainNameResult[]; provider: ServedProvider }> {
  const started = Date.now();
  const query = q.trim();
  if (!query) return { trains: [], provider: "none" };
  let primary: RailcoreTrainNameResult[] = [];
  try {
    primary = await searchRailcoreTrainsByName(query);
  } catch {
    primary = [];
  }
  if (primary.length) {
    logServed("railcore", "trainNameSearch", started, true);
    return { trains: primary, provider: "railcore" };
  }
  const blocked = railcoreBlockState().blocked || !env.railcoreApiKey;
  const rr = await railradarTrainNameSearch(query);
  if (rr && rr.length) {
    logServed("railradar", "trainNameSearch", started, true, blocked ? "railcore_blocked" : "railcore_empty");
    return { trains: rr, provider: "railradar" };
  }
  const ira = await indianRailApiTrainNameSearch(query);
  if (ira && ira.length) {
    logServed("indianrailapi", "trainNameSearch", started, true, blocked ? "railcore_blocked" : "railcore_empty");
    return { trains: ira, provider: "indianrailapi" };
  }
  /* Web (erail train list) — sirf number+naam; route blank (honest). */
  let web: { number: string; name: string }[] = [];
  try {
    web = await scrapeTrainNameSearchWeb(query, 10);
  } catch {
    web = [];
  }
  if (web.length) {
    logServed("web_erail", "trainNameSearch", started, true, blocked ? "railcore_blocked" : "railcore_empty");
    return { trains: web.map((t) => ({ number: t.number, name: t.name, from: "", to: "", type: "" })), provider: "web_erail" };
  }
  logServed("none", "trainNameSearch", started, false, blocked ? "railcore_blocked+all_failed" : "no_match");
  return { trains: [], provider: "none" };
}

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
    /* Round-16o: local bhi empty — pehle extra APIs (RailRadar / IndianRailAPI,
     * key ho to), phir web lookup. */
    if (local.length === 0) {
      const extra = await extraApiStationSearch(query);
      if (extra) {
        const pickX = pickStations(query, enrichClusterHits(query, extra.stations));
        logServed(extra.provider, "stationSearch", started, pickX.kind !== "none", "api_and_local_empty");
        if (pickX.kind === "ambiguous") return { stations: pickX.stations, needChoice: true, city: pickX.city, provider: extra.provider };
        if (pickX.kind === "single") return { stations: pickX.stations, needChoice: false, provider: extra.provider };
        if (extra.stations.length) return { stations: extra.stations, needChoice: extra.stations.length > 1, city: extra.stations.length > 1 ? query : undefined, provider: extra.provider };
      }
    }
    /* Round-7/16: local bhi empty — web lookup (railenquiry code → erail name-list). */
    if (local.length === 0) {
      const web = await stationWebSearch(query);
      if (web.length) {
        logServed("web_erail", "stationSearch", started, true, "api_and_local_empty");
        return { stations: web, needChoice: web.length > 1, city: web.length > 1 ? query : undefined, provider: web.length === 1 && /^[A-Za-z]{2,5}$/.test(query) ? "web_railenquiry" : "web_erail" };
      }
    }
    return { stations: local, needChoice: false, provider: "railkit_fallback" };
  }

  const local = await searchRailkitStations(query);
  /* Round-7: railkit sirf placeholder de raha ({name===code}) ya empty —
   * code-like query par railenquiry station page se real name. */
  const realHits = local.filter((s) => s.name && s.name !== s.code);
  if (realHits.length === 0) {
    const web = await stationWebSearch(query);
    if (web.length) {
      logServed("web_erail", "stationSearch", started, true, "local_placeholder_only");
      return { stations: web, needChoice: web.length > 1, city: web.length > 1 ? query : undefined, provider: web.length === 1 && /^[A-Za-z]{2,5}$/.test(query) ? "web_railenquiry" : "web_erail" };
    }
  }
  return { stations: local, needChoice: false, provider: env.provider === "railkit" ? "railkit" : "local" };
}

export type RoutedLive = {
  live: (RailcoreLiveStatus | LiveTrainStatus) | null;
  provider: ServedProvider;
};

/* Round-16p: live-status ka "run" samjho. Har provider ek START-DATE ka run
 * deta hai; multi-day train (Rajdhani 3 din) ke liye AAJ wala run abhi origin
 * par khada hota hai jabki KAL/PARSON wala run asli mein raste mein hai. */
export function liveRunState(live: RailcoreLiveStatus | LiveTrainStatus | null): "not_started" | "running" | "completed" | "unknown" {
  if (!live) return "unknown";
  const explicit = (live as RailcoreLiveStatus).runState;
  if (explicit) return explicit;
  const s = String(live.status ?? "").toLowerCase();
  if (/not[\s-]*started|yet to start|scheduled to depart|abhi chali nahi|has not started/.test(s)) return "not_started";
  if (/completed|reached destination|journey (?:over|ended)|terminated|arrived at destination/.test(s)) return "completed";
  if (/running|departed|arrived|late|on time|delay|at station|between/.test(s)) return "running";
  return "unknown";
}

function ymdShift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Origin par khadi (progress 0) aaj wali entry vs. sach mein chal rahi
 * pichhle din wali — dono "running" bol sakte hain; isliye origin-idle bhi
 * not_started jaisa treat hota hai jab currentStation route ka pehla stop ho. */
function looksIdleAtOrigin(live: RailcoreLiveStatus | LiveTrainStatus | null): boolean {
  return liveRunState(live) === "not_started";
}

/**
 * Round-16p (user: "kal/parson/usse pehle ki train ka live status nahi milta"):
 * (a) date DI gayi ho (kal/parson/7 Sep) → wahi run, chahe completed ho —
 *     completed run bhi "kahan thi, kitni late pahunchi" ka sach hai.
 * (b) date NA di ho aur aaj ka run origin par idle/not-started ho → pichhle
 *     3 din ke runs probe karo (multi-day trains) aur jo RUNNING mile wahi
 *     "abhi kahan hai" ka jawab hai. Kuch na mile → aaj wala hi.
 */
export async function routedLiveStatus(number: string, dateYmd?: string, trainNameHint?: string | null): Promise<RoutedLive> {
  const first = await routedLiveStatusForDate(number, dateYmd, trainNameHint);
  if (dateYmd || !first.live) return first;
  if (!looksIdleAtOrigin(first.live)) return first;
  const today = istToday();
  for (let back = 1; back <= 3; back++) {
    const probeDate = ymdShift(today, -back);
    const probe = await routedLiveStatusForDate(number, probeDate, trainNameHint, /*quiet*/ true);
    if (!probe.live) continue;
    const st = liveRunState(probe.live);
    if (st === "running" && !looksIdleAtOrigin(probe.live)) {
      logServed(probe.provider, "liveStatus", Date.now(), true, `active_run_${probeDate}`);
      return { ...probe, live: { ...probe.live, journeyDate: (probe.live as RailcoreLiveStatus).journeyDate ?? probeDate } as RailcoreLiveStatus };
    }
    if (st === "completed") break; // isse purane sab complete honge
  }
  return first;
}

/* ── Round-18m: which run-dates have live/history data RIGHT NOW ──────────
 * User picks the date (never assumed). Probes today-3 … today in parallel
 * through the same chain (RailCore → RailKit → RailRadar → IndianRailAPI →
 * railyatri web) and keeps ONLY dates where a provider returned a run.
 * Bounded: 4 probes, 12 s cap, cached 3 min per train. */
export type LiveDateOption = { date: string; label: string; runState: "not_started" | "running" | "completed" | "unknown"; provider: ServedProvider };
const liveDatesCache = new Map<string, { at: number; options: LiveDateOption[] }>();
const LIVE_DATES_TTL_MS = 3 * 60_000;
export async function routedLiveDates(number: string, trainNameHint?: string | null, daysBack = 3): Promise<LiveDateOption[]> {
  const key = `${number}:${daysBack}`;
  const hit = liveDatesCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_DATES_TTL_MS) return hit.options;
  const today = istToday();
  const dates = Array.from({ length: daysBack + 1 }, (_, i) => ymdShift(today, -i));
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const label = (ymd: string, i: number) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return i === 0 ? `Aaj (${wd} ${d})` : i === 1 ? `Kal (${wd} ${d})` : `${wd} ${d}`;
  };
  const probes = await Promise.all(
    dates.map(async (dt, i): Promise<LiveDateOption | null> => {
      try {
        const r = await Promise.race([
          routedLiveStatusForDate(number, dt, trainNameHint, true),
          new Promise<RoutedLive>((resolve) => setTimeout(() => resolve({ live: null, provider: "none" }), 12_000)),
        ]);
        if (!r.live) return null;
        return { date: dt, label: label(dt, i), runState: liveRunState(r.live), provider: r.provider };
      } catch {
        return null;
      }
    }),
  );
  const options = probes.filter((o): o is LiveDateOption => o != null);
  liveDatesCache.set(key, { at: Date.now(), options });
  return options;
}

/* ── Round-16p-2: station-wise history of a PAST run ───────────────────
 * RailKit getTrainHistory → RailCore /live?date= `stations[]` (actual_arrival/
 * actual_departure/delay) → RailRadar /live?date= `route[]` (halts). Har
 * provider us START-date ke run ka per-station actual deta hai — running run
 * ke liye bhi (jitna ho chuka wahi actual, baaki scheduled/upcoming). */
export type RoutedHistoryStop = {
  code: string;
  name: string;
  arrival: string | null;
  departure: string | null;
  delay: number | null;
  done: boolean;
};
export type RoutedHistory = {
  trainNumber: string;
  trainName: string;
  date: string;
  status: string | null;
  runState: "not_started" | "running" | "completed" | "unknown";
  stops: RoutedHistoryStop[];
  provider: ServedProvider;
};

function hhmm(iso: unknown): string | null {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const m = s.match(/T(\d{2}:\d{2})/);
  if (m) {
    const d = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return d ? `${m[1]} (${d[3]}/${d[2]})` : m[1];
  }
  return s.length <= 8 ? s.slice(0, 5) : s;
}

export async function routedTrainHistory(number: string, dateYmd: string): Promise<RoutedHistory | null> {
  const started = Date.now();
  const kit = await railkitHistory(number, dateYmd).catch(() => null);
  if (kit && kit.stops.length) {
    logServed("railkit", "trainHistory", started, true);
    return {
      trainNumber: kit.trainNumber,
      trainName: kit.trainName,
      date: kit.date,
      status: null,
      runState: "unknown",
      stops: kit.stops.map((s) => ({ ...s, done: Boolean(s.arrival || s.departure) })),
      provider: "railkit",
    };
  }
  /* RailCore full /live payload — stations[] with actuals. */
  if (railcoreIsPrimary()) {
    const res = await railcoreRequest(`/trains/${encodeURIComponent(number)}/live`, { date: dateYmd });
    const d = asObjR(res.ok ? unwrapR(res.json) : null);
    const rows = Array.isArray(d.stations) ? d.stations.map(asObjR) : [];
    if (rows.length) {
      const stops: RoutedHistoryStop[] = rows
        .filter((r) => r.is_stopping !== false)
        .map((r) => ({
          code: String(r.station_code ?? ""),
          name: String(r.station_name ?? r.station_code ?? ""),
          arrival: hhmm(r.actual_arrival ?? (r.has_arrived ? r.eta : null)),
          departure: hhmm(r.actual_departure ?? (r.has_departed ? r.etd : null)),
          delay: typeof r.delay_arrival_minutes === "number" ? r.delay_arrival_minutes : typeof r.delay_departure_minutes === "number" ? r.delay_departure_minutes : null,
          done: Boolean(r.has_arrived || r.has_departed),
        }))
        .filter((s) => s.code);
      const st = String(d.status ?? "").toUpperCase();
      logServed("railcore", "trainHistory", started, true, "railkit_failed");
      return {
        trainNumber: String(d.train_number ?? number),
        trainName: String(d.train_name ?? ""),
        date: String(d.journey_date ?? dateYmd),
        status: String(d.status_text ?? d.status ?? "") || null,
        runState: st === "COMPLETED" ? "completed" : st === "RUNNING" ? "running" : st === "AT_STATION" && !(Number(d.distance_covered_km) > 0) ? "not_started" : "unknown",
        stops,
        provider: "railcore",
      };
    }
  }
  /* RailRadar route[] (halts only). */
  const rr = await railradarRequest(`/trains/${encodeURIComponent(number)}/live`, { date: dateYmd, haltsOnly: "true" });
  const rd = asObjR(rr.ok ? rr.data : null);
  const route = Array.isArray(rd.route) ? rd.route.map(asObjR) : [];
  if (route.length) {
    const stops: RoutedHistoryStop[] = route
      .filter((r) => r.isHalt !== false)
      .map((r) => {
        const done = /departed|arrived|at-station/i.test(String(r.status ?? ""));
        return {
          code: String(r.stationCode ?? ""),
          name: String(r.stationName ?? r.stationCode ?? ""),
          arrival: done ? hhmm(r.actualArrival ?? r.scheduledArrival) : null,
          departure: done ? hhmm(r.actualDeparture ?? r.scheduledDeparture) : null,
          delay: typeof r.delayArrival === "number" ? r.delayArrival : typeof r.delayDeparture === "number" ? r.delayDeparture : null,
          done,
        };
      })
      .filter((s) => s.code);
    const st = String(rd.status ?? "").toLowerCase();
    logServed("railradar", "trainHistory", started, true, "railkit+railcore_failed");
    return {
      trainNumber: String(rd.trainNumber ?? number),
      trainName: String(rd.trainName ?? asObjR(rd.train).name ?? ""),
      date: String(rd.startDate ?? dateYmd),
      status: st || null,
      runState: st === "completed" ? "completed" : /not-?started/.test(st) ? "not_started" : st ? "running" : "unknown",
      stops,
      provider: "railradar",
    };
  }
  logServed("none", "trainHistory", started, false, "all_failed");
  return null;
}

function asObjR(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function unwrapR(json: unknown): unknown {
  const o = asObjR(json);
  return "data" in o ? o.data : json;
}

async function routedLiveStatusForDate(number: string, dateYmd?: string, trainNameHint?: string | null, quiet = false): Promise<RoutedLive> {
  const started = Date.now();
  void quiet;
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
    /* Round-16o: extra APIs (RailRadar → IndianRailAPI) web-scrape se pehle. */
    const rr = await railradarLive(number, dateYmd);
    if (isUsableLive(rr)) {
      logServed("railradar", "liveStatus", started, true, "railcore+railkit_failed");
      return { live: rr, provider: "railradar" };
    }
    const ira = await indianRailApiLive(number, dateYmd);
    if (isUsableLive(ira)) {
      logServed("indianrailapi", "liveStatus", started, true, "railcore+railkit+railradar_failed");
      return { live: ira, provider: "indianrailapi" };
    }
    /* Web-scrape fallback (user-authorized 2026-09-06, booking-critical bhi):
     * dono API fail par RailYatri SSR live-status. Naam URL mein chahiye —
     * pehle caller ka hint (context ki selected train), warna RailCore
     * trainInfo (alag endpoint, live down hone par bhi chal sakta hai). */
    /* Round-16b: RailYatri ko naam zaroori nahi (number se route hota hai) —
     * RailCore trainInfo par depend nahi karte (RailCore down/rate-limited
     * hone par wo bhi fail hota tha → prod par fallback kabhi chalta hi nahi tha). */
    const trainName: string | null = String(trainNameHint ?? "").trim() || null;
    const scraped = await scrapeLiveStatusWeb(number, trainName);
    if (scraped) {
      logServed("web_railyatri", "liveStatus", started, true, "api_both_failed");
      return { live: scraped, provider: "web_railyatri" };
    }
    /* railenquiry.in (round-6): number-only URL — trainName hint na mile
     * tab bhi chalta hai (RailYatri ko naam URL mein chahiye). */
    const reScraped = await scrapeLiveStatusRailEnquiry(number);
    if (reScraped) {
      logServed("web_railenquiry", "liveStatus", started, true, "api_both_failed");
      return { live: reScraped, provider: "web_railenquiry" };
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
    /* Round-16o: extra APIs web-scrape se pehle. */
    const extra = await extraApiSchedule(number);
    if (extra) {
      logServed(extra.provider, "timetable", started, true, "railcore+railkit_failed");
      return { schedule: extra.schedule, provider: extra.provider };
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
    /* Round-16: /trains/:n fail par RailCore schedule (cached) se naam —
     * web se pehle apna hi provider poora try karo. */
    const sched = await railcoreSchedule(number);
    if (sched?.trainName) {
      logServed("railcore", "trainInfo", started, true, "via_schedule");
      return { info: { trainNumber: sched.trainNumber, trainName: sched.trainName, runningDays: sched.runningDays ?? [] }, provider: "railcore" };
    }
    const fb = await railkitSchedule(number);
    if (fb) {
      logServed("railkit_fallback", "trainInfo", started, true, "railcore_unusable");
      return {
        info: { trainNumber: fb.trainNumber, trainName: fb.trainName, runningDays: [] },
        provider: "railkit_fallback",
      };
    }
    /* Round-16o: extra APIs (RailRadar/IndianRailAPI) web-scrape se pehle. */
    const extra = await extraApiSchedule(number);
    if (extra?.schedule.trainName) {
      logServed(extra.provider, "trainInfo", started, true, "railcore+railkit_failed");
      return { info: { trainNumber: extra.schedule.trainNumber, trainName: extra.schedule.trainName, runningDays: extra.schedule.runningDays ?? [] }, provider: extra.provider };
    }
    /* VERIFIED-SITE WEB SCRAPING (2026-09-06): API dono fail → schedule-page
     * scrape se train ka naam. runningDays scrape se nahi aata — [] honest. */
    const sc = await scrapeTrainScheduleWeb(number);
    if (sc?.trainName) {
      logServed(sc.provider, "trainInfo", started, true, "railcore+railkit_failed → web-scrape");
      return { info: { trainNumber: number, trainName: sc.trainName, runningDays: [] }, provider: sc.provider };
    }
    logServed("none", "trainInfo", started, false, "both_failed");
    return { info: null, provider: "none" };
  }
  const fb = await railkitSchedule(number);
  if (fb) {
    return {
      info: { trainNumber: fb.trainNumber, trainName: fb.trainName, runningDays: [] },
      provider: "railkit",
    };
  }
  const sc2 = await scrapeTrainScheduleWeb(number);
  if (sc2?.trainName) {
    logServed(sc2.provider, "trainInfo", started, true, "railkit_failed → web-scrape");
    return { info: { trainNumber: number, trainName: sc2.trainName, runningDays: [] }, provider: sc2.provider };
  }
  return { info: null, provider: "none" };
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
    /* Round-16o: extra APIs web-scrape se pehle. */
    const extra = await extraApiCoachPosition(number, stationCode);
    if (extra) {
      logServed(extra.provider, "coachPosition", started, true, "railcore_failed");
      return { coachPosition: extra.coachPosition, provider: extra.provider };
    }
    /* VERIFIED-SITE WEB SCRAPING (2026-09-06): RailCore coach-position fail
     * (ya train missing) → trainspnrstatus SSR boxes se layout. Labeled. */
    const sc = await scrapeCoachPositionWeb(number);
    if (sc) {
      logServed(sc.provider, "coachPosition", started, true, "railcore_failed → web-scrape");
      return {
        coachPosition: { trainNumber: sc.trainNumber, stationCode: stationCode ?? null, coaches: sc.coaches },
        provider: sc.provider,
      };
    }
    logServed("none", "coachPosition", started, false, "railcore+web_failed");
    return { coachPosition: null, provider: "none" };
  }
  /* RailCore configured nahi — extra APIs, phir web (API-first policy). */
  const extra2 = await extraApiCoachPosition(number, stationCode);
  if (extra2) {
    logServed(extra2.provider, "coachPosition", started, true, "no_railcore");
    return { coachPosition: extra2.coachPosition, provider: extra2.provider };
  }
  const sc2 = await scrapeCoachPositionWeb(number);
  if (sc2) {
    logServed(sc2.provider, "coachPosition", started, true, "no_railcore → web-scrape");
    return {
      coachPosition: { trainNumber: sc2.trainNumber, stationCode: stationCode ?? null, coaches: sc2.coaches },
      provider: sc2.provider,
    };
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

/* Round-18m: train → class codes via erail fare page (web fallback, cached). */
const trainClassCache = new Map<string, { codes: ClassCode[]; at: number }>();
const TRAIN_CLASS_TTL_MS = 12 * 60 * 60_000;
export async function webTrainClasses(trainNumber: string): Promise<ClassCode[]> {
  const key = String(trainNumber).trim();
  const hit = trainClassCache.get(key);
  if (hit && Date.now() - hit.at < TRAIN_CLASS_TTL_MS) return hit.codes;
  try {
    const scraped = await scrapeTrainFareWeb(key);
    const codes = asClassCodes(scraped?.classes.map((c) => c.code));
    if (codes.length) trainClassCache.set(key, { codes, at: Date.now() });
    return codes;
  } catch {
    return [];
  }
}

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
    /* Round-18m (user: "fallback pe seat availability data nahi aa raha"):
     * RailRadar / erail search rows carry NO class list and RailCore schedule
     * is blocked → codes empty → seat probe never ran ("Seat data nahi").
     * Discover the train's classes from the erail fare page (web, cached 12h)
     * so the railyatri/railradar seat probe can run. */
    if (!codes.length) codes = await webTrainClasses(trainNumber);
    if (codes.length) {
      const classes = await Promise.all(
        codes.map((code) => provider.getAvailability(trainNumber, date, from, to, code, quota)),
      );
      const ok = classes.some((c) => c.status !== "UNKNOWN");
      const known = classes.filter((c) => c.status !== "UNKNOWN");
      const viaWeb = ok && known.every((c) => c.source === "web_railyatri");
      /* Round-16o: extra-API rows (railradar/indianrailapi) ka label bhi sahi. */
      const viaExtra = ok && !viaWeb && known.every((c) => c.source === "railradar" || c.source === "indianrailapi") ? (known[0].source as ServedProvider) : null;
      const label: ServedProvider = viaWeb ? "web_railyatri" : viaExtra ? viaExtra : ok ? "railcore" : "none";
      logServed(label, "classBoard", started, ok);
      return { classes, provider: label };
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

type StopRow = { code: string; name: string; arrival?: string | null; departure?: string | null; day?: number };

/* Round-16m: timetable cache ab TTL ke saath (12h) — timetable roz nahi
 * badalti, aur har search par 27 trains × /schedule call RailCore ka 20/min
 * burst limit uda deta tha ("Too many requests" → sirf 4 trains bachi).
 * `null` (fail) ko cache NAHI karte, taaki agli baar retry ho. */
const SCHEDULE_TTL_MS = 12 * 60 * 60_000;
const scheduleCache = new Map<string, { stops: StopRow[]; at: number }>();
/* Round-16m: schedule lookups bhi rate-limit ke andar — ek waqt mein 4. */
const SCHEDULE_CONCURRENCY = 4;

export function clearScheduleCache(): void {
  scheduleCache.clear();
}

/** Round-16m: loadStops ka result — `unknown` = provider se timetable nahi
 * aayi (rate-limit/down), `stops` = verified list. Dono alag hain: unknown par
 * train ko DROP karna "trains hi nahi hain" ka jhooth ban jaata hai. */
type StopsLookup = { stops: StopRow[] } | { stops: null; reason: "unavailable" };

async function loadStops(trainNumber: string): Promise<StopsLookup> {
  const cached = scheduleCache.get(trainNumber);
  if (cached && Date.now() - cached.at < SCHEDULE_TTL_MS) return { stops: cached.stops };
  let stops: StopRow[] = ((await railcoreSchedule(trainNumber))?.stops ?? []).map((s) => ({
    code: s.code,
    name: s.name,
    arrival: s.arrival,
    departure: s.departure,
    day: s.day,
  }));
  if (!stops.length) {
    /* Round-16m: RailCore budget/limit → verified sites se timetable
     * (ixigo/confirmtkt/trainspnrstatus) — quota-free. Sirf halt-verify ke liye. */
    try {
      const web = await scrapeTrainScheduleWeb(trainNumber);
      stops = (web?.stops ?? []).map((s) => ({ code: s.code, name: s.name, arrival: s.arrival, departure: s.departure }));
    } catch {
      stops = [];
    }
  }
  if (!stops.length && env.railkitApiKey) {
    const kit = await railkitSchedule(trainNumber);
    stops = (kit?.stops ?? []).map((s) => ({
      code: s.code,
      name: s.name,
      arrival: s.arrival && s.arrival !== "--" ? s.arrival : null,
      departure: s.departure && s.departure !== "--" ? s.departure : null,
    }));
  }
  if (!stops.length) {
    /* Round-16o: extra APIs (key ho to) — halt-verify ke liye timetable. */
    const extra = await extraApiSchedule(trainNumber);
    stops = (extra?.schedule.stops ?? []).map((s) => ({ code: s.code, name: s.name, arrival: s.arrival, departure: s.departure, day: s.day }));
  }
  if (!stops.length) return { stops: null, reason: "unavailable" };
  scheduleCache.set(trainNumber, { stops, at: Date.now() });
  return { stops };
}

/* Round-16m: jo trains is search mein verify nahi ho paayin (rate-limit), unki
 * timetable background mein dheere-dheere (4s gap ≈ 15/min) warm karo — agli
 * search ("1 day later", dobara route) poori verified ho. Fire-and-forget. */
const warming = new Set<string>();
function warmSchedulesInBackground(numbers: string[]): void {
  const todo = numbers.filter((n) => !warming.has(n) && !scheduleCache.has(n)).slice(0, 40);
  if (!todo.length) return;
  for (const n of todo) warming.add(n);
  void (async () => {
    for (const n of todo) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        await loadStops(n);
      } catch {
        /* ignore */
      }
      warming.delete(n);
    }
  })();
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
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
  await mapLimited(trains, SCHEDULE_CONCURRENCY, async (train) => {
      const lookup = await loadStops(train.number);
      const stops = lookup.stops;
      if (!stops?.length) {
        /* Round-16m (user: "LDH→DLI 12 Sep par 'No trains' jabki IRCTC par
         * hain"): timetable nahi mili (RailCore 20/min burst limit) to train
         * ko DROP nahi karte — provider ne is route par di hai, wahi rakho.
         * Cluster station (DLI/NDLS/HWH) par bhi: provider ka `to` code hi
         * user ka chuna hua station hai; galat-station ka risk < "koi train
         * nahi" ka jhooth. Verification skip ka nishaan: haltVerified=false. */
        kept.push({ ...train, haltVerified: false });
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
      const segmentUnchanged =
        fromStop.code.toUpperCase() === train.from.code.toUpperCase() &&
        toStop.code.toUpperCase() === train.to.code.toUpperCase() &&
        train.durationMinutes > 0;
      if (start != null && end != null && !segmentUnchanged) {
        /* Round-16l (LDH→KOAA "3h 23m" bug): clock-diff mod 24h se multi-day
         * trains 24h ke multiples kho deti thin. Pehle stop ke `day` fields,
         * warna provider ki total duration ke sabse paas waala 24h multiple. */
        const base = end >= start ? end - start : end + 1440 - start;
        if (typeof fromStop.day === "number" && typeof toStop.day === "number" && toStop.day >= fromStop.day) {
          const byDay = (toStop.day - fromStop.day) * 1440 + (end - start);
          durationMinutes = byDay > 0 ? byDay : base;
        } else if (train.durationMinutes > 0) {
          let best = base;
          for (let k = 1; k <= 4; k++) {
            const cand = base + k * 1440;
            if (Math.abs(cand - train.durationMinutes) < Math.abs(best - train.durationMinutes)) best = cand;
          }
          durationMinutes = best;
        } else {
          durationMinutes = base;
        }
      }
      const arrivalDayOffset =
        start != null && durationMinutes > 0 ? Math.floor((start + durationMinutes) / 1440) : train.arrivalDayOffset;
      kept.push({
        ...train,
        from: { code: fromStop.code, name: fromStop.name, city: fromStop.name },
        to: { code: toStop.code, name: toStop.name, city: toStop.name },
        departure: dep,
        arrival: arr,
        arrivalDayOffset,
        durationMinutes,
        durationLabel: durationLabel(durationMinutes || 0),
        haltVerified: true,
      });
  });
  kept.sort((a, b) => a.departure.localeCompare(b.departure));
  const unverified = kept.filter((t) => t.haltVerified === false).map((t) => t.number);
  if (unverified.length && process.env.NODE_ENV !== "test" && !process.env.VITEST) warmSchedulesInBackground(unverified);
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
    let primary = await this.core.trySearchTrains(query);
    /* Round-16m: short burst block (≤25s) par route search FAIL karke "No
     * trains" dikhane se behtar — block khatam hone tak ruk ke ek retry. */
    if (!primary.ok) {
      const blk = railcoreBlockState();
      const waitMs = blk.blocked ? blk.until - Date.now() : 0;
      if (blk.blocked && blk.reason === "railcore_rate_limited" && waitMs > 0 && waitMs <= 25_000) {
        await new Promise((r) => setTimeout(r, waitMs + 250));
        primary = await this.core.trySearchTrains(query);
      }
    }
    if (primary.ok) {
      logServed("railcore", "trainSearch", started, true);
      return filterTrainsServingStops(primary.trains, query.from, query.to);
    }
    const reason = primary.failureReason ?? "railcore_failed";
    if (env.railkitApiKey) {
      const fb = await this.kit.searchTrainsDetailed(query);
      if (fb.ok) {
        logServed("railkit_fallback", "trainSearch", started, true, reason);
        return filterTrainsServingStops(fb.trains, query.from, query.to);
      }
    }
    /* Round-16o: RailRadar trains-between (key ho to) — web se pehle. Exact
     * from/to codes hum khud bhejte hain; running-day filter yahin. */
    const rr = await railradarSearchTrains(query);
    if (rr && rr.length) {
      const wdR = weekday(query.date);
      const rows = rr.filter((t) => !t.runsOn.length || t.runsOn.includes(wdR));
      if (rows.length) {
        logServed("railradar", "trainSearch", started, true, `${reason}+railkit_failed`);
        return rows;
      }
    }
    /* Round-16n (user: "daily limit hit → fallback par bhi trains nahi, web
     * scraping lagayi thi na?"): train SEARCH ka web fallback ab hai — erail.in
     * trains-between list (IRCTC timetable data). Date ke hisaab se running-day
     * filter yahin; exact boarding codes (DLI≠NDLS) source se aate hain to
     * timetable-verify ki zaroorat nahi (quota bhi nahi jalta). */
    const web = await scrapeTrainsBetweenWeb(query.from, query.to);
    if (web && web.trains.length) {
      const wd = weekday(query.date);
      const rows = webTrainsToResults(web.trains, query).filter((t) => t.runsOn.includes(wd));
      logServed("web_erail", "trainSearch", started, true, `${reason}+railkit_failed`);
      return rows;
    }
    // Sab fail — "0 trains" bolna jhooth hai. "none" label hi upstream
    // (SEARCH_TRAINS/JOURNEY_ANALYZE) ko honest unavailable deta hai.
    logServed("none", "trainSearch", started, false, `${reason}+railkit_failed+web_failed`);
    return [];
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
      /* Round-16o: extra APIs (RailRadar → IndianRailAPI) web se pehle. */
      const extraNoKit = await extraApiAvailability(trainNumber, date, from, to, classCode, quotaCode);
      if (extraNoKit) {
        logServed(extraNoKit.source as ServedProvider, "availability", started, true, "railcore_failed");
        return extraNoKit;
      }
      /* Round-16: railkit key nahi — RailYatri SA se seats+status+fare. */
      const ry = await railyatriAvailability(trainNumber, date, from, to, classCode, quotaCode);
      if (ry) {
        logServed("web_railyatri", "availability", started, true, "railcore_failed → web-scrape");
        return ry;
      }
      /* Round-7: erail.in se fare to nikaal lo. */
      const webFareNoKit = await erailFareForClass(trainNumber, classCode, quotaCode, from, to);
      if (webFareNoKit != null) {
        logServed("web_erail", "availability", started, false, "fare_only_no_seats");
        return { ...unknown, fare: webFareNoKit, source: "web_erail" };
      }
      logServed("none", "availability", started, false, "both_unavailable");
      return unknown;
    }
    const fb = await this.kit.getAvailability(trainNumber, date, from, to, classCode, quotaCode);
    if (fb.status !== "UNKNOWN") {
      logServed("railkit_fallback", "availability", started, true, "railcore_unusable");
      return fb;
    }
    /* Round-16o: extra APIs (RailRadar → IndianRailAPI) web se pehle. */
    const extra = await extraApiAvailability(trainNumber, date, from, to, classCode, quotaCode);
    if (extra) {
      logServed(extra.source as ServedProvider, "availability", started, true, "railcore+railkit_failed");
      return extra;
    }
    /* Round-16: dono API fail — RailYatri SA JSON (IRCTC-sourced) se
     * seats+status+fare. */
    const ry = await railyatriAvailability(trainNumber, date, from, to, classCode, quotaCode);
    if (ry) {
      logServed("web_railyatri", "availability", started, true, "railcore+railkit_failed → web-scrape");
      return ry;
    }
    /* Round-7: erail.in se class-ka fare to nikaal lo — fare-only row. */
    const webFare = await erailFareForClass(trainNumber, classCode, quotaCode, from, to);
    if (webFare != null) {
      logServed("web_erail", "availability", started, false, "fare_only_no_seats");
      return { ...fb, fare: webFare, source: "web_erail" };
    }
    logServed("none", "availability", started, false, "railcore_unusable");
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
      /* Round-16o: extra APIs web se pehle. */
      const extraNoKit = await extraApiFare(trainNumber, date, from, to, classCode, passengerCount);
      if (extraNoKit) {
        logServed(extraNoKit.source as ServedProvider, "fare", started, true, "railcore_failed");
        return extraNoKit;
      }
      /* Round-16: railyatri (segment fare) → Round-7: erail.in (route fare). */
      const web =
        (await railyatriFareBreakdown(trainNumber, date, from, to, classCode, passengerCount)) ??
        (await erailFareBreakdown(trainNumber, date, classCode, passengerCount, from, to));
      if (web) {
        logServed(web.source === "web_railyatri" ? "web_railyatri" : "web_erail", "fare", started, true, "both_unavailable");
        return web;
      }
      const empty = await this.core.getFare(trainNumber, date, from, to, classCode, passengerCount);
      logServed("none", "fare", started, false, "both_unavailable");
      return empty;
    }
    const fb = await this.kit.getFare(trainNumber, date, from, to, classCode, passengerCount);
    if (fb.railwayAvailable) {
      logServed("railkit_fallback", "fare", started, true, "railcore_unusable");
      return fb;
    }
    /* Round-16o: extra APIs web se pehle. */
    const extra = await extraApiFare(trainNumber, date, from, to, classCode, passengerCount);
    if (extra) {
      logServed(extra.source as ServedProvider, "fare", started, true, "railcore+railkit_failed");
      return extra;
    }
    /* Round-16/7: railkit bhi fail — railyatri (segment) → erail.in fare-scrape. */
    const web =
      (await railyatriFareBreakdown(trainNumber, date, from, to, classCode, passengerCount)) ??
      (await erailFareBreakdown(trainNumber, date, classCode, passengerCount, from, to));
    if (web) {
      logServed(web.source === "web_railyatri" ? "web_railyatri" : "web_erail", "fare", started, true, "railcore_unusable");
      return web;
    }
    logServed("none", "fare", started, false, "railcore_unusable");
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
