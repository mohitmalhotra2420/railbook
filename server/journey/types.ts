/**
 * Round-17 — Journey intelligence types (RailBook Atlas).
 *
 * Har field REAL provider data se aata hai. Jo provider nahi deta (jaise
 * berth-level vacancy, reliability score) wo null/omitted rehta hai — kabhi
 * fabricate nahi hota. `source` batata hai data kis provider se aaya.
 */

export type RankCategory =
  | "fastest"
  | "direct"
  | "fewest_changes"
  | "best_availability"
  | "cheapest"
  | "earliest"
  | "best_overall";

export type RouteAvailability = {
  classCode: string;
  status: "AVAILABLE" | "RAC" | "WAITLIST" | "UNKNOWN" | "NOT_AVAILABLE" | string;
  seats: number | null;
  rac: number | null;
  waitlist: number | null;
  fare: number | null;
  source: string;
};

export type RouteLeg = {
  trainNumber: string;
  trainName: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
  arrivalDayOffset: number;
  durationMinutes: number | null;
};

export type RouteOption = {
  rank: number;
  category: RankCategory;
  /** Sab categories jinme ye option top hai (UI badges). */
  badges: RankCategory[];
  trainNumbers: string[];
  trainNames: string[];
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  arrivalDayOffset: number;
  durationMinutes: number | null;
  durationLabel: string | null;
  changes: number;
  legs: RouteLeg[];
  /** Connection ke liye: layover minutes (single-change). */
  layoverMinutes: number | null;
  classes: string[];
  availability: RouteAvailability | null;
  /** Reliability SIRF tab jab provider real data de — abhi koi nahi deta → null. */
  reliability: null;
  source: string;
  why: string;
};

export type Connection = {
  station: string;
  stationName?: string | null;
  arrivalTrain: string;
  departureTrain: string;
  arrivalAt: string;
  departsAt: string;
  arrivalDayOffset: number;
  layoverMinutes: number;
  valid: boolean;
  reason: string | null;
  totalDurationMinutes: number | null;
  legs: RouteLeg[];
  source: string;
};

export type VacantSeatRow = {
  classCode: string;
  status: string;
  seats: number | null;
  rac: number | null;
  waitlist: number | null;
  fare: number | null;
  quota: string;
  source: string;
  /** Berth/coach-level (B4 · 32 LB) sirf tab jab provider de — abhi koi nahi deta. */
  berths: { coach: string; berth: number; type: string }[] | null;
};

export type VacantSeatsResult = {
  trainNumber: string;
  trainName: string | null;
  origin: string;
  destination: string;
  date: string;
  travelClass: string | null;
  rows: VacantSeatRow[];
  capability: {
    classLevel: boolean;
    berthLevel: boolean;
    postChart: boolean;
    note: string;
  };
  source: string;
};

export type PartialSegment = {
  from: string;
  fromName: string | null;
  to: string;
  toName: string | null;
  trainNumber: string;
  classCode: string;
  status: string;
  seats: number | null;
  rac: number | null;
  waitlist: number | null;
  fare: number | null;
  departure: string | null;
  arrival: string | null;
  source: string;
  /** Coach/berth sirf provider de to — warna null (fake nahi). */
  berth: { coach: string; berth: number; type: string } | null;
};

export type PartialRoutePlan = {
  trainNumber: string;
  trainName: string | null;
  origin: string;
  destination: string;
  date: string;
  classCode: string;
  direct: PartialSegment | null;
  /** Split plans: [origin→X, X→destination] dono provider-verified. */
  plans: { switchStation: string; switchStationName: string | null; segments: PartialSegment[]; fullyAvailable: boolean; note: string }[];
  /** Same-train switch: seat destination tak nahi, par X ke baad AVAILABLE. */
  sameTrainSwitch: { afterStation: string; afterStationName: string | null; segment: PartialSegment } | null;
  verification: {
    stationSequenceValid: boolean;
    classValid: boolean;
    dateValid: boolean;
    trainRunsOnDate: boolean | null;
    stopsChecked: string[];
  };
  note: string;
  source: string;
};

/** Round-18: alternatives for ONE selected train when its seat is poor. */
export type AlternativeTrainsResult = {
  selected: { trainNumber: string; trainName: string | null; classCode: string | null; status: string | null; seats: number | null; waitlist: number | null; rac: number | null; source: string | null };
  reason: "waitlist" | "rac" | "low_availability" | "not_available" | "class_unavailable" | "unknown" | "fine";
  origin: string;
  destination: string;
  date: string;
  /** Provider-verified alternatives (other trains, same day, same route) — ONLY with AVAILABLE/RAC data. */
  alternatives: RouteOption[];
  /** Same train, other class with AVAILABLE seats (real board rows). */
  otherClasses: RouteAvailability[];
  partialRoute: PartialRoutePlan | null;
  connecting: Connection[];
  alternativeDates: JourneyPlan["alternativeDates"];
  sources: string[];
  note: string;
  provenance: { retrievedAt: string; requestDate: string; travelDate: string; freshness: string; sourceTypes: string[] };
};

/** Round-18 §8: alternate boarding / destination station within the same city cluster. */
export type AlternateStationOption = {
  from: string;
  to: string;
  changed: "origin" | "destination" | "both";
  count: number;
  best: RouteOption | null;
  /** Round-18j: all direct train numbers on the sibling pair (≤6), for the agent's summary. */
  allTrainNumbers?: string[];
  source: string;
  note: string;
};

export type JourneyPlan = {
  query: { from: string; to: string; date: string; travelClass: string | null; preference: string };
  best: RouteOption | null;
  routeOptions: RouteOption[];
  connections: Connection[];
  /** Alternative dates — SIRF suggestion (counts), user ki date badli nahi jaati. */
  alternativeDates: { date: string; count: number; fastest: { number: string; durationMinutes: number } | null; providerFailed?: boolean }[];
  directUnavailable: boolean;
  recovery: {
    reason: string;
    differentTrain: RouteOption[];
    partialRoute: PartialRoutePlan | null;
    connecting: Connection[];
    alternativeDates: JourneyPlan["alternativeDates"];
    /** Round-18 §8: same-city alternate boarding/destination station — presented as a DIFFERENT journey assumption (never silently applied). */
    alternateStations: AlternateStationOption[];
  } | null;
  sources: string[];
  notes: string[];
  /** Round-18l: deterministic plain-language "AI journey summary" — best plan,
   *  then the fallback route, then an alternative date. Built ONLY from data
   *  actually retrieved in this plan (never invented); null when nothing real. */
  summary: string | null;
  /** Round-18 freshness envelope (dynamic data must not be shown as current when stale). */
  provenance?: { retrievedAt: string; requestDate: string; travelDate: string; freshness: string; sourceTypes: string[] };
  /** Round-18: any availability source conflict detected (values never blended). */
  conflicts?: { trainNumber: string; message: string; sources: string[] }[];
};

export const CLASS_CODES = ["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"] as const;

export function minutesOf(hhmm: string | null | undefined): number | null {
  const m = String(hhmm ?? "").match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function durationLabelOf(min: number | null | undefined): string | null {
  if (min == null || !Number.isFinite(min) || min < 0) return null;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
