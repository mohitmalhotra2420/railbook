/**
 * Round-17 — RailBook Atlas journey engine (deterministic, provider-grounded).
 *
 *  rankRouteOptions()      — Feature 1: ranked route options (fastest / direct /
 *                            fewest changes / availability / cheapest / earliest /
 *                            best_overall). Pure function over real search rows.
 *  evaluateConnection()    — Feature 6: layover = depB − arrA, configurable buffer.
 *  findConnections()       — Feature 6: hub-based 1-change itineraries (real legs).
 *  findVacantSeats()       — Feature 3: class-level availability per provider;
 *                            berth-level capability flag honest (no provider deta).
 *  findPartialRouteSeats() — Feature 4/5: split at real intermediate halts of the
 *                            SAME train; each segment provider-verified; same-train
 *                            switch = seat AVAILABLE from a later halt.
 *  planJourney()           — Feature 2: orchestrates the above + recovery when the
 *                            direct journey has poor/no availability. User's date is
 *                            NEVER changed — alternative dates are suggestions only.
 *
 * Kabhi koi train/seat/berth/delay invent nahi hota. Reliability = null (koi
 * provider real reliability data nahi deta).
 */
import { env } from "../env.js";
import type { ClassAvailability, TrainResult } from "../providers/types.js";
import { routedClassBoard, routedSchedule, searchTrainsRouted, type ServedProvider } from "../railway/router.js";
import { todayYmd } from "../util.js";
import { MULTI_STATION_CITIES } from "../railway/station-resolve.js";
import { CONFLICT_MESSAGE, availabilityEquals, freshnessOf, resolveConflict, sourceTypeOf } from "../providers/provenance.js";
import type { BoardFromEarlierOption } from "./types.js";
import {
  CLASS_CODES,
  durationLabelOf,
  minutesOf,
  type Connection,
  type JourneyPlan,
  type PartialRoutePlan,
  type PartialSegment,
  type AlternativeTrainsResult,
  type AlternateStationOption,
  type RankCategory,
  type RouteAvailability,
  type RouteLeg,
  type RouteOption,
  type VacantSeatsResult,
} from "./types.js";

/* ── Config (no invented rules — env-tunable) ─────────────────────── */
export const JOURNEY_CONFIG = {
  /** Minimum transfer buffer (minutes) for a connection to be "valid". */
  minTransferMinutes: Number(process.env.MIN_TRANSFER_MINUTES ?? 30) || 30,
  /** Maximum layover we present (minutes) — longer waits are still "valid" but filtered. */
  maxLayoverMinutes: Number(process.env.MAX_LAYOVER_MINUTES ?? 360) || 360,
  /** Bounded fan-out: how many trains get an availability probe. */
  availabilityProbeLimit: Number(process.env.JOURNEY_AVAIL_PROBE ?? 4) || 4,
  /** Hubs tried for connections (comma env override). */
  connectionHubs: String(process.env.CONNECTION_HUBS ?? "NDLS,UMB,LJN,CNB,JUC,ASR,BPL,ET,NGP,HWH,MAS,SBC,ADI,BCT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  /** Partial-route: max intermediate halts probed (each = 1 availability call). */
  partialSplitLimit: Number(process.env.PARTIAL_SPLIT_LIMIT ?? 3) || 3,
  /** Round-18m-6: how many stops BEFORE origin to try for "book from earlier station". */
  boardEarlierStops: Number(process.env.BOARD_EARLIER_STOPS ?? 5) || 5,
  boardEarlierTrains: Number(process.env.BOARD_EARLIER_TRAINS ?? 10) || 10,
};

const AVAIL_RANK: Record<string, number> = { AVAILABLE: 0, RAC: 1, WAITLIST: 2, UNKNOWN: 3, NOT_AVAILABLE: 4 };

function availScore(a: RouteAvailability | null): number {
  /* Round-18m-6: unknown (null) ranks like UNKNOWN (3) — pehle 9 → floor(9/1e4)=0
   * → "seat data nahi" wali train AVAILABLE ke barabar rank ho jaati thi (13152 bug). */
  if (!a) return AVAIL_RANK.UNKNOWN * 10000 + 9;
  const base = AVAIL_RANK[a.status] ?? 5;
  return base * 10000 - (a.status === "AVAILABLE" ? Math.min(a.seats ?? 0, 9999) : 0);
}

function toLeg(t: TrainResult): RouteLeg {
  return {
    trainNumber: t.number,
    trainName: t.name,
    from: t.from.code,
    to: t.to.code,
    fromName: t.from.name ?? null,
    toName: t.to.name ?? null,
    departure: t.departure,
    arrival: t.arrival,
    arrivalDayOffset: t.arrivalDayOffset || 0,
    durationMinutes: t.durationMinutes ?? null,
  };
}

function bestClassRow(classes: ClassAvailability[], travelClass: string | null): RouteAvailability | null {
  const known = classes.filter((c) => c.status && c.status !== "UNKNOWN");
  if (!known.length) return null;
  /* Round-18m: fresh rows beat stale (24h+) web-cache rows; stale flag carried. */
  const pick =
    (travelClass ? known.find((c) => c.code === travelClass) : undefined) ??
    [...known].sort((a, b) => Number(!!a.stale) - Number(!!b.stale) || (AVAIL_RANK[a.status] ?? 5) - (AVAIL_RANK[b.status] ?? 5) || (a.fare || 9e9) - (b.fare || 9e9))[0];
  return {
    ...(pick.stale ? { stale: true } : {}),
    classCode: pick.code,
    status: pick.status,
    seats: pick.seats ?? null,
    rac: pick.rac ?? null,
    waitlist: pick.waitlist ?? null,
    fare: pick.fare > 0 ? pick.fare : null,
    source: String(pick.source ?? "railcore"),
  };
}

/* ── Feature 1: deterministic ranking ─────────────────────────────── */
export type RankInput = {
  origin: string;
  destination: string;
  trains: TrainResult[];
  /** Verified availability per train number (optional, bounded probe). */
  availability?: Map<string, RouteAvailability | null>;
  connections?: Connection[];
  source: string;
  travelClass?: string | null;
};

const byNumber = (a: { trainNumbers: string[] }, b: { trainNumbers: string[] }) => a.trainNumbers.join().localeCompare(b.trainNumbers.join());

/** Stable, reproducible: same input → same output. Ties break by train number. */
export function rankRouteOptions(input: RankInput): RouteOption[] {
  const base: RouteOption[] = input.trains.map((t) => ({
    rank: 0,
    category: "direct",
    badges: [],
    trainNumbers: [t.number],
    trainNames: [t.name],
    origin: input.origin,
    destination: input.destination,
    departure: t.departure,
    arrival: t.arrival,
    arrivalDayOffset: t.arrivalDayOffset || 0,
    durationMinutes: t.durationMinutes ?? null,
    durationLabel: t.durationLabel ?? durationLabelOf(t.durationMinutes),
    changes: 0,
    legs: [toLeg(t)],
    layoverMinutes: null,
    classes: t.classes.map((c) => c.code),
    availability: input.availability?.get(t.number) ?? null,
    reliability: null,
    source: input.source,
    why: "",
  }));
  for (const c of input.connections ?? []) {
    if (!c.valid) continue;
    const first = c.legs[0];
    const last = c.legs[c.legs.length - 1];
    if (!first || !last) continue;
    base.push({
      rank: 0,
      category: "fewest_changes",
      badges: [],
      trainNumbers: c.legs.map((l) => l.trainNumber),
      trainNames: c.legs.map((l) => l.trainName),
      origin: input.origin,
      destination: input.destination,
      departure: first.departure,
      arrival: last.arrival,
      arrivalDayOffset: c.arrivalDayOffset + (last.arrivalDayOffset || 0),
      durationMinutes: c.totalDurationMinutes,
      durationLabel: durationLabelOf(c.totalDurationMinutes),
      changes: c.legs.length - 1,
      legs: c.legs,
      layoverMinutes: c.layoverMinutes,
      classes: [],
      /* Round-18m-6: combined = weakest leg (AVL < RAC < WL …); null if any leg unknown. */
      availability: c.legs.every((l) => l.availability)
        ? [...c.legs.map((l) => l.availability!)].sort((x, y) => (AVAIL_RANK[y.status] ?? 5) - (AVAIL_RANK[x.status] ?? 5) || (x.seats ?? 0) - (y.seats ?? 0))[0]
        : null,
      reliability: null,
      source: c.source,
      why: "",
    });
  }
  if (!base.length) return [];

  const dur = (o: RouteOption) => (o.durationMinutes != null && o.durationMinutes > 0 ? o.durationMinutes : 9e9);
  const dep = (o: RouteOption) => minutesOf(o.departure) ?? 9e9;

  const fastest = [...base].sort((a, b) => dur(a) - dur(b) || byNumber(a, b))[0];
  const fewestChanges = [...base].sort((a, b) => a.changes - b.changes || dur(a) - dur(b) || byNumber(a, b))[0];
  const earliest = [...base].sort((a, b) => dep(a) - dep(b) || byNumber(a, b))[0];
  const withAvail = base.filter((o) => o.availability && o.availability.status !== "UNKNOWN");
  const bestAvail = withAvail.length ? [...withAvail].sort((a, b) => availScore(a.availability) - availScore(b.availability) || dur(a) - dur(b) || byNumber(a, b))[0] : null;
  const withFare = base.filter((o) => o.availability?.fare != null);
  const cheapest = withFare.length ? [...withFare].sort((a, b) => (a.availability!.fare ?? 9e9) - (b.availability!.fare ?? 9e9) || dur(a) - dur(b) || byNumber(a, b))[0] : null;

  /* best_overall: deterministic weighted order — direct first, then availability
   * class (AVAILABLE < RAC < WL < unknown), then duration, then train number. */
  /* Round-18m-6 (user: "13308 mein seat nahi, fastest bhi nahi — best plan kaise?"):
   * seat-proven (fresh AVL/RAC) option ALWAYS ranks above WL/N-A/unknown, even a
   * connecting one; then fewer changes, then availability class, then duration. */
  const bookable = (o: RouteOption) => (o.availability && !o.availability.stale && (o.availability.status === "AVAILABLE" || o.availability.status === "RAC") ? 0 : 1);
  const overall = [...base].sort(
    (a, b) =>
      bookable(a) - bookable(b) ||
      a.changes - b.changes ||
      Math.floor(availScore(a.availability) / 10000) - Math.floor(availScore(b.availability) / 10000) ||
      dur(a) - dur(b) ||
      byNumber(a, b),
  );

  const key = (o: RouteOption) => o.trainNumbers.join("+");
  const badgeMap = new Map<string, RankCategory[]>();
  const add = (o: RouteOption | null, cat: RankCategory) => {
    if (!o) return;
    const k = key(o);
    badgeMap.set(k, [...(badgeMap.get(k) ?? []), cat]);
  };
  add(overall[0], "best_overall");
  add(fastest, "fastest");
  add(fewestChanges, fewestChanges.changes === 0 ? "direct" : "fewest_changes");
  add(bestAvail, "best_availability");
  add(cheapest, "cheapest");
  add(earliest, "earliest");

  return overall.map((o, i) => {
    const badges = badgeMap.get(key(o)) ?? [];
    const category: RankCategory = badges.includes("best_overall")
      ? "best_overall"
      : badges.includes("fastest")
        ? "fastest"
        : badges.includes("best_availability")
          ? "best_availability"
          : badges.includes("cheapest")
            ? "cheapest"
            : badges.includes("earliest")
              ? "earliest"
              : o.changes === 0
                ? "direct"
                : "fewest_changes";
    const whyParts: string[] = [];
    if (badges.includes("fastest")) whyParts.push(`sabse kam duration${o.durationLabel ? ` (${o.durationLabel})` : ""}`);
    if (badges.includes("direct")) whyParts.push("direct, koi change nahi");
    if (badges.includes("fewest_changes") && o.changes > 0) whyParts.push(`${o.changes} change`);
    if (badges.includes("best_availability") && o.availability) whyParts.push(`${o.availability.classCode} ${o.availability.status}${o.availability.seats != null ? ` ${o.availability.seats}` : ""}`);
    if (badges.includes("cheapest") && o.availability?.fare != null) whyParts.push(`verified fare ₹${o.availability.fare}`);
    if (badges.includes("earliest")) whyParts.push(`sabse pehle departure ${o.departure}`);
    return { ...o, rank: i + 1, category, badges, why: whyParts.join(", ") || (o.changes === 0 ? "direct train" : `${o.changes} change`) };
  });
}

/* ── Feature 6: connections ───────────────────────────────────────── */
export function evaluateConnection(
  legA: RouteLeg,
  legB: RouteLeg,
  station: string,
  opts: { minTransferMinutes?: number; maxLayoverMinutes?: number; source?: string; stationName?: string | null } = {},
): Connection {
  const minBuf = opts.minTransferMinutes ?? JOURNEY_CONFIG.minTransferMinutes;
  const maxLay = opts.maxLayoverMinutes ?? JOURNEY_CONFIG.maxLayoverMinutes;
  const arrMin = minutesOf(legA.arrival);
  const depMin = minutesOf(legB.departure);
  let layover = 0;
  let valid = false;
  let reason: string | null = null;
  if (arrMin == null || depMin == null) {
    reason = "arrival/departure time provider se nahi mila";
  } else {
    /* Leg A arrives on day offset d; leg B departs same calendar day (searched
     * for that date) — if it departs before A arrives, it is the NEXT day's
     * departure only if B runs daily; hum wo assume NAHI karte → invalid. */
    layover = depMin - arrMin - (legA.arrivalDayOffset || 0) * 1440;
    if (layover < 0) reason = "connecting train pehle nikal jaati hai (same-day)";
    else if (layover < minBuf) reason = `layover ${layover} min < buffer ${minBuf} min`;
    else if (layover > maxLay) reason = `layover ${layover} min > ${maxLay} min`;
    else valid = true;
  }
  const total = valid && legA.durationMinutes != null && legB.durationMinutes != null ? legA.durationMinutes + layover + legB.durationMinutes : null;
  return {
    station,
    stationName: opts.stationName ?? null,
    arrivalTrain: legA.trainNumber,
    departureTrain: legB.trainNumber,
    arrivalAt: legA.arrival,
    departsAt: legB.departure,
    arrivalDayOffset: legA.arrivalDayOffset || 0,
    layoverMinutes: Math.max(layover, Number.isFinite(layover) ? layover : 0),
    valid,
    reason,
    totalDurationMinutes: total,
    legs: [legA, legB],
    source: opts.source ?? "railcore",
  };
}

/* Round-18m-3 (user: "connecting option par seat JAT→BDTS dhoondhta hai jabki
 * train wahan jaati hi nahi; dono trains ki seat alag-alag dikhao"):
 * har leg ka apna segment (A: from→hub, B: hub→to) probe hota hai. Bounded:
 * pehli `limit` connections, dono legs parallel, provider-proven only. */
export async function probeConnectionLegs(connections: Connection[], date: string, travelClass: string | null, limit = 24): Promise<Set<string>> {
  const sources = new Set<string>();
  const cache = new Map<string, Promise<{ best: RouteAvailability | null; all: RouteAvailability[] } | null>>();
  const probe = (leg: RouteLeg): Promise<{ best: RouteAvailability | null; all: RouteAvailability[] } | null> => {
    const key = `${leg.trainNumber}:${leg.from}:${leg.to}`;
    let p = cache.get(key);
    if (!p) {
      /* Round-18m-7: poora class board (user class na ho to SAB classes) — leg par
       * har seat-wali class dikhegi, best row ranking ke liye. */
      p = routedClassBoard(leg.trainNumber, date, leg.from, leg.to, "GN", travelClass ? [travelClass] : [])
        .then((b) => ({ best: bestClassRow(b.classes, travelClass), all: bookableRows(b.classes) }))
        .catch(() => null);
      cache.set(key, p);
    }
    return p;
  };
  await Promise.all(
    connections.slice(0, limit).map(async (c) => {
      const rows = await Promise.all(c.legs.map((l) => probe(l)));
      c.legs = c.legs.map((l, i) => ({ ...l, availability: rows[i]?.best ?? null, classOptions: rows[i]?.all ?? [] }));
      rows.forEach((r) => r?.best && sources.add(r.best.source));
    }),
  );
  return sources;
}

/* Round-18m-5 (user: "connecting mein WL wali train kyu — humein AVAILABLE seat
 * wale route chahiye"): connection tabhi option hai jab DONO legs par
 * provider-proven AVL/RAC (fresh) ho. Baaki drop — WL/N-A/unknown leg wali
 * connection kabhi "alternative" nahi. Deterministic: seats-desc → duration. */
/* Round-18m-7 (user: "har class mein seat check karo, jis class mein mile wo dikhao"):
 * board ki SAB fresh AVL/RAC rows (AVL pehle, phir zyada seats, phir sasta). */
export function bookableRows(classes: ClassAvailability[], opts: { includeStale?: boolean } = {}): RouteAvailability[] {
  return classes
    .filter((c) => (opts.includeStale || !c.stale) && (c.status === "AVAILABLE" || c.status === "RAC"))
    .map((c) => ({ ...(c.stale ? { stale: true } : {}), classCode: c.code, status: c.status, seats: c.seats ?? null, rac: c.rac ?? null, waitlist: c.waitlist ?? null, fare: c.fare > 0 ? c.fare : null, source: String(c.source ?? "railcore") }))
    .sort((a, b) => Number(!!a.stale) - Number(!!b.stale) || (AVAIL_RANK[a.status] ?? 5) - (AVAIL_RANK[b.status] ?? 5) || (b.seats ?? 0) - (a.seats ?? 0) || (a.fare ?? 9e9) - (b.fare ?? 9e9));
}

/* Round-18m-9 (user: "kitni seats chahiye tabhi train dhoondho"): AVAILABLE row must
 * have >= pax seats (null seats = count unknown → accept), RAC accepted only for 1–2 pax. */
export function enoughSeats(a: RouteAvailability | null | undefined, pax: number | null | undefined): boolean {
  if (!a) return false;
  const n = pax && pax > 0 ? pax : 1;
  if (a.status === "AVAILABLE") return a.seats == null || a.seats >= n;
  if (a.status === "RAC") return n <= 2;
  return false;
}
export function legBookable(a: RouteAvailability | null | undefined, pax?: number | null): boolean {
  return !!a && !a.stale && (a.status === "AVAILABLE" || a.status === "RAC") && enoughSeats(a, pax);
}
export function bookableConnections(connections: Connection[], pax?: number | null): Connection[] {
  return connections
    .filter((c) => c.legs.length > 0 && c.legs.every((l) => legBookable(l.availability, pax) || (l.classOptions ?? []).some((r) => legBookable(r, pax))))
    .map((c) => ({
      ...c,
      /* Har leg ki best row = pax ke liye kaafi seats wali (class-agnostic — user kisi bhi class mein book kare). */
      legs: c.legs.map((l) => (legBookable(l.availability, pax) ? l : { ...l, availability: (l.classOptions ?? []).find((r) => legBookable(r, pax)) ?? l.availability })),
    }))
    .sort((x, y) => {
      const minSeats = (c: Connection) => Math.min(...c.legs.map((l) => (l.availability?.status === "AVAILABLE" ? l.availability.seats ?? 0 : 0)));
      return (x.totalDurationMinutes ?? 9e9) - (y.totalDurationMinutes ?? 9e9) || minSeats(y) - minSeats(x) || x.arrivalTrain.localeCompare(y.arrivalTrain);
    })
    .slice(0, 4);
}
export const CONNECTION_NO_SEAT_NOTE = "Connecting routes mile lekin kisi mein dono trains par seat available nahi thi (WL/N-A) — isliye connecting option nahi dikhaya.";

/* Round-18m-5: smart hubs — user ke route ki DIRECT trains ke beech wale
 * bade stops (schedule se, invent nahi) ko bhi hub banao. Fixed hub list
 * (NDLS/UMB…) long routes par seat-wali connection nahi de paati; asli
 * route ke junctions (e.g. JAT→BDTS par RTM/KOTA/BRC) se milti hai.
 * Bounded: 2 trains ki timetable, har train se max 4 evenly-spaced stops. */
export async function routeDerivedHubs(directTrains: { number: string }[], from: string, to: string, limit = 6): Promise<string[]> {
  const out: string[] = [];
  for (const t of directTrains.slice(0, 2)) {
    try {
      const sched = await routedSchedule(t.number);
      const stops = (sched.schedule && "stops" in sched.schedule ? (sched.schedule.stops as Stop[]) : []) ?? [];
      const codes = stops.map((s) => String(s.code).toUpperCase());
      const iFrom = codes.indexOf(from);
      const iTo = codes.indexOf(to);
      if (iFrom < 0 || iTo < 0 || iTo - iFrom < 3) continue;
      /* Sirf junction/major stops (naam se: JN / JUNCTION / CANTT / CENTRAL /
       * TERMINUS) ya configured hub list — chhote halts par connection nahi. */
      const JN_RE = /\b(JN|JUNCTION|CANTT?|CENTRAL|TERMINUS|CITY)\b/i;
      const mid = stops.slice(iFrom + 1, iTo).filter((s) => JN_RE.test(String(s.name ?? "")) || JOURNEY_CONFIG.connectionHubs.includes(String(s.code).toUpperCase()));
      const step = Math.max(1, Math.ceil(mid.length / limit));
      for (let i = 0; i < mid.length; i += step) {
        const c = String(mid[i].code).toUpperCase();
        if (c && !out.includes(c) && c !== from && c !== to) out.push(c);
        if (out.length >= limit) break;
      }
    } catch {
      /* timetable nahi — skip */
    }
    if (out.length >= limit) break;
  }
  return out;
}

export async function findConnections(
  from: string,
  to: string,
  date: string,
  opts: { hubs?: string[]; maxHubs?: number; legsPerHub?: number } = {},
): Promise<{ connections: Connection[]; hubsTried: string[]; sources: Set<string> }> {
  const hubs = (opts.hubs ?? JOURNEY_CONFIG.connectionHubs).filter((h) => h !== from && h !== to).slice(0, opts.maxHubs ?? 3);
  const legsPerHub = opts.legsPerHub ?? 8; // Round-18m-9: poore route ki trains (bounded), sirf 4 nahi
  const out: Connection[] = [];
  const sources = new Set<string>();
  for (const hub of hubs) {
    try {
      const [a, b] = await Promise.all([searchTrainsRouted({ from, to: hub, date }), searchTrainsRouted({ from: hub, to, date })]);
      if (a.provider !== "none") sources.add(a.provider);
      if (b.provider !== "none") sources.add(b.provider);
      const legA = [...a.trains].sort((x, y) => x.departure.localeCompare(y.departure)).slice(0, legsPerHub);
      const legB = [...b.trains].sort((x, y) => x.departure.localeCompare(y.departure)).slice(0, legsPerHub + 4);
      for (const ta of legA) {
        for (const tb of legB) {
          if (ta.number === tb.number) continue; // same train = not a connection
          const c = evaluateConnection(toLeg(ta), toLeg(tb), hub, { source: a.provider === b.provider ? a.provider : `${a.provider}+${b.provider}` });
          if (c.valid) out.push(c);
        }
      }
    } catch {
      /* hub pair fail — skip, never invent */
    }
    if (out.length >= 40) break;
  }
  out.sort((x, y) => (x.totalDurationMinutes ?? 9e9) - (y.totalDurationMinutes ?? 9e9) || x.layoverMinutes - y.layoverMinutes || x.arrivalTrain.localeCompare(y.arrivalTrain));
  /* Round-18m-9: zyada candidates (24) — har leg ki seat probe ke baad joint best chunte hain. */
  return { connections: out.slice(0, 24), hubsTried: hubs, sources };
}

/* ── Feature 3: vacant seats ──────────────────────────────────────── */
export async function findVacantSeats(args: {
  trainNumber: string;
  origin: string;
  destination: string;
  date: string;
  travelClass?: string | null;
  quota?: string;
  hintClasses?: string[];
}): Promise<VacantSeatsResult> {
  const quota = args.quota ?? "GN";
  const board = await routedClassBoard(args.trainNumber, args.date, args.origin.toUpperCase(), args.destination.toUpperCase(), quota, args.hintClasses ?? []);
  const rows = board.classes
    .filter((c) => !args.travelClass || c.code === args.travelClass)
    .filter((c) => c.status && c.status !== "UNKNOWN")
    .map((c) => ({
      classCode: c.code,
      status: c.status,
      seats: c.seats ?? null,
      rac: c.rac ?? null,
      waitlist: c.waitlist ?? null,
      fare: c.fare > 0 ? c.fare : null,
      quota: c.quota ?? quota,
      source: String(c.source ?? board.provider),
      berths: null, // koi provider berth-level (B4 · 32 LB) nahi deta — invent nahi
    }));
  return {
    trainNumber: args.trainNumber,
    trainName: null,
    origin: args.origin.toUpperCase(),
    destination: args.destination.toUpperCase(),
    date: args.date,
    travelClass: args.travelClass ?? null,
    rows,
    capability: {
      classLevel: rows.length > 0,
      berthLevel: false,
      postChart: false,
      note: "Class-level seat count provider se (IRCTC availability). Coach/berth-level vacancy (jaise B4 · 32 LB) aur post-chart vacant berths abhi kisi configured provider (RailCore/RailKit/RailRadar) se nahi aate — jab aayenge tab dikhayenge, andaza nahi.",
    },
    source: board.provider,
  };
}

/* ── Feature 4/5: partial-route + same-train switch ───────────────── */
type Stop = { code: string; name: string; arrival: string | null; departure: string | null; day?: number };

function segRow(
  train: string,
  from: Stop,
  to: Stop,
  c: ClassAvailability | undefined,
  provider: ServedProvider,
): PartialSegment | null {
  if (!c || !c.status || c.status === "UNKNOWN") return null;
  return {
    from: from.code,
    fromName: from.name ?? null,
    to: to.code,
    toName: to.name ?? null,
    trainNumber: train,
    classCode: c.code,
    status: c.status,
    seats: c.seats ?? null,
    rac: c.rac ?? null,
    waitlist: c.waitlist ?? null,
    fare: c.fare > 0 ? c.fare : null,
    departure: from.departure ?? null,
    arrival: to.arrival ?? null,
    source: String(c.source ?? provider),
    berth: null, // provider berth nahi deta → null (kabhi fabricate nahi)
  };
}

export async function findPartialRouteSeats(args: {
  trainNumber: string;
  origin: string;
  destination: string;
  date: string;
  classCode: string;
  quota?: string;
}): Promise<PartialRoutePlan> {
  const quota = args.quota ?? "GN";
  const cls = args.classCode.toUpperCase();
  const from = args.origin.toUpperCase();
  const to = args.destination.toUpperCase();
  const classValid = (CLASS_CODES as readonly string[]).includes(cls);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(args.date) && args.date >= todayYmd();
  const base: PartialRoutePlan = {
    trainNumber: args.trainNumber,
    trainName: null,
    origin: from,
    destination: to,
    date: args.date,
    classCode: cls,
    direct: null,
    plans: [],
    sameTrainSwitch: null,
    verification: { stationSequenceValid: false, classValid, dateValid, trainRunsOnDate: null, stopsChecked: [] },
    note: "",
    source: "none",
  };
  if (!classValid) return { ...base, note: `Class ${cls} valid nahi.` };
  if (!dateValid) return { ...base, note: "Date invalid ya beet chuki — partial-route sirf aane wali date par." };

  const sched = await routedSchedule(args.trainNumber);
  const stops = (sched.schedule && "stops" in sched.schedule ? (sched.schedule.stops as Stop[]) : []) ?? [];
  base.trainName = sched.schedule?.trainName ?? null;
  base.source = sched.provider;
  const iFrom = stops.findIndex((s) => s.code.toUpperCase() === from);
  const iTo = stops.findIndex((s) => s.code.toUpperCase() === to);
  if (!stops.length || iFrom < 0 || iTo < 0 || iFrom >= iTo) {
    return { ...base, note: !stops.length ? "Timetable provider se nahi mili — route verify nahi ho saka." : `${from}→${to} is train ke route par is order mein nahi hai.` };
  }
  base.verification.stationSequenceValid = true;
  /* Runs-on-date: runningDays (Mon..Sun) agar available. */
  const runningDays = sched.schedule && "runningDays" in sched.schedule ? (sched.schedule.runningDays as string[]) : [];
  if (runningDays?.length) {
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${args.date}T00:00:00+05:30`).getUTCDay()];
    const norm = runningDays.map((d) => d.slice(0, 3).toLowerCase());
    base.verification.trainRunsOnDate = norm.includes("daily") || norm.includes(dow.toLowerCase());
    if (base.verification.trainRunsOnDate === false) return { ...base, note: `${args.trainNumber} ${args.date} (${dow}) ko nahi chalti.` };
  }
  const classHint = sched.schedule && "classes" in sched.schedule ? (sched.schedule.classes as string[]) : [];
  if (classHint?.length && !classHint.includes(cls)) {
    base.verification.classValid = false;
    return { ...base, note: `${args.trainNumber} mein ${cls} class nahi hai (${classHint.join("/")}).` };
  }

  const probe = async (a: Stop, b: Stop): Promise<PartialSegment | null> => {
    const board = await routedClassBoard(args.trainNumber, args.date, a.code, b.code, quota, [cls]);
    base.verification.stopsChecked.push(`${a.code}-${b.code}`);
    return segRow(args.trainNumber, a, b, board.classes.find((c) => c.code === cls), board.provider);
  };

  base.direct = await probe(stops[iFrom], stops[iTo]);
  const directOk = base.direct?.status === "AVAILABLE";

  /* Candidate switch stations: major halts between (bounded). Prefer halts
   * roughly in the middle, deterministic order by index. */
  const between = stops.slice(iFrom + 1, iTo);
  const mid = (iFrom + iTo) / 2;
  const candidates = [...between]
    .map((s, i) => ({ s, idx: iFrom + 1 + i }))
    .sort((x, y) => Math.abs(x.idx - mid) - Math.abs(y.idx - mid) || x.idx - y.idx)
    .slice(0, JOURNEY_CONFIG.partialSplitLimit);

  if (!directOk && candidates.length) {
    for (const { s } of candidates) {
      const [segA, segB] = await Promise.all([probe(stops[iFrom], s), probe(s, stops[iTo])]);
      const segments = [segA, segB].filter((x): x is PartialSegment => Boolean(x));
      if (segments.length !== 2) continue;
      const fully = segments.every((x) => x.status === "AVAILABLE");
      base.plans.push({
        switchStation: s.code,
        switchStationName: s.name ?? null,
        segments,
        fullyAvailable: fully,
        note: fully ? `${from}→${s.code} aur ${s.code}→${to} dono ${cls} AVAILABLE — same train, ${s.name ?? s.code} par seat badalni hogi (berth number chart ke baad hi pata chalega).` : `${s.code} par split: ${segments.map((x) => `${x.from}→${x.to} ${x.status}`).join(", ")}.`,
      });
      /* Same-train switch: origin→X poor, but X→destination AVAILABLE → seat
       * becomes available after X (provider-proven for that segment). */
      if (segB?.status === "AVAILABLE" && segA && segA.status !== "AVAILABLE" && !base.sameTrainSwitch) {
        base.sameTrainSwitch = { afterStation: s.code, afterStationName: s.name ?? null, segment: segB };
      }
    }
    base.plans.sort((a, b) => Number(b.fullyAvailable) - Number(a.fullyAvailable) || a.switchStation.localeCompare(b.switchStation));
  }
  base.note = directOk
    ? `Direct ${from}→${to} ${cls} AVAILABLE hai — split ki zaroorat nahi.`
    : base.plans.length
      ? `Direct seat nahi; ${base.plans.filter((p) => p.fullyAvailable).length} split plan provider-verified.`
      : base.direct
        ? `Direct ${base.direct.status}; koi verified split plan nahi mila (${base.verification.stopsChecked.length} segments check kiye).`
        : "Availability provider se nahi mili — kuch invent nahi kiya.";
  return base;
}

/* ── Round-18m-6: "Book from earlier station" (ConfirmTkt-style) ──────────
 * User (LDH→LKO, 13308 SL WL 32): ConfirmTkt showed "book from Phillaur (PHR)
 * 19:00, board at Ludhiana 19:55 — SL RAC 31". Same train, ticket from a stop
 * BEFORE origin; quota pool differs so seats often exist. Deterministic and
 * provider-proven: timetable → up to `stopsBack` earlier stops → probe
 * bookFrom→destination → keep AVL/RAC only. Never invented. */
export async function findBoardFromEarlier(args: {
  trains: { number: string; name: string; directStatus?: string | null; durationMinutes?: number | null }[];
  origin: string;
  destination: string;
  date: string;
  travelClass?: string | null;
  stopsBack?: number;
  limitTrains?: number;
  passengers?: number | null;
}): Promise<{ options: BoardFromEarlierOption[]; sources: Set<string> }> {
  const from = args.origin.toUpperCase();
  const to = args.destination.toUpperCase();
  const stopsBack = args.stopsBack ?? JOURNEY_CONFIG.boardEarlierStops;
  const sources = new Set<string>();
  const options: BoardFromEarlierOption[] = [];
  await Promise.all(
    args.trains.slice(0, args.limitTrains ?? 3).map(async (t) => {
      try {
        const sched = await routedSchedule(t.number);
        const stops = (sched.schedule && "stops" in sched.schedule ? (sched.schedule.stops as Stop[]) : []) ?? [];
        const codes = stops.map((s) => String(s.code).toUpperCase());
        const iFrom = codes.indexOf(from);
        const iTo = codes.indexOf(to);
        if (iFrom <= 0 || iTo < 0 || iTo <= iFrom) return;
        const earlier = stops.slice(Math.max(0, iFrom - stopsBack), iFrom).reverse(); // nearest first
        for (let k = 0; k < earlier.length; k++) {
          const s = earlier[k];
          const board = await routedClassBoard(t.number, args.date, s.code, to, "GN", args.travelClass ? [args.travelClass] : []);
          /* Round-18m-7: SAB classes check — jis class mein bhi seat mile, sab dikhao. */
          /* Stale (24h+ web-cache) AVL/RAC bhi option hai — ⚠ "last known" ke saath; fresh pehle. */
          const all = bookableRows(board.classes, { includeStale: true }).filter((r) => enoughSeats(r, args.passengers));
          const row = (args.travelClass ? all.find((r) => r.classCode === args.travelClass) : undefined) ?? all[0] ?? null;
          if (row) {
            sources.add(row.source);
            const dest = stops[iTo];
            const dayOf = (st: Stop) => (typeof st.day === "number" ? st.day : 1);
            const depM = minutesOf(stops[iFrom].departure ?? stops[iFrom].arrival ?? "");
            const arrM = minutesOf(dest.arrival ?? dest.departure ?? "");
            const dayDiff = Math.max(0, dayOf(dest) - dayOf(stops[iFrom]));
            /* Search result ka duration (boardAt→destination) sabse reliable; schedule se sirf fallback. */
            let durationMinutes: number | null = t.durationMinutes && t.durationMinutes > 0 ? t.durationMinutes : depM != null && arrM != null ? arrM - depM + dayDiff * 1440 : null;
            if (durationMinutes != null && durationMinutes <= 0) durationMinutes += 1440; // schedule bina day → overnight

            options.push({
              classOptions: all,
              durationMinutes,
              trainNumber: t.number,
              trainName: t.name,
              bookFrom: s.code,
              bookFromName: s.name ?? null,
              bookFromDeparture: s.departure ?? s.arrival ?? null,
              boardAt: from,
              boardAtName: stops[iFrom].name ?? null,
              boardAtDeparture: stops[iFrom].departure ?? stops[iFrom].arrival ?? null,
              destination: to,
              destinationName: dest.name ?? null,
              arrival: dest.arrival ?? dest.departure ?? null,
              arrivalDayOffset: Math.max(0, dayOf(dest) - dayOf(stops[iFrom])),
              availability: row,
              directStatus: t.directStatus ?? null,
              stopsBefore: k + 1,
              source: row.source,
            });
            return; // nearest earlier stop with a seat is enough for this train
          }
        }
      } catch {
        /* provider fail → skip this train, never invent */
      }
    }),
  );
  /* Round-18m-7: seat pehle (AVL > RAC), phir SABSE KAM travel time, phir nazdeek ka stop. */
  options.sort((a, b) => Number(!!a.availability.stale) - Number(!!b.availability.stale) || (AVAIL_RANK[a.availability.status] ?? 5) - (AVAIL_RANK[b.availability.status] ?? 5) || (a.durationMinutes ?? 9e9) - (b.durationMinutes ?? 9e9) || a.stopsBefore - b.stopsBefore || a.trainNumber.localeCompare(b.trainNumber));
  return { options, sources };
}

/** Round-18: same class from two different sources with different values → conflict (never blended). */
export function detectBoardConflict(classes: ClassAvailability[]): string[] | null {
  const byCode = new Map<string, ClassAvailability[]>();
  for (const c of classes) {
    if (!c.status || c.status === "UNKNOWN") continue;
    const arr = byCode.get(c.code) ?? [];
    arr.push(c);
    byCode.set(c.code, arr);
  }
  for (const rows of byCode.values()) {
    if (rows.length < 2) continue;
    const r = resolveConflict(
      "availability",
      rows.map((x) => ({ value: { status: x.status, seats: x.seats ?? null, waitlist: x.waitlist ?? null, rac: x.rac ?? null }, source: String(x.source ?? "railcore"), providerUpdatedAt: x.webNote?.match(/as of ([^)]*)/i)?.[1] ?? null })),
      availabilityEquals,
    );
    if (!r.ok) return rows.map((x) => String(x.source ?? "railcore"));
  }
  return null;
}

/* ── Round-18: alternatives for ONE selected train ─────────────────── */
export async function findAlternativeTrains(args: {
  trainNumber: string;
  origin: string;
  destination: string;
  date: string;
  travelClass?: string | null;
  lowSeatThreshold?: number;
  /** Already-verified row for the selected train/class (from CHECK_AVAILABILITY) — avoids a second probe & provider drift. */
  knownRow?: { status: string; seats?: number | null; waitlist?: number | null; rac?: number | null; source?: string | null } | null;
}): Promise<AlternativeTrainsResult> {
  const from = args.origin.toUpperCase();
  const to = args.destination.toUpperCase();
  const cls = args.travelClass?.toUpperCase() ?? null;
  const low = args.lowSeatThreshold ?? (Number(process.env.LOW_SEAT_THRESHOLD ?? 10) || 10);
  const sources = new Set<string>();
  const retrievedAt = new Date().toISOString();

  /* Poora class board (hint = []) — "usi train ki doosri class" real rows se; schedule ke classes use hote hain. */
  const board = await routedClassBoard(args.trainNumber, args.date, from, to, "GN", []);
  const known = board.classes.filter((c) => c.status && c.status !== "UNKNOWN");
  known.forEach((c) => sources.add(String(c.source ?? board.provider)));
  const sel = cls ? known.find((c) => c.code === cls) : bestClassRow(board.classes, null);
  let selRow = sel ? { status: sel.status, seats: (sel as ClassAvailability).seats ?? null, waitlist: (sel as ClassAvailability).waitlist ?? null, rac: (sel as ClassAvailability).rac ?? null, source: String((sel as ClassAvailability).source ?? board.provider) } : null;
  if (!selRow && args.knownRow && args.knownRow.status && args.knownRow.status !== "UNKNOWN") {
    /* Board probe missed this class (provider quota/segment) — use the row we already verified. */
    selRow = { status: args.knownRow.status, seats: args.knownRow.seats ?? null, waitlist: args.knownRow.waitlist ?? null, rac: args.knownRow.rac ?? null, source: String(args.knownRow.source ?? "railcore") };
    sources.add(selRow.source);
  }
  const boardHasClass = cls ? board.classes.some((c) => c.code === cls) : true;

  let reason: AlternativeTrainsResult["reason"] = "unknown";
  if (!selRow) reason = cls && known.length && !boardHasClass ? "class_unavailable" : cls && known.length ? "class_unavailable" : "unknown";
  else if (selRow.status === "WAITLIST") reason = "waitlist";
  else if (selRow.status === "RAC") reason = "rac";
  else if (selRow.status === "NOT_AVAILABLE") reason = "not_available";
  else if (selRow.status === "AVAILABLE" && selRow.seats != null && selRow.seats < low) reason = "low_availability";
  else if (selRow.status === "AVAILABLE") reason = "fine";

  const otherClasses: RouteAvailability[] = known
    .filter((c) => c.code !== cls && c.status === "AVAILABLE")
    .map((c) => ({ classCode: c.code, status: c.status, seats: c.seats ?? null, rac: c.rac ?? null, waitlist: c.waitlist ?? null, fare: c.fare > 0 ? c.fare : null, source: String(c.source ?? board.provider) }));

  const base = {
    selected: { trainNumber: args.trainNumber, trainName: null as string | null, classCode: cls, status: selRow?.status ?? null, seats: selRow?.seats ?? null, waitlist: selRow?.waitlist ?? null, rac: selRow?.rac ?? null, source: selRow?.source ?? null },
    reason,
    origin: from,
    destination: to,
    date: args.date,
    otherClasses,
  };
  const prov = () => ({ retrievedAt, requestDate: todayYmd(), travelDate: args.date, freshness: freshnessOf("availability", retrievedAt), sourceTypes: [...new Set([...sources].map(sourceTypeOf))] });

  if (reason === "fine") {
    return { ...base, alternatives: [], partialRoute: null, connecting: [], alternativeDates: [], sources: [...sources], note: `${args.trainNumber} ${cls ?? ""} AVAILABLE (${selRow?.seats ?? "?"} seats) — alternatives ki zaroorat nahi.`, provenance: prov() };
  }

  /* Alternatives: full plan on same route/date, excluding this train; keep only provider-verified AVAILABLE/RAC. */
  const plan = await planJourney({ from, to, date: args.date, travelClass: cls, preference: "best_availability", includeConnections: false, includeAlternativeDates: true, includePartial: false, includeAlternateStations: false });
  plan.sources.forEach((x) => sources.add(x));
  const t = plan.routeOptions.find((o) => o.trainNumbers[0] === args.trainNumber);
  base.selected.trainName = t?.trainNames[0] ?? null;
  const alternatives = plan.routeOptions.filter((o) => o.trainNumbers[0] !== args.trainNumber && o.availability && (o.availability.status === "AVAILABLE" || o.availability.status === "RAC")).slice(0, 4);

  let partialRoute: PartialRoutePlan | null = null;
  if (cls && reason !== "class_unavailable") {
    try {
      partialRoute = await findPartialRouteSeats({ trainNumber: args.trainNumber, origin: from, destination: to, date: args.date, classCode: cls });
      if (partialRoute.source !== "none") sources.add(partialRoute.source);
    } catch {
      partialRoute = null;
    }
  }
  let connecting: Connection[] = [];
  if (!alternatives.length) {
    const c = await findConnections(from, to, args.date, { maxHubs: 2 });
    c.sources.forEach((x) => sources.add(x));
    (await probeConnectionLegs(c.connections, args.date, cls ?? null)).forEach((x) => sources.add(x));
    connecting = bookableConnections(c.connections).slice(0, 2);
  }
  const why =
    reason === "waitlist" ? `${args.trainNumber} ${cls ?? ""} WL${selRow?.waitlist ?? ""}` : reason === "rac" ? `${args.trainNumber} ${cls ?? ""} RAC` : reason === "low_availability" ? `${args.trainNumber} ${cls ?? ""} mein sirf ${selRow?.seats} seats` : reason === "not_available" ? `${args.trainNumber} ${cls ?? ""} not available` : reason === "class_unavailable" ? `${args.trainNumber} mein ${cls} class ka data/seat nahi` : `${args.trainNumber} ki availability provider se nahi aayi`;
  const found = alternatives.length + otherClasses.length + (partialRoute?.plans.filter((p) => p.fullyAvailable).length ?? 0) + connecting.length;
  return {
    ...base,
    alternatives,
    partialRoute,
    connecting,
    alternativeDates: plan.alternativeDates,
    sources: [...sources],
    note: found ? `${why} — ${found} verified alternative(s) mile.` : `${why} — koi verified alternative nahi mila (invent nahi kiya).`,
    provenance: prov(),
  };
}

/* ── Round-18 §8: alternate boarding / destination station (same city cluster) ── */
export function clusterSiblings(code: string): string[] {
  const up = code.toUpperCase();
  const group = Object.values(MULTI_STATION_CITIES).find((list) => list.includes(up));
  return group ? [...new Set(group.filter((c) => c !== up))] : [];
}

/**
 * Same-city alternate stations (e.g. user asked NDLS but NZM/ANVT have seats).
 * Bounded: max 2 siblings per side, availability probe only for the fastest
 * train per alternate pair. Result is a SUGGESTION — origin/destination are
 * never changed silently; UI/LLM must present it as a different assumption.
 */
export async function findAlternateStationOptions(args: { from: string; to: string; date: string; travelClass?: string | null; limitPerSide?: number; maxProbes?: number }): Promise<{ options: AlternateStationOption[]; sources: Set<string> }> {
  const from = args.from.toUpperCase();
  const to = args.to.toUpperCase();
  const n = args.limitPerSide ?? 6;
  const maxProbes = args.maxProbes ?? 3;
  const pairs: { from: string; to: string; changed: AlternateStationOption["changed"] }[] = [
    ...clusterSiblings(from).slice(0, n).map((f) => ({ from: f, to, changed: "origin" as const })),
    ...clusterSiblings(to).slice(0, n).map((t) => ({ from, to: t, changed: "destination" as const })),
  ];
  const sources = new Set<string>();
  /* Step 1: schedule search for every sibling pair (cheap, cached per provider). */
  const found = (
    await Promise.all(
      pairs.map(async (p) => {
        try {
          const s = await searchTrainsRouted({ from: p.from, to: p.to, date: args.date });
          if (!s.trains.length) return null;
          sources.add(s.provider);
          return { p, s };
        } catch {
          return null;
        }
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x != null);
  /* Step 2: availability probe only for pairs that really have trains (bounded). */
  found.sort((a, b) => b.s.trains.length - a.s.trains.length || a.p.from.localeCompare(b.p.from) || a.p.to.localeCompare(b.p.to));
  const options: AlternateStationOption[] = [];
  await Promise.all(
    found.slice(0, maxProbes).map(async ({ p, s }) => {
      const fastest = [...s.trains].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9) || a.number.localeCompare(b.number))[0];
      const availability = new Map<string, RouteAvailability | null>();
      try {
        const board = await routedClassBoard(fastest.number, args.date, p.from, p.to, "GN", args.travelClass ? [args.travelClass] : fastest.classes.map((c) => c.code));
        const row = bestClassRow(board.classes, args.travelClass ?? null);
        availability.set(fastest.number, row);
        if (row) sources.add(row.source);
      } catch {
        availability.set(fastest.number, null);
      }
      /* Round-18j: ranking failure (odd provider row) must not drop a REAL option. */
      let best: RouteOption | null = null;
      try {
        const ranked = rankRouteOptions({ origin: p.from, destination: p.to, trains: s.trains, availability, source: s.provider, travelClass: args.travelClass ?? null });
        best = ranked.find((o) => o.trainNumbers[0] === fastest.number) ?? ranked[0] ?? null;
      } catch {
        best = null;
      }
      options.push({
        from: p.from,
        to: p.to,
        changed: p.changed,
        count: s.trains.length,
        best,
        allTrainNumbers: s.trains.map((t) => t.number).slice(0, 6),
        source: s.provider,
        note: `${p.changed === "origin" ? `Boarding ${p.from}` : `Destination ${p.to}`} (same city) — ${s.trains.length} trains${best?.availability ? `, ${best.trainNumbers[0]} ${best.availability.classCode} ${best.availability.status}${best.availability.seats != null ? ` ${best.availability.seats}` : ""}` : ""}. Ye aapki original ${p.changed === "origin" ? "boarding" : "destination"} station se ALAG hai — confirm karein.`,
      });
    }),
  );
  options.sort((a, b) => availScore(a.best?.availability ?? null) - availScore(b.best?.availability ?? null) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { options, sources };
}

/* ── Feature 2: plan + recovery ───────────────────────────────────── */
export async function planJourney(args: {
  from: string;
  to: string;
  date: string;
  travelClass?: string | null;
  preference?: string;
  includeConnections?: boolean;
  includeAlternativeDates?: boolean;
  includePartial?: boolean;
  includeAlternateStations?: boolean;
  trains?: TrainResult[];
  searchProvider?: ServedProvider;
  /** Round-18m-9: seats needed — bookable = AVL >= pax (RAC only for <=2). */
  passengers?: number | null;
}): Promise<JourneyPlan> {
  const notes: string[] = [];
  const pax = args.passengers && args.passengers > 0 ? args.passengers : null;
  const sources = new Set<string>();
  const from = args.from.toUpperCase();
  const to = args.to.toUpperCase();
  let trains = args.trains ?? [];
  let provider: ServedProvider = args.searchProvider ?? "none";
  if (!args.trains) {
    const s = await searchTrainsRouted({ from, to, date: args.date });
    trains = s.trains;
    provider = s.provider;
  }
  if (provider !== "none") sources.add(provider);

  /* Bounded availability probe: fastest N trains. */
  const availability = new Map<string, RouteAvailability | null>();
  const conflicts: { trainNumber: string; message: string; sources: string[] }[] = [];
  const probeList = [...trains].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9) || a.number.localeCompare(b.number)).slice(0, JOURNEY_CONFIG.availabilityProbeLimit);
  await Promise.all(
    probeList.map(async (t) => {
      try {
        const hint = args.travelClass ? [args.travelClass] : t.classes.map((c) => c.code);
        const board = await routedClassBoard(t.number, args.date, from, to, "GN", hint);
        const c = detectBoardConflict(board.classes);
        if (c) {
          conflicts.push({ trainNumber: t.number, message: CONFLICT_MESSAGE, sources: c });
          availability.set(t.number, null);
          return;
        }
        const row = bestClassRow(board.classes, args.travelClass ?? null);
        availability.set(t.number, row);
        if (row) sources.add(row.source);
      } catch {
        availability.set(t.number, null);
      }
    }),
  );
  const probedKnown = [...availability.values()].filter(Boolean).length;
  if (probeList.length && !probedKnown) notes.push("Seat availability provider se nahi aayi — ranking sirf duration/direct par hai.");

  /* Connections: only when thin direct list or requested. */
  let connections: Connection[] = [];
  if (args.includeConnections || trains.length <= 1) {
    const c = await findConnections(from, to, args.date, { maxHubs: trains.length ? 2 : 3 });
    connections = c.connections;
    c.sources.forEach((s) => sources.add(s));
    (await probeConnectionLegs(connections, args.date, args.travelClass ?? null)).forEach((s) => sources.add(s));
    const found = connections.length;
    connections = bookableConnections(connections, pax);
    if (!connections.length && trains.length) {
      const hubs = await routeDerivedHubs(probeList, from, to);
      if (hubs.length) {
        const c2 = await findConnections(from, to, args.date, { hubs, maxHubs: hubs.length, legsPerHub: 5 });
        c2.sources.forEach((s) => sources.add(s));
        (await probeConnectionLegs(c2.connections, args.date, args.travelClass ?? null)).forEach((s) => sources.add(s));
        connections = bookableConnections(c2.connections, pax);
      }
    }
    if ((found || trains.length) && !connections.length) notes.push(CONNECTION_NO_SEAT_NOTE);
  }

  const routeOptions = rankRouteOptions({ origin: from, destination: to, trains, availability, connections, source: provider, travelClass: args.travelClass ?? null });

  /* Alternative dates: suggestions only — user date never changed. */
  let alternativeDates: JourneyPlan["alternativeDates"] = [];
  const directUnavailable =
    trains.length === 0 ||
    (probedKnown > 0 && ![...availability.values()].some((a) => legBookable(a, pax)));
  if (args.includeAlternativeDates || directUnavailable) {
    const [y, m, d] = args.date.split("-").map(Number);
    const shift = (n: number) => {
      const dt = new Date(Date.UTC(y, m - 1, d + n));
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    };
    const dates = [shift(-1), shift(1), shift(2)].filter((x) => x >= todayYmd() && x !== args.date);
    alternativeDates = await Promise.all(
      dates.map(async (dd) => {
        const alt = await searchTrainsRouted({ from, to, date: dd });
        const fastest = [...alt.trains].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9))[0];
        /* Round-18m: alt-date par bhi seat PROVE karo (fastest train, 1 probe) —
         * "12th ko seat hai" tab hi bole jab provider ne AVL/RAC dikhaya ho. */
        let seatProof: string | null = null;
        if (fastest) {
          try {
            const hint = args.travelClass ? [args.travelClass] : fastest.classes.map((c) => c.code);
            const board = await routedClassBoard(fastest.number, dd, from, to, "GN", hint);
            const row = bestClassRow(board.classes, args.travelClass ?? null);
            if (row) {
              const tag = row.status === "AVAILABLE" ? `AVL${row.seats != null ? ` ${row.seats}` : ""}` : row.status === "RAC" ? `RAC${row.rac != null ? ` ${row.rac}` : ""}` : row.status === "WAITLIST" ? `WL${row.waitlist != null ? ` ${row.waitlist}` : ""}` : row.status === "NOT_AVAILABLE" ? "N/A" : null;
              if (tag) seatProof = `${fastest.number} ${row.classCode} ${tag}${row.stale ? " ⚠stale" : ""}`;
            }
          } catch {
            seatProof = null;
          }
        }
        return { date: dd, count: alt.trains.length, fastest: fastest ? { number: fastest.number, durationMinutes: fastest.durationMinutes } : null, seatProof, ...(alt.provider === "none" ? { providerFailed: true } : {}) };
      }),
    );
  }

  /* Recovery block. */
  let recovery: JourneyPlan["recovery"] = null;
  if (directUnavailable) {
    const differentTrain = routeOptions.filter((o) => o.changes === 0 && legBookable(o.availability, pax));
    let partial: PartialRoutePlan | null = null;
    if (args.includePartial !== false && args.travelClass && trains.length) {
      const target = probeList[0];
      if (target) {
        try {
          partial = await findPartialRouteSeats({ trainNumber: target.number, origin: from, destination: to, date: args.date, classCode: args.travelClass });
          if (partial.source !== "none") sources.add(partial.source);
        } catch {
          partial = null;
        }
      }
    }
    /* Round-18m-6: same train, book from an earlier stop (user still boards at origin). */
    let boardFromEarlier: BoardFromEarlierOption[] = [];
    try {
      /* Saari direct trains jinme user ke segment par seat nahi (ya probe nahi hui) —
       * fastest pehle; bounded to 6 trains × 3 earlier stops. */
      const wlDirect = [...trains]
        .sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9) || a.number.localeCompare(b.number))
        .filter((t) => !legBookable(availability.get(t.number), pax))
        .map((t) => ({ number: t.number, name: t.name, directStatus: availability.get(t.number)?.status ?? null, durationMinutes: t.durationMinutes ?? null }));
      if (wlDirect.length) {
        /* Round-18m-7: ConfirmTkt jaisa — SAARI direct trains (bounded 10) × pichhle stops × har class. */
        const r = await findBoardFromEarlier({ trains: wlDirect, origin: from, destination: to, date: args.date, travelClass: args.travelClass ?? null, limitTrains: JOURNEY_CONFIG.boardEarlierTrains, passengers: pax });
        boardFromEarlier = r.options;
        r.sources.forEach((s) => sources.add(s));
      }
    } catch {
      boardFromEarlier = [];
    }
    if (!connections.length) {
      const c = await findConnections(from, to, args.date, { maxHubs: 3 });
      connections = c.connections;
      c.sources.forEach((s) => sources.add(s));
      (await probeConnectionLegs(connections, args.date, args.travelClass ?? null)).forEach((s) => sources.add(s));
      connections = bookableConnections(connections, pax);
      if (!connections.length) {
        const hubs = await routeDerivedHubs(probeList, from, to);
        if (hubs.length) {
          const c2 = await findConnections(from, to, args.date, { hubs, maxHubs: hubs.length, legsPerHub: 5 });
          c2.sources.forEach((s) => sources.add(s));
          (await probeConnectionLegs(c2.connections, args.date, args.travelClass ?? null)).forEach((s) => sources.add(s));
          connections = bookableConnections(c2.connections, pax);
        }
      }
      if (!connections.length && !notes.includes(CONNECTION_NO_SEAT_NOTE)) notes.push(CONNECTION_NO_SEAT_NOTE);
    }
    /* §8 alternate boarding/destination station (same city) — suggestion only. */
    let alternateStations: AlternateStationOption[] = [];
    if (args.includeAlternateStations !== false) {
      try {
        const alt = await findAlternateStationOptions({ from, to, date: args.date, travelClass: args.travelClass ?? null });
        /* Sirf useful: naya train (direct list mein nahi) ya sach mein AVAILABLE/RAC. */
        const directSet = new Set(trains.map((t) => t.number));
        alternateStations = alt.options.filter((o) => {
          if (o.count <= 0) return false;
          const st = o.best?.availability?.status;
          if (st === "AVAILABLE" || st === "RAC") return true;
          return o.best ? !directSet.has(o.best.trainNumbers[0]) : false;
        });
        alt.sources.forEach((s) => sources.add(s));
      } catch {
        alternateStations = [];
      }
    }
    recovery = {
      reason: trains.length === 0 ? "Koi direct train nahi mili." : `Direct trains mein ${args.travelClass ?? "kisi class"} mein AVAILABLE/RAC seat nahi (verified ${probedKnown} trains).`,
      differentTrain,
      partialRoute: partial,
      connecting: connections,
      alternativeDates,
      alternateStations,
      boardFromEarlier,
    };
  }
  if (!trains.length && provider === "none") notes.push("Railway data source unavailable — RailCore/RailKit/RailRadar/web sab se jawab nahi mila.");
  const retrievedAt = new Date().toISOString();
  const sourceTypes = [...new Set([...sources].map(sourceTypeOf))];

  const plan: JourneyPlan = {
    provenance: { retrievedAt, requestDate: todayYmd(), travelDate: args.date, freshness: freshnessOf("availability", retrievedAt), sourceTypes },
    conflicts: conflicts.length ? conflicts : undefined,
    query: { from, to, date: args.date, travelClass: args.travelClass ?? null, preference: args.preference ?? "best_overall", passengers: pax },
    best: routeOptions[0] ?? null,
    routeOptions,
    connections,
    alternativeDates,
    directUnavailable,
    recovery,
    sources: [...sources],
    notes,
    summary: null,
  };
  plan.summary = journeySummary(plan);
  plan.whyPoints = journeyWhyPoints(plan);
  return plan;
}

/* ── Round-18m-9: "AI ne ye plan kyun chuna" — 3–5 concrete reasons, deterministic,
 * built only from data in this plan (no invented facts). ─────────────────── */
export function journeyWhyPoints(plan: JourneyPlan): string[] {
  const pts: string[] = [];
  const pax = plan.query.passengers ?? null;
  const paxTxt = pax ? `${pax} passenger${pax > 1 ? "s" : ""}` : null;
  const best = plan.best;
  const rec = plan.recovery;
  const bfe = (rec?.boardFromEarlier ?? []).find((b) => !b.availability.stale) ?? null;
  const direct = plan.routeOptions.filter((o) => o.changes === 0);
  const fastestDirect = [...direct].sort((a, b) => (a.durationMinutes ?? 9e9) - (b.durationMinutes ?? 9e9))[0] ?? null;
  const seatTxt = (a: RouteAvailability) => `${a.classCode} ${a.status === "AVAILABLE" ? `AVL ${a.seats ?? ""}`.trim() : a.status === "RAC" ? `RAC ${a.rac ?? ""}`.trim() : a.status}`;
  if (plan.directUnavailable && bfe) {
    const wlCount = direct.filter((o) => o.availability && !legBookable(o.availability, pax)).length;
    pts.push(`${plan.query.from}→${plan.query.to} par ${wlCount || direct.length} direct train${(wlCount || direct.length) > 1 ? "s" : ""} check ki — kisi mein${paxTxt ? ` ${paxTxt} ke liye` : ""} confirmed seat nahi (WL/RAC/N-A).`);
    pts.push(`${bfe.trainNumber} mein ${bfe.bookFrom} (${bfe.stopsBefore} stop pehle) se ticket lene par ${seatTxt(bfe.availability)}${bfe.availability.fare != null ? ` @ ₹${bfe.availability.fare}` : ""} — provider-verified, fresh data.`);
    if (bfe.durationMinutes && fastestDirect?.durationMinutes) {
      pts.push(bfe.durationMinutes <= fastestDirect.durationMinutes + 30 ? `Travel time ${durationLabelOf(bfe.durationMinutes)} — direct trains mein sabse kam ke barabar, train badalni nahi padti.` : `Travel time ${durationLabelOf(bfe.durationMinutes)}; fastest direct (${fastestDirect.trainNumbers[0]}, ${fastestDirect.durationLabel}) mein seat nahi thi, isliye seat-proven option upar rakha.`);
    }
    const extra = (bfe.classOptions ?? []).filter((r) => r.classCode !== bfe.availability.classCode && !r.stale);
    if (extra.length) pts.push(`Isi option mein ${extra.map(seatTxt).join(", ")} bhi hai — budget ke hisaab se class chun sakte ho.`);
    pts.push(`Boarding ${bfe.boardAt} hi rahega — IRCTC par boarding point ${bfe.boardAt} chuno; ${bfe.bookFrom}→${bfe.boardAt} ka chhota extra fare lagta hai.`);
    const conn = plan.connections[0] ?? rec?.connecting?.[0];
    if (conn) pts.push(`Connecting via ${conn.stationName ?? conn.station} bhi possible (${conn.legs.map((l) => l.trainNumber).join("→")}, ${durationLabelOf(conn.totalDurationMinutes)}) — lekin train change + layover ${conn.layoverMinutes} min, isliye 2nd option.`);
    else if (plan.notes.some((n) => /Connecting routes mile lekin/.test(n))) pts.push("Connecting routes check kiye — kisi mein dono legs par seat nahi mili, isliye nahi dikhaya.");
  } else if (best) {
    if (best.changes === 0) pts.push(`Direct train — koi change nahi${best.durationLabel ? `, ${best.durationLabel}` : ""}.`);
    else pts.push(`Direct trains mein${paxTxt ? ` ${paxTxt} ke liye` : ""} seat nahi — is route par dono legs verified seat ke saath (${best.legs.map((l) => `${l.trainNumber}${l.availability ? ` ${seatTxt(l.availability)}` : ""}`).join(" → ")}), layover ${best.layoverMinutes ?? "-"} min.`);
    if (best.availability) pts.push(legBookable(best.availability, pax) ? `${seatTxt(best.availability)}${best.availability.fare != null ? ` @ ₹${best.availability.fare}` : ""} — provider-verified${paxTxt ? `, ${paxTxt} ke liye kaafi` : ""}.` : `Seat status ${seatTxt(best.availability)} — confirmed nahi; ye sabse kam WL/fastest option hai.`);
    if (fastestDirect && best.trainNumbers[0] === fastestDirect.trainNumbers[0]) pts.push(`${direct.length} direct trains mein sabse fast.`);
    else if (fastestDirect?.durationLabel) pts.push(`Fastest direct ${fastestDirect.trainNumbers[0]} (${fastestDirect.durationLabel}) mein seat nahi/kam thi, isliye ye upar.`);
    const cheaper = plan.routeOptions.filter((o) => o !== best && o.availability?.fare != null && best.availability?.fare != null && o.availability!.fare! < best.availability!.fare! && legBookable(o.availability, pax))[0];
    if (cheaper) pts.push(`Sasta option ${cheaper.trainNumbers[0]} (₹${cheaper.availability!.fare}) bhi hai — Lowest fare tab mein.`);
    if (best.departure) pts.push(`Departure ${best.departure}, arrival ${best.arrival}${best.arrivalDayOffset ? ` (+${best.arrivalDayOffset} din)` : ""}.`);
  }
  return pts.slice(0, 5);
}

/* ── Round-18l: plain-language journey summary (deterministic) ─────────
 * Screenshot-style: "Best plan: 12779 Goa Express (SL AVAILABLE 42). If it
 * slips, route via Madgaon (…) — or shift to Mon 15 Sep (1 train)."
 * Every clause comes from a REAL retrieved object; nothing is made up. */
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WD[dt.getUTCDay()]} ${d} ${MO[m - 1]}`;
}
function availPhrase(a: RouteAvailability | null | undefined): string | null {
  if (!a) return null;
  if (a.status === "AVAILABLE") return `${a.classCode} ${a.seats != null ? `${a.seats} seats open` : "available"}`;
  if (a.status === "RAC") return `${a.classCode} RAC${a.rac != null ? ` ${a.rac}` : ""}`;
  if (a.status === "WAITLIST") return `${a.classCode} WL${a.waitlist != null ? ` ${a.waitlist}` : ""}`;
  return `${a.classCode} ${a.status}`;
}
export function journeySummary(plan: JourneyPlan): string | null {
  const parts: string[] = [];
  const best = plan.best;
  const rec = plan.recovery;
  const isBookable = (a: RouteAvailability | null | undefined) => !!a && !a.stale && (a.status === "AVAILABLE" || a.status === "RAC");
  /* Round-18m-6: "Book from earlier station" (same train) beats a WL best. */
  const bfeAll = rec?.boardFromEarlier ?? [];
  const bfe = bfeAll.find((b) => !b.availability.stale) ?? null; // summary sirf FRESH proof par
  /* Round-18m-7: bfe list seat-first + kam-time sorted hai; ye direct same-train
   * option WL best ko aur LAMBI connecting best ko bhi beat karta hai (seat + time). */
  const bfeBeatsBest =
    !!bfe && !!best && (!isBookable(best.availability) || (best.changes > 0 && (bfe.durationMinutes ?? 9e9) <= (best.durationMinutes ?? 9e9)));
  if (best && bfe && bfeBeatsBest) {
    const a = bfe.availability;
    const seat = a.status === "AVAILABLE" ? `${a.classCode} AVL${a.seats != null ? ` ${a.seats}` : ""}` : `${a.classCode} RAC${a.rac != null ? ` ${a.rac}` : ""}`;
    const otherCls = (bfe.classOptions ?? []).filter((r) => r.classCode !== a.classCode).map((r) => `${r.classCode} ${r.status === "AVAILABLE" ? `AVL ${r.seats ?? ""}`.trim() : `RAC ${r.rac ?? ""}`.trim()}`);
    const dur = bfe.durationMinutes != null ? `, ${durationLabelOf(bfe.durationMinutes)}` : "";
    const more = bfeAll.length > 1 ? ` Aise ${bfeAll.length} same-train options mile (card mein sab, har seat-wali class ke saath) — ye fresh seat-proof wala sabse kam time ka option hai.` : "";
    parts.push(`Best plan: ${bfe.trainNumber} ${bfe.trainName} — ticket ${bfe.bookFromName ?? bfe.bookFrom} (${bfe.bookFrom}${bfe.bookFromDeparture ? ` ${bfe.bookFromDeparture}` : ""}) se book karo, board ${bfe.boardAtName ?? bfe.boardAt} (${bfe.boardAt}${bfe.boardAtDeparture ? ` ${bfe.boardAtDeparture}` : ""}) par hi — ${seat}${a.fare != null ? `, ₹${a.fare}` : ""}${dur}${otherCls.length ? ` (aur bhi classes: ${otherCls.join(", ")})` : ""}. (${bfe.boardAt}→${bfe.destination} par ${best.trainNumbers[0] === bfe.trainNumber && best.availability ? availPhrase(best.availability) : bfe.directStatus ?? "seat nahi"}.)${more}`);
  } else if (best) {
    const name = best.trainNames[0] ? ` ${best.trainNames[0]}` : "";
    const av = availPhrase(best.availability);
    const dur = best.durationLabel ? `, ${best.durationLabel}` : "";
    const changes = best.changes ? `, ${best.changes} change` : "";
    const why = isBookable(best.availability)
      ? (best.changes ? " — direct trains mein seat nahi, is route par dono legs available" : "")
      : " — kisi option mein confirmed seat nahi; ye sabse kam WL/fastest direct hai";
    parts.push(`Best plan: ${best.trainNumbers.join("+")}${name} ${best.departure}→${best.arrival}${dur}${changes}${av ? ` (${av})` : ""}${why}.`);
  } else if (rec) {
    parts.push(`${plan.query.from}→${plan.query.to} ${dayLabel(plan.query.date)}: ${rec.reason}`);
  } else {
    return null;
  }
  /* Fallback route: a verified connecting option (only when best isn't already a clean AVAILABLE seat). */
  const bestOk = best?.availability?.status === "AVAILABLE" || !!bfe;
  const conn = (plan.connections.length ? plan.connections : rec?.connecting ?? []).find((c) => c.valid) ?? null;
  const diff = rec?.differentTrain.find((o) => o.availability && (o.availability.status === "AVAILABLE" || o.availability.status === "RAC")) ?? null;
  if (!bestOk && diff && diff.trainNumbers[0] !== best?.trainNumbers[0]) {
    parts.push(`If it slips, take ${diff.trainNumbers[0]}${diff.trainNames[0] ? ` ${diff.trainNames[0]}` : ""} (${availPhrase(diff.availability) ?? "seats"}).`);
  } else if (!bestOk && conn && conn.legs.length >= 2) {
    const via = conn.stationName ?? conn.station;
    const trains = conn.legs.map((l) => l.trainNumber).join("→");
    /* Round-18m-7: har leg ki SAB seat-wali classes (jis class mein bhi mile). */
    const legSeats = conn.legs.map((l) => {
      const rows = l.classOptions?.length ? l.classOptions : l.availability ? [l.availability] : [];
      if (!rows.length) return null;
      return `${l.trainNumber} ${rows.map((r) => `${r.classCode} ${r.status === "AVAILABLE" ? `AVL ${r.seats ?? ""}`.trim() : r.status === "RAC" ? `RAC ${r.rac ?? ""}`.trim() : r.status}`).join("/")}`;
    }).filter(Boolean);
    parts.push(`If it slips, route via ${via} (${trains}, layover ${conn.layoverMinutes} min${legSeats.length ? `; ${legSeats.join(", ")}` : ""}).`);
  }
  /* Alternative date with real trains. */
  /* Later dates first (a "shift to today" suggestion is usually already past departure). */
  const altDates = (plan.alternativeDates.length ? plan.alternativeDates : rec?.alternativeDates ?? [])
    .filter((d) => d.count > 0 && !d.providerFailed)
    .sort((a, b) => Number(b.date > plan.query.date) - Number(a.date > plan.query.date) || a.date.localeCompare(b.date));
  if (!bestOk && altDates.length) {
    /* Round-18m: seat-proven date first; WL-only date is stated as WL, never as "seat hai". */
    const proven = altDates.find((d) => d.seatProof && /\b(AVL|RAC)\b/.test(d.seatProof) && !/stale/.test(d.seatProof));
    const d = proven ?? altDates[0];
    if (proven) parts.push(`Or shift to ${dayLabel(d.date)} — ${d.seatProof}.`);
    else parts.push(`Or shift to ${dayLabel(d.date)} — ${d.count} train${d.count > 1 ? "s" : ""} run${d.seatProof ? ` (${d.seatProof})` : ", seat status unverified"}.`);
  }
  /* Same-city alternate station (suggestion only). */
  const altSt = rec?.alternateStations?.[0];
  if (!bestOk && altSt && altSt.count > 0 && parts.length < 3) {
    parts.push(`Alternate station: ${altSt.from}→${altSt.to} has ${altSt.count} train${altSt.count > 1 ? "s" : ""} — confirm before switching.`);
  }
  return parts.join(" ");
}

export const __test = { availScore, bestClassRow, toLeg };
void env;
