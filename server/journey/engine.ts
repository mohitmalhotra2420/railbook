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
import {
  CLASS_CODES,
  durationLabelOf,
  minutesOf,
  type Connection,
  type JourneyPlan,
  type PartialRoutePlan,
  type PartialSegment,
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
};

const AVAIL_RANK: Record<string, number> = { AVAILABLE: 0, RAC: 1, WAITLIST: 2, UNKNOWN: 3, NOT_AVAILABLE: 4 };

function availScore(a: RouteAvailability | null): number {
  if (!a) return 9;
  const base = AVAIL_RANK[a.status] ?? 5;
  return base * 10000 - (a.status === "AVAILABLE" ? Math.min(a.seats ?? 0, 9999) : 0);
}

function toLeg(t: TrainResult): RouteLeg {
  return {
    trainNumber: t.number,
    trainName: t.name,
    from: t.from.code,
    to: t.to.code,
    departure: t.departure,
    arrival: t.arrival,
    arrivalDayOffset: t.arrivalDayOffset || 0,
    durationMinutes: t.durationMinutes ?? null,
  };
}

function bestClassRow(classes: ClassAvailability[], travelClass: string | null): RouteAvailability | null {
  const known = classes.filter((c) => c.status && c.status !== "UNKNOWN");
  if (!known.length) return null;
  const pick =
    (travelClass ? known.find((c) => c.code === travelClass) : undefined) ??
    [...known].sort((a, b) => (AVAIL_RANK[a.status] ?? 5) - (AVAIL_RANK[b.status] ?? 5) || (a.fare || 9e9) - (b.fare || 9e9))[0];
  return {
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
      availability: null,
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
  const overall = [...base].sort(
    (a, b) =>
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

export async function findConnections(
  from: string,
  to: string,
  date: string,
  opts: { hubs?: string[]; maxHubs?: number; legsPerHub?: number } = {},
): Promise<{ connections: Connection[]; hubsTried: string[]; sources: Set<string> }> {
  const hubs = (opts.hubs ?? JOURNEY_CONFIG.connectionHubs).filter((h) => h !== from && h !== to).slice(0, opts.maxHubs ?? 3);
  const legsPerHub = opts.legsPerHub ?? 4;
  const out: Connection[] = [];
  const sources = new Set<string>();
  for (const hub of hubs) {
    try {
      const [a, b] = await Promise.all([searchTrainsRouted({ from, to: hub, date }), searchTrainsRouted({ from: hub, to, date })]);
      if (a.provider !== "none") sources.add(a.provider);
      if (b.provider !== "none") sources.add(b.provider);
      const legA = [...a.trains].sort((x, y) => x.departure.localeCompare(y.departure)).slice(0, legsPerHub);
      const legB = [...b.trains].sort((x, y) => x.departure.localeCompare(y.departure)).slice(0, legsPerHub + 2);
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
    if (out.length >= 6) break;
  }
  out.sort((x, y) => (x.totalDurationMinutes ?? 9e9) - (y.totalDurationMinutes ?? 9e9) || x.layoverMinutes - y.layoverMinutes || x.arrivalTrain.localeCompare(y.arrivalTrain));
  return { connections: out.slice(0, 4), hubsTried: hubs, sources };
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
  trains?: TrainResult[];
  searchProvider?: ServedProvider;
}): Promise<JourneyPlan> {
  const notes: string[] = [];
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
  const probeList = [...trains].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9) || a.number.localeCompare(b.number)).slice(0, JOURNEY_CONFIG.availabilityProbeLimit);
  await Promise.all(
    probeList.map(async (t) => {
      try {
        const hint = args.travelClass ? [args.travelClass] : t.classes.map((c) => c.code);
        const board = await routedClassBoard(t.number, args.date, from, to, "GN", hint);
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
  }

  const routeOptions = rankRouteOptions({ origin: from, destination: to, trains, availability, connections, source: provider, travelClass: args.travelClass ?? null });

  /* Alternative dates: suggestions only — user date never changed. */
  let alternativeDates: JourneyPlan["alternativeDates"] = [];
  const directUnavailable =
    trains.length === 0 ||
    (probedKnown > 0 && ![...availability.values()].some((a) => a && (a.status === "AVAILABLE" || a.status === "RAC")));
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
        return { date: dd, count: alt.trains.length, fastest: fastest ? { number: fastest.number, durationMinutes: fastest.durationMinutes } : null, ...(alt.provider === "none" ? { providerFailed: true } : {}) };
      }),
    );
  }

  /* Recovery block. */
  let recovery: JourneyPlan["recovery"] = null;
  if (directUnavailable) {
    const differentTrain = routeOptions.filter((o) => o.changes === 0 && o.availability && (o.availability.status === "AVAILABLE" || o.availability.status === "RAC"));
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
    if (!connections.length) {
      const c = await findConnections(from, to, args.date, { maxHubs: 3 });
      connections = c.connections;
      c.sources.forEach((s) => sources.add(s));
    }
    recovery = {
      reason: trains.length === 0 ? "Koi direct train nahi mili." : `Direct trains mein ${args.travelClass ?? "kisi class"} mein AVAILABLE/RAC seat nahi (verified ${probedKnown} trains).`,
      differentTrain,
      partialRoute: partial,
      connecting: connections,
      alternativeDates,
    };
  }
  if (!trains.length && provider === "none") notes.push("Railway data source unavailable — RailCore/RailKit/RailRadar/web sab se jawab nahi mila.");

  return {
    query: { from, to, date: args.date, travelClass: args.travelClass ?? null, preference: args.preference ?? "best_overall" },
    best: routeOptions[0] ?? null,
    routeOptions,
    connections,
    alternativeDates,
    directUnavailable,
    recovery,
    sources: [...sources],
    notes,
  };
}

export const __test = { availScore, bestClassRow, toLeg };
void env;
