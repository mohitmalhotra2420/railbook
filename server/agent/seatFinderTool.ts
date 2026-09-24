/* FIND_SEATS — AI khud seat sawaal ka jawab deta hai (24 Sep 2026).
 *
 * User: "Haan yeh kro — do not specific to 2A, user kuch bhi pooch sakta hai. Mujhe chahiye AI sabh
 *        handle kare — query AI ke paas jaaye aur wo decide kare kaunsa tool use karna hai."
 *
 * Isliye: ye ek NAYA read-only tool hai jo AI khud call karta hai jab user seat/class/availability
 * ke saare trains par poochhe ("2A me kaunsi train me seat hai", "AC trains", "sabse sasti seat wali",
 * "raat 9 ke baad sleeper me seat", "is train me seat hai kya", "sirf confirmed wali"). AI args khud
 * banata hai (class, route, date, filter, sort) — server sirf LIVE data laata hai:
 *   • route board  = routedRouteBoard()  — wahi jo /api/availability route-board chalata hai
 *   • per-train     = routedClassBoard() — wahi jo CHECK_AVAILABILITY aur TrainBoard "Refresh" use karte hain
 *   • ranking       = pickSeatRows()/seatSummaryLine() (pehle se maujoodh seat layer)
 * Koi naya endpoint nahi, koi provider/planner change nahi, kuch invent nahi — sirf asli rows.
 *
 * Filters (AI in sab ko samajhkar bhejta hai):
 *   class_code: "ALL" | "AC" | "1A"|"2A"|"3A"|"3E"|"SL"|"CC"|"EC"|"2S" (comma-separated bhi)
 *   only_available: true = sirf AVAILABLE/RAC · false = WL/N-A bhi
 *   depart_after: "17:00" ya "5 baje ke baad" (narrative bhi chalega — server khud parse karta hai)
 *   sort_by: "cheapest" | "fastest" | null
 *   train_numbers: sirf in trains par (jaise "12029,12497")
 */
import { getProvider } from "../providers/index.js";
import { routedClassBoard, routedRouteBoard, routedStationSearch } from "../railway/router.js";
import { searchStations as searchLocalStations } from "../data/stations.js";
import {
  AC_CLASSES,
  TIME_WINDOWS,
  beforeMinute as parseBeforeMinute,
  departAfterMinute as parseDepartAfter,
} from "../understand/seatIntent.js";
import { pickSeatRows, seatSummaryLine, type SeatBoardClass, type SeatBoardTrain, type SeatFilterRow } from "./seatFilter.js";

export interface FindSeatsArgs {
  from: string;
  to: string;
  date: string;
  class_code?: string | null;
  only_available?: boolean | null;
  depart_after?: string | number | null;
  /** Round-19: "subah/dopahar/shaam/raat" bhi yahan aa sakta hai (window ban jaata hai) aur
   *  "12 se pehle" wala upper bound. */
  depart_before?: string | number | null;
  sort_by?: "cheapest" | "fastest" | null;
  train_numbers?: string | string[] | null;
  quota?: string | null;
  passengers?: number | null;
}

export interface FindSeatsResult {
  ok: boolean;
  source: string | null;
  summary: string;
  data: unknown;
}

const CLASS_RE = /^[A-Z0-9]{1,3}$/;

/** "AC" / "ALL" / "2A" / "2A,3A" → class code list (khaali = sab). */
export function classesFromArg(raw: string | null | undefined): string[] {
  const t = String(raw ?? "").trim().toUpperCase();
  if (!t || t === "ALL" || t === "SAB" || t === "ANY") return [];
  if (t === "AC") return [...AC_CLASSES];
  return t
    .split(/[\s,+/]+/)
    .map((c) => c.trim())
    .filter((c) => CLASS_RE.test(c));
}

/** "17:00" / "5 baje ke baad" / "raat 9 ke baad" → minute of day. */
export function minutesFromArg(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw >= 0 && raw <= 1439 ? Math.round(raw) : null;
  const t = String(raw).trim();
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    return h <= 23 && m <= 59 ? h * 60 + m : null;
  }
  return parseDepartAfter(t); /* "5 baje ke baad", "रात 9 के बाद", "after 5" — wahi server parser */
}

/** Round-19: shabd wala time window ("subah", "shaam", "raat", "morning") → {after, before, label}.
 *  `before` agar `after` se chhota ho to window raat ki tarah wrap karta hai (21:00 → 04:00). */
export function timeWindowFromWord(raw: string | null | undefined): { after: number; before: number; label: string } | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (/\d/.test(t)) return null; /* ghadi boli gayi — minutesFromArg ka kaam */
  for (const w of TIME_WINDOWS) if (w.re.test(t)) return { after: w.after, before: w.before, label: w.label };
  return null;
}

async function stationCode(raw: string): Promise<string | null> {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^[A-Z0-9]{2,5}$/.test(s) && /[A-Z]/.test(s)) return s.toUpperCase();
  const local = searchLocalStations(s);
  if (local.length) return local[0].code;
  try {
    const res = await routedStationSearch(s);
    if (res.stations?.length) return res.stations[0].code;
  } catch {
    /* station lookup fail — neeche null */
  }
  return null;
}

/**
 * AI ke args se seat jawab. Sirf live rows — jo na mile wo saaf likha jaata hai, gadha nahi jaata.
 */
export async function runFindSeatsTool(args: FindSeatsArgs): Promise<FindSeatsResult> {
  const from = await stationCode(args.from);
  const to = await stationCode(args.to);
  const date = String(args.date ?? "").trim();
  if (!from || !to) {
    return { ok: false, source: null, summary: `Station resolve nahi hua (from="${args.from}", to="${args.to}") — user se poochho.`, data: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, source: null, summary: `Date "${args.date}" valid nahi — user se poochho (YYYY-MM-DD).`, data: null };
  }

  const classCodes = classesFromArg(args.class_code);
  const onlyAvailable = args.only_available !== false; /* default: seat wali (AVL/RAC) */
  /* Round-19: AI ne "subah"/"shaam"/"raat" bheja ho to poora WINDOW banao (warna sirf "ke baad"). */
  const wordWindow = timeWindowFromWord(args.depart_after == null ? null : String(args.depart_after));
  const departAfterMinute = wordWindow ? wordWindow.after : minutesFromArg(args.depart_after);
  const departBeforeMinute = wordWindow
    ? wordWindow.before
    : minutesFromArg(args.depart_before) ?? (args.depart_before == null || typeof args.depart_before === "number" ? null : parseBeforeMinute(String(args.depart_before)));
  const windowLabel =
    wordWindow?.label ??
    (args.depart_before != null && departBeforeMinute != null && departAfterMinute == null
      ? `${String(Math.floor(departBeforeMinute / 60)).padStart(2, "0")}:${String(departBeforeMinute % 60).padStart(2, "0")} se pehle`
      : null);
  const sortBy = args.sort_by === "cheapest" || args.sort_by === "fastest" ? args.sort_by : null;
  const quota = (args.quota ?? "GN").toString().toUpperCase().slice(0, 2) || "GN";
  const wantTrains = (Array.isArray(args.train_numbers) ? args.train_numbers : String(args.train_numbers ?? "").split(/[\s,]+/))
    .map((n) => String(n).trim())
    .filter((n) => /^\d{4,5}$/.test(n));

  const board = await routedRouteBoard(from, to, date, []).catch(() => null);
  if (!board || !board.trains.length) {
    return {
      ok: false,
      source: board?.provider ?? null,
      summary: `Route board ${from}→${to} (${date}) abhi nahi aayi (provider busy ya is din koi train nahi) — seat ka dawa mat karo, user ko bolo dobara try kare.`,
      data: { from, to, date },
    };
  }

  /* Per-train board: jo train maangi gayi class ke liye missing/UNKNOWN hai, uska poora board laao.
   * Bounded (6 trains, 3 ek saath) taaki jawab jaldi aaye. */
  const timeBudgetMs = 25000;
  const started = Date.now();
  const needBoard = (t: SeatBoardTrain): boolean => {
    const rows = (t.classes ?? []).filter((c) => String(c.classCode ?? c.code ?? "").trim());
    const codeOf = (c: SeatBoardClass) => String(c.classCode ?? c.code ?? "").trim().toUpperCase();
    if (classCodes.length) return classCodes.some((want) => !rows.some((c) => codeOf(c) === want && String(c.status ?? "UNKNOWN").toUpperCase() !== "UNKNOWN"));
    return rows.length <= 1 || rows.some((c) => String(c.status ?? "UNKNOWN").toUpperCase() === "UNKNOWN");
  };
  const targets = board.trains
    .filter((t) => (wantTrains.length ? wantTrains.includes(String(t.trainNumber ?? "").trim()) : true))
    .filter((t) => needBoard(t as SeatBoardTrain))
    .map((t) => String(t.trainNumber ?? "").trim())
    .slice(0, 6);

  const enriched = new Map<string, SeatBoardClass[]>();
  for (let i = 0; i < targets.length; i += 3) {
    if (Date.now() - started > timeBudgetMs) break;
    const batch = targets.slice(i, i + 3);
    const got = await Promise.all(
      batch.map(async (n) => {
        try {
          const b = await routedClassBoard(n, date, from, to, quota);
          return b.classes.filter((c) => String(c.status ?? "UNKNOWN").toUpperCase() !== "UNKNOWN") as SeatBoardClass[];
        } catch {
          return [] as SeatBoardClass[];
        }
      }),
    );
    batch.forEach((n, idx) => {
      if (got[idx].length) enriched.set(n, got[idx]);
    });
  }

  const trains: SeatBoardTrain[] = board.trains.map((t) => {
    const key = String(t.trainNumber ?? "").trim();
    const base = (t.classes ?? []) as SeatBoardClass[];
    const more = enriched.get(key);
    if (!more) return { trainNumber: key, trainName: t.trainName ?? "", classes: base };
    const codeOf = (c: SeatBoardClass) => String(c.classCode ?? c.code ?? "").trim().toUpperCase();
    const out = base.slice();
    const at = new Map(out.map((c, i) => [codeOf(c), i]));
    for (const c of more) {
      const code = codeOf(c);
      const i = at.get(code);
      if (i == null) out.push(c);
      else if (String(out[i].status ?? "UNKNOWN").toUpperCase() === "UNKNOWN") out[i] = c;
    }
    return { trainNumber: key, trainName: t.trainName ?? "", classes: out };
  });

  const pool = wantTrains.length ? trains.filter((t) => wantTrains.includes(String(t.trainNumber ?? "").trim())) : trains;
  const timesNeeded = departAfterMinute != null || departBeforeMinute != null || sortBy === "fastest";
  let times: Map<string, { departure?: string | null; arrival?: string | null; durationMinutes?: number | null }> | undefined;
  if (timesNeeded) {
    try {
      const list = await getProvider().searchTrains({ from, to, date });
      times = new Map(
        list.map((t) => [
          String(t.number),
          { departure: t.departure ?? null, arrival: t.arrival ?? null, durationMinutes: t.durationMinutes ?? null },
        ]),
      );
    } catch {
      times = undefined;
    }
  }

  const slots = {
    classCodes,
    classGroup: classCodes.length && String(args.class_code ?? "").toUpperCase() === "AC" ? ("AC" as const) : null,
    onlyAvailable,
    departAfterMinute,
    departBeforeMinute,
    windowLabel,
    sortBy,
  };
  const pick = pickSeatRows(pool, slots, times);
  /* WL rows alag se (onlyAvailable par bhi), taaki "seat nahi par WL itni" sach bata sake. */
  const wlPick = onlyAvailable
    ? pickSeatRows(pool, { ...slots, onlyAvailable: false }, times)
    : pick;
  const head = seatSummaryLine({ ...pick, wl: wlPick.wl }, slots, { from, to });

  const fmt = (r: SeatFilterRow) =>
    `${r.number} ${r.name} · ${r.classCode} · ${r.status === "AVAILABLE" ? `AVAILABLE ${r.seats ?? "?"} seats` : r.status === "RAC" ? `RAC ${r.rac ?? "?"}` : r.status === "WAITLIST" ? `WL ${r.waitlist ?? "?"}` : "N/A"}${r.fare != null ? ` · ₹${r.fare}` : ""}${r.departure ? ` · ${r.departure}` : ""}`;

  const lines: string[] = [head];
  if (pick.seat.length) lines.push(`SEAT (${pick.seat.length} rows): ${pick.seat.slice(0, 8).map(fmt).join(" | ")}`);
  if (wlPick.wl.length) lines.push(`WAITLIST/N-A (${wlPick.wl.length} rows, confirm% NAHI batana): ${wlPick.wl.slice(0, 8).map(fmt).join(" | ")}`);
  if (pick.missingClass) lines.push(`${pick.missingClass} trains me ye class hi nahi hai — unhe "seat nahi" mat maano.`);
  if (pick.unknownTime) lines.push(`${pick.unknownTime} rows ka time nahi mila (time filter laga tha).`);
  lines.push(`Source: ${board.provider ?? "live board"} · ${pool.length} trains dekhe (${enriched.size} ka alag board check kiya).`);

  return {
    ok: true,
    source: board.provider ?? null,
    summary: lines.join("\n"),
    data: {
      from,
      to,
      date,
      classCodes,
      onlyAvailable,
      departAfterMinute,
      departBeforeMinute,
      windowLabel,
      sortBy,
      trainNumbers: wantTrains,
      trainsSeen: pool.length,
      enriched: enriched.size,
      rows: pick.seat,
      wlRows: wlPick.wl,
      missingClass: pick.missingClass,
      unknownTime: pick.unknownTime,
      summary: head,
    },
  };
}

/** Tool description — dono agents (agentic + autonomous) isi ko use karte hain. */
export const FIND_SEATS_DESCRIPTION =
  "Ek route ke SAARE trains par seat/class/availability ka jawab ek call me (live board + per-train check). " +
  "Jab user seat/berth/class/availability ya 'kis train me seat hai' poochhe — jaise '2A me seat kaunsi train me hai', " +
  "'AC trains dikhao', 'sabse sasti seat wali train', 'raat 9 ke baad sleeper me seat', 'sirf confirmed wali dikhao', " +
  "'12029 me seat hai kya' — to PEHLE ye tool call karo aur uske result se hi jawab do (kabhi memory se seat mat batao). " +
  "Args: class_code = 'ALL' | 'AC' (1A/2A/3A/3E/CC/EC) | '2A','3A','SL','CC','EC','2S','3E','1A' (comma se kai); " +
  "only_available = true sirf AVAILABLE+RAC, false to WL/N-A bhi; " +
  "TIME FILTER — user ne waqt bola ho to ye ZAROOR bhejo: depart_after = 'subah' | 'dopahar' | 'shaam' | 'raat' (poora window) " +
  "YA '17:00' / '5 baje ke baad'; depart_before = '12:00' / '12 baje se pehle'. " +
  "'subah ki trains batao' jaisa sawaal aaye to poora din ka jawab MAT do — usi window ki trains batao. " +
  "sort_by = 'cheapest' | 'fastest'; train_numbers = sirf in trains par (comma-separated). " +
  "WL ka confirm% kabhi mat batao (data nahi hai) — sirf WL number.";

export const FIND_SEATS_PARAMETERS = {
  type: "object",
  properties: {
    from: { type: "string", description: "Origin station code (LDH) ya city naam (Ludhiana)" },
    to: { type: "string", description: "Destination station code (BEAS) ya city naam (Beas)" },
    date: { type: "string", description: "Journey date YYYY-MM-DD" },
    class_code: { type: "string", description: "'ALL' | 'AC' | '1A'|'2A'|'3A'|'3E'|'SL'|'CC'|'EC'|'2S' (comma-separated bhi)" },
    only_available: { type: "boolean", description: "true = sirf AVAILABLE/RAC (default true); false = WL/N-A bhi dikhao" },
    depart_after: { type: "string", description: "Window ka shabd ('subah' | 'dopahar' | 'shaam' | 'raat') ya '17:00' / '5 baje ke baad' / 'raat 9 ke baad'" },
    depart_before: { type: "string", description: "'12:00' ya '12 baje se pehle' (is waqt se pehle wali trains)" },
    sort_by: { type: "string", description: "'cheapest' (sabse sasta) ya 'fastest' (sabse kam time)" },
    train_numbers: { type: "string", description: "Sirf in trains par — comma-separated (jaise '12029,12497')" },
    quota: { type: "string", description: "GN (default) | TQ (tatkal) | PT (premium tatkal) | LD (ladies)" },
    passengers: { type: "number", description: "Kitne log (1-6) — sirf jawab me context ke liye" },
  },
  required: ["from", "to", "date"],
} as const;
