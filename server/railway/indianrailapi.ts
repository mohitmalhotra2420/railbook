/* Round-16o: Indian Rail API (https://indianrailapi.com) — ADDITIONAL fallback
 * provider (RailCore → RailKit → RailRadar → **IndianRailAPI** → verified-site
 * web-scrape). Key optional: `INDIANRAILAPI_KEY` set na ho to har call turant
 * null deti hai — chain aage badhti hai.
 *
 * URL pattern: https://indianrailapi.com/api/v2/<Method>/apikey/<KEY>/... ;
 * body { ResponseCode:"200", Status:"SUCCESS", ... }. Bina/galat key par
 * ResponseCode "201" "Authentication Required." (live verify 2026-09-08).
 * Seat availability sirf Enterprise/Advanced plan par hai — fail par null. */
import { env } from "../env.js";
import { CLASS_LABELS, type ClassAvailability, type ClassCode, type FareBreakdown, type Station } from "../providers/types.js";
import { parseIrctcAvailabilityText } from "./webscrape.js";
import type { RailcoreCoachPosition, RailcoreLiveStatus, RailcoreSchedule, RailcoreTrainNameResult } from "./railcore.js";

export const INDIANRAILAPI_BASE_URL = "https://indianrailapi.com/api/v2";

let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);
let blockedUntil = 0;
let blockedReason = "";

export function setIndianRailApiFetch(next: typeof fetch | null): void {
  fetchImpl = next ?? globalThis.fetch.bind(globalThis);
  blockedUntil = 0;
  blockedReason = "";
}

export function indianRailApiConfigured(): boolean {
  return Boolean(env.indianRailApiKey);
}

function logCall(method: string, started: number, ok: boolean, failureReason?: string | null): void {
  console.info(
    JSON.stringify({
      railwayProvider: "indianrailapi",
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

type IraRes = { ok: boolean; json: Record<string, unknown>; error: string | null };

/** `segments` URL path ke hisse (key ke baad) — har ek encode hota hai. */
export async function indianRailApiRequest(method: string, segments: (string | number)[]): Promise<IraRes> {
  const key = env.indianRailApiKey;
  if (!key) return { ok: false, json: {}, error: "INDIANRAILAPI_KEY missing" };
  if (Date.now() < blockedUntil) return { ok: false, json: {}, error: blockedReason || "indianrailapi_blocked" };
  const path = [method, "apikey", key, ...segments.map((s) => encodeURIComponent(String(s)))].join("/");
  const url = `${INDIANRAILAPI_BASE_URL}/${path}/`;
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    let res: Response;
    try {
      res = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const o = asObj(json);
    const code = String(o.ResponseCode ?? res.status);
    if (code === "201" || res.status === 401 || res.status === 403) {
      /* Authentication Required / plan nahi — 1h tak dobara mat maaro. */
      blockedUntil = Date.now() + 3_600_000;
      blockedReason = "indianrailapi_auth";
    } else if (res.status === 429 || /limit|quota|exceed/i.test(String(o.Message ?? ""))) {
      blockedUntil = Date.now() + 6 * 3_600_000;
      blockedReason = "indianrailapi_quota";
    }
    const success = res.ok && code === "200" && String(o.Status ?? "SUCCESS").toUpperCase() !== "FAILED";
    void started;
    return { ok: success, json: o, error: success ? null : String(o.Message ?? o.Status ?? `http_${res.status}`) };
  } catch {
    return { ok: false, json: {}, error: "network" };
  }
}

function hhmm(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (/pm/i.test(m12[3])) h += 12;
    return `${String(h).padStart(2, "0")}:${m12[2]}`;
  }
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function ymdCompact(ymd: string): string {
  return ymd.replace(/-/g, "");
}

/* ── Schedule ─────────────────────────────────────────────────────────── */
export async function indianRailApiSchedule(number: string): Promise<RailcoreSchedule | null> {
  if (!indianRailApiConfigured()) return null;
  const started = Date.now();
  const res = await indianRailApiRequest("TrainSchedule", ["TrainNumber", number]);
  logCall("timetable", started, res.ok, res.error);
  if (!res.ok) return null;
  const route = Array.isArray(res.json.Route) ? res.json.Route : [];
  const stops = route
    .map((row) => {
      const s = asObj(row);
      const code = String(s.StationCode ?? "").trim().toUpperCase();
      if (!code) return null;
      return { code, name: String(s.StationName ?? code).trim(), arrival: hhmm(s.ArrivalTime), departure: hhmm(s.DepartureTime) };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (!stops.length) return null;
  let trainName = String(res.json.TrainName ?? "").trim();
  if (!trainName) {
    const info = await indianRailApiRequest("TrainNumberToName", ["TrainNumber", number]);
    trainName = String(info.json.TrainName ?? "").trim();
  }
  return { trainNumber: number, trainName, runningDays: [], classes: [], durationMinutes: null, stops };
}

/* ── Live status ─────────────────────────────────────────────────────── */
export async function indianRailApiLive(number: string, dateYmd?: string): Promise<RailcoreLiveStatus | null> {
  if (!indianRailApiConfigured()) return null;
  const started = Date.now();
  const ist = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const res = await indianRailApiRequest("livetrainstatus", ["trainnumber", number, "date", ymdCompact(dateYmd || ist)]);
  logCall("liveStatus", started, res.ok, res.error);
  if (!res.ok) return null;
  const cur = asObj(res.json.CurrentStation);
  const route = Array.isArray(res.json.TrainRoute) ? res.json.TrainRoute.map(asObj) : [];
  const curCode = String(cur.StationCode ?? "").trim();
  if (!curCode && !route.length) return null;
  const delayRaw = String(cur.DelayInArrival ?? cur.DelayInDeparture ?? "").match(/(\d+)\s*M/i);
  const delay = delayRaw ? Number(delayRaw[1]) : null;
  const idx = route.findIndex((s) => String(s.StationCode ?? "") === curCode);
  const next = idx >= 0 ? route[idx + 1] : undefined;
  return {
    trainNumber: String(res.json.TrainNumber ?? number),
    trainName: "",
    status: delay == null ? "running" : delay > 0 ? `${delay} min late` : "on time",
    delayMinutes: delay,
    lastUpdatedAt: null,
    currentStation: curCode ? `${String(cur.StationName ?? curCode)} (${curCode})` : null,
    nextStation: next ? `${String(next.StationName ?? "")} (${String(next.StationCode ?? "")})` : null,
    journeyDate: dateYmd ?? null,
  };
}

/* ── Fare (route-segment fare, class list) ────────────────────────────── */
export async function indianRailApiFare(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  passengerCount: number,
): Promise<FareBreakdown | null> {
  if (!indianRailApiConfigured()) return null;
  const started = Date.now();
  const res = await indianRailApiRequest("TrainFare", ["TrainNumber", trainNumber, "From", from.toUpperCase(), "To", to.toUpperCase(), "Quota", "GN"]);
  logCall("fare", started, res.ok, res.error);
  if (!res.ok) return null;
  const fares = Array.isArray(res.json.Fares) ? res.json.Fares.map(asObj) : [];
  const hit = fares.find((f) => String(f.Code ?? "").toUpperCase() === classCode);
  const per = Number(hit?.Fare ?? 0);
  if (!Number.isFinite(per) || per <= 0) return null;
  const pax = Math.max(1, passengerCount || 1);
  return { trainNumber, date, classCode, passengerCount: pax, baseFare: per * pax, serviceFee: 0, total: per * pax, currency: "INR", railwayAvailable: true, source: "indianrailapi" };
}

/* ── Seat availability (Enterprise plan only — warna null) ────────────── */
export async function indianRailApiAvailability(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  quotaCode = "GN",
): Promise<ClassAvailability | null> {
  if (!indianRailApiConfigured()) return null;
  if ((quotaCode || "GN").toUpperCase() !== "GN") return null;
  const started = Date.now();
  const res = await indianRailApiRequest("SeatAvailability", [
    "TrainNumber",
    trainNumber,
    "From",
    from.toUpperCase(),
    "To",
    to.toUpperCase(),
    "Date",
    ymdCompact(date),
    "Quota",
    "GN",
    "Class",
    classCode,
  ]);
  logCall("availability", started, res.ok, res.error);
  if (!res.ok) return null;
  const rows = Array.isArray(res.json.Availability) ? res.json.Availability.map(asObj) : [];
  const dmy = `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
  const row = rows.find((r) => String(r.JourneyDate ?? "") === dmy) ?? rows[0];
  if (!row) return null;
  const raw = String(row.Availability ?? "").trim();
  const parsed = parseIrctcAvailabilityText(raw);
  if (parsed.status === "UNKNOWN") return null;
  return {
    code: classCode,
    label: CLASS_LABELS[classCode],
    status: parsed.status,
    seats: parsed.seats ?? undefined,
    rac: parsed.rac ?? undefined,
    waitlist: parsed.waitlist ?? undefined,
    fare: 0,
    quota: "GN",
    date,
    source: "indianrailapi",
    webNote: `Indian Rail API — status "${raw}"`,
  };
}

/* ── Coach position ───────────────────────────────────────────────────── */
export async function indianRailApiCoachPosition(number: string): Promise<RailcoreCoachPosition | null> {
  if (!indianRailApiConfigured()) return null;
  const started = Date.now();
  const res = await indianRailApiRequest("CoachPosition", ["TrainNumber", number]);
  logCall("coachPosition", started, res.ok, res.error);
  if (!res.ok) return null;
  const rows = Array.isArray(res.json.Coaches) ? res.json.Coaches.map(asObj) : [];
  const coaches = rows
    .map((c) => {
      const name = String(c.Number ?? c.Code ?? "").trim().toUpperCase();
      if (!name) return null;
      const pos = Number(c.SerialNo);
      return { name, classCode: String(c.Code ?? "").trim().toUpperCase() || "—", positionFromEngine: Number.isFinite(pos) ? pos : null, sequence: Number.isFinite(pos) ? pos : null };
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (!coaches.length) return null;
  return { trainNumber: String(res.json.TrainNumber ?? number), stationCode: null, coaches };
}

/* ── Station autocomplete ─────────────────────────────────────────────── */
export async function indianRailApiStationSearch(q: string): Promise<Station[] | null> {
  if (!indianRailApiConfigured()) return null;
  const started = Date.now();
  const res = await indianRailApiRequest("AutoCompleteStation", ["StationCodeOrName", q.trim()]);
  logCall("stationSearch", started, res.ok, res.error);
  if (!res.ok) return null;
  const raw = res.json.Station;
  const rows = Array.isArray(raw) ? raw.map(asObj) : raw ? [asObj(raw)] : [];
  const out: Station[] = [];
  for (const o of rows) {
    const code = String(o.StationCode ?? "").trim().toUpperCase();
    if (!code) continue;
    const name = String(o.NameEn ?? code).trim();
    out.push({ code, name, city: name });
  }
  return out;
}

/* ── Train name/number autocomplete ───────────────────────────────────── */
export async function indianRailApiTrainNameSearch(q: string): Promise<RailcoreTrainNameResult[] | null> {
  if (!indianRailApiConfigured()) return null;
  const started = Date.now();
  const res = await indianRailApiRequest("AutoCompleteTrainInformation", ["TrainNumberOrName", q.trim()]);
  logCall("trainNameSearch", started, res.ok, res.error);
  if (!res.ok) return null;
  const rows = Array.isArray(res.json.Trains) ? res.json.Trains.map(asObj) : [];
  const seen = new Set<string>();
  const out: RailcoreTrainNameResult[] = [];
  for (const o of rows) {
    const number = String(o.TrainNo ?? "").trim();
    if (!/^\d{4,6}$/.test(number) || seen.has(number)) continue;
    seen.add(number);
    out.push({
      number,
      name: String(o.TrainName ?? `Train ${number}`).trim(),
      from: String(asObj(o.Source).Code ?? "").toUpperCase(),
      to: String(asObj(o.Destination).Code ?? "").toUpperCase(),
      type: "",
    });
  }
  return out;
}
