import { env } from "../env.js";
import { durationLabel, hash32, uid } from "../util.js";
import {
  CLASS_LABELS,
  type AvailabilityStatus,
  type BookingRecord,
  type CancelResult,
  type ClassAvailability,
  type ClassCode,
  type CreateBookingRequest,
  type FareBreakdown,
  type RailwayProvider,
  type SearchQuery,
  type Station,
  type TrainResult,
} from "../providers/types.js";

export const RAILCORE_BASE_URL = "https://ir.railcore.tech/v1";

export type RailcoreLiveStatus = {
  trainNumber: string;
  trainName: string;
  status: string;
  delayMinutes: number | null;
  lastUpdatedAt: string | null;
  currentStation: string | null;
  nextStation: string | null;
  journeyDate: string | null;
};

export type RailcoreSchedule = {
  trainNumber: string;
  trainName: string;
  runningDays: string[];
  classes: string[];
  durationMinutes: number | null;
  stops: { code: string; name: string; arrival: string | null; departure: string | null; day?: number }[];
};

const bookings = new Map<string, BookingRecord>();
const KNOWN_CLASS: ClassCode[] = ["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"];

let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);

/**
 * Circuit breaker. RailCore's plan has a small daily quota (300 req/day, 20/min).
 * Once the API says the quota is gone, calling it again is pure latency; we remember the
 * block window (from the API's own headers) and route straight to the RailKit fallback.
 * The `provider` field in responses stays truthful (`railkit_fallback`), nothing is invented.
 */
let blockedUntil = 0;
let blockedReason = "";

export function resetRailcoreBlock(): void {
  blockedUntil = 0;
  blockedReason = "";
}

export function railcoreBlockState(): { blocked: boolean; until: number; reason: string } {
  const blocked = Date.now() < blockedUntil;
  return { blocked, until: blocked ? blockedUntil : 0, reason: blocked ? blockedReason : "" };
}

function noteRateLimit(res: Response): void {
  const now = Date.now();
  if (res.status === 402) {
    blockedUntil = now + 30 * 60_000;
    blockedReason = "railcore_credits_exhausted";
    return;
  }
  if (res.status !== 429) return;
  const dayRemaining = res.headers.get("x-railcore-ratelimit-day-remaining");
  const dayReset = Number(res.headers.get("x-railcore-ratelimit-day-reset"));
  if (dayRemaining === "0" && Number.isFinite(dayReset) && dayReset > 0) {
    blockedUntil = Math.min(dayReset * 1000, now + 6 * 3_600_000);
    blockedReason = "railcore_daily_limit";
    return;
  }
  const retry = Number(res.headers.get("retry-after"));
  const seconds = Number.isFinite(retry) && retry > 0 ? Math.min(retry, 120) : 10;
  blockedUntil = now + seconds * 1000;
  blockedReason = "railcore_rate_limited";
}

export function setRailcoreFetch(next: typeof fetch | null): void {
  fetchImpl = next ?? globalThis.fetch.bind(globalThis);
  resetRailcoreBlock();
}

export function resetRailcoreBookings(): void {
  bookings.clear();
}

function logCall(method: string, started: number, ok: boolean, failureReason?: string | null): void {
  console.info(
    JSON.stringify({
      railwayProvider: "railcore",
      railwayMethod: method,
      railwayLatencyMs: Date.now() - started,
      railwaySuccess: ok,
      failureReason: failureReason || undefined,
    }),
  );
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function unwrap(json: unknown): unknown {
  const o = asObj(json);
  return "data" in o ? o.data : json;
}

export async function railcoreRequest(path: string, query: Record<string, string | number | undefined> = {}): Promise<{
  ok: boolean;
  status: number;
  json: unknown;
  latencyMs: number;
}> {
  const key = env.railcoreApiKey;
  const started = Date.now();
  if (!key) {
    return { ok: false, status: 0, json: { error: { message: "RAILCORE_API_KEY missing" } }, latencyMs: 0 };
  }
  if (Date.now() < blockedUntil) {
    return { ok: false, status: 429, json: { error: { message: blockedReason || "railcore_blocked" } }, latencyMs: 0 };
  }
  const url = new URL(path.startsWith("http") ? path : `${RAILCORE_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  try {
    const res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        "X-RailCore-Key": key,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { error: { message: "invalid_json" } };
    }
    if (res.status === 429 || res.status === 402) noteRateLimit(res);
    return { ok: res.ok, status: res.status, json, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, status: 0, json: { error: { message: "network" } }, latencyMs: Date.now() - started };
  }
}

function failReason(json: unknown): string | null {
  const o = asObj(json);
  const err = asObj(o.error);
  const msg = err.message || o.message;
  return typeof msg === "string" ? msg : null;
}

function mapStation(row: unknown): Station | null {
  const o = asObj(row);
  const code = String(o.station_code ?? o.code ?? "").trim().toUpperCase();
  if (!code) return null;
  const name = String(o.station_name ?? o.display_name ?? o.name ?? code);
  const city = String(o.city ?? name);
  return { code, name, city };
}

const DAY_NUM: Record<string, number> = {
  SUN: 0,
  SUNDAY: 0,
  MON: 1,
  MONDAY: 1,
  TUE: 2,
  TUESDAY: 2,
  WED: 3,
  WEDNESDAY: 3,
  THU: 4,
  THURSDAY: 4,
  FRI: 5,
  FRIDAY: 5,
  SAT: 6,
  SATURDAY: 6,
};

function runDays(raw: unknown): number[] {
  if (!Array.isArray(raw) || !raw.length) return [0, 1, 2, 3, 4, 5, 6];
  const days = raw
    .map((d) => DAY_NUM[String(d).toUpperCase()] ?? DAY_NUM[String(d).toUpperCase().slice(0, 3)])
    .filter((n): n is number => n != null);
  return days.length ? days : [0, 1, 2, 3, 4, 5, 6];
}

function parseAvail(row: unknown): { status: AvailabilityStatus; seats?: number; rac?: number; waitlist?: number } {
  const o = asObj(row);
  const text = String(o.availability_text ?? o.text ?? o.status ?? "").toUpperCase();
  const status = String(o.status ?? "").toUpperCase();
  if (text.includes("NOT AVAILABLE") || status === "NOT_AVAILABLE") return { status: "NOT_AVAILABLE" };
  if (status === "AVAILABLE" || text.includes("AVAILABLE")) {
    const n =
      typeof o.available_count === "number"
        ? o.available_count
        : Number(text.match(/AVAILABLE[- ]?0*(\d+)/)?.[1]);
    return { status: "AVAILABLE", seats: Number.isFinite(n) ? n : undefined };
  }
  if (status === "RAC" || text.includes("RAC")) {
    const n = typeof o.rac_count === "number" ? o.rac_count : Number(text.match(/RAC\s*0*(\d+)/)?.[1]);
    return { status: "RAC", rac: Number.isFinite(n) ? n : undefined };
  }
  if (status === "WAITLIST" || text.includes("WL") || text.includes("WAIT")) {
    const n = typeof o.waitlist_count === "number" ? o.waitlist_count : Number(text.match(/WL\s*0*(\d+)/)?.[1]);
    return { status: "WAITLIST", waitlist: Number.isFinite(n) ? n : undefined };
  }
  return { status: "UNKNOWN" };
}

export async function searchRailcoreStationsResult(q: string): Promise<{
  ok: boolean;
  stations: Station[];
  failureReason?: string;
}> {
  const started = Date.now();
  const query = q.trim();
  if (!query) return { ok: true, stations: [] };
  const res = await railcoreRequest("/stations/search", { q: query, limit: 12 });
  logCall("stationSearch", started, res.ok, res.ok ? null : failReason(res.json));
  if (!res.ok) return { ok: false, stations: [], failureReason: failReason(res.json) ?? "station_search_failed" };
  const data = asObj(unwrap(res.json));
  const rows = Array.isArray(data.results) ? data.results : [];
  return { ok: true, stations: rows.map(mapStation).filter((s): s is Station => Boolean(s)) };
}

export async function searchRailcoreStations(q: string): Promise<Station[]> {
  return (await searchRailcoreStationsResult(q)).stations;
}

export function isUsableLive(live: RailcoreLiveStatus | null): boolean {
  if (!live) return false;
  if (!live.trainNumber) return false;
  const status = (live.status || "").trim().toLowerCase();
  if (!status || status === "unknown") {
    return Boolean(live.currentStation || live.lastUpdatedAt);
  }
  return true;
}

function mapLivePayload(d: Record<string, unknown>, number: string, dateYmd?: string): RailcoreLiveStatus {
  const current = asObj(d.current_station);
  const next = asObj(d.next_stop);
  return {
    trainNumber: String(d.train_number ?? number),
    trainName: String(d.train_name ?? ""),
    status: String(d.status_text ?? d.status ?? "unknown"),
    delayMinutes: typeof d.delay_minutes === "number" ? d.delay_minutes : null,
    lastUpdatedAt: typeof d.last_reported_at === "string" ? d.last_reported_at : null,
    currentStation:
      String(d.current_station_name ?? current.station_name ?? d.current_station_code ?? current.station_code ?? "") ||
      null,
    nextStation: String(next.station_name ?? d.next_station_code ?? next.station_code ?? "") || null,
    journeyDate: typeof d.journey_date === "string" ? d.journey_date : dateYmd ?? null,
  };
}

export async function liveTrainStatus(number: string, dateYmd?: string): Promise<RailcoreLiveStatus | null> {
  const started = Date.now();
  let res = await railcoreRequest(`/trains/${encodeURIComponent(number)}/live`, dateYmd ? { date: dateYmd } : {});
  if (!res.ok) {
    res = await railcoreRequest(`/trains/${encodeURIComponent(number)}/running`, dateYmd ? { date: dateYmd } : {});
  }
  logCall("liveStatus", started, res.ok, res.ok ? null : failReason(res.json));
  if (!res.ok) return null;
  return mapLivePayload(asObj(unwrap(res.json)), number, dateYmd);
}

export async function trainInfo(number: string): Promise<{ trainNumber: string; trainName: string; runningDays: string[] } | null> {
  const started = Date.now();
  const res = await railcoreRequest(`/trains/${encodeURIComponent(number)}`);
  logCall("trainInfo", started, res.ok, res.ok ? null : failReason(res.json));
  if (!res.ok) return null;
  const d = asObj(unwrap(res.json));
  return {
    trainNumber: String(d.train_number ?? number),
    trainName: String(d.train_name ?? ""),
    runningDays: Array.isArray(d.running_days) ? d.running_days.map(String) : [],
  };
}

export async function trainSchedule(number: string): Promise<RailcoreSchedule | null> {
  const started = Date.now();
  const res = await railcoreRequest(`/trains/${encodeURIComponent(number)}/schedule`);
  logCall("timetable", started, res.ok, res.ok ? null : failReason(res.json));
  if (!res.ok) return null;
  const d = asObj(unwrap(res.json));
  const stops = Array.isArray(d.stops) ? d.stops : [];
  return {
    trainNumber: String(d.train_number ?? number),
    trainName: String(d.train_name ?? ""),
    runningDays: Array.isArray(d.running_days) ? d.running_days.map(String) : [],
    classes: Array.isArray(d.classes) ? d.classes.map(String).filter((c) => c && c !== "UNKNOWN") : [],
    durationMinutes: typeof d.total_duration_minutes === "number" ? d.total_duration_minutes : null,
    stops: stops
      .map((row) => {
        const s = asObj(row);
        const code = String(s.station_code ?? "").trim();
        if (!code) return null;
        return {
          code,
          name: String(s.station_name ?? code),
          arrival: s.arrival_time != null ? String(s.arrival_time) : null,
          departure: s.departure_time != null ? String(s.departure_time) : null,
          day: typeof s.day === "number" ? s.day : undefined,
        };
      })
      .filter((s): s is NonNullable<typeof s> => Boolean(s)),
  };
}

export type RailcoreCoach = {
  name: string;
  classCode: string;
  positionFromEngine: number | null;
  sequence: number | null;
};

export type RailcoreCoachPosition = {
  trainNumber: string;
  stationCode: string | null;
  coaches: RailcoreCoach[];
};

export async function coachPosition(number: string, stationCode?: string): Promise<RailcoreCoachPosition | null> {
  const started = Date.now();
  const query: Record<string, string | undefined> = {};
  if (stationCode) query.stationCode = stationCode;
  const res = await railcoreRequest(`/trains/${encodeURIComponent(number)}/coach-position`, query);
  logCall("coachPosition", started, res.ok, res.ok ? null : failReason(res.json));
  if (!res.ok) return null;
  const d = asObj(unwrap(res.json));
  const rows = Array.isArray(d.coach_position) ? d.coach_position : [];
  const coaches = rows
    .map((row) => {
      const c = asObj(row);
      const name = String(c.coach_name ?? "").trim().toUpperCase();
      if (!name) return null;
      return {
        name,
        classCode: String(c.class_code ?? "").trim().toUpperCase() || "—",
        positionFromEngine: typeof c.position_from_engine === "number" ? c.position_from_engine : null,
        sequence: typeof c.sequence === "number" ? c.sequence : null,
      };
    })
    .filter((c): c is RailcoreCoach => Boolean(c))
    .sort(
      (a, b) =>
        (a.positionFromEngine ?? Number.MAX_SAFE_INTEGER) - (b.positionFromEngine ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
  if (!coaches.length) return null;
  return {
    trainNumber: String(d.train_number ?? number),
    stationCode: stationCode ? stationCode.toUpperCase() : null,
    coaches,
  };
}

export async function cancelledTrains(): Promise<null> {
  return null;
}

export async function pnrStatus(_pnr: string): Promise<null> {
  return null;
}

export class RailCoreProvider implements RailwayProvider {
  readonly id = "railcore";
  get displayName() {
    return env.railcoreApiKey ? "RailCore" : "RailCore (not configured)";
  }
  get mock() {
    return !env.railcoreApiKey;
  }

  async trySearchTrains(query: SearchQuery): Promise<{ ok: boolean; trains: TrainResult[]; failureReason?: string }> {
    const started = Date.now();
    const res = await railcoreRequest("/routes/trains", {
      from: query.from.toUpperCase(),
      to: query.to.toUpperCase(),
      date: query.date,
    });
    logCall("trainSearch", started, res.ok, res.ok ? null : failReason(res.json));
    if (!res.ok) return { ok: false, trains: [], failureReason: failReason(res.json) ?? "train_search_failed" };
    const data = asObj(unwrap(res.json));
    const rows = Array.isArray(data.trains) ? data.trains : [];
    const fromCode = String(data.from_station_code ?? query.from).toUpperCase();
    const toCode = String(data.to_station_code ?? query.to).toUpperCase();
    const out: TrainResult[] = [];
    for (const row of rows) {
      const o = asObj(row);
      const number = String(o.train_number ?? "").trim();
      if (!number) continue;
      const dur = typeof o.duration_minutes === "number" ? o.duration_minutes : 0;
      const classCodes = Array.isArray(o.classes)
        ? o.classes.map((c) => String(c).toUpperCase()).filter((c): c is ClassCode => (KNOWN_CLASS as string[]).includes(c))
        : [];
      out.push({
        number,
        name: String(o.train_name ?? `Train ${number}`),
        type: String(o.train_type ?? "Express"),
        from: { code: fromCode, name: fromCode, city: fromCode },
        to: { code: toCode, name: toCode, city: toCode },
        date: query.date,
        departure: String(o.departure_time ?? "--:--"),
        arrival: String(o.arrival_time ?? "--:--"),
        arrivalDayOffset: 0,
        durationMinutes: dur,
        durationLabel: durationLabel(dur),
        runsOn: runDays(o.running_days),
        classes: classCodes.map((code) => ({
          code,
          label: CLASS_LABELS[code],
          status: "UNKNOWN",
          fare: 0,
        })),
      });
    }
    return { ok: true, trains: out };
  }

  async searchTrains(query: SearchQuery): Promise<TrainResult[]> {
    return (await this.trySearchTrains(query)).trains;
  }

  async getAvailability(
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    quotaCode = "GN",
  ): Promise<ClassAvailability> {
    const unknown: ClassAvailability = {
      code: classCode,
      label: CLASS_LABELS[classCode],
      status: "UNKNOWN",
      fare: 0,
    };
    const started = Date.now();
    const res = await railcoreRequest("/availability/seats", {
      train_number: trainNumber,
      from,
      to,
      date,
      class: classCode,
      quota: quotaCode || "GN",
    });
    logCall("availability", started, res.ok, res.ok ? null : failReason(res.json));
    if (!res.ok) return unknown;
    const d = asObj(unwrap(res.json));
    const classes = Array.isArray(d.classes) ? d.classes : [];
    const row =
      classes.find((c) => String(asObj(c).class_code).toUpperCase() === classCode) ?? classes[0] ?? d;
    const parsed = parseAvail(row);
    const o = asObj(row);
    const fare = Number(o.total_fare ?? o.fare ?? 0);
    return {
      code: classCode,
      label: CLASS_LABELS[classCode],
      status: parsed.status,
      seats: parsed.seats,
      rac: parsed.rac,
      waitlist: parsed.waitlist,
      fare: Number.isFinite(fare) && fare > 0 ? fare : 0,
        quota: String(d.quota ?? quotaCode ?? "GN"),
      date: String(d.journey_date ?? date),
    };
  }

  async getFare(
    trainNumber: string,
    date: string,
    from: string,
    to: string,
    classCode: ClassCode,
    passengerCount: number,
  ): Promise<FareBreakdown> {
    const count = Math.max(1, passengerCount);
    const empty: FareBreakdown = {
      trainNumber,
      date,
      classCode,
      passengerCount: count,
      baseFare: 0,
      serviceFee: env.serviceFee * count,
      total: env.serviceFee * count,
      currency: "INR",
      railwayAvailable: false,
    };
    const started = Date.now();
    const res = await railcoreRequest("/fares/estimate", {
      train_number: trainNumber,
      from,
      to,
      class: classCode,
      quota: "GN",
    });
    logCall("fare", started, res.ok, res.ok ? null : failReason(res.json));
    if (!res.ok) return empty;
    const d = asObj(unwrap(res.json));
    const fares = Array.isArray(d.fares) ? d.fares : [];
    const hit = fares.find((f) => String(asObj(f).class_code).toUpperCase() === classCode) ?? fares[0];
    const per = Number(asObj(hit).fare ?? 0);
    if (!Number.isFinite(per) || per <= 0) return empty;
    const base = per * count;
    return {
      ...empty,
      baseFare: base,
      total: base + empty.serviceFee,
      railwayAvailable: true,
    };
  }

  async createBooking(req: CreateBookingRequest): Promise<BookingRecord> {
    const fare = await this.getFare(
      req.trainNumber,
      req.date,
      req.from,
      req.to,
      req.classCode,
      req.passengers.length,
    );
    const record: BookingRecord = {
      id: uid("RB"),
      pnr: null,
      mock: true,
      status: "DRAFT",
      trainNumber: req.trainNumber,
      trainName: req.trainNumber,
      date: req.date,
      from: { code: req.from, name: req.from, city: req.from },
      to: { code: req.to, name: req.to, city: req.to },
      departure: "",
      arrival: "",
      classCode: req.classCode,
      seatPreference: req.seatPreference,
      passengers: req.passengers,
      fare,
      createdAt: new Date().toISOString(),
      confirmedAt: null,
      failureReason: null,
    };
    bookings.set(record.id, record);
    return record;
  }

  async confirmBooking(bookingId: string): Promise<BookingRecord> {
    const rec = bookings.get(bookingId);
    if (!rec) throw Object.assign(new Error("Booking not found."), { status: 404 });
    rec.status = "CONFIRMED";
    rec.mock = true;
    rec.pnr = `MOCK${String(hash32(rec.id)).padStart(7, "0").slice(0, 7)}`;
    rec.confirmedAt = new Date().toISOString();
    rec.failureReason = null;
    return rec;
  }

  async getBooking(idOrPnr: string): Promise<BookingRecord | null> {
    const direct = bookings.get(idOrPnr);
    if (direct) return direct;
    for (const rec of bookings.values()) {
      if (rec.pnr && rec.pnr === idOrPnr) return rec;
    }
    return null;
  }

  async listBookings(): Promise<BookingRecord[]> {
    return [...bookings.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async cancelBooking(bookingId: string): Promise<CancelResult> {
    const rec = bookings.get(bookingId);
    if (!rec) throw Object.assign(new Error("Booking not found."), { status: 404 });
    rec.status = "CANCELLED";
    return { bookingId, status: "CANCELLED", refundAmount: rec.fare.total };
  }
}
