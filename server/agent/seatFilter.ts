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

/** Round-19: time window — "subah" (04:00–12:00), "shaam" (17:00–21:00), "raat" (21:00 → 04:00 wrap),
 *  ya "X ke baad" / "X se pehle". Sab minute-of-day par, koi andaza nahi. */
export function inTimeWindow(dep: number, after: number | null, before: number | null): boolean {
  if (after == null && before == null) return true;
  if (after != null && before != null) return before < after ? dep >= after || dep <= before : dep >= after && dep <= before;
  if (after != null) return dep >= after;
  return dep <= (before as number);
}

/** Pehle se maujood rows ko filter karna — koi network call nahi, koi guess nahi. */
export function pickSeatRows(
  trains: SeatBoardTrain[],
  slots: Pick<SeatIntentSlots, "classCodes" | "onlyAvailable" | "departAfterMinute" | "sortBy"> &
    Partial<Pick<SeatIntentSlots, "departBeforeMinute">>,
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
      /* "5 baje ke baad" / "subah": time pata ho to hi filter karo; pata nahi to seat list se hata do
       * (jhooth na bole — kitne rows chhoote wo unknownTime me count hote hain). */
      const hasWindow = slots.departAfterMinute != null || slots.departBeforeMinute != null;
      if (hasWindow && row.departure == null) {
        unknownTime += 1;
        continue;
      }
      const inWindow = inTimeWindow(depMin(row), slots.departAfterMinute ?? null, slots.departBeforeMinute ?? null);
      if (isSeat) {
        if (!inWindow) continue;
        seat.push(row);
      } else {
        if (!inWindow) continue;
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

/* Round-25: ek jawab me kitni rows dikhayein — "koi cap nahi" ke saath, par jawab padhne layak rahe. */
export const SEAT_LINE_MAX = 12;

const inr = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);
const trainCount = (rows: SeatFilterRow[]) => new Set(rows.map((r) => r.number)).size;
const statusText = (r: SeatFilterRow): string =>
  r.status === "AVAILABLE"
    ? `AVL ${r.seats ?? "—"}`
    : r.status === "RAC"
      ? `RAC ${r.rac ?? "—"}`
      : r.status === "WAITLIST"
        ? `WL ${r.waitlist ?? "—"}`
        : "N/A";

/** Ek hi train ki rows ko ek text me — "12013 CC AVL 444 ₹675 · 3A AVL 71 ₹520".
 *  Round-27 (user: "yeh ek hi class dikha raha, jabki aur bhi classes me seat available hai same train me"). */
export function trainClassesText(rows: SeatFilterRow[]): string {
  return rows
    .map((r) => `${r.classCode} ${statusText(r)}${r.fare != null ? ` ${inr(r.fare)}` : ""}`)
    .join(" · ");
}

/** Rows ko train-wise group karo (aane ke order me) — har train ki saari classes ek saath. */
export function groupRowsByTrain(rows: SeatFilterRow[]): { number: string; name: string; classes: SeatFilterRow[] }[] {
  const map = new Map<string, { number: string; name: string; classes: SeatFilterRow[] }>();
  for (const r of rows) {
    const g = map.get(r.number) ?? { number: r.number, name: r.name, classes: [] };
    g.classes.push(r);
    map.set(r.number, g);
  }
  return [...map.values()];
}

const fmtRow = (r: SeatFilterRow) => {
  const status = r.status === "AVAILABLE" ? `AVL ${r.seats ?? "—"}` : r.status === "RAC" ? `RAC ${r.rac ?? "—"}` : r.status === "WAITLIST" ? `WL ${r.waitlist ?? "—"}` : "N/A";
  return `${r.number} ${r.classCode} ${status}${r.fare != null ? ` ${inr(r.fare)}` : ""}${r.departure ? ` (${r.departure})` : ""}`;
};

/** AI ke jawab me lagne wali chhoti line — sirf asli board numbers. */
export function seatSummaryLine(
  pick: SeatPickResult,
  slots: Pick<SeatIntentSlots, "classCodes" | "classGroup" | "sortBy" | "departAfterMinute"> &
    Partial<Pick<SeatIntentSlots, "windowLabel" | "onlyAvailable">>,
  where: { from: string; to: string },
): string {
  const cls =
    slots.classGroup === "AC"
      ? "AC (1A/2A/3A/3E/CC/EC)"
      : slots.classCodes?.length
        ? slots.classCodes.join("/")
        : "sab class";
  const whenMin = slots.departAfterMinute;
  /* Round-19: window ("Subah 04:00–12:00") pehle — warna purana "HH:MM ke baad". */
  const when =
    slots.windowLabel
      ? ` (${slots.windowLabel})`
      : whenMin == null
        ? ""
        : ` (${String(Math.floor(whenMin / 60)).padStart(2, "0")}:${String(whenMin % 60).padStart(2, "0")} ke baad)`;
  const sortNote = slots.sortBy === "cheapest" ? " · sabse sasta pehle" : slots.sortBy === "fastest" ? " · sabse jaldi pehle" : "";
  const head = `${where.from} → ${where.to} · live board`;

  /* Round-26 (user: "sirf available mat show karo — W/L trains bhi show karo"): jab user ne khud
   * available nahi maanga (slots.onlyAvailable === false) to ek hi line me SAARI trains — pehle
   * AVL/RAC, phir WL/N-A — aur count saaf: kitni me seat, kitni WL/N-A. Kuch invent nahi. */
  if (slots.onlyAvailable === false && (pick.seat.length || pick.wl.length)) {
    const all = [...pick.seat, ...pick.wl];
    const trains = trainCount(all);
    const withSeat = trainCount(pick.seat);
    const wlOnly = trains - withSeat;
    const grouped = groupRowsByTrain(all);
    /* Round-27: ek line me har train ki SAARI classes (pehle ek class per row thi — user ko laga
     * sirf wahi class available hai). */
    const shown = grouped
      .slice(0, SEAT_LINE_MAX)
      .map((g) => `${g.number} ${trainClassesText(g.classes)}`)
      .join(" | ");
    const more = grouped.length > SEAT_LINE_MAX ? ` | +${grouped.length - SEAT_LINE_MAX} trains aur bhi hain` : "";
    const countBit =
      pick.seat.length && pick.wl.length
        ? `${withSeat} me seat (AVL/RAC), ${wlOnly} me WL/N-A`
        : pick.seat.length
          ? `${withSeat} me seat (AVL/RAC)`
          : `${wlOnly} me sirf WL/N-A`;
    return `💺 ${cls} me ${trains} train${trains === 1 ? "" : "s"}${when}${sortNote} — ${countBit}: ${shown}${more}. (${head})`;
  }

  if (pick.seat.length) {
    const trains = trainCount(pick.seat);
    /* Round-25 (26 Sep, user screenshot: "Yeh baki trains seat finder card mein kyu le jaata?") —
     * pehle ye line sirf top 4 rows likhti thi aur baaki ko "(Seat Finder card me)" bhej deti thi;
     * us card ko Round-21c me chat se hata diya gaya tha, isliye pointer jhootha tha (aur AI wahi
     * line copy karke "…Seat Finder card mein hain" likh deta tha). Ab SAARI seat rows isi line me
     * aati hain (koi card pointer nahi) — bahut zyada hon to hi "+N aur bhi hain" (bina kisi card ke). */
    const grouped = groupRowsByTrain(pick.seat);
    const shown = grouped
      .slice(0, SEAT_LINE_MAX)
      .map((g) => `${g.number} ${trainClassesText(g.classes)}`)
      .join(" | ");
    const more = grouped.length > SEAT_LINE_MAX ? ` | +${grouped.length - SEAT_LINE_MAX} trains aur bhi hain` : "";
    return `💺 ${cls} me seat wali ${trains} train${trains === 1 ? "" : "s"}${when}${sortNote} — ${shown}${more}. (${head})`;
  }
  if (pick.wl.length) {
    const trains = trainCount(pick.wl);
    const top = pick.wl.slice(0, SEAT_LINE_MAX).map(fmtRow).join(" · ");
    const wlMore = pick.wl.length > SEAT_LINE_MAX ? ` · +${pick.wl.length - SEAT_LINE_MAX} aur bhi hain` : "";
    /* WL number hi dikhate hain — confirm% nahi (wo data hamare paas nahi hai). */
    return `💺 ${cls} me abhi koi AVAILABLE/RAC seat nahi${when} — WL wali ${trains} train${trains === 1 ? "" : "s"} ${trains === 1 ? "hai" : "hain"}: ${top}${wlMore}. Confirm% hum nahi dete (data nahi); booking se pehle IRCTC par check karo. (${head})`;
  }
  const extra = pick.unknownTime ? ` ${pick.unknownTime} trains ka time pata nahi chal paya.` : "";
  return `💺 ${cls} me aaj koi seat wali train nahi mili${when}.${extra} (${head})`;
}

/** Ek row ki chat line (ReplyText parser isi shakal ko rows me todta hai) — sirf asli row data. */
function replyLine(r: SeatFilterRow): string {
  const status =
    r.status === "AVAILABLE"
      ? `AVAILABLE ${r.seats ?? "?"} seats`
      : r.status === "RAC"
        ? `RAC ${r.rac ?? "?"}`
        : r.status === "WAITLIST"
          ? `WL ${r.waitlist ?? "?"}`
          : "N/A";
  return (
    `* ${r.number} ${r.name} — ${r.classCode} — ${status}` +
    `${r.fare != null ? ` — ${inr(r.fare)}` : ""}` +
    `${r.departure ? ` — ${r.departure} departure` : ""}`
  );
}

/**
 * Round-25 (26 Sep, user screenshot: "Yeh baki trains seat finder card mein kyu le jaata? last line
 * dekho"): AI ke jawab me jo seat-wali trains chhoot gayi hon, unki lines YAHAN se banti hain — jo
 * rows live board se aayi hain wahi (kuch invent nahi). Chat me koi Seat Finder card nahi dikhta,
 * isliye "baki trains card me hain" jaisi baat kabhi sach nahi thi. In lines ko jawab ke saath jodne
 * par user ko SAARI trains usi message me dikhti hain.
 */
export function missingSeatLines(replyText: string, rows: SeatFilterRow[]): string[] {
  const text = String(replyText ?? "");
  const out: string[] = [];
  /* Round-27 (user: "ek hi class dikha raha, jabki same train me aur bhi classes me seat hai"):
   * ab har train ki line me uski SAARI classes ek saath — "12013 AMRITSAR SHTABDI — CC AVL 444 ₹675 ·
   * 3A AVL 71 ₹520 · EC AVL 23 ₹1,015 — 06:10 departure". */
  for (const g of groupRowsByTrain(rows)) {
    /* Number jawab me kahin bhi ho to us train ki line dobara nahi likhte. */
    if (new RegExp(`\\b${g.number}\\b`).test(text)) continue;
    const dep = g.classes.find((c) => c.departure)?.departure ?? null;
    out.push(
      `* ${g.number} ${g.name} — ${trainClassesText(g.classes)}` + (dep ? ` — ${dep} departure` : ""),
    );
  }
  return out;
}

/** Round-27: cap **trains** par lagta hai, rows (train×class) par nahi — warna same train ki
 *  baaki classes kat jaati thi ("ek hi class dikha raha" wali complaint). */
export function capRowsByTrain(rows: SeatFilterRow[], maxTrains: number): SeatFilterRow[] {
  const order: string[] = [];
  const byTrain = new Map<string, SeatFilterRow[]>();
  for (const r of rows) {
    if (!byTrain.has(r.number)) order.push(r.number);
    const list = byTrain.get(r.number) ?? [];
    list.push(r);
    byTrain.set(r.number, list);
  }
  const out: SeatFilterRow[] = [];
  for (const n of order.slice(0, maxTrains)) out.push(...(byTrain.get(n) ?? []));
  return out;
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

  const needTimes = slots.departAfterMinute != null || slots.departBeforeMinute != null || slots.sortBy === "fastest";
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
  /* Round-25: payload/line me saari seat-wali trains (12 tak) — default 8 se badhaya.
   * Round-27: cap ab *trains* par — har train ki SAARI classes isi jawab/block me aani chahiye. */
  const max = opts.maxRows ?? SEAT_LINE_MAX;
  return {
    line,
    rows: capRowsByTrain(pick.seat, max),
    wlRows: capRowsByTrain(wlPick.wl, max),
    trainsSeen: board.trains.length,
    source: board.provider ?? null,
  };
}
