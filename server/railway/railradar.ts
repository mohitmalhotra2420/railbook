/* Round-16o: RailRadar API (https://railradar.in/docs) — ADDITIONAL fallback
 * provider. Chain mein RailCore → RailKit ke BAAD aur verified-site web-scrape
 * se PEHLE aata hai. Key optional: `RAILRADAR_API_KEY` set na ho to har call
 * turant null deti hai (chain aage badhti hai, kuch nahi badalta).
 *
 * Base: https://api.railradar.in/v1 · Auth: `Authorization: Bearer rr_live_…`
 * Envelope: { success, data, meta } · errors { success:false, error:{code,message} }
 * Free sandbox tier: 1,000 req/month → 429 par 6h ka circuit-break (quota
 * jalane ka koi matlab nahi), 401 par 1h (galat key). */
import { env } from "../env.js";
import { durationLabel } from "../util.js";
import { CLASS_LABELS, type ClassAvailability, type ClassCode, type FareBreakdown, type SearchQuery, type Station, type TrainResult } from "../providers/types.js";
import { parseIrctcAvailabilityText } from "./webscrape.js";
import type { RailcoreCoachPosition, RailcoreLiveStatus, RailcoreSchedule, RailcoreTrainNameResult } from "./railcore.js";

export const RAILRADAR_BASE_URL = "https://api.railradar.in/v1";

let fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis);
let blockedUntil = 0;
let blockedReason = "";

export function setRailradarFetch(next: typeof fetch | null): void {
  fetchImpl = next ?? globalThis.fetch.bind(globalThis);
  blockedUntil = 0;
  blockedReason = "";
}

export function railradarConfigured(): boolean {
  return Boolean(env.railradarApiKey);
}

export function railradarBlockState(): { blocked: boolean; reason: string } {
  const blocked = Date.now() < blockedUntil;
  return { blocked, reason: blocked ? blockedReason : "" };
}

function logCall(method: string, started: number, ok: boolean, failureReason?: string | null): void {
  console.info(
    JSON.stringify({
      railwayProvider: "railradar",
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

type RadarRes = { ok: boolean; status: number; data: unknown; error: string | null };

export async function railradarRequest(path: string, query: Record<string, string | number | undefined> = {}): Promise<RadarRes> {
  const key = env.railradarApiKey;
  if (!key) return { ok: false, status: 0, data: null, error: "RAILRADAR_API_KEY missing" };
  if (Date.now() < blockedUntil) return { ok: false, status: 429, data: null, error: blockedReason || "railradar_blocked" };
  const url = new URL(`${RAILRADAR_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${key}`, "X-API-Key": key, Accept: "application/json" },
        signal: ctrl.signal,
      });
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
    const err = asObj(o.error);
    if (res.status === 429) {
      blockedUntil = Date.now() + 6 * 3_600_000;
      blockedReason = "railradar_quota_exceeded";
    } else if (res.status === 401) {
      blockedUntil = Date.now() + 3_600_000;
      blockedReason = "railradar_unauthorized";
    }
    if (!res.ok || o.success === false) {
      return { ok: false, status: res.status, data: null, error: String(err.message ?? err.code ?? o.message ?? `http_${res.status}`) };
    }
    return { ok: true, status: res.status, data: "data" in o ? o.data : json, error: null };
  } catch {
    return { ok: false, status: 0, data: null, error: "network" };
  }
}

function hhmm(raw: unknown): string {
  const m = String(raw ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

const DAY_IDX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function runDaysToJs(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const d of raw) {
    const k = String(d).slice(0, 3).toLowerCase();
    if (k in DAY_IDX) out.add(DAY_IDX[k]);
  }
  return [...out].sort();
}

/* ── Trains between stations ─────────────────────────────────────────── */
export async function railradarSearchTrains(query: SearchQuery): Promise<TrainResult[] | null> {
  if (!railradarConfigured()) return null;
  const started = Date.now();
  const from = query.from.toUpperCase();
  const to = query.to.toUpperCase();
  const res = await railradarRequest(`/trains/between/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, { date: query.date });
  logCall("trainSearch", started, res.ok, res.error);
  if (!res.ok) return null;
  const d = asObj(res.data);
  const rows = Array.isArray(d.trains) ? d.trains : [];
  const out: TrainResult[] = [];
  for (const row of rows) {
    const r = asObj(row);
    const t = asObj(r.train);
    const number = String(t.number ?? r.number ?? "").trim();
    if (!/^\d{4,6}$/.test(number)) continue;
    const f = asObj(r.from);
    const tt = asObj(r.to);
    const dep = hhmm(f.departure);
    const arr = hhmm(tt.arrival);
    if (!dep || !arr) continue;
    const depDay = Number(f.day ?? 1);
    const arrDay = Number(tt.day ?? depDay);
    let dayOff = Number.isFinite(depDay) && Number.isFinite(arrDay) ? Math.max(0, arrDay - depDay) : 0;
    const dur = Number(r.duration);
    const depMin = Number(dep.slice(0, 2)) * 60 + Number(dep.slice(3));
    if (!dayOff && Number.isFinite(dur) && dur > 0) dayOff = Math.floor((depMin + dur) / 1440);
    const arrMin = Number(arr.slice(0, 2)) * 60 + Number(arr.slice(3));
    const computed = dayOff * 1440 + (arrMin - depMin);
    const durationMinutes = Number.isFinite(dur) && dur > 0 ? dur : computed > 0 ? computed : 0;
    out.push({
      number,
      name: String(t.name ?? `Train ${number}`),
      type: String(t.type ?? "Express"),
      from: { code: from, name: String(asObj(d.from).name ?? from), city: String(asObj(d.from).name ?? from) },
      to: { code: to, name: String(asObj(d.to).name ?? to), city: String(asObj(d.to).name ?? to) },
      date: query.date,
      departure: dep,
      arrival: arr,
      arrivalDayOffset: dayOff,
      durationMinutes,
      durationLabel: durationLabel(durationMinutes),
      runsOn: runDaysToJs(t.runDays),
      classes: [],
      haltVerified: true,
    });
  }
  out.sort((a, b) => a.departure.localeCompare(b.departure));
  return out;
}

/* ── Seat availability (14-day list; hum sirf maangi date ki row lete hain) ── */
export async function railradarAvailability(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  quotaCode = "GN",
): Promise<ClassAvailability | null> {
  if (!railradarConfigured()) return null;
  const started = Date.now();
  const res = await railradarRequest(`/trains/${encodeURIComponent(trainNumber)}/seats`, {
    source: from.toUpperCase(),
    destination: to.toUpperCase(),
    journeyDate: date,
    classCode,
    quotaCode: quotaCode || "GN",
  });
  logCall("availability", started, res.ok, res.error);
  if (!res.ok) return null;
  const d = asObj(res.data);
  const list = Array.isArray(d.avlDayList) ? d.avlDayList : [];
  const row = list.map(asObj).find((x) => String(x.availablityDate ?? x.availabilityDate ?? "") === date) ?? (list.length ? asObj(list[0]) : null);
  if (!row) return null;
  const rawStatus = String(row.availablityStatus ?? row.availabilityStatus ?? "").trim();
  if (!rawStatus) return null;
  const parsed = parseIrctcAvailabilityText(rawStatus);
  if (parsed.status === "UNKNOWN") return null;
  return {
    code: classCode,
    label: CLASS_LABELS[classCode],
    status: parsed.status,
    seats: parsed.seats ?? undefined,
    rac: parsed.rac ?? undefined,
    waitlist: parsed.waitlist ?? undefined,
    fare: 0,
    quota: String(d.quotaCode ?? quotaCode ?? "GN"),
    date: String(row.availablityDate ?? row.availabilityDate ?? date),
    source: "railradar",
    webNote: `RailRadar API — status "${rawStatus}"`,
  };
}

/* ── Fare ─────────────────────────────────────────────────────────────── */
export async function railradarFare(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  classCode: ClassCode,
  passengerCount: number,
): Promise<FareBreakdown | null> {
  if (!railradarConfigured()) return null;
  const started = Date.now();
  const res = await railradarRequest(`/trains/${encodeURIComponent(trainNumber)}/fare`, {
    source: from.toUpperCase(),
    destination: to.toUpperCase(),
    journeyDate: date,
    classCode,
    quotaCode: "GN",
  });
  logCall("fare", started, res.ok, res.error);
  if (!res.ok) return null;
  const d = asObj(res.data);
  const per = Number(d.totalFare ?? asObj(d.breakdown).baseFare ?? 0);
  if (!Number.isFinite(per) || per <= 0) return null;
  const pax = Math.max(1, passengerCount || 1);
  return {
    trainNumber,
    date,
    classCode,
    passengerCount: pax,
    baseFare: per * pax,
    serviceFee: 0,
    total: per * pax,
    currency: "INR",
    railwayAvailable: true,
    source: "railradar",
  };
}

/* ── Live status ─────────────────────────────────────────────────────── */
export async function railradarLive(number: string, dateYmd?: string): Promise<RailcoreLiveStatus | null> {
  if (!railradarConfigured()) return null;
  const started = Date.now();
  const res = await railradarRequest(`/trains/${encodeURIComponent(number)}/live`, { date: dateYmd, haltsOnly: "true" });
  logCall("liveStatus", started, res.ok, res.error);
  if (!res.ok) return null;
  const d = asObj(res.data);
  const cur = asObj(d.currentLocation);
  const next = asObj(d.nextHalt);
  const route = Array.isArray(d.route) ? d.route.map(asObj) : [];
  const curCode = String(cur.stationCode ?? "").trim();
  const curName = route.find((s) => String(s.stationCode ?? "") === curCode)?.stationName;
  const delay = Number(d.delayMinutes);
  const statusRaw = String(d.status ?? "").trim();
  const status = statusRaw
    ? `${statusRaw}${Number.isFinite(delay) ? (delay > 0 ? `, ${delay} min late` : ", on time") : ""}`
    : Number.isFinite(delay)
      ? delay > 0
        ? `${delay} min late`
        : "on time"
      : "unknown";
  return {
    trainNumber: String(d.trainNumber ?? number),
    trainName: String(d.trainName ?? asObj(d.train).name ?? ""),
    status,
    delayMinutes: Number.isFinite(delay) ? delay : null,
    lastUpdatedAt: d.lastUpdatedAt != null ? String(d.lastUpdatedAt) : null,
    currentStation: curName ? `${String(curName)} (${curCode})` : curCode || null,
    nextStation: next.stationName ? `${String(next.stationName)} (${String(next.stationCode ?? "")})` : null,
    journeyDate: d.startDate != null ? String(d.startDate) : (dateYmd ?? null),
  };
}

/* ── Schedule / timetable ─────────────────────────────────────────────── */
export async function railradarSchedule(number: string): Promise<RailcoreSchedule | null> {
  if (!railradarConfigured()) return null;
  const started = Date.now();
  const res = await railradarRequest(`/trains/${encodeURIComponent(number)}`, { haltsOnly: "true" });
  logCall("timetable", started, res.ok, res.error);
  if (!res.ok) return null;
  const d = asObj(res.data);
  const t = asObj(d.train);
  const route = Array.isArray(d.route) ? d.route : [];
  const stops = route
    .map((row) => {
      const s = asObj(row);
      const st = asObj(s.station);
      const code = String(st.code ?? s.stationCode ?? "").trim();
      if (!code) return null;
      const day = Number(s.arrivalDay ?? s.departureDay);
      return {
        code,
        name: String(st.name ?? s.stationName ?? code),
        arrival: s.arrival != null ? hhmm(s.arrival) || null : null,
        departure: s.departure != null ? hhmm(s.departure) || null : null,
        day: Number.isFinite(day) ? day : undefined,
      };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const dur = Number(t.duration);
  return {
    trainNumber: String(t.number ?? number),
    trainName: String(t.name ?? ""),
    runningDays: Array.isArray(t.runDays) ? t.runDays.map((x) => String(x).toUpperCase()) : [],
    classes: [],
    durationMinutes: Number.isFinite(dur) && dur > 0 ? dur : null,
    stops,
  };
}

/* ── Coach position ───────────────────────────────────────────────────── */
export async function railradarCoachPosition(number: string, stationCode?: string): Promise<RailcoreCoachPosition | null> {
  if (!railradarConfigured()) return null;
  const started = Date.now();
  const path = stationCode
    ? `/trains/${encodeURIComponent(number)}/coaches/${encodeURIComponent(stationCode.toUpperCase())}`
    : `/trains/${encodeURIComponent(number)}/coaches`;
  let res = await railradarRequest(path);
  if (!res.ok && stationCode) res = await railradarRequest(`/trains/${encodeURIComponent(number)}/coaches`);
  logCall("coachPosition", started, res.ok, res.error);
  if (!res.ok) return null;
  const d = asObj(res.data);
  const rows = Array.isArray(d.coaches) ? d.coaches : [];
  const coaches = rows
    .map((row) => {
      const c = asObj(row);
      const name = String(c.code ?? c.name ?? "").trim().toUpperCase();
      if (!name) return null;
      const pos = Number(c.position);
      return {
        name,
        classCode: String(c.classType ?? c.category ?? "").trim().toUpperCase() || "—",
        positionFromEngine: Number.isFinite(pos) ? pos : null,
        sequence: Number.isFinite(pos) ? pos : null,
      };
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .sort((a, b) => (a.positionFromEngine ?? 1e9) - (b.positionFromEngine ?? 1e9));
  if (!coaches.length) return null;
  return { trainNumber: String(d.trainNumber ?? number), stationCode: d.stationCode != null ? String(d.stationCode) : (stationCode ?? null), coaches };
}

/* ── Station autocomplete ─────────────────────────────────────────────── */
export async function railradarStationSearch(q: string): Promise<Station[] | null> {
  if (!railradarConfigured()) return null;
  const started = Date.now();
  const res = await railradarRequest(`/lookup/search/stations`, { q: q.trim(), limit: 10 });
  logCall("stationSearch", started, res.ok, res.error);
  if (!res.ok) return null;
  const rows = Array.isArray(res.data) ? res.data : Array.isArray(asObj(res.data).stations) ? (asObj(res.data).stations as unknown[]) : [];
  const out: Station[] = [];
  for (const row of rows) {
    const o = asObj(row);
    const code = String(o.code ?? "").trim().toUpperCase();
    if (!code) continue;
    const name = String(o.name ?? code).trim();
    out.push({ code, name, city: String(o.city ?? name).trim() || name });
  }
  return out;
}

/* ── Train name/number autocomplete ───────────────────────────────────── */
export async function railradarTrainNameSearch(q: string): Promise<RailcoreTrainNameResult[] | null> {
  if (!railradarConfigured()) return null;
  const started = Date.now();
  const res = await railradarRequest(`/lookup/search/trains`, { q: q.trim(), limit: 10 });
  logCall("trainNameSearch", started, res.ok, res.error);
  if (!res.ok) return null;
  const rows = Array.isArray(res.data) ? res.data : Array.isArray(asObj(res.data).trains) ? (asObj(res.data).trains as unknown[]) : [];
  const out: RailcoreTrainNameResult[] = [];
  for (const row of rows) {
    const o = asObj(row);
    const number = String(o.number ?? "").trim();
    if (!/^\d{4,6}$/.test(number)) continue;
    out.push({
      number,
      name: String(o.name ?? `Train ${number}`),
      from: String(asObj(o.source).code ?? o.source ?? "").toUpperCase(),
      to: String(asObj(o.destination).code ?? o.destination ?? "").toUpperCase(),
      type: String(o.type ?? ""),
    });
  }
  return out;
}
