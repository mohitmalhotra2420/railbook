/**
 * ConfirmTkt route board — ek hi call me POORI route ke saare trains × classes ka
 * seat board (status + seats/WL/RAC + fare + confirm-chance).
 *
 * Kyun (user feedback 23 Sep 2026, LDH→BEAS list): chat/seat-board ki rows
 * "Seat data provider se nahi aayi" par atak jaati thin jabki TrainBoard cards
 * fresh data dikhate the — kyunki per-train probe kismat par nirbhar tha.
 * ConfirmTkt ka public (unauthenticated) trains-search API ek request me route ke
 * 20+ trains ka class-wise board deta hai — `TRAIN CANCELLED` jaisa sach bhi
 * (18309 SBP JAT 24 Sep ko cancelled nikla, isliye uski "seat" data kisi source
 * se nahi aati thi).
 *
 * Endpoint (ConfirmTkt ke rbooking SPA se reverse-engineered, koi API key nahi):
 *   GET https://cttrainsapi.confirmtkt.com/api/v1/trains/search
 *       ?sourceStationCode=LDH&destinationStationCode=BEAS&dateOfJourney=24-09-2026
 *   headers: clientid: ct-web · apikey: ct-web!2$ · deviceid: <uuid>
 *
 * Honesty rules (project ki jaan):
 *  - Sirf jo API kehti hai wahi: status string se hi AVL/WL/RAC/Regret/Cancelled.
 *  - `cacheTime` 24h se purana → row `stale: true` (UI "X din pehle ka data").
 *  - availability null/NA → UNKNOWN (koi guess nahi).
 */
import type { AvailabilityStatus, ClassAvailability, ClassCode } from "../providers/types.js";

const HOST = "https://cttrainsapi.confirmtkt.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const API_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "application/json",
  clientid: "ct-web",
  apikey: "ct-web!2$",
  deviceid: "railbook-0000-0000-0000-000000000000",
};
const TIMEOUT_MS = 12_000;
/** Ek hi route+date ka board 90s tak reuse — app/list ka sweep bar-bar same call na kare. */
const TTL_MS = 90_000;
/** Board row ka data isse purana → stale flag (silent purana data kabhi nahi). */
export const CONFIRMTKT_STALE_MS = 24 * 60 * 60_000;

export type ConfirmTktBoardRow = {
  trainNumber: string;
  trainName: string;
  fromCode: string | null;
  toCode: string | null;
  departure: string | null;
  arrival: string | null;
  trainType: string | null;
  classes: ClassAvailability[];
};

export type ConfirmTktBoard = {
  at: number;
  from: string;
  to: string;
  date: string;
  trains: ConfirmTktBoardRow[];
};

/* Test hook (network ke bina parse/logic verify karne ke liye). */
let fetchImpl: typeof fetch | null = null;
export function _setConfirmTktFetchForTests(fn: typeof fetch | null): void {
  fetchImpl = fn;
}
export function _clearConfirmTktCache(): void {
  cache.clear();
  inflight.clear();
}

const cache = new Map<string, ConfirmTktBoard>();
const inflight = new Map<string, Promise<ConfirmTktBoard | null>>();

function ymdToDmy(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ymd;
}

/**
 * ConfirmTkt ka availability string → RailBook status.
 * Observed strings (23 Sep 2026 live): "AVAILABLE-0009", "CURR_AVBL-0226",
 * "RLWL5/WL5", "REGRET", "NOT AVAILABLE", "TRAIN CANCELLED", null/NA.
 */
export function parseConfirmTktAvailability(
  raw: string | null | undefined,
  display?: string | null,
): { status: AvailabilityStatus; seats: number | null; rac: number | null; waitlist: number | null; note?: string; statusText: string } {
  const s = String(raw ?? "").trim();
  const disp = String(display ?? "").trim();
  const up = s.toUpperCase();
  const upDisp = disp.toUpperCase();

  const seatMatch = up.match(/^(?:AVAILABLE|CURR_AVBL|AVBL)[-_\s]*0*(\d+)$/);
  if (seatMatch) {
    return { status: "AVAILABLE", seats: Number(seatMatch[1]), rac: null, waitlist: null, statusText: disp || `AVL ${Number(seatMatch[1])}` };
  }
  if (/CANCEL/.test(up) || /CANCEL/.test(upDisp)) {
    return { status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, note: "Train Cancelled", statusText: "Cancelled" };
  }
  if (/DEPART/.test(up) || /DEPART/.test(upDisp)) {
    return { status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, note: "Train Departed", statusText: "Departed" };
  }
  if (/REGRET/.test(up) || /REGRET/.test(upDisp)) {
    return { status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, note: "Regret", statusText: "Regret" };
  }
  if (/NOT\s*AVAIL|NOT\s*AVBL|NO\s*ROOM/.test(up) || /NOT AVAILABLE/.test(upDisp)) {
    return { status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, statusText: "Not available" };
  }
  const racM = up.match(/RAC[-_\s]*(\d+)/);
  if (racM) {
    return { status: "RAC", seats: null, rac: Number(racM[1]), waitlist: null, statusText: disp || `RAC ${Number(racM[1])}` };
  }
  if (/RAC/.test(up)) {
    return { status: "RAC", seats: null, rac: null, waitlist: null, statusText: disp || "RAC" };
  }
  if (/WL/.test(up)) {
    /* "RLWL5/WL5" / "GNWL21/WL5" / "WL 12" — current WL = last "/" ke baad wala number. */
    const tail = up.split("/").pop() ?? up;
    const wlM = tail.match(/(\d+)/) ?? up.match(/WL[-_\s]*(\d+)/);
    return { status: "WAITLIST", seats: null, rac: null, waitlist: wlM ? Number(wlM[1]) : null, statusText: disp || (wlM ? `WL ${Number(wlM[1])}` : "WL") };
  }
  if (!s && !disp) {
    return { status: "UNKNOWN", seats: null, rac: null, waitlist: null, statusText: "" };
  }
  return { status: "UNKNOWN", seats: null, rac: null, waitlist: null, statusText: disp || s };
}

const KNOWN_BOARD: ClassCode[] = ["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S", "EA"];

type RawClassCache = {
  availability?: string | null;
  availabilityDisplayName?: string | null;
  fare?: string | number | null;
  cacheTime?: string | null;
  predictionPercentage?: number | null;
  confirmTktStatus?: string | null;
  quota?: string | null;
};

function classRow(classCode: ClassCode, info: RawClassCache, dateYmd: string): ClassAvailability {
  const parsed = parseConfirmTktAvailability(info.availability, info.availabilityDisplayName);
  const fareNum = info.fare != null && info.fare !== "" ? Number(info.fare) : null;
  const asOfMs = info.cacheTime ? Date.parse(info.cacheTime) : NaN;
  const asOf = Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null;
  const stale = Number.isFinite(asOfMs) ? Date.now() - asOfMs > CONFIRMTKT_STALE_MS : false;
  const chance = typeof info.predictionPercentage === "number" && info.predictionPercentage > 0 ? info.predictionPercentage : null;
  const bits = ["web: confirmtkt.com (IRCTC board)"];
  if (parsed.note) bits.push(parsed.note);
  if (chance != null && parsed.status === "WAITLIST") bits.push(`${chance}% confirm chance`);
  const row: ClassAvailability = {
    code: classCode,
    label: CLASS_LABELS_LOCAL[classCode] ?? classCode,
    status: parsed.status,
    fare: Number.isFinite(fareNum as number) ? (fareNum as number) : 0,
    quota: String(info.quota ?? "GN") || "GN",
    date: dateYmd,
    source: "web_confirmtkt",
    webNote: bits.join(" — "),
  };
  if (parsed.seats != null) row.seats = parsed.seats;
  if (parsed.rac != null) row.rac = parsed.rac;
  if (parsed.waitlist != null) row.waitlist = parsed.waitlist;
  if (parsed.note) row.note = parsed.note;
  if (stale && asOf) {
    row.stale = true;
    row.updatedAt = asOf;
  } else if (asOf) {
    row.updatedAt = asOf;
  }
  return row;
}

const CLASS_LABELS_LOCAL: Record<string, string> = {
  "1A": "AC First Class",
  "2A": "AC 2 Tier",
  "3A": "AC 3 Tier",
  "3E": "AC 3 Economy",
  SL: "Sleeper",
  CC: "AC Chair Car",
  EC: "Executive Chair Car",
  "2S": "Second Sitting",
  EA: "Anubhuti",
};

export function parseConfirmTktBoard(json: unknown, from: string, to: string, dateYmd: string): ConfirmTktBoardRow[] {
  const j = (json ?? {}) as { data?: { trainList?: unknown[] } };
  const list = Array.isArray(j.data?.trainList) ? (j.data!.trainList as Record<string, unknown>[]) : [];
  const out: ConfirmTktBoardRow[] = [];
  for (const t of list) {
    const number = String(t.trainNumber ?? "").trim();
    if (!/^\d{4,5}$/.test(number)) continue;
    const cacheObj = (t.availabilityCache ?? {}) as Record<string, RawClassCache>;
    const classes: ClassAvailability[] = [];
    for (const code of KNOWN_BOARD) {
      const info = cacheObj[code];
      if (!info) continue;
      const row = classRow(code, info, dateYmd);
      /* UNKNOWN + fare 0 → is class ka koi sach nahi; row rakhna bekaar (UI muted chip). */
      if (row.status === "UNKNOWN" && !row.fare) continue;
      classes.push(row);
    }
    out.push({
      trainNumber: number,
      trainName: String(t.trainName ?? "").trim() || number,
      fromCode: t.fromStnCode ? String(t.fromStnCode) : null,
      toCode: t.toStnCode ? String(t.toStnCode) : null,
      departure: t.departureTime ? String(t.departureTime) : null,
      arrival: t.arrivalTime ? String(t.arrivalTime) : null,
      trainType: t.trainType ? String(t.trainType) : null,
      classes,
    });
  }
  return out;
}

/** Poori route ka board (cached 90s, in-flight dedupe). Null = API ne data nahi diya. */
export async function confirmTktRouteBoard(from: string, to: string, dateYmd: string): Promise<ConfirmTktBoard | null> {
  const f = String(from || "").trim().toUpperCase();
  const t = String(to || "").trim().toUpperCase();
  const d = String(dateYmd || "").trim();
  if (!/^[A-Z0-9]{1,6}$/.test(f) || !/^[A-Z0-9]{1,6}$/.test(t) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const key = `${f}|${t}|${d}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const run = (async (): Promise<ConfirmTktBoard | null> => {
    const url =
      `${HOST}/api/v1/trains/search?sourceStationCode=${encodeURIComponent(f)}` +
      `&destinationStationCode=${encodeURIComponent(t)}&dateOfJourney=${encodeURIComponent(ymdToDmy(d))}`;
    try {
      const res = await (fetchImpl ?? globalThis.fetch.bind(globalThis))(url, {
        headers: API_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      const trains = parseConfirmTktBoard(json, f, t, d);
      if (!trains.length) return null;
      const board: ConfirmTktBoard = { at: Date.now(), from: f, to: t, date: d, trains };
      cache.set(key, board);
      return board;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** Ek train ke classes us route ke board se. */
export async function confirmTktTrainClasses(
  trainNumber: string,
  from: string,
  to: string,
  dateYmd: string,
): Promise<ClassAvailability[] | null> {
  const board = await confirmTktRouteBoard(from, to, dateYmd);
  if (!board) return null;
  const num = String(trainNumber).trim();
  const row = board.trains.find((r) => r.trainNumber === num);
  if (!row || !row.classes.length) return null;
  return row.classes;
}
