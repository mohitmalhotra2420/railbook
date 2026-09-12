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
import type { ClassAvailability, ClassCode, TrainResult } from "../providers/types.js";
import { routedClassBoard, routedSchedule, searchTrainsRouted, type ServedProvider } from "../railway/router.js";
import { todayYmd } from "../util.js";
import { MULTI_STATION_CITIES } from "../railway/station-resolve.js";
import { CONFLICT_MESSAGE, availabilityEquals, freshnessOf, resolveConflict, sourceTypeOf } from "../providers/provenance.js";
import type { BoardFromEarlierOption, JourneyDecision } from "./types.js";
import { type LegPlan,
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
  availabilityProbeLimit: Number(process.env.JOURNEY_AVAIL_PROBE ?? 20) || 20, // Round-18m-12: route ki HAR train (bounded 20), sirf fastest 4 nahi
  /** Hubs tried for connections (comma env override). */
  connectionHubs: String(process.env.CONNECTION_HUBS ?? "NDLS,UMB,LJN,CNB,JUC,ASR,BPL,ET,NGP,HWH,MAS,SBC,ADI,BCT")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  /** Partial-route: max intermediate halts probed (each = 1 availability call). */
  partialSplitLimit: Number(process.env.PARTIAL_SPLIT_LIMIT ?? 3) || 3,
  /** Round-18m-6: how many stops BEFORE origin to try for "book from earlier station". */
  boardEarlierStops: Number(process.env.BOARD_EARLIER_STOPS ?? 15) || 15, // Round-18m-11: train origin tak (bounded)
  boardEarlierTrains: Number(process.env.BOARD_EARLIER_TRAINS ?? 20) || 20,
  /** Round-18m-16: ConfirmTkt "Book Upto" — destination ke aage kitne stops tak ticket try karein. */
  bookUptoStops: Number(process.env.BOOK_UPTO_STOPS ?? 6) || 6, // Round-18m-15: route ki SAARI trains (origin tak har stop × har class)
};

const AVAIL_RANK: Record<string, number> = { AVAILABLE: 0, RAC: 1, WAITLIST: 2, UNKNOWN: 3, NOT_AVAILABLE: 4 };

function availScore(a: RouteAvailability | null): number {
  /* Round-18m-6: unknown (null) ranks like UNKNOWN (3) — pehle 9 → floor(9/1e4)=0
   * → "seat data nahi" wali train AVAILABLE ke barabar rank ho jaati thi (13152 bug). */
  if (!a) return AVAIL_RANK.UNKNOWN * 10000 + 9;
  const base = AVAIL_RANK[a.status] ?? 5;
  return base * 10000 - (a.status === "AVAILABLE" ? Math.min(a.seats ?? 0, 9999) : 0);
}

function addDays(ymd: string, n: number): string {
  if (!n) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
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
    classes: t.classes.map((c) => c.code),
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
  /** Round-18m-12: har train ka poora class board. */
  classBoards?: Map<string, RouteAvailability[]>;
  probed?: Set<string>;
  connections?: Connection[];
  source: string;
  travelClass?: string | null;
  /** Round-18m-12: pax-aware tiers (fresh bookable for N → stale AVL/RAC for N → rest). */
  passengers?: number | null;
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
    classOptions: input.classBoards?.get(t.number) ?? [],
    probed: input.probed ? input.probed.has(t.number) : undefined,
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
  /* Round-18m-12: pax-aware — tier 0 fresh AVL/RAC with enough seats for the party,
   * tier 1 stale (web-cache) AVL/RAC with enough seats ("available, not fresh — verify"),
   * tier 2 everything else (WL / kam seats / unknown). */
  const pax = input.passengers ?? null;
  const bookable = (o: RouteOption) => (legBookable(o.availability, pax) ? 0 : o.availability?.stale && enoughSeats(o.availability, pax) ? 1 : 2);
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
/* Round-18m-10 (user: "2nd leg mein boarding→destination ki SAB trains ki
 * availability dikhao, 1st leg mein origin→boarding ki har train — phir joint
 * best"): probed connections ko hub ke hisaab se group karke har leg ke SAB
 * seat-wale trains (pax ke liye kaafi) nikaalo. Sirf probed data — invent nahi. */
export function buildLegPlans(probed: Connection[], pax?: number | null, opts: { maxHubs?: number } = {}): LegPlan[] {
  const byHub = new Map<string, { name: string | null; a: Map<string, RouteLeg>; b: Map<string, RouteLeg>; conns: Connection[] }>();
  const bestRowFor = (l: RouteLeg): RouteLeg => (legBookable(l.availability, pax) ? l : { ...l, availability: (l.classOptions ?? []).find((r) => legBookable(r, pax)) ?? l.availability });
  for (const c of probed) {
    if (!c.valid || c.legs.length !== 2) continue;
    let g = byHub.get(c.station);
    if (!g) {
      g = { name: c.stationName ?? c.legs[0]?.toName ?? null, a: new Map(), b: new Map(), conns: [] };
      byHub.set(c.station, g);
    }
    const [la, lb] = c.legs;
    if (!g.a.has(la.trainNumber)) g.a.set(la.trainNumber, bestRowFor(la));
    if (!g.b.has(lb.trainNumber)) g.b.set(lb.trainNumber, bestRowFor(lb));
    g.conns.push(c);
  }
  const plans: LegPlan[] = [];
  for (const [hub, g] of byHub) {
    const okA = [...g.a.values()].filter((l) => legBookable(l.availability, pax)).sort((x, y) => x.departure.localeCompare(y.departure));
    const okB = [...g.b.values()].filter((l) => legBookable(l.availability, pax)).sort((x, y) => x.departure.localeCompare(y.departure));
    const bookable = bookableConnections(g.conns, pax);
    if (!bookable.length) continue;
    plans.push({ hub, hubName: g.name, leg1: okA, leg2: okB, checkedLeg1: g.a.size, checkedLeg2: g.b.size, best: bookable[0] });
  }
  plans.sort((x, y) => (x.best?.totalDurationMinutes ?? 9e9) - (y.best?.totalDurationMinutes ?? 9e9) || y.leg1.length + y.leg2.length - (x.leg1.length + x.leg2.length));
  return plans.slice(0, opts.maxHubs ?? 2);
}
/* Round-18m-10: chosen hub ke liye POORE route ki trains — leg-1 origin→hub ki
 * har train, leg-2 hub→destination ki har train (bounded `perLeg`), sab par
 * pax-aware seat probe; phir joint best = seat-wale pairs mein valid + fastest. */
export async function expandLegPlan(args: { from: string; to: string; hub: string; hubName?: string | null; date: string; travelClass: string | null; pax: number | null; perLeg?: number; leg2DayOffset?: number }): Promise<{ plan: LegPlan | null; sources: Set<string> }> {
  const sources = new Set<string>();
  /* Round-18m-14 (user): leg-1 origin→boarding aur leg-2 boarding→destination
   * par us din chalne wali HAR train (special/weekly bhi — search date-filtered
   * hai) × HAR class. Bounded 20 per leg, parallel. */
  const perLeg = args.perLeg ?? 20;
  const [a, b] = await Promise.all([searchTrainsRouted({ from: args.from, to: args.hub, date: args.date }), searchTrainsRouted({ from: args.hub, to: args.to, date: addDays(args.date, args.leg2DayOffset ?? 0) })]);
  if (a.provider !== "none") sources.add(a.provider);
  if (b.provider !== "none") sources.add(b.provider);
  const legA = [...a.trains].sort((x, y) => x.departure.localeCompare(y.departure)).slice(0, perLeg).map(toLeg);
  const legB = [...b.trains].sort((x, y) => x.departure.localeCompare(y.departure)).slice(0, perLeg).map(toLeg);
  const probe = async (l: RouteLeg, date: string): Promise<RouteLeg> => {
    try {
      /* Hint = user class PEHLE + train ki saari classes → poora board (sirf user class nahi). */
      const hint = Array.from(new Set([...(args.travelClass ? [args.travelClass] : []), ...(l.classes ?? [])]));
      const board = await routedClassBoard(l.trainNumber, date, l.from, l.to, "GN", hint);
      const all = bookableRows(board.classes, { includeStale: true });
      const best = all.find((r) => legBookable(r, args.pax)) ?? bestClassRow(board.classes, args.travelClass);
      if (best) sources.add(best.source);
      /* classOptions = poora board (AVL/RAC/WL/N-A, stale flagged) — UI/AI ko har class dikhe. */
      const full = board.classes.filter((c) => c.status && c.status !== "UNKNOWN").map((c) => ({ ...(c.stale ? { stale: true } : {}), classCode: c.code, status: c.status, seats: c.seats ?? null, rac: c.rac ?? null, waitlist: c.waitlist ?? null, fare: c.fare > 0 ? c.fare : null, source: String(c.source ?? "railcore") }));
      return { ...l, availability: best, classOptions: full.length ? full : all };
    } catch {
      return { ...l, availability: null, classOptions: [] };
    }
  };
  const dateB = addDays(args.date, args.leg2DayOffset ?? 0);
  const [pa, pb] = await Promise.all([Promise.all(legA.map((l) => probe(l, args.date))), Promise.all(legB.map((l) => probe(l, dateB)))]);
  const okA = pa.filter((l) => legBookable(l.availability, args.pax));
  const okB = pb.filter((l) => legBookable(l.availability, args.pax)).map((l) => ({ ...l, departureDayOffset: args.leg2DayOffset ?? 0 }));
  const combos: Connection[] = [];
  for (const la of okA) for (const lb of okB) {
    if (la.trainNumber === lb.trainNumber) continue;
    /* leg-2 agle din ki ho to layover mein +1440 (evaluateConnection same-day maanta hai). */
    const shifted = args.leg2DayOffset ? { ...lb, departure: lb.departure } : lb;
    const c = evaluateConnection(la, shifted, args.hub, { source: a.provider === b.provider ? a.provider : `${a.provider}+${b.provider}`, stationName: args.hubName ?? null, maxLayoverMinutes: 480 });
    if (c.valid) combos.push(c);
  }
  const best = bookableConnections(combos, args.pax)[0] ?? null;
  if (!okA.length && !okB.length) return { plan: null, sources };
  return { plan: { hub: args.hub, hubName: args.hubName ?? null, leg1: okA, leg2: okB, checkedLeg1: pa.length, checkedLeg2: pb.length, best }, sources };
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
  trains: { number: string; name: string; classes?: string[]; directStatus?: string | null; durationMinutes?: number | null }[];
  origin: string;
  destination: string;
  date: string;
  travelClass?: string | null;
  stopsBack?: number;
  /** Round-18m-16: ConfirmTkt "Book Upto" — destination ke AAGE ke stops bhi (ticket aage tak, utro destination par). */
  stopsAhead?: number;
  /** "earlier" (default) = sirf pichhle stops; "upto" = sirf aage ke stops + earlier×aage combo (tab jab earlier + connecting fail). */
  mode?: "earlier" | "upto";
  limitTrains?: number;
  passengers?: number | null;
}): Promise<{ options: BoardFromEarlierOption[]; sources: Set<string>; stopsChecked: number; trainsChecked: number }> {
  const from = args.origin.toUpperCase();
  const to = args.destination.toUpperCase();
  const stopsBack = args.stopsBack ?? JOURNEY_CONFIG.boardEarlierStops;
  const mode = args.mode ?? "earlier";
  const stopsAhead = mode === "upto" ? args.stopsAhead ?? JOURNEY_CONFIG.bookUptoStops : 0;
  const sources = new Set<string>();
  const options: BoardFromEarlierOption[] = [];
  let stopsChecked = 0;
  let trainsChecked = 0;
  await Promise.all(
    args.trains.slice(0, args.limitTrains ?? 3).map(async (t) => {
      try {
        const sched = await routedSchedule(t.number);
        const stops = (sched.schedule && "stops" in sched.schedule ? (sched.schedule.stops as Stop[]) : []) ?? [];
        const codes = stops.map((s) => String(s.code).toUpperCase());
        const iFrom = codes.indexOf(from);
        const iTo = codes.indexOf(to);
        if (iFrom <= 0 || iTo < 0 || iTo <= iFrom) return;
        trainsChecked++;
        const earlier = stops.slice(Math.max(0, iFrom - stopsBack), iFrom).reverse(); // nearest first … train origin tak
        const later = stops.slice(iTo + 1, iTo + 1 + stopsAhead); // Round-18m-16: destination ke aage, nearest first
        const tcls = (t as { classes?: string[] }).classes ?? [];
        const hint = Array.from(new Set([...(args.travelClass ? [args.travelClass] : []), ...tcls]));
        const dest = stops[iTo];
        const dayOf = (st: Stop) => (typeof st.day === "number" ? st.day : 1);
        /* Ek ticket-segment (bookFrom → bookUpto) probe karo — passenger phir bhi from→to hi travel karta hai. */
        const tryOneSegment = async (bf: Stop, bu: Stop | null, stopsBefore: number, stopsAfterN: number): Promise<boolean> => {
          stopsChecked++;
          const segTo = bu ? String(bu.code).toUpperCase() : to;
          const board = await routedClassBoard(t.number, args.date, String(bf.code).toUpperCase(), segTo, "GN", hint);
          /* Round-18m-7: SAB classes check — jis class mein bhi seat mile, sab dikhao. Stale AVL/RAC bhi option (⚠), fresh pehle. */
          const all = bookableRows(board.classes, { includeStale: true }).filter((r) => enoughSeats(r, args.passengers));
          const row = (args.travelClass ? all.find((r) => r.classCode === args.travelClass) : undefined) ?? all[0] ?? null;
          if (!row) return false;
          sources.add(row.source);
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
            bookFrom: String(bf.code).toUpperCase(),
            bookFromName: bf.name ?? null,
            bookFromDeparture: bf.departure ?? bf.arrival ?? null,
            boardAt: from,
            boardAtName: stops[iFrom].name ?? null,
            boardAtDeparture: stops[iFrom].departure ?? stops[iFrom].arrival ?? null,
            destination: to,
            destinationName: dest.name ?? null,
            arrival: dest.arrival ?? dest.departure ?? null,
            arrivalDayOffset: Math.max(0, dayOf(dest) - dayOf(stops[iFrom])),
            availability: row,
            directStatus: t.directStatus ?? null,
            stopsBefore,
            source: row.source,
            bookUpto: bu ? String(bu.code).toUpperCase() : null,
            bookUptoName: bu ? bu.name ?? null : null,
            bookUptoArrival: bu ? bu.arrival ?? bu.departure ?? null : null,
            stopsAfter: stopsAfterN,
          });
          return true;
        };
        /* Phase 1 (Round-18m-6): earlier stop → destination. */
        if (mode === "earlier") {
          for (let k = 0; k < earlier.length; k++) {
            if (await tryOneSegment(earlier[k], null, k + 1, 0)) return; // nearest earlier stop with a seat is enough for this train
          }
          return;
        }
        /* Phase 2 (Round-18m-16, user ConfirmTkt screenshot LDH→INDB: "Book Upto DADN"):
         * origin → destination ke AAGE ka stop. */
        for (let j = 0; j < later.length; j++) {
          if (await tryOneSegment(stops[iFrom], later[j], 0, j + 1)) return;
        }
        /* Phase 3: earlier × later combo — SAARE earlier stops (train origin tak) × nazdeek ke
         * 3 later stops. User case: LDH→INDB par seat JAT(6 stops pehle)→DADN(1 aage) hi mili —
         * 3×3 bound se chhoot jaata tha. Nazdeek wala later stop pehle, phir door ka earlier. */
        for (let j = 0; j < Math.min(3, later.length); j++) {
          for (let k = 0; k < earlier.length; k++) {
            if (await tryOneSegment(earlier[k], later[j], k + 1, j + 1)) return;
          }
        }
      } catch {
        /* provider fail → skip this train, never invent */
      }
    }),
  );
  /* Round-18m-7: seat pehle (AVL > RAC), phir SABSE KAM travel time, phir nazdeek ka stop. */
  options.sort((a, b) => Number(!!a.availability.stale) - Number(!!b.availability.stale) || (AVAIL_RANK[a.availability.status] ?? 5) - (AVAIL_RANK[b.availability.status] ?? 5) || (a.durationMinutes ?? 9e9) - (b.durationMinutes ?? 9e9) || (a.stopsBefore + (a.stopsAfter ?? 0)) - (b.stopsBefore + (b.stopsAfter ?? 0)) || a.trainNumber.localeCompare(b.trainNumber));
  return { options, sources, stopsChecked, trainsChecked };
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
  /** Round-18m-16: ConfirmTkt "Book Upto" scan (default on) — sirf tab jab earlier + connecting fail. */
  includeBookUpto?: boolean;
  includeAlternateStations?: boolean;
  trains?: TrainResult[];
  searchProvider?: ServedProvider;
  /** Round-18m-10: false → model-written why-points skip (tests / fast paths). */
  aiWhy?: boolean;
  /** Round-18m-10: false → top-hub full-route leg expansion skip. */
  expandLegs?: boolean;
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
  const classBoards = new Map<string, RouteAvailability[]>();
  const probedSet = new Set<string>();
  const conflicts: { trainNumber: string; message: string; sources: string[] }[] = [];
  /* Round-18m-12 (user bug LDH→SRE: 14 trains, sirf 4 probe hui, 12588/14682
   * ki AVL seats kabhi dekhi hi nahi → "koi seat nahi" jhooth): route ki HAR
   * train (bounded 20) × HAR class, parallel. User class ho to bhi poora board
   * (baaki classes options mein) — best row user-class/pax ke hisaab se. */
  const probeList = [...trains].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9) || a.number.localeCompare(b.number)).slice(0, JOURNEY_CONFIG.availabilityProbeLimit);
  const toRow = (c: ClassAvailability): RouteAvailability => ({ ...(c.stale ? { stale: true } : {}), classCode: c.code, status: c.status, seats: c.seats ?? null, rac: c.rac ?? null, waitlist: c.waitlist ?? null, fare: c.fare > 0 ? c.fare : null, source: String(c.source ?? "railcore") });
  /* Round-18m-14: RailCore = 20 req/min. 15 trains × 4 classes = 60 calls ek
   * saath → pehli 20 fresh, baaki web-cache (stale). Ab do PASS: pass-1 har
   * train ki PRIORITY class (user class, warna SL/3A jahan seat sabse likely)
   * = ≤20 fresh calls; pass-2 baaki classes (fresh jo mile, warna web). Aise
   * har train ko kam-se-kam ek FRESH row zaroor milti hai. */
  const priorityClass = (t: TrainResult): ClassCode | null => {
    const codes = t.classes.map((c) => c.code);
    if (args.travelClass && codes.includes(args.travelClass as ClassCode)) return args.travelClass as ClassCode;
    for (const c of ["SL", "3A", "CC", "2S", "3E", "2A", "EC", "1A"] as ClassCode[]) if (codes.includes(c)) return c;
    return codes[0] ?? null;
  };
  const pass1 = new Map<string, ClassAvailability[]>();
  await Promise.all(
    probeList.map(async (t) => {
      const pc = priorityClass(t);
      if (!pc) return;
      try {
        const b = await routedClassBoard(t.number, args.date, from, to, "GN", [pc]);
        pass1.set(t.number, b.classes);
      } catch {
        /* pass-2 covers it */
      }
    }),
  );
  await Promise.all(
    probeList.map(async (t) => {
      try {
        const done = new Set<string>((pass1.get(t.number) ?? []).filter((c) => c.status && c.status !== "UNKNOWN").map((c) => c.code));
        const hint = Array.from(new Set<string>([...(args.travelClass ? [args.travelClass] : []), ...t.classes.map((c) => c.code)])).filter((c) => !done.has(c));
        const rest = hint.length || !done.size ? await routedClassBoard(t.number, args.date, from, to, "GN", hint) : { classes: [] as ClassAvailability[], provider: "none" as ServedProvider };
        const merged = [...(pass1.get(t.number) ?? []).filter((c) => done.has(c.code)), ...rest.classes.filter((c) => !done.has(c.code))];
        const board = { classes: merged, provider: rest.provider };
        const c = detectBoardConflict(board.classes);
        if (c) {
          conflicts.push({ trainNumber: t.number, message: CONFLICT_MESSAGE, sources: c });
          availability.set(t.number, null);
          return;
        }
        const known = board.classes.filter((x) => x.status && x.status !== "UNKNOWN");
        if (known.length) probedSet.add(t.number);
        const allRows = known.map(toRow).sort((a, b) => Number(!!a.stale) - Number(!!b.stale) || (AVAIL_RANK[a.status] ?? 5) - (AVAIL_RANK[b.status] ?? 5) || (b.seats ?? 0) - (a.seats ?? 0) || (a.fare ?? 9e9) - (b.fare ?? 9e9));
        classBoards.set(t.number, allRows);
        /* best row: user class mein pax-bookable → wahi; warna KOI bhi class jo pax ke liye bookable (fresh, phir stale); warna user class ka status; warna board best. */
        const inClass = args.travelClass ? allRows.filter((r) => r.classCode === args.travelClass) : [];
        const row =
          inClass.find((r) => legBookable(r, pax)) ??
          allRows.find((r) => legBookable(r, pax)) ??
          allRows.find((r) => !r.stale && enoughSeats(r, pax)) ??
          inClass.find((r) => r.stale && (r.status === "AVAILABLE" || r.status === "RAC") && enoughSeats(r, pax)) ??
          allRows.find((r) => r.stale && (r.status === "AVAILABLE" || r.status === "RAC") && enoughSeats(r, pax)) ??
          inClass[0] ??
          bestClassRow(board.classes, args.travelClass ?? null);
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
  /* Round-18m-10: har probed connection (bookable ya nahi) — legPlans ke liye. */
  const probedConnections: Connection[] = [];
  let bfeAudit = { trains: 0, stops: 0 };
  if (args.includeConnections || trains.length <= 1) {
    const c = await findConnections(from, to, args.date, { maxHubs: trains.length ? 2 : 3 });
    connections = c.connections;
    c.sources.forEach((s) => sources.add(s));
    (await probeConnectionLegs(connections, args.date, args.travelClass ?? null)).forEach((s) => sources.add(s));
    const found = connections.length;
    probedConnections.push(...connections);
    connections = bookableConnections(connections, pax);
    if (!connections.length && trains.length) {
      const hubs = await routeDerivedHubs(probeList, from, to);
      if (hubs.length) {
        const c2 = await findConnections(from, to, args.date, { hubs, maxHubs: hubs.length, legsPerHub: 5 });
        c2.sources.forEach((s) => sources.add(s));
        (await probeConnectionLegs(c2.connections, args.date, args.travelClass ?? null)).forEach((s) => sources.add(s));
        probedConnections.push(...c2.connections);
        connections = bookableConnections(c2.connections, pax);
      }
    }
    if ((found || trains.length) && !connections.length) notes.push(CONNECTION_NO_SEAT_NOTE);
  }

  const routeOptions = rankRouteOptions({ origin: from, destination: to, trains, availability, classBoards, probed: probedSet, connections, source: provider, travelClass: args.travelClass ?? null, passengers: pax });

  /* Alternative dates: suggestions only — user date never changed. */
  let alternativeDates: JourneyPlan["alternativeDates"] = [];
  /* Round-18m-12: "direct mein seat nahi" SIRF tab jab har direct train ka board
   * mila aur kisi mein bookable nahi. Kuch trains ka data hi nahi aaya
   * (provider fail) to unke liye note — jhooth se "seat nahi" nahi. */
  const anyBookable = [...availability.values()].some((a) => legBookable(a, pax));
  /* Round-18m-12 (user screenshot LDH→SRE: board par AVL 559 ⚠ / AVL 2 ⚠ tha,
   * card ne "koi seat nahi" bola): stale (24h+ cache) AVL/RAC = "seat nahi" NAHI
   * — "available, not fresh — verify" tier. Fresh WL hi sirf "seat nahi". */
  const anyStaleBookable = !anyBookable && [...classBoards.values()].some((rows) => rows.some((r) => r.stale && (r.status === "AVAILABLE" || r.status === "RAC") && enoughSeats(r, pax)));
  const unprobed = trains.filter((t) => !probedSet.has(t.number));
  const directUnavailable = trains.length === 0 || (probedKnown > 0 && !anyBookable && !anyStaleBookable);
  if (anyStaleBookable) notes.push("Kuch direct trains mein seat AVAILABLE dikh rahi hai lekin data 24h+ purana (web cache) hai — Seat check/Refresh se confirm karo, phir book.");
  if (!anyBookable && unprobed.length && trains.length) notes.push(`${unprobed.length} train${unprobed.length > 1 ? "s" : ""} (${unprobed.slice(0, 4).map((t) => t.number).join(", ")}${unprobed.length > 4 ? "…" : ""}) ki seat data provider se nahi aayi — inhe "seat nahi" nahi maana, board par Refresh seats se dobara check karo.`);
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
  /* Round-18m-12: stale-AVL direct ke saath bhi fresh-verified alternatives (bfe/doosri train) nikalo. */
  if (directUnavailable || anyStaleBookable) {
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
        .map((t) => ({ number: t.number, name: t.name, classes: t.classes.map((c) => c.code), directStatus: (() => { const a = availability.get(t.number); return a ? `${a.status}${a.stale ? " (not fresh)" : ""}` : null; })(), durationMinutes: t.durationMinutes ?? null }));
      if (wlDirect.length) {
        /* Round-18m-7: ConfirmTkt jaisa — SAARI direct trains (bounded 10) × pichhle stops × har class. */
        const r = await findBoardFromEarlier({ trains: wlDirect, origin: from, destination: to, date: args.date, travelClass: args.travelClass ?? null, limitTrains: JOURNEY_CONFIG.boardEarlierTrains, passengers: pax });
        boardFromEarlier = r.options;
        bfeAudit = { trains: r.trainsChecked, stops: r.stopsChecked };
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
      probedConnections.push(...connections);
      connections = bookableConnections(connections, pax);
      if (!connections.length) {
        const hubs = await routeDerivedHubs(probeList, from, to);
        if (hubs.length) {
          const c2 = await findConnections(from, to, args.date, { hubs, maxHubs: hubs.length, legsPerHub: 5 });
          c2.sources.forEach((s) => sources.add(s));
          (await probeConnectionLegs(c2.connections, args.date, args.travelClass ?? null)).forEach((s) => sources.add(s));
          probedConnections.push(...c2.connections);
          connections = bookableConnections(c2.connections, pax);
        }
      }
      if (!connections.length && !notes.includes(CONNECTION_NO_SEAT_NOTE)) notes.push(CONNECTION_NO_SEAT_NOTE);
    }
    /* Round-18m-16 (user ConfirmTkt screenshot LDH→INDB, 12920 "Book Upto DADN" → 1A AVL):
     * direct ✗, book-from-earlier ✗, connecting ✗ — TAB destination ke AAGE ke stops tak
     * ticket try karo (utro apne destination par), saari trains × har class, earlier×aage combo bhi.
     * Sirf provider-proven rows; kabhi invent nahi. */
    if (!boardFromEarlier.some((b) => !b.availability.stale) && !connections.length && args.includeBookUpto !== false) {
      try {
        const wl2 = [...trains]
          .sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9) || a.number.localeCompare(b.number))
          .filter((t) => !legBookable(availability.get(t.number), pax))
          .map((t) => ({ number: t.number, name: t.name, classes: t.classes.map((c) => c.code), directStatus: (() => { const a = availability.get(t.number); return a ? `${a.status}${a.stale ? " (not fresh)" : ""}` : null; })(), durationMinutes: t.durationMinutes ?? null }));
        if (wl2.length) {
          const r2 = await findBoardFromEarlier({ trains: wl2, origin: from, destination: to, date: args.date, travelClass: args.travelClass ?? null, limitTrains: JOURNEY_CONFIG.boardEarlierTrains, passengers: pax, mode: "upto" });
          if (r2.options.length) {
            boardFromEarlier = [...boardFromEarlier, ...r2.options];
            notes.push(`Book-upto scan: ${r2.trainsChecked} trains × destination ke aage ${JOURNEY_CONFIG.bookUptoStops} stops tak (${r2.stopsChecked} segments, har class) — ticket aage tak, utro ${to} par.`);
          }
          bfeAudit = { trains: Math.max(bfeAudit.trains, r2.trainsChecked), stops: bfeAudit.stops + r2.stopsChecked };
          r2.sources.forEach((s) => sources.add(s));
        }
      } catch {
        /* skip — never invent */
      }
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
    directStaleAvailable: anyStaleBookable,
    recovery,
    sources: [...sources],
    notes,
    summary: null,
  };
  plan.legPlans = buildLegPlans(probedConnections, pax);
  /* Round-18m-10: top hub ko poore route par expand karo — leg-1 ki HAR train
   * origin→hub, leg-2 ki HAR train hub→destination (seat ke saath), phir AI ka
   * joint best. Bounded (10+10 probes, parallel). */
  if (plan.directUnavailable && plan.legPlans[0] && args.expandLegs !== false) {
    try {
      const top = plan.legPlans[0];
      const off = top.best?.legs[0]?.arrivalDayOffset ?? 0;
      const ex = await expandLegPlan({ from, to, hub: top.hub, hubName: top.hubName, date: args.date, travelClass: args.travelClass ?? null, pax, leg2DayOffset: off });
      ex.sources.forEach((x) => sources.add(x));
      if (ex.plan && ex.plan.leg1.length + ex.plan.leg2.length >= top.leg1.length + top.leg2.length) {
        plan.legPlans[0] = { ...ex.plan, best: ex.plan.best ?? top.best };
        plan.sources = [...sources];
      }
    } catch {
      /* expanded plan optional */
    }
  }
  plan.audit = {
    passengers: pax,
    directTrains: trains.length,
    directProbed: probedKnown,
    bfeTrains: bfeAudit.trains,
    bfeStopsChecked: bfeAudit.stops,
    connHubs: (plan.legPlans ?? []).map((l) => l.hub),
    connLeg1Checked: (plan.legPlans ?? []).reduce((n, l) => n + l.checkedLeg1, 0),
    connLeg2Checked: (plan.legPlans ?? []).reduce((n, l) => n + l.checkedLeg2, 0),
  };
  plan.summary = journeySummary(plan);
  plan.whyPoints = journeyWhyPoints(plan);
  plan.whySource = "rules";
  /* Round-18m-10: "AI ne ye plan kyun chuna" — model khud sochta hai (grounded
   * facts sheet se), deterministic points sirf fallback. Bounded ~8s. */
  /* Round-18m-13: FAISLA AI ka — engine ne har train × har class, same-train
   * earlier-stop aur connecting legs ka data laaya; ab LLM candidates dekh kar
   * recommend + rank + why karta hai (grounded ids). Rules sirf fallback. */
  if (args.aiWhy !== false) {
    try {
      const { decideJourney } = await import("./decide.js");
      const d = await decideJourney(plan, { timeoutMs: 10000 });
      plan.decision = d;
      if (d.source === "ai" && d.recommended) {
        applyDecision(plan, d);
        plan.whyPoints = d.whyPoints.length ? d.whyPoints : plan.whyPoints;
        plan.whySource = "ai";
        plan.summary = journeySummary(plan);
        if (d.verdict) plan.summary = `${d.verdict}${plan.summary ? ` ${plan.summary}` : ""}`;
        return plan;
      }
    } catch {
      /* fall through to legacy why-points */
    }
    try {
      /* Muse (primary) 12s → gpt-oss (fallback) 8s → rules. Total bounded ~20s. */
      const ai = (await aiWhyPoints(plan, { timeoutMs: 12000 }).catch(() => null)) ?? (env.nluModel !== env.nvidiaModel ? await aiWhyPoints(plan, { timeoutMs: 12000, model: env.nluModel }).catch(() => null) : null);
      if (ai && ai.length >= 3) {
        /* 4–5 points chahiye: model ke points pehle, kami rules-based se
         * (jo baat model ne already kahi ho — word-overlap — wo skip). */
        const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9₹]+/g) ?? []);
        const overlap = (a: string, b: string) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
        const merged = [...ai];
        for (const r of plan.whyPoints ?? []) {
          if (merged.length >= 5) break;
          if (merged.every((m) => overlap(m, r) < 0.5)) merged.push(r);
        }
        plan.whyPoints = merged.slice(0, 5);
        plan.whySource = "ai";
      }
    } catch {
      /* rules-based points already set */
    }
  }
  return plan;
}

/* Round-18m-13: AI ke pick ko plan ke existing fields par map karo taaki UI/agent
 * (best, recovery.boardFromEarlier[0], connections[0]) wahi dikhayein jo AI ne chuna. */
function applyDecision(plan: JourneyPlan, d: JourneyDecision): void {
  const rec = d.recommended;
  if (!rec) return;
  const order = new Map(d.ranking.map((id, i) => [id, i]));
  const idOf = (o: RouteOption) => (o.changes === 0 ? `D:${o.trainNumbers[0]}` : null);
  if (rec.kind === "direct") {
    const pick = plan.routeOptions.find((o) => idOf(o) === rec.id);
    if (pick) {
      plan.routeOptions = [pick, ...plan.routeOptions.filter((o) => o !== pick)].map((o, i) => ({ ...o, rank: i + 1, badges: i === 0 ? Array.from(new Set(["best_overall", ...o.badges.filter((b) => b !== "best_overall")])) : o.badges.filter((b) => b !== "best_overall"), category: i === 0 ? "best_overall" : o.category === "best_overall" ? "direct" : o.category }));
      plan.best = plan.routeOptions[0];
      plan.directUnavailable = false;
      /* AI ne direct chuna → same-train earlier-stop hero mat dikhao (list mein rahe). */
      if (plan.recovery) plan.recovery = { ...plan.recovery, boardFromEarlier: plan.recovery.boardFromEarlier ?? [] };
    }
  } else if (rec.kind === "bfe" && plan.recovery?.boardFromEarlier?.length) {
    const list = plan.recovery.boardFromEarlier;
    const pick = list.find((b) => `B:${b.trainNumber}:${b.bookFrom}${b.bookUpto ? `>${b.bookUpto}` : ""}` === rec.id);
    if (pick) plan.recovery = { ...plan.recovery, boardFromEarlier: [pick, ...list.filter((b) => b !== pick)] };
  } else if (rec.kind === "connecting") {
    const all = [...(plan.legPlans ?? []).map((l) => l.best).filter((c): c is Connection => !!c), ...plan.connections, ...(plan.recovery?.connecting ?? [])];
    const pick = all.find((c) => `C:${c.station}:${c.legs.map((l) => l.trainNumber).join("+")}` === rec.id);
    if (pick) {
      plan.connections = [pick, ...plan.connections.filter((c) => c !== pick)];
      if (plan.legPlans?.length) {
        const lp = plan.legPlans.find((l) => l.hub === pick.station);
        if (lp) { lp.best = pick; plan.legPlans = [lp, ...plan.legPlans.filter((x) => x !== lp)]; }
      }
    }
  }
  /* Other direct options follow the AI's ranking where given. */
  plan.routeOptions = [...plan.routeOptions].sort((a, b) => (order.get(idOf(a) ?? "") ?? 99) - (order.get(idOf(b) ?? "") ?? 99) || a.rank - b.rank).map((o, i) => ({ ...o, rank: i + 1 }));
  plan.best = plan.routeOptions[0] ?? plan.best;
}

/* ── Round-18m-10: model-written why-points. Facts sheet = sirf plan ka retrieved
 * data; output har point mein koi na koi fact (train no / class / seats / fare /
 * duration / station) match kare warna drop — hallucinated point kabhi nahi. */
export function whyFactsSheet(plan: JourneyPlan): string {
  const L: string[] = [];
  const pax = plan.query.passengers ?? null;
  const av = (a: RouteAvailability | null | undefined) => (a ? `${a.classCode} ${a.status}${a.seats != null ? ` ${a.seats}` : ""}${a.rac != null ? ` RAC ${a.rac}` : ""}${a.waitlist != null ? ` WL ${a.waitlist}` : ""}${a.fare != null ? ` ₹${a.fare}` : ""}${a.stale ? " (stale)" : ""}` : "no data");
  L.push(`Route ${plan.query.from}→${plan.query.to} on ${plan.query.date}${pax ? `, ${pax} passengers` : ""}${plan.query.travelClass ? `, class pref ${plan.query.travelClass}` : ""}.`);
  const direct = plan.routeOptions.filter((o) => o.changes === 0);
  const staleDirect = direct.filter((o) => o.availability?.stale && enoughSeats(o.availability, pax)).map((o) => o.trainNumbers[0]);
  L.push(`Direct trains checked: ${direct.filter((o) => o.probed !== false).length}/${direct.length} (every class each). ${plan.directUnavailable ? "None has confirmed seat for this party." : plan.directStaleAvailable ? `No FRESH confirmed seat; ${staleDirect.join(", ")} show AVAILABLE only in 24h+ old web cache (must be re-verified before booking — do not call it confirmed).` : "Seat found in direct train."}`);
  if (direct.some((o) => o.probed === false)) L.push(`Seat data missing (not checked, NOT 'no seat'): ${direct.filter((o) => o.probed === false).map((o) => o.trainNumbers[0]).join(", ")}.`);
  if (plan.audit?.bfeStopsChecked) L.push(`Book-from-earlier scan: ${plan.audit.bfeTrains} trains × earlier stops back to each train's origin (${plan.audit.bfeStopsChecked} stop-segments probed, every class).`);
  for (const o of direct.slice(0, 8)) L.push(`- ${o.trainNumbers[0]} ${o.trainNames[0]} dep ${o.departure} arr ${o.arrival}${o.arrivalDayOffset ? ` +${o.arrivalDayOffset}d` : ""} ${o.durationLabel ?? ""} seat: ${av(o.availability)}`);
  const bfe = plan.recovery?.boardFromEarlier ?? [];
  if (bfe.length) {
    L.push(`Book-from-earlier (same train, ticket from an earlier stop, user still boards at ${plan.query.from}):`);
    for (const b of bfe.slice(0, 4)) L.push(`- ${b.trainNumber} ${b.trainName ?? ""} ticket from ${b.bookFrom} (${b.stopsBefore} stops before)${b.bookUpto ? ` upto ${b.bookUpto} (${b.stopsAfter ?? 0} stops AFTER destination, deboard at ${plan.query.to})` : ""} board ${b.boardAt} ${b.boardAtDeparture ?? ""} → ${plan.query.to} ${b.arrival ?? ""} ${durationLabelOf(b.durationMinutes)} seat: ${av(b.availability)}${(b.classOptions ?? []).length > 1 ? `; other classes: ${(b.classOptions ?? []).filter((r) => r.classCode !== b.availability.classCode).map(av).join(", ")}` : ""}`);
  }
  for (const lp of plan.legPlans ?? []) {
    L.push(`Connecting via ${lp.hubName ?? lp.hub} (${lp.hub}): leg-1 ${lp.leg1.length}/${lp.checkedLeg1} trains with seats, leg-2 ${lp.leg2.length}/${lp.checkedLeg2} trains with seats.`);
    if (lp.best) L.push(`- best combo: ${lp.best.legs.map((l) => `${l.trainNumber} ${l.from} ${l.departure}→${l.to} ${l.arrival} ${av(l.availability)}`).join(" | ")} layover ${lp.best.layoverMinutes} min total ${durationLabelOf(lp.best.totalDurationMinutes)}`);
  }
  if (!plan.legPlans?.length && plan.notes.some((n) => /Connecting routes mile lekin/.test(n))) L.push("Connecting routes were checked but no route had seats on both legs.");
  for (const d of plan.alternativeDates.slice(0, 3)) L.push(`Other date ${d.date}: ${d.count} trains${d.seatProof ? `, seat proof ${d.seatProof}` : ""}`);
  const rec = recommendedOf(plan);
  /* Pre-computed comparisons — model inhe articulate kare, khud calculate na kare. */
  const fastest = [...direct].sort((x, y) => (x.durationMinutes ?? 9e9) - (y.durationMinutes ?? 9e9))[0];
  const recDur = rec.kind === "bfe" ? rec.bfe?.durationMinutes ?? null : rec.kind === "connecting" ? rec.conn?.totalDurationMinutes ?? null : plan.best?.durationMinutes ?? null;
  if (fastest?.durationMinutes && recDur != null) {
    const diff = recDur - fastest.durationMinutes;
    L.push(`COMPARISON: fastest direct is ${fastest.trainNumbers[0]} (${fastest.durationLabel}, seat ${av(fastest.availability)}); recommended takes ${durationLabelOf(recDur)} = ${diff <= 0 ? "same/faster" : `${durationLabelOf(diff)} longer`}.`);
  }
  if (rec.kind === "bfe" && rec.bfe) {
    const cheapestWl = [...direct].filter((o) => o.availability?.fare != null).sort((x, y) => x.availability!.fare! - y.availability!.fare!)[0];
    if (cheapestWl?.availability?.fare != null) L.push(`COMPARISON: cheapest direct ticket ${cheapestWl.trainNumbers[0]} ${cheapestWl.availability!.classCode} ₹${cheapestWl.availability!.fare} is WL — recommended ${rec.bfe.availability.classCode} ₹${rec.bfe.availability.fare ?? "?"} is ${rec.bfe.availability.fare != null ? `₹${rec.bfe.availability.fare - cheapestWl.availability!.fare!} more` : "confirmed"} but confirmed.`);
    const conn = plan.legPlans?.[0]?.best;
    if (conn) L.push(`COMPARISON: connecting via ${plan.legPlans![0].hub} takes ${durationLabelOf(conn.totalDurationMinutes)} with a ${conn.layoverMinutes} min change and two tickets — recommended is one train, no change.`);
    L.push(`PRACTICAL: passenger boards at ${rec.bfe.boardAt} as usual; on IRCTC choose boarding point ${rec.bfe.boardAt}; fare counted from ${rec.bfe.bookFrom} (${rec.bfe.stopsBefore} stop earlier) — small extra.`);
    if (rec.bfe.availability.stale) L.push("RISK: recommended seat data is stale (web cache) — re-verify before paying.");
  }
  if (rec.kind === "bfe" && rec.bfe) L.push(`RECOMMENDED PLAN: book-from-earlier — ${rec.bfe.trainNumber} ticket from ${rec.bfe.bookFrom}, board at ${rec.bfe.boardAt}, seat ${av(rec.bfe.availability)}. Direct tickets from ${plan.query.from} on ALL direct trains are WL/RAC/no-data (REJECTED for this party).`);
  else if (rec.kind === "connecting" && rec.conn) L.push(`RECOMMENDED PLAN: connecting via ${rec.conn.station} — ${rec.conn.legs.map((l) => `${l.trainNumber} ${av(l.availability)}`).join(" then ")}. All direct trains REJECTED (no confirmed seat).`);
  else if (rec.kind === "direct" && plan.best) L.push(`RECOMMENDED PLAN: direct ${plan.best.trainNumbers[0]} ${plan.best.durationLabel ?? ""} seat ${av(plan.best.availability)}.`);
  else L.push("RECOMMENDED PLAN: none has a confirmed seat; the least-bad direct option is shown with its WL status. Do NOT claim any seat is confirmed.");
  return L.join("\n");
}

/* Kaunsa plan actually recommend ho raha hai (UI hero ke same rules). */
export function recommendedOf(plan: JourneyPlan): { kind: "direct" | "bfe" | "connecting" | "none"; bfe?: BoardFromEarlierOption | null; conn?: Connection | null } {
  const pax = plan.query.passengers ?? null;
  const bfe = (plan.recovery?.boardFromEarlier ?? []).find((b) => !b.availability.stale) ?? null;
  /* Round-18m-12: same rule as journeySummary/UI — fresh same-train bfe beats a non-fresh
   * (stale) best or a slower connecting best. */
  const best = plan.best;
  const bfeBeatsBest = !!bfe && !!best && (!legBookable(best.availability, pax) || (best.changes > 0 && (bfe.durationMinutes ?? 9e9) <= (best.durationMinutes ?? 9e9)));
  if (bfe && bfeBeatsBest) return { kind: "bfe", bfe };
  if (!plan.directUnavailable && best && (legBookable(best.availability, pax) || (plan.directStaleAvailable && enoughSeats(best.availability, pax)))) return { kind: "direct" };
  if (bfe) return { kind: "bfe", bfe };
  const conn = plan.legPlans?.[0]?.best ?? plan.connections[0] ?? plan.recovery?.connecting?.[0] ?? null;
  if (conn) return { kind: "connecting", conn };
  return { kind: "none" };
}

const WHY_TOKEN_RE = /\b\d{5}\b|\b[A-Z]{2,5}\b|₹\s?\d|\b\d+h\b|\bmin\b|AVL|RAC|WL|seat/;
export async function aiWhyPoints(plan: JourneyPlan, opts: { timeoutMs?: number; model?: string } = {}): Promise<string[] | null> {
  const key = env.nvidiaApiKey;
  if (!key || process.env.VITEST) return null;
  const facts = whyFactsSheet(plan);
  const pax = plan.query.passengers ?? null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 9000);
  try {
    const res = await fetch(`${env.nvidiaBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: opts.model ?? env.nvidiaModel,
        temperature: 0.2,
        max_tokens: 500,
        reasoning_effort: "low",
        messages: [
          {
            role: "system",
            content:
              "You are RailBook's journey planner explaining WHY you recommended a plan to an Indian traveller. Write in Hinglish (Roman Hindi mixed with English, e.g. \"12345 mein XYZ se ticket lene par 2A AVL 36 — 2 logon ke liye confirmed\"), like a smart friend; NOT pure English. Output ONLY a JSON array of 4 to 5 short strings (max 24 words each), no labels/prefixes like COMPARISON:, each a complete Hinglish sentence a traveller would understand. Explain the RECOMMENDED PLAN line only, using the COMPARISON/PRACTICAL/RISK lines for substance (what was rejected and why, time/cost trade-off, how to book, risk); trains marked REJECTED/WL must never be described as having a seat. Each point must be a genuinely important, decision-relevant reason grounded ONLY in the facts sheet: seat certainty for the party size, speed vs alternatives, what was checked and rejected, cost/class trade-offs, boarding/IRCTC practicalities, risk (stale data / RAC / layover). Never invent trains, seats, fares, or times not in the sheet; seat counts (AVL 36) are seats, never money; never say 'per person'. No markdown.",
          },
          { role: "user", content: `FACTS:\n${facts}\n\nReturn the JSON array now.` },
        ],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const raw = String(j.choices?.[0]?.message?.content ?? "");
    if (process.env.WHY_DEBUG) console.error("[aiWhy raw]", raw.slice(0, 1200));
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(arr)) return null;
    const factTokens = new Set((facts.match(/\b\d{5}\b|\b[A-Z]{2,5}\b|₹\s?\d+/g) ?? []).map((t) => t.replace(/\s+/g, "")));
    /* Grounding-2: jin trains mein pax ke liye seat NAHI (direct WL/RAC/no-data),
     * unke saath "confirmed/available/AVL" claim → point drop. */
    const noSeat = new Set(plan.routeOptions.filter((o) => o.changes === 0 && !legBookable(o.availability, pax)).map((o) => o.trainNumbers[0]));
    const seatOk = new Set<string>();
    for (const b of plan.recovery?.boardFromEarlier ?? []) if (!b.availability.stale) seatOk.add(b.trainNumber);
    for (const lp of plan.legPlans ?? []) for (const l of [...lp.leg1, ...lp.leg2]) seatOk.add(l.trainNumber);
    for (const c of plan.connections) for (const l of c.legs) seatOk.add(l.trainNumber);
    const CONFIRM_RE = /confirm|available|\bAVL\b|seat certainty|seat (?:hai|milegi|mil rahi)|guaranteed/i;
    const rec0 = recommendedOf(plan);
    const fastest0 = [...plan.routeOptions].filter((o) => o.changes === 0).sort((x, y) => (x.durationMinutes ?? 9e9) - (y.durationMinutes ?? 9e9))[0];
    const recDur0 = rec0.kind === "bfe" ? rec0.bfe?.durationMinutes ?? null : rec0.kind === "connecting" ? rec0.conn?.totalDurationMinutes ?? null : plan.best?.durationMinutes ?? null;
    const recIsFastest = !fastest0?.durationMinutes || recDur0 == null || recDur0 <= fastest0.durationMinutes + 15;
    /* Grounding-3: ₹ ke saath likha har number plan ka REAL fare ho (36 seats ko "36₹" banana → drop). */
    const fares = new Set<number>();
    const addFare = (a?: RouteAvailability | null) => { if (a?.fare != null) fares.add(a.fare); };
    for (const o of plan.routeOptions) addFare(o.availability);
    for (const b of plan.recovery?.boardFromEarlier ?? []) { addFare(b.availability); for (const r of b.classOptions ?? []) addFare(r); }
    for (const lp of plan.legPlans ?? []) for (const l of [...lp.leg1, ...lp.leg2]) { addFare(l.availability); for (const r of l.classOptions ?? []) addFare(r); }
    for (const c of plan.connections) for (const l of c.legs) { addFare(l.availability); for (const r of l.classOptions ?? []) addFare(r); }
    const rupeeOk = (x: string) => {
      const found = [...x.matchAll(/₹\s?(\d[\d,]*)|(\d[\d,]*)\s?₹|\bRs\.?\s?(\d[\d,]*)|(\d[\d,]*)\s?(?:rupees|rupaye)/gi)].map((m) => Number((m[1] ?? m[2] ?? m[3] ?? m[4]).replace(/,/g, "")));
      return found.every((n) => fares.has(n));
    };
    const out = arr
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim().replace(/^[-•*]\s*/, "").replace(/^(?:COMPARISON|PRACTICAL|RISK|TIME\/COST|COST|TIME|SEAT|BOOKING|WHY)\s*[:\-–]\s*/i, ""))
      .filter((x) => x.length >= 12 && x.length <= 220)
      .filter((x) => {
        const nums = x.match(/\b\d{5}\b/g) ?? [];
        if (!nums.every((n) => factTokens.has(n)) || !WHY_TOKEN_RE.test(x) || !rupeeOk(x)) return false;
        const trainsIn = x.match(/\b\d{5}\b/g) ?? [];
        if (CONFIRM_RE.test(x) && trainsIn.some((t) => noSeat.has(t) && !seatOk.has(t)) && !/\b(WL|waitlist|nahi|not|no seat|rejected)\b/i.test(x)) return false;
        /* "fastest" claim sirf tab jab recommended sach mein fastest ke barabar ho. */
        if (/\b(fastest|sabse (?:fast|tez|jaldi)|quickest)\b/i.test(x) && !recIsFastest && !/\b(but|lekin|par|though|nahi|not|slower|longer)\b/i.test(x)) return false;
        return true;
      });
    if (process.env.WHY_DEBUG) console.error("[aiWhy kept]", out);
    return out.length >= 3 ? out.slice(0, 5) : null;
  } finally {
    clearTimeout(timer);
  }
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
  const bfeBeats = !!bfe && !!best && (!legBookable(best.availability, pax) || (best.changes > 0 && (bfe.durationMinutes ?? 9e9) <= (best.durationMinutes ?? 9e9)));
  if (bfe && (plan.directUnavailable || bfeBeats)) {
    const wlCount = direct.filter((o) => o.availability && !legBookable(o.availability, pax)).length;
    const staleAvl = direct.filter((o) => o.availability?.stale && enoughSeats(o.availability, pax)).map((o) => o.trainNumbers[0]);
    pts.push(`${plan.query.from}→${plan.query.to} par ${wlCount || direct.length} direct train${(wlCount || direct.length) > 1 ? "s" : ""} ki har class check ki — kisi mein${paxTxt ? ` ${paxTxt} ke liye` : ""} FRESH confirmed seat nahi${staleAvl.length ? ` (${staleAvl.slice(0, 3).join(", ")} mein AVL sirf 24h+ purane web-cache mein — Seat check se verify karo)` : " (WL/N-A)"}.`);
    if (bfe.bookUpto) pts.push(`${bfe.trainNumber} mein ticket ${bfe.bookFrom}→${bfe.bookUpto} tak (${bfe.stopsAfter ?? 0} stop aage) lene par ${seatTxt(bfe.availability)}${bfe.availability.fare != null ? ` @ ₹${bfe.availability.fare}` : ""} — aap ${plan.query.to} par utar jaayenge; ${plan.query.from}→${plan.query.to} segment par seat nahi thi. Provider-verified.`);
    else pts.push(`${bfe.trainNumber} mein ${bfe.bookFrom} (${bfe.stopsBefore} stop pehle) se ticket lene par ${seatTxt(bfe.availability)}${bfe.availability.fare != null ? ` @ ₹${bfe.availability.fare}` : ""} — provider-verified, fresh data.`);
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
    if (best.availability) pts.push(legBookable(best.availability, pax) ? `${seatTxt(best.availability)}${best.availability.fare != null ? ` @ ₹${best.availability.fare}` : ""} — provider-verified${paxTxt ? `, ${paxTxt} ke liye kaafi` : ""}.` : best.availability.stale && enoughSeats(best.availability, pax) ? `${seatTxt(best.availability)} dikh rahi hai lekin data 24h+ purana (web cache) hai — Seat check se refresh karke confirm karo, phir book.` : `Seat status ${seatTxt(best.availability)} — confirmed nahi; ye sabse kam WL/fastest option hai.`);
    const racRows = (best.classOptions ?? []).filter((r) => r.status === "RAC" && r.classCode !== best.availability?.classCode && !r.stale);
    if (racRows.length && (pax ?? 1) <= 2) pts.push(`Isi train mein ${racRows.map(seatTxt).join(", ")} bhi option hai — RAC = seat pakki, berth chart ke baad.`);
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
  const st = a.stale ? " (not fresh — verify)" : "";
  if (a.status === "AVAILABLE") return `${a.classCode} ${a.seats != null ? `${a.seats} seats open` : "available"}${st}`;
  if (a.status === "RAC") return `${a.classCode} RAC${a.rac != null ? ` ${a.rac}` : ""}${st}`;
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
