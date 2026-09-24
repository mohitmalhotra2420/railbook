/* Seat filter — server side (24 Sep 2026).
 *
 * User: "seat intent questions AI khud samjhe and filter kare … baaki AI ka search karne ka way,
 *        tools calling ka way, API calling ka way, alternatives/connecting journeys ka logic
 *        mat change karna."
 *
 * Isliye: yahan sirf **padhne wale** helpers hain —
 *   1) pickSeatRows()  : pehle se maujood route-board rows (live board) ko class/status/time se filter.
 *   2) seatSummaryLine(): AI ke jawab me lagne wali chhoti line (asli numbers, koi andaza nahi).
 *   3) seatFilterFor() : board (aur zaroorat par trains list) ko maujooda provider/router se LAATA hai —
 *                        koi naya endpoint, koi tool-registry change, koi journey-engine change nahi.
 *
 * WL ka confirm% hum nahi dete (data hai hi nahi) — sirf asli WL number.
 */
import { getProvider } from "../providers/index.js";
import { routedRouteBoard } from "../railway/router.js";
import type { SeatIntentSlots } from "../understand/seatIntent.js";

export interface SeatBoardClass {
  code?: string | null;
  classCode?: string | null;
  label?: string | null;
  status?: string | null;
  seats?: number | null;
  rac?: number | null;
  waitlist?: number | null;
  fare?: number | null;
  source?: string | null;
}
export interface SeatBoardTrain {
  trainNumber?: string | null;
  trainName?: string | null;
  classes?: SeatBoardClass[] | null;
}
export interface SeatTrainTimes {
  departure?: string | null;
  arrival?: string | null;
  durationMinutes?: number | null;
}

export interface SeatFilterRow {
  number: string;
  name: string;
  classCode: string;
  status: string;
  seats: number | null;
  rac: number | null;
  waitlist: number | null;
  fare: number | null;
  departure: string | null;
  durationMinutes: number | null;
}

export interface SeatPickResult {
  seat: SeatFilterRow[];
  wl: SeatFilterRow[];
  /** class filter me jinke paas wo class hi nahi (data honest rahe). */
  missingClass: number;
  /** departAfter ke saath: jin trains ka time hi nahi mila. */
  unknownTime: number;
}

const codeOf = (c: SeatBoardClass): string => String(c.classCode ?? c.code ?? "").trim().toUpperCase();
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const depMin = (r: SeatFilterRow): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec(r.departure ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 9e9;
};
const rank = (s: string) => (s === "AVAILABLE" ? 0 : s === "RAC" ? 1 : s === "WAITLIST" ? 2 : 3);

/** Pehle se maujood rows ko filter karna — koi network call nahi, koi guess nahi. */
export function pickSeatRows(
  trains: SeatBoardTrain[],
  slots: Pick<SeatIntentSlots, "classCodes" | "onlyAvailable" | "departAfterMinute" | "sortBy">,
  times?: Map<string, SeatTrainTimes>,
): SeatPickResult {
  const wantClass = (slots.classCodes ?? []).map((c) => c.toUpperCase());
  const seat: SeatFilterRow[] = [];
  const wl: SeatFilterRow[] = [];
  let missingClass = 0;
  let unknownTime = 0;

  for (const t of trains) {
    const number = String(t.trainNumber ?? "").trim();
    if (!number) continue;
    const all = (t.classes ?? []).filter((c) => codeOf(c));
    const rows = wantClass.length ? all.filter((c) => wantClass.includes(codeOf(c))) : all;
    if (!rows.length) {
      if (wantClass.length) missingClass += 1;
      continue;
    }
    const tm = times?.get(number);
    for (const c of rows) {
      const status = String(c.status ?? "UNKNOWN").toUpperCase();
      const isSeat = status === "AVAILABLE" || status === "RAC";
      if (slots.onlyAvailable && !isSeat) continue;
      const row: SeatFilterRow = {
        number,
        name: String(t.trainName ?? ""),
        classCode: codeOf(c) || "—",
        status,
        seats: num(c.seats),
        rac: num(c.rac),
        waitlist: num(c.waitlist),
        fare: num(c.fare),
        departure: tm?.departure ?? null,
        durationMinutes: num(tm?.durationMinutes),
      };
      /* "5 baje ke baad": time pata ho to hi filter karo; pata nahi to seat list se hata do (jhooth na bole). */
      if (slots.departAfterMinute != null && row.departure == null) {
        unknownTime += 1;
        continue;
      }
      if (isSeat) {
        if (slots.departAfterMinute != null && depMin(row) < slots.departAfterMinute) continue;
        seat.push(row);
      } else {
        if (slots.departAfterMinute != null && depMin(row) < slots.departAfterMinute) continue;
        wl.push(row);
      }
    }
  }

  const byTime = (a: SeatFilterRow, b: SeatFilterRow) => depMin(a) - depMin(b);
  if (slots.sortBy === "cheapest") {
    const fare = (a: SeatFilterRow, b: SeatFilterRow) => (a.fare ?? Number.POSITIVE_INFINITY) - (b.fare ?? Number.POSITIVE_INFINITY);
    seat.sort((a, b) => fare(a, b) || byTime(a, b));
    wl.sort((a, b) => fare(a, b) || byTime(a, b));
  } else if (slots.sortBy === "fastest") {
    const dur = (a: SeatFilterRow, b: SeatFilterRow) => (a.durationMinutes ?? 9e9) - (b.durationMinutes ?? 9e9);
    seat.sort((a, b) => dur(a, b) || byTime(a, b));
    wl.sort((a, b) => dur(a, b) || byTime(a, b));
  } else {
    seat.sort((a, b) => rank(a.status) - rank(b.status) || (b.seats ?? b.rac ?? 0) - (a.seats ?? a.rac ?? 0) || byTime(a, b));
    wl.sort((a, b) => rank(a.status) - rank(b.status) || (a.waitlist ?? 9e9) - (b.waitlist ?? 9e9) || byTime(a, b));
  }
  return { seat, wl, missingClass, unknownTime };
}

const inr = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);
const trainCount = (rows: SeatFilterRow[]) => new Set(rows.map((r) => r.number)).size;
const fmtRow = (r: SeatFilterRow) => {
  const status = r.status === "AVAILABLE" ? `AVL ${r.seats ?? "—"}` : r.status === "RAC" ? `RAC ${r.rac ?? "—"}` : r.status === "WAITLIST" ? `WL ${r.waitlist ?? "—"}` : "N/A";
  return `${r.number} ${r.classCode} ${status}${r.fare != null ? ` ${inr(r.fare)}` : ""}${r.departure ? ` (${r.departure})` : ""}`;
};

/** AI ke jawab me lagne wali chhoti line — sirf asli board numbers. */
export function seatSummaryLine(
  pick: SeatPickResult,
  slots: Pick<SeatIntentSlots, "classCodes" | "classGroup" | "sortBy" | "departAfterMinute">,
  where: { from: string; to: string },
): string {
  const cls =
    slots.classGroup === "AC"
      ? "AC (1A/2A/3A/3E/CC/EC)"
      : slots.classCodes?.length
        ? slots.classCodes.join("/")
        : "sab class";
  const whenMin = slots.departAfterMinute;
  const when =
    whenMin == null
      ? ""
      : ` (${String(Math.floor(whenMin / 60)).padStart(2, "0")}:${String(whenMin % 60).padStart(2, "0")} ke baad)`;
  const sortNote = slots.sortBy === "cheapest" ? " · sabse sasta pehle" : slots.sortBy === "fastest" ? " · sabse jaldi pehle" : "";
  const head = `${where.from} → ${where.to} · live board`;

  if (pick.seat.length) {
    const trains = trainCount(pick.seat);
    const top = pick.seat.slice(0, 4).map(fmtRow).join(" · ");
    const more = pick.seat.length > 4 ? ` · +${pick.seat.length - 4} aur (Seat Finder card me)` : "";
    return `💺 ${cls} me seat wali ${trains} train${trains === 1 ? "" : "s"}${when}${sortNote} — ${top}${more}. (${head})`;
  }
  if (pick.wl.length) {
    const trains = trainCount(pick.wl);
    const top = pick.wl.slice(0, 3).map(fmtRow).join(" · ");
    /* WL number hi dikhate hain — confirm% nahi (wo data hamare paas nahi hai). */
    return `💺 ${cls} me abhi koi AVAILABLE/RAC seat nahi${when} — WL wali ${trains} train${trains === 1 ? "" : "s"} ${trains === 1 ? "hai" : "hain"}: ${top}. Confirm% hum nahi dete (data nahi); booking se pehle IRCTC par check karo. (${head})`;
  }
  const extra = pick.unknownTime ? ` ${pick.unknownTime} trains ka time pata nahi chal paya.` : "";
  return `💺 ${cls} me aaj koi seat wali train nahi mili${when}.${extra} (${head})`;
}

export interface SeatFilterResult {
  line: string;
  rows: SeatFilterRow[];
  wlRows: SeatFilterRow[];
  trainsSeen: number;
  source: string | null;
}

/**
 * Live board (aur sirf zaroorat par trains list — time/sort ke liye) se seat filter.
 * Koi naya endpoint nahi: `routedRouteBoard` wahi hai jo /api/availability route-board ke liye
 * pehle se chal raha hai; `getProvider().searchTrains` wahi hai jo /api/trains chalata hai.
 */
export async function seatFilterFor(opts: {
  from: string;
  to: string;
  date: string;
  slots: SeatIntentSlots;
  maxRows?: number;
}): Promise<SeatFilterResult | null> {
  const { from, to, date, slots } = opts;
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const board = await routedRouteBoard(from, to, date, []).catch(() => null);
  if (!board || !board.trains.length) return null;

  const needTimes = slots.departAfterMinute != null || slots.sortBy === "fastest";
  let times: Map<string, SeatTrainTimes> | undefined;
  if (needTimes) {
    try {
      const list = await getProvider().searchTrains({ from, to, date });
      times = new Map(
        list.map((t) => [
          String(t.number),
          { departure: t.departure ?? null, arrival: t.arrival ?? null, durationMinutes: t.durationMinutes ?? null },
        ]),
      );
    } catch {
      times = undefined; /* times na mile to filter honest rehta hai (unknownTime count). */
    }
  }

  const pick = pickSeatRows(board.trains as SeatBoardTrain[], slots, times);
  /* 24 Sep 2026 (user: "2A ki seats dikhana" → "koi seat wali train nahi mili" par WL ka pata hi
   * nahi chala): onlyAvailable=true par bhi WL rows ALAG se nikaal lo, taaki line bata sake ki
   * seat nahi hai par WL kitni hai. Data wahi board ka, koi andaza nahi. */
  const wlPick = slots.onlyAvailable
    ? pickSeatRows(board.trains as SeatBoardTrain[], { ...slots, onlyAvailable: false }, times)
    : pick;
  const line = seatSummaryLine({ ...pick, wl: wlPick.wl }, slots, { from, to });
  const max = opts.maxRows ?? 8;
  return {
    line,
    rows: pick.seat.slice(0, max),
    wlRows: wlPick.wl.slice(0, max),
    trainsSeen: board.trains.length,
    source: board.provider ?? null,
  };
}
