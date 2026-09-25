/* Round-20 (25 Sep 2026) — "jis bhi class pe tap ho wo seedha passenger form pe le jaaye, upar train
 * number / date / from / to apne aap aaye".
 *
 * Yahan sirf MAPPING hai: jo REAL data UI me pehle se dikh raha hai (journey plan ka route option ya
 * Seat Finder ka seat row) usse booking state ke TrainResult + ClassAvailability banate hain. Koi naya
 * API call nahi, koi number invent nahi — jo chip par likha hai wahi booking me jaata hai. AI/tools/
 * planner ko chhua nahi gaya: ye pure helpers hain.
 */
import { CLASS_LABELS, type AvailabilityStatus, type ClassAvailability, type ClassCode, type Station, type TrainResult } from "../types";
import type { AgentRouteOption } from "../ai/agent";
import type { SeatRow } from "../seatfinder";

/** Station object — code ke saath naam mile to wahi, warna code hi naam (jhooth nahi). */
export function stationOf(code: string, name?: string | null, city?: string | null): Station {
  const c = String(code ?? "").trim().toUpperCase();
  const n = String(name ?? "").trim();
  return { code: c, name: n || c, city: String(city ?? "").trim() || n || c };
}

const CODE_RE = /^(1A|2A|3A|3E|SL|CC|2S|EC|EA|FC|2A\+|GN)$/;
const asClassCode = (code: string): ClassCode => (CODE_RE.test(String(code).toUpperCase()) ? (String(code).toUpperCase() as ClassCode) : (String(code).toUpperCase() as ClassCode));
const asStatus = (status: string): AvailabilityStatus => {
  const s = String(status ?? "").toUpperCase();
  if (s === "AVAILABLE" || s === "RAC" || s === "WAITLIST" || s === "NOT_AVAILABLE" || s === "REGRET" || s === "CANCELLED" || s === "UNKNOWN") return s as AvailabilityStatus;
  return "UNKNOWN";
};

/** Plan card ke per-train board row (classOptions) → booking ka ClassAvailability. */
export function classFromBoardRow(r: {
  classCode?: string | null;
  code?: string | null;
  status?: string | null;
  seats?: number | null;
  rac?: number | null;
  waitlist?: number | null;
  fare?: number | null;
  source?: string | null;
  asOf?: string | null;
}): ClassAvailability {
  const code = asClassCode(String(r.classCode ?? r.code ?? "").toUpperCase());
  const status = asStatus(String(r.status ?? "UNKNOWN"));
  const out: ClassAvailability = {
    code,
    label: CLASS_LABELS[code] ?? code,
    status,
    fare: typeof r.fare === "number" ? r.fare : 0,
  };
  if (typeof r.seats === "number") out.seats = r.seats;
  if (typeof r.rac === "number") out.rac = r.rac;
  if (typeof r.waitlist === "number") out.waitlist = r.waitlist;
  if (r.source) out.source = r.source;
  if (r.asOf) out.updatedAt = r.asOf;
  return out;
}

/** Journey plan ka route option → booking ka TrainResult (jo upar card me dikhta hai wahi). */
export function trainFromRouteOption(
  o: Pick<AgentRouteOption, "trainNumbers" | "trainNames" | "departure" | "arrival" | "arrivalDayOffset" | "durationMinutes" | "durationLabel" | "classOptions" | "availability" | "origin" | "destination" | "legs">,
  opts: { from: Station; to: Station; date: string },
): TrainResult {
  const leg0 = (o.legs ?? [])[0];
  const classes = (o.classOptions?.length ? o.classOptions : o.availability ? [o.availability] : []).map((c) => classFromBoardRow(c));
  return {
    number: String(o.trainNumbers?.[0] ?? ""),
    name: String(o.trainNames?.[0] ?? ""),
    type: "",
    from: opts.from,
    to: opts.to,
    date: opts.date,
    departure: String(o.departure ?? ""),
    arrival: String(o.arrival ?? ""),
    arrivalDayOffset: Number(o.arrivalDayOffset ?? 0),
    durationMinutes: Number(o.durationMinutes ?? 0),
    durationLabel: String(o.durationLabel ?? ""),
    runsOn: [],
    classes,
    ...(leg0?.fromName || leg0?.toName
      ? {
          from: stationOf(opts.from.code, leg0.fromName ?? opts.from.name),
          to: stationOf(opts.to.code, leg0.toName ?? opts.to.name),
        }
      : {}),
  };
}

/** Seat Finder ka seat row → booking target (train + class) — row me jo asli data hai wahi. */
export function bookingFromSeatRow(
  r: Pick<SeatRow, "number" | "name" | "classCode" | "status" | "seats" | "rac" | "waitlist" | "fare" | "departure" | "arrival" | "durationLabel">,
  opts: { from: Station; to: Station; date: string; arrivalDayOffset?: number | null },
): { train: TrainResult; klass: ClassAvailability } {
  const klass = classFromBoardRow({
    classCode: r.classCode === "—" ? "" : r.classCode,
    status: r.status,
    seats: r.seats,
    rac: r.rac,
    waitlist: r.waitlist,
    fare: r.fare,
  });
  const train: TrainResult = {
    number: String(r.number ?? ""),
    name: String(r.name ?? ""),
    type: "",
    from: opts.from,
    to: opts.to,
    date: opts.date,
    departure: String(r.departure ?? ""),
    arrival: String(r.arrival ?? ""),
    arrivalDayOffset: Number(opts.arrivalDayOffset ?? 0),
    durationMinutes: 0,
    durationLabel: String(r.durationLabel ?? ""),
    runsOn: [],
    classes: [klass],
  };
  return { train, klass };
}

/** Chip ke liye chhota label (class + status) — jaise "3A AVL 23". */
export function chipLabel(r: { classCode?: string | null; status?: string | null; seats?: number | null; rac?: number | null; waitlist?: number | null }): string {
  const code = String(r.classCode ?? "").toUpperCase();
  const s = asStatus(String(r.status ?? "UNKNOWN"));
  if (s === "AVAILABLE") return `${code} AVL ${r.seats ?? "—"}`;
  if (s === "RAC") return `${code} RAC ${r.rac ?? "—"}`;
  if (s === "WAITLIST") return `${code} WL ${r.waitlist ?? "—"}`;
  if (s === "UNKNOWN" || s === "NOT_AVAILABLE") return `${code} N/A`;
  return `${code} ${s}`;
}

/** Round-20: JourneyOptions ke class chip ka payload → booking target. Jo card me dikha wahi —
 *  koi naya number/naam invent nahi; jo field nahi mila wo khaali rehta hai. */
export function bookingFromChipPayload(q: {
  trainNumber: string;
  classCode: string;
  from: string;
  to: string;
  date?: string | null;
  requestDate: string;
  row?: { status?: string | null; seats?: number | null; rac?: number | null; waitlist?: number | null; fare?: number | null; source?: string | null; asOf?: string | null } | null;
  trainName?: string | null;
  departure?: string | null;
  arrival?: string | null;
  arrivalDayOffset?: number | null;
  durationLabel?: string | null;
  fromName?: string | null;
  toName?: string | null;
}): { train: TrainResult; klass: ClassAvailability } {
  const klass = classFromBoardRow({
    classCode: q.classCode,
    status: q.row?.status ?? "UNKNOWN",
    seats: q.row?.seats ?? null,
    rac: q.row?.rac ?? null,
    waitlist: q.row?.waitlist ?? null,
    fare: q.row?.fare ?? null,
    source: q.row?.source ?? null,
    asOf: q.row?.asOf ?? null,
  });
  const train: TrainResult = {
    number: String(q.trainNumber ?? ""),
    name: String(q.trainName ?? ""),
    type: "",
    from: stationOf(q.from, q.fromName ?? null),
    to: stationOf(q.to, q.toName ?? null),
    date: String(q.date ?? q.requestDate),
    departure: String(q.departure ?? ""),
    arrival: String(q.arrival ?? ""),
    arrivalDayOffset: Number(q.arrivalDayOffset ?? 0),
    durationMinutes: 0,
    durationLabel: String(q.durationLabel ?? ""),
    runsOn: [],
    classes: [klass],
  };
  return { train, klass };
}
