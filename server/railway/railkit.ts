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

export type LiveTrainStatus = {
  trainNumber: string;
  trainName: string;
  status: string;
  delayMinutes: number | null;
  lastUpdatedAt: string | null;
  currentStation: string | null;
  nextStation: string | null;
};

export type TrainSchedule = {
  trainNumber: string;
  trainName: string;
  stops: { code: string; name: string; arrival: string; departure: string; day?: string }[];
};

export type PnrLookup = {
  pnr: string;
  data: unknown;
};

type SdkResult = { success?: boolean; message?: string; data?: unknown };

export type RailkitSdk = {
  configure: (key: string) => void;
  searchTrainBetweenStations: (from: string, to: string, date?: string) => Promise<SdkResult>;
  getTrainInfo: (trainNumber: string) => Promise<SdkResult>;
  trackTrain: (trainNumber: string, date?: string) => Promise<SdkResult>;
  getAvailability: (
    trainNo: string,
    from: string,
    to: string,
    date: string,
    coach: string,
    quota: string,
  ) => Promise<SdkResult>;
  fareLookup: (
    trainNo: string,
    from: string,
    to: string,
    date: string,
    travelClass: string,
    quota: string,
  ) => Promise<SdkResult>;
  checkPNRStatus: (pnr: string) => Promise<SdkResult>;
  cancelList?: () => Promise<SdkResult>;
  liveAtStation?: (stationCode: string, hours?: number) => Promise<SdkResult>;
  getTrainHistory?: (trainNumber: string, journeyDate: string) => Promise<SdkResult>;
};

const bookings = new Map<string, BookingRecord>();
const classCache = new Map<string, ClassCode[]>();
let configured = false;
let sdkOverride: RailkitSdk | null = null;

const KNOWN_CLASS: ClassCode[] = ["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"];

export function setRailkitSdk(next: RailkitSdk | null): void {
  sdkOverride = next;
  configured = false;
  classCache.clear();
}

export function resetRailkitBookings(): void {
  bookings.clear();
  classCache.clear();
}

function logCall(method: string, started: number, ok: boolean): void {
  const railwayLatencyMs = Date.now() - started;
  console.info(
    JSON.stringify({
      railwayProvider: "railkit",
      railwayMethod: method,
      railwayLatencyMs,
      railwaySuccess: ok,
    }),
  );
}

async function loadSdk(): Promise<RailkitSdk> {
  if (sdkOverride) return sdkOverride;
  const mod = (await import("railkit")) as RailkitSdk;
  return mod;
}

export async function ensureRailkitConfigured(): Promise<boolean> {
  const key = env.railkitApiKey;
  if (!key) return false;
  if (configured && !sdkOverride) return true;
  const sdk = await loadSdk();
  sdk.configure(key);
  configured = true;
  return true;
}

export function ymdToDmy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}-${m}-${y}`;
}

export function todayDmy(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(now);
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  return `${d}-${m}-${y}`;
}

function sameCalendarDay(a: string, b: string): boolean {
  const pa = String(a).match(/(\d{1,2})[^\d](\d{1,2})[^\d](\d{4})/);
  const pb = String(b).match(/(\d{1,2})[^\d](\d{1,2})[^\d](\d{4})/);
  if (!pa || !pb) return String(a) === String(b);
  return Number(pa[1]) === Number(pb[1]) && Number(pa[2]) === Number(pb[2]) && pa[3] === pb[3];
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function hhmm(raw: unknown): string {
  const s = String(raw ?? "");
  const m = s.match(/(\d{1,2}:\d{2})/);
  if (!m) return "--:--";
  const [h, min] = m[1].split(":");
  return `${h.padStart(2, "0")}:${min}`;
}

function minutesBetween(dep: string, arr: string, dayOffset: number): number {
  const [dh, dm] = dep.split(":").map(Number);
  const [ah, am] = arr.split(":").map(Number);
  if (![dh, dm, ah, am].every((n) => Number.isFinite(n))) return 0;
  return Math.max(0, dayOffset * 1440 + ah * 60 + am - (dh * 60 + dm));
}

const DAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function runDays(raw: unknown): number[] {
  if (typeof raw === "string") {
    const flags = raw.replace(/\s+/g, "");
    if (/^[01YNyN]{7}$/i.test(flags)) {
      const out: number[] = [];
      // IRCTC often Mon..Sun
      const order = [1, 2, 3, 4, 5, 6, 0];
      [...flags].forEach((ch, i) => {
        if (ch === "1" || ch.toUpperCase() === "Y") out.push(order[i]);
      });
      return out.length ? out : [0, 1, 2, 3, 4, 5, 6];
    }
    const bits = raw.split(/[^A-Za-z]+/).filter(Boolean);
    return runDays(bits);
  }
  if (!Array.isArray(raw) || !raw.length) return [0, 1, 2, 3, 4, 5, 6];
  const days = raw
    .map((d) => DAY_MAP[String(d).toLowerCase().slice(0, 3)] ?? DAY_MAP[String(d).toLowerCase()])
    .filter((n): n is number => n != null);
  return days.length ? days : [0, 1, 2, 3, 4, 5, 6];
}

function mapSearchTrain(row: unknown, fromCode: string, toCode: string, date: string): TrainResult | null {
  if (!row || typeof row !== "object") return null;
  const o = asObj(row);
  const train = asObj(o.train ?? o);
  const number = String(
    train.train_no ??
      train.train_number ??
      train.trainNumber ??
      train.number ??
      o.train_no ??
      o.train_number ??
      o.trainNumber ??
      "",
  ).trim();
  const name = String(train.train_name ?? train.trainName ?? train.name ?? o.train_name ?? o.trainName ?? "").trim();
  if (!number) return null;
  const fromInfo = asObj(o.from ?? o.from_station ?? {});
  const toInfo = asObj(o.to ?? o.to_station ?? {});
  const dep = hhmm(
    o.from_time ?? o.from_std ?? o.departure ?? fromInfo.departure ?? train.from_time ?? train.from_std,
  );
  const arr = hhmm(o.to_time ?? o.to_sta ?? o.arrival ?? toInfo.arrival ?? train.to_time ?? train.to_sta);
  const dayOff = Number(o.dayCount ?? o.arrive_day ?? toInfo.day ?? 0) || (arr < dep ? 1 : 0);
  const computed = minutesBetween(dep, arr, dayOff);
  const durRaw = o.duration ?? o.travel_time ?? train.duration;
  let dur = 0;
  if (typeof durRaw === "string") {
    const hm = durRaw.match(/(\d+)\s*h(?:ours?)?[^\d]*(\d+)?/i);
    const colon = durRaw.match(/(\d{1,2}):(\d{2})/);
    if (colon) dur = Number(colon[1]) * 60 + Number(colon[2]);
    else if (hm) dur = Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  } else if (typeof durRaw === "number" && durRaw > 0) {
    dur = durRaw > 48 ? durRaw : durRaw * 60;
  }
  if (!dur || (computed > 0 && computed < 48 * 60 && Math.abs(dur - computed) > 12 * 60)) {
    dur = computed || dur;
  }
  const classesRaw = o.classes ?? train.classes ?? o.class;
  const classCodes = Array.isArray(classesRaw)
    ? classesRaw
        .map((x) => String(x).toUpperCase())
        .filter((x): x is ClassCode => (KNOWN_CLASS as string[]).includes(x))
    : typeof classesRaw === "string"
      ? classesRaw
          .toUpperCase()
          .split(/[^A-Z0-9]+/)
          .filter((x): x is ClassCode => (KNOWN_CLASS as string[]).includes(x))
      : [];
  return {
    number,
    name: name || `Train ${number}`,
    type: String(train.train_type ?? train.type ?? o.type ?? "Express"),
    from: {
      code: String(o.from_stn_code ?? fromInfo.code ?? fromCode).toUpperCase() || fromCode,
      name: String(o.from_stn_name ?? fromInfo.name ?? fromCode),
      city: String(o.from_stn_name ?? fromInfo.name ?? fromCode),
    },
    to: {
      code: String(o.to_stn_code ?? toInfo.code ?? toCode).toUpperCase() || toCode,
      name: String(o.to_stn_name ?? toInfo.name ?? toCode),
      city: String(o.to_stn_name ?? toInfo.name ?? toCode),
    },
    date,
    departure: dep,
    arrival: arr,
    arrivalDayOffset: dayOff,
    durationMinutes: dur,
    durationLabel: durationLabel(dur || 0),
    runsOn: runDays(o.running_days ?? o.run_days ?? o.runDays ?? train.run_days ?? train.runningDays),
    classes: classCodes.map((code) => ({
      code,
      label: CLASS_LABELS[code],
      status: "UNKNOWN" as const,
      fare: 0,
    })),
  };
}

function parseAvail(raw: unknown): { status: AvailabilityStatus; seats?: number; rac?: number; waitlist?: number } {
  if (raw && typeof raw === "object") {
    const o = asObj(raw);
    const rawStatus = String(o.rawStatus ?? o.availabilityText ?? o.status ?? "").toUpperCase();
    if (rawStatus.includes("NOT AVAILABLE") || rawStatus === "NOT_AVAILABLE") {
      return { status: "NOT_AVAILABLE" };
    }
    if (String(o.status ?? "").toUpperCase() === "AVAILABLE" || /AVAILABLE[- /]?\d+/.test(rawStatus)) {
      const n =
        String(o.availabilityText ?? o.rawStatus ?? "").match(/AVL\s*0*(\d+)/i) ??
        rawStatus.match(/AVAILABLE[- /]?0*(\d+)/);
      return { status: "AVAILABLE", seats: n ? Number(n[1]) : undefined };
    }
    if (rawStatus.includes("RAC") || String(o.status ?? "").toUpperCase() === "RAC") {
      const rac = rawStatus.match(/RAC\s*0*(\d+)/);
      return { status: "RAC", rac: rac ? Number(rac[1]) : undefined };
    }
    if (
      rawStatus.includes("WL") ||
      String(o.status ?? "").toUpperCase() === "WAITLIST" ||
      rawStatus.includes("WAIT")
    ) {
      const wl = rawStatus.match(/(?:WL)\s*0*(\d+)/);
      return { status: "WAITLIST", waitlist: wl ? Number(wl[1]) : undefined };
    }
  }
  const blob = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  const u = blob.toUpperCase();
  if (u.includes("NOT AVAILABLE") || (u.includes("NOT") && u.includes("AVAIL"))) {
    return { status: "NOT_AVAILABLE" };
  }
  const avail = u.match(/AVAILABLE[- /]?0*(\d+)/);
  if (avail) return { status: "AVAILABLE", seats: Number(avail[1]) };
  if (u.includes("AVAILABLE") && !u.includes("NOT")) {
    const n = u.match(/AVL\s*0*(\d+)/) ?? u.match(/(\d{1,4})/);
    return { status: "AVAILABLE", seats: n ? Number(n[1]) : undefined };
  }
  const rac = u.match(/RAC\s*(\d+)/);
  if (u.includes("RAC")) return { status: "RAC", rac: rac ? Number(rac[1]) : undefined };
  const wl = u.match(/(?:WL|WAITLIST|GNWL|TQWL|PQWL)\s*\/?\s*(\d+)?/);
  if (u.includes("WL") || u.includes("WAIT")) return { status: "WAITLIST", waitlist: wl?.[1] ? Number(wl[1]) : undefined };
  return { status: "UNKNOWN" };
}

function pickAvailDay(data: unknown, dateYmd: string): unknown {
  const d = asObj(data);
  const wanted = ymdToDmy(dateYmd);
  const list = Array.isArray(d.availability)
    ? d.availability
    : Array.isArray(d.avlDayList)
      ? d.avlDayList
      : [];
  if (list.length) {
    const hit = list.find((row) => {
      const o = asObj(row);
      return sameCalendarDay(String(o.date ?? o.availablityDate ?? ""), wanted);
    });
    return hit ?? list[0];
  }
  return (
    d.status ??
    d.availablityStatus ??
    d.currentStatus ??
    d.availabilityStatus ??
    data
  );
}

function railwayFareFrom(data: unknown): number {
  const d = asObj(data);
  const fareObj = asObj(d.fare);
  const n = Number(d.totalFare ?? fareObj.totalFare ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function searchRailkitStations(q: string): Promise<Station[]> {
  const { searchStations, getStation } = await import("../data/stations.js");
  const query = q.trim();
  if (!query) return [];
  const local = searchStations(query);
  if (local.length) return local;
  if (/^[A-Za-z0-9]{2,5}$/.test(query)) {
    const known = getStation(query);
    if (known) return [known];
    const code = query.toUpperCase();
    return [{ code, name: code, city: code }];
  }
  const aliases: Record<string, string> = {
    kochi: "ERS",
    cochin: "ERS",
    ernakulam: "ERS",
    bombay: "BCT",
    bangalore: "SBC",
    bengaluru: "SBC",
    calcutta: "HWH",
    madras: "MAS",
  };
  const mapped = aliases[query.toLowerCase()];
  if (mapped) {
    const st = getStation(mapped);
    if (st) return [st];
  }
  return [];
}

function parseDelayMinutes(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/on time/i.test(s)) return 0;
  const m = s.match(/(-?\d+)/);
  return m ? Number(m[1]) : null;
}

export async function liveTrainStatus(number: string, dateYmd?: string): Promise<LiveTrainStatus | null> {
  if (!(await ensureRailkitConfigured())) return null;
  const started = Date.now();
  try {
    const sdk = await loadSdk();
    const date = dateYmd ? ymdToDmy(dateYmd) : todayDmy();
    const res = await sdk.trackTrain(number, date);
    logCall("trackTrain", started, Boolean(res?.success));
    if (!res?.success || !res.data) {
      const info = await trainSchedule(number);
      if (!info) return null;
      return {
        trainNumber: info.trainNumber,
        trainName: info.trainName,
        status: "Live location not available",
        delayMinutes: null,
        lastUpdatedAt: null,
        currentStation: null,
        nextStation: null,
      };
    }
    const d = asObj(res.data);
    const train = asObj(d.train ?? d.trainInfo ?? {});
    const timeline = Array.isArray(d.timeline) ? d.timeline : [];
    const currentPoint = timeline.find((row) => String(asObj(row).status).toLowerCase() === "current");
    const currentIdx = currentPoint ? timeline.indexOf(currentPoint) : -1;
    const nextPoint = currentIdx >= 0 ? timeline.slice(currentIdx + 1).find((row) => String(asObj(row).status).toLowerCase() === "upcoming") : undefined;
    const current = asObj(currentPoint ?? d.currentStation ?? d.current ?? {});
    const next = asObj(nextPoint ?? d.nextStation ?? d.next ?? {});
    const arr = asObj(current.arrival);
    const dep = asObj(current.departure);
    const delay =
      parseDelayMinutes(d.delayMinutes) ??
      parseDelayMinutes(d.delay) ??
      parseDelayMinutes(arr.delay) ??
      parseDelayMinutes(dep.delay);
    const last =
      (typeof d.lastUpdate === "string" && d.lastUpdate.trim() && d.lastUpdate) ||
      (typeof d.lastUpdatedAt === "string" && d.lastUpdatedAt.trim() && d.lastUpdatedAt) ||
      null;
    return {
      trainNumber: String(d.trainNo ?? d.trainNumber ?? train.number ?? train.train_number ?? number),
      trainName: String(d.trainName ?? train.name ?? train.train_name ?? ""),
      status: String(d.statusNote ?? d.status ?? "unknown"),
      delayMinutes: delay,
      lastUpdatedAt: last,
      currentStation:
        String(current.stationName ?? current.name ?? current.stationCode ?? current.code ?? d.currentStationCode ?? d.currentStation ?? "") ||
        null,
      nextStation: String(next.stationName ?? next.name ?? next.stationCode ?? next.code ?? d.nextStation ?? "") || null,
    };
  } catch {
    logCall("trackTrain", started, false);
    return null;
  }
}

export async function trainSchedule(number: string): Promise<TrainSchedule | null> {
  if (!(await ensureRailkitConfigured())) return null;
  const started = Date.now();
  try {
    const sdk = await loadSdk();
    const res = await sdk.getTrainInfo(number);
    logCall("getTrainInfo", started, Boolean(res?.success));
    if (!res?.success || !res.data) return null;
    const d = asObj(res.data);
    const info = asObj(d.trainInfo ?? d.train ?? d);
    const route = Array.isArray(d.route) ? d.route : [];
    return {
      trainNumber: String(info.train_no ?? info.train_number ?? info.trainNumber ?? info.number ?? number),
      trainName: String(info.train_name ?? info.trainName ?? info.name ?? ""),
      stops: route
        .map((row) => {
          const s = asObj(row);
          const code = String(s.stnCode ?? s.code ?? "").trim();
          if (!code) return null;
          return {
            code,
            name: String(s.stnName ?? s.name ?? code),
            arrival: String(s.arrival ?? "--"),
            departure: String(s.departure ?? "--"),
            day: s.day != null ? String(s.day) : undefined,
          };
        })
        .filter((s): s is NonNullable<typeof s> => Boolean(s)),
    };
  } catch {
    logCall("getTrainInfo", started, false);
    return null;
  }
}

export async function pnrStatus(pnr: string): Promise<PnrLookup | null> {
  if (!(await ensureRailkitConfigured())) return null;
  const started = Date.now();
  try {
    const sdk = await loadSdk();
    const res = await sdk.checkPNRStatus(pnr);
    logCall("checkPNRStatus", started, Boolean(res?.success));
    if (!res?.success || !res.data) return null;
    return { pnr, data: res.data };
  } catch {
    logCall("checkPNRStatus", started, false);
    return null;
  }
}

export async function classesForTrain(trainNumber: string): Promise<ClassCode[]> {
  const cached = classCache.get(trainNumber);
  if (cached) return cached;
  if (!(await ensureRailkitConfigured())) return [];
  const started = Date.now();
  try {
    const sdk = await loadSdk();
    const res = await sdk.getTrainInfo(trainNumber);
    logCall("getTrainInfo", started, Boolean(res?.success));
    if (!res?.success || !res.data) return [];
    const d = asObj(res.data);
    const info = asObj(d.trainInfo ?? d.train ?? d);
    const raw = info.classes ?? d.classes ?? info.availableClasses;
    let codes: ClassCode[] = [];
    if (Array.isArray(raw)) {
      codes = raw
        .map((x) => String(typeof x === "object" && x ? (asObj(x).code ?? asObj(x).class ?? x) : x).toUpperCase())
        .filter((x): x is ClassCode => (KNOWN_CLASS as string[]).includes(x));
    } else if (typeof raw === "string") {
      codes = raw
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter((x): x is ClassCode => (KNOWN_CLASS as string[]).includes(x));
    }
    if (codes.length) classCache.set(trainNumber, codes);
    return codes;
  } catch {
    logCall("getTrainInfo", started, false);
    return [];
  }
}

const PROBE_CLASSES: ClassCode[] = ["SL", "3A", "3E", "2A", "1A", "CC", "EC", "2S"];

export async function loadClassBoard(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
  quotaCode = "GN",
): Promise<ClassAvailability[]> {
  const provider = new RailKitProvider();
  const known = await classesForTrain(trainNumber);
  const codes = known.length ? known : PROBE_CLASSES;
  const out: ClassAvailability[] = [];
  for (const code of codes) {
    const row = await provider.getAvailability(trainNumber, date, from, to, code, quotaCode);
    if (known.length || row.status !== "UNKNOWN") out.push(row);
  }
  return out;
}

export type StationBoardTrain = {
  trainNo: string;
  trainName: string;
  platform: string | null;
  source: string | null;
  dest: string | null;
  arrival: string | null;
  departure: string | null;
  delay: number | null;
  cancelled: boolean | null;
};

export type StationBoard = {
  summary: string | null;
  total: number;
  trains: StationBoardTrain[];
};

export type HistoryStop = {
  code: string;
  name: string;
  arrival: string | null;
  departure: string | null;
  delay: number | null;
};

export async function stationBoard(code: string, hours = 2): Promise<StationBoard | null> {
  if (!(await ensureRailkitConfigured())) return null;
  const started = Date.now();
  try {
    const sdk = await loadSdk();
    if (!sdk.liveAtStation) {
      logCall("liveAtStation", started, false);
      return null;
    }
    const windowHours = hours === 4 || hours === 8 ? hours : 2;
    const res = await sdk.liveAtStation(code.toUpperCase(), windowHours);
    logCall("liveAtStation", started, Boolean(res?.success));
    if (!res?.success || !res.data) return null;
    const d = asObj(res.data);
    const rows = Array.isArray(d.trains) ? d.trains : [];
    return {
      summary: typeof d.summary === "string" ? d.summary : null,
      total: typeof d.totalTrains === "number" ? d.totalTrains : rows.length,
      trains: rows
        .map((row) => {
          const t = asObj(row);
          const no = String(t.trainNo ?? t.train_no ?? t.trainNumber ?? "").trim();
          if (!no) return null;
          const arr = asObj(t.arrival);
          const dep = asObj(t.departure);
          return {
            trainNo: no,
            trainName: String(t.trainName ?? t.train_name ?? ""),
            platform: t.platform != null ? String(t.platform) : null,
            source: t.sourceName != null ? String(t.sourceName) : t.source != null ? String(t.source) : null,
            dest: t.destName != null ? String(t.destName) : t.dest != null ? String(t.dest) : null,
            arrival: arr.actual != null ? String(arr.actual) : arr.scheduled != null ? String(arr.scheduled) : null,
            departure: dep.actual != null ? String(dep.actual) : dep.scheduled != null ? String(dep.scheduled) : null,
            delay: parseDelayMinutes(arr.delay ?? dep.delay ?? t.delay),
            cancelled: typeof t.cancelled === "boolean" ? t.cancelled : null,
          };
        })
        .filter((t): t is StationBoardTrain => Boolean(t)),
    };
  } catch {
    logCall("liveAtStation", started, false);
    return null;
  }
}

export async function trainHistory(number: string, dateYmd: string): Promise<{
  trainNumber: string;
  trainName: string;
  date: string;
  stops: HistoryStop[];
} | null> {
  if (!(await ensureRailkitConfigured())) return null;
  const started = Date.now();
  try {
    const sdk = await loadSdk();
    if (!sdk.getTrainHistory) {
      logCall("getTrainHistory", started, false);
      return null;
    }
    const res = await sdk.getTrainHistory(number, ymdToDmy(dateYmd));
    logCall("getTrainHistory", started, Boolean(res?.success));
    if (!res?.success || !res.data) return null;
    const d = asObj(res.data);
    const rows = Array.isArray(d.stations) ? d.stations : [];
    return {
      trainNumber: String(d.trainNo ?? d.trainNumber ?? number),
      trainName: String(d.trainName ?? ""),
      date: String(d.journeyDate ?? dateYmd),
      stops: rows
        .map((row) => {
          const s = asObj(row);
          const code = String(s.stationCode ?? s.stnCode ?? s.code ?? "").trim();
          if (!code) return null;
          const arr = asObj(s.arrival);
          const dep = asObj(s.departure);
          return {
            code,
            name: String(s.stationName ?? s.stnName ?? code),
            arrival: arr.actual != null ? String(arr.actual) : arr.scheduled != null ? String(arr.scheduled) : null,
            departure: dep.actual != null ? String(dep.actual) : dep.scheduled != null ? String(dep.scheduled) : null,
            delay: parseDelayMinutes(arr.delay ?? dep.delay),
          };
        })
        .filter((s): s is HistoryStop => Boolean(s)),
    };
  } catch {
    logCall("getTrainHistory", started, false);
    return null;
  }
}

export async function cancelledTrains(): Promise<{ fully: unknown[]; partial: unknown[] } | null> {
  if (!(await ensureRailkitConfigured())) return null;
  const started = Date.now();
  try {
    const sdk = await loadSdk();
    if (!sdk.cancelList) {
      logCall("cancelList", started, false);
      return null;
    }
    const res = await sdk.cancelList();
    logCall("cancelList", started, Boolean(res?.success));
    if (!res?.success || !res.data) return null;
    const d = asObj(res.data);
    return {
      fully: Array.isArray(d.fullyCancelledTrains) ? d.fullyCancelledTrains : [],
      partial: Array.isArray(d.partiallyCancelledTrains) ? d.partiallyCancelledTrains : [],
    };
  } catch {
    logCall("cancelList", started, false);
    return null;
  }
}

export class RailKitProvider implements RailwayProvider {
  readonly id = "railkit";
  get displayName() {
    return env.railkitApiKey ? "RailKit" : "RailKit (not configured)";
  }
  get mock() {
    return !env.railkitApiKey;
  }

  /**
   * Search with an explicit success flag — "genuinely empty" vs "fail hua"
   * dono alag karna zaroori hai taaki FallbackRailwayProvider dono-provider
   * outage par "0 trains" ka jhooth na bole ("none" label de sake).
   */
  async searchTrainsDetailed(query: SearchQuery): Promise<{ trains: TrainResult[]; ok: boolean }> {
    if (!(await ensureRailkitConfigured())) return { trains: [], ok: false };
    const started = Date.now();
    try {
      const sdk = await loadSdk();
      const from = query.from.toUpperCase();
      const to = query.to.toUpperCase();
      const res = await sdk.searchTrainBetweenStations(from, to, ymdToDmy(query.date));
      logCall("searchTrainBetweenStations", started, Boolean(res?.success));
      if (!res?.success) return { trains: [], ok: false };
      const data = res.data;
      const rows = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray(asObj(data).trains)
          ? (asObj(data).trains as unknown[])
          : [];
      const mapped = rows
        .map((row) => mapSearchTrain(row, from, to, query.date))
        .filter((t): t is TrainResult => Boolean(t));
      mapped.sort((a, b) => a.departure.localeCompare(b.departure));
      return { trains: mapped, ok: true };
    } catch {
      logCall("searchTrainBetweenStations", started, false);
      return { trains: [], ok: false };
    }
  }

  async searchTrains(query: SearchQuery): Promise<TrainResult[]> {
    return (await this.searchTrainsDetailed(query)).trains;
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
    if (!(await ensureRailkitConfigured())) return unknown;
    const started = Date.now();
    try {
      const sdk = await loadSdk();
      const res = await sdk.getAvailability(trainNumber, from, to, ymdToDmy(date), classCode, quotaCode || "GN");
      logCall("getAvailability", started, Boolean(res?.success));
      if (!res?.success || !res.data) return unknown;
      const day = pickAvailDay(res.data, date);
      const parsed = parseAvail(day);
      const d = asObj(res.data);
      const train = asObj(d.train);
      return {
        code: classCode,
        label: CLASS_LABELS[classCode],
        status: parsed.status,
        seats: parsed.seats,
        rac: parsed.rac,
        waitlist: parsed.waitlist,
        fare: railwayFareFrom(res.data),
        quota: String(train.quota ?? quotaCode ?? "GN") || undefined,
        date: String(asObj(day).date ?? date),
      };
    } catch {
      logCall("getAvailability", started, false);
      return unknown;
    }
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
    if (!(await ensureRailkitConfigured())) return empty;
    const started = Date.now();
    try {
      const sdk = await loadSdk();
      const res = await sdk.fareLookup(trainNumber, from, to, ymdToDmy(date), classCode, "GN");
      logCall("fareLookup", started, Boolean(res?.success));
      const perPax = res?.success ? railwayFareFrom(res.data) : 0;
      if (!perPax) {
        /* SDK error (jaise "Usage limit exceeded for current billing cycle") —
         * user ko honest reason do, sirf "unavailable" nahi. */
        const sdkErr = String((res as { error?: unknown } | null)?.error ?? "").trim();
        const quota = /usage limit exceeded/i.test(sdkErr);
        return {
          ...empty,
          unavailableReason: quota
            ? "RailKit ka is-billing-cycle ka usage limit khatam ho gaya hai (next reset ~20 Sep) — fare abhi nahi milegi"
            : sdkErr
              ? `RailKit fareLookup fail: ${sdkErr.slice(0, 120)}`
              : "RailKit se fare data nahi mila",
        };
      }
      const base = perPax * count;
      return {
        ...empty,
        baseFare: base,
        total: base + empty.serviceFee,
        railwayAvailable: true,
      };
    } catch {
      logCall("fareLookup", started, false);
      return empty;
    }
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
