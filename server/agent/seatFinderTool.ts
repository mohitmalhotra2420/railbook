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
import { enrichTrainsFreshness, routedClassBoard, routedRouteBoard, routedStationSearch } from "../railway/router.js";
import { filterTrainsServingSegment, nearbyCandidatesNote, routeDropNote } from "./routeSegment.js";
import { resolveStationArg } from "./stationArg.js";
import { searchStations as searchLocalStations } from "../data/stations.js";
import {
  AC_CLASSES,
  TIME_WINDOWS,
  beforeMinute as parseBeforeMinute,
  departAfterMinute as parseDepartAfter,
} from "../understand/seatIntent.js";
import { SEAT_LINE_MAX, pickSeatRows, seatSummaryLine, type SeatBoardClass, type SeatBoardTrain, type SeatFilterRow } from "./seatFilter.js";

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
  /* Round-52: user/model ke haath ka station arg (jaise "Yaar Ldh", "Ldh", "svdk", "smvd katra") —
   * ek jagah se resolve (stationArg.ts). Pehle yahan sirf local exact + provider search thi, isliye
   * filler wala phrase resolve hi nahi hota tha aur tool "station resolve nahi hua" de deta tha. */
  const hit = await resolveStationArg(String(raw ?? ""));
  return hit?.code ?? null;
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
  /* Round-26 (user: "sirf available mat show karo — W/L trains bhi show karo, kyunki user ne
   * specifically nahi bola"): default ab false — yaani WL/N-A bhi, jab tak user ne khud
   * "available / khali / sirf available / confirmed" na maanga ho. */
  const onlyAvailable = args.only_available === true;
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

  const boardRaw = await routedRouteBoard(from, to, date, []).catch(() => null);
  /* Round-49: jo train `to` tak jaati hi nahi (ConfirmTkt board me paas ke bade station wali bhi aati
   * hain — jaise LDH→SVDK me JAT tak wali), wo pool me hi nahi aani chahiye. Warna AI unki seat
   * rows likh deta hai aur user us train me book nahi kar sakta. */
  const seg = boardRaw
    ? await filterTrainsServingSegment(
        boardRaw.trains.map((t) => ({ trainNumber: String(t.trainNumber ?? "").trim(), trainName: String(t.trainName ?? "") })),
        from,
        to,
      ).catch(() => ({ trains: boardRaw.trains.map((t) => ({ trainNumber: String(t.trainNumber ?? "").trim() })), dropped: [] }))
    : null;
  const keptNums = new Set((seg?.trains ?? []).map((t) => String(t.trainNumber).trim()));
  const board = boardRaw ? { ...boardRaw, trains: boardRaw.trains.filter((t) => keptNums.has(String(t.trainNumber ?? "").trim())) } : null;
  const dropLine = seg ? routeDropNote(seg.dropped, to) : null;
  /* Round-50: jo trains segment tak nahi jaati par seat-detih hain — alag section (jaise JAT tak). */
  const nearbyLine = seg
    ? nearbyCandidatesNote(
        (boardRaw?.trains ?? []).filter((t) => seg.dropped.some((d) => d.number === String(t.trainNumber ?? "").trim())) as { trainNumber: string; trainName?: string; classes?: never[] }[],
        seg.dropped,
        from,
        to,
      )
    : null;
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
  /* Round-50: dikhaayi jaane wali trains ke purane/future rows ka live probe (IRCTC se ulat ho sakta
   * hai — user ka 2S case). Live row na mile to purani row waise hi rehti hai. */
  try {
    if (typeof enrichTrainsFreshness === "function") {
      const probe = pickSeatRows(pool, slots, times);
      const probeWl = onlyAvailable ? pickSeatRows(pool, { ...slots, onlyAvailable: false }, times) : probe;
      const order: string[] = [];
      for (const r of [...probe.seat, ...probeWl.wl]) if (!order.includes(r.number) && order.length < 6) order.push(r.number);
      if (order.length) await enrichTrainsFreshness(trains as { trainNumber: string; trainName: string; classes: never[] }[], order, from, to, date, quota);
    }
  } catch {
    /* freshness optional — board data waise hi */
  }

  const pick = pickSeatRows(pool, slots, times);
  /* WL rows alag se (onlyAvailable par bhi), taaki "seat nahi par WL itni" sach bata sake. */
  const wlPick = onlyAvailable
    ? pickSeatRows(pool, { ...slots, onlyAvailable: false }, times)
    : pick;
  /* Round-53d: available-only (confirm/available) maangne par model ko WL-only trains ka data bhejna hi
   * nahi hai — warna wo unhe jawab me likh deta hai aur cards (jo sirf seat-wali trains dikhate hain)
   * se mismatch ho jaata hai. Isliye WL rows sirf UN trains ki rakh-te hain jinka koi class AVL/RAC hai;
   * baaki trains ka sirf COUNT instruction me jaata hai (model ek honest line likh sakta hai). */
  const winnerSet = new Set(pick.seat.map((r) => r.number));
  /* Round-53e: agar is waqt kisi train me seat hi nahi (winnerSet khaali), to WL rows SAB rakh-te hain —
   * warna model ke paas honest jawab ("koi confirmed seat nahi, ye WL trains") ka data hi nahi hota aur
   * grounding check uske jawab ko reject kar deta hai (deterministic summary aa jaati thi). */
  const wlForReply =
    onlyAvailable && winnerSet.size > 0 ? wlPick.wl.filter((r) => winnerSet.has(r.number)) : wlPick.wl;
  const head = seatSummaryLine({ ...pick, wl: wlForReply }, slots, { from, to });

  const fmt = (r: SeatFilterRow) =>
    `${r.number} ${r.name} · ${r.classCode} · ${r.status === "AVAILABLE" ? `AVAILABLE ${r.seats ?? "?"} seats` : r.status === "RAC" ? `RAC ${r.rac ?? "?"}` : r.status === "WAITLIST" ? `WL ${r.waitlist ?? "?"}` : "N/A"}${r.fare != null ? ` · ₹${r.fare}` : ""}${r.departure ? ` · ${r.departure}` : ""}`;

  const lines: string[] = [head];
  /* Round-25 (user: "baki trains seat finder card mein kyu le jaata"): pehle yahan sirf 8 rows jaati
   * thi aur summary line "+N aur" likhti thi — model usse aage badha kar "baaki trains card me hain"
   * likh deta tha, jabki chat me koi Seat Finder card nahi dikhta. Ab saari rows isi call me jaati
   * hain (SEAT_LINE_MAX tak) taaki jawab me saari trains aayein — koi card pointer nahi. */
  if (pick.seat.length) lines.push(`SEAT (${pick.seat.length} rows): ${pick.seat.slice(0, SEAT_LINE_MAX).map(fmt).join(" | ")}`);
  if (wlForReply.length) lines.push(`WAITLIST/N-A (${wlForReply.length} rows, confirm% NAHI batana): ${wlForReply.slice(0, SEAT_LINE_MAX).map(fmt).join(" | ")}`);
  /* Round-51 (user: *"sabhi class kyu nahi show hoti jab bhi specifically confirm, available
   * poocho"*): jab user ne confirm/available seat maange, jawab me us train ki baaki classes bhi
   * aani chahiye — warna 2S jaisi class (jo usi train me hai) gayab lagti hai. Ye rows sirf un
   * trains ki hain jinme seat mili hai (WL-only trains jawab me nahi). */
  const seatNums = new Set(pick.seat.map((r) => r.number));
  const seatHave = new Set(pick.seat.map((r) => `${r.number}:${r.classCode}`));
  const otherClasses = pick.seat.length ? wlPick.wl.filter((r) => seatNums.has(r.number) && !seatHave.has(`${r.number}:${r.classCode}`)) : [];
  if (otherClasses.length) {
    lines.push(`OTHER CLASSES (inhi trains ki baaki classes — inhe bhi status ke saath likho, chhupao mat): ${otherClasses.slice(0, SEAT_LINE_MAX).map(fmt).join(" | ")}`);
  }
  if (pick.missingClass) lines.push(`${pick.missingClass} trains me ye class hi nahi hai — unhe "seat nahi" mat maano.`);
  /* Round-49: hati hui trains (jo ${to} tak nahi jaati) — model ise jawab me saaf likh de. */
  if (dropLine) lines.push(`ROUTE: ${dropLine.replace(/^ℹ️\s*/, "")}`);
  if (nearbyLine) lines.push(`NEARBY: ${nearbyLine.replace(/^🧭\s*/gm, "")}`);
  if (pick.unknownTime) lines.push(`${pick.unknownTime} rows ka time nahi mila (time filter laga tha).`);
  lines.push(`Source: ${board.provider ?? "live board"} · ${pool.length} trains dekhe (${enriched.size} ka alag board check kiya).`);
  lines.push("Jawab me SAARI trains ki lines likho (jo SEAT rows me hain) — 'baaki trains kisi card me hain' jaisi baat kabhi mat likho, chat me aisa koi card nahi dikhta.");
  /* Round-51: per-train completeness — jo train jawab me hai uski har class ka status likho. */
  lines.push("Har train ki line me uski SAARI classes likho (SEAT wali pehle, phir usi train ki OTHER/WAITLIST classes status ke saath) — koi class chhupao mat, warna user ko lagta hai wo class hi nahi hai.");
  /* Round-53b (prod probe 50b23b6): "saari trains ki seat availability batao" par model ne pivot-jaise
   * table banaya jisme ek hi class/status 9 baar repeat ho gaya (2A WL, 2A WL (2) …) — padhne layak nahi.
   * Isliye saaf instruction: har train EK line/row, koi column-repeat nahi. */
  lines.push("Formatting: har train ki EK line likho (jaise yahan upar hai) — table/pivot-columns mat banao aur ek hi class/status kisi train ke liye ek hi baar likho; repeat ya (2),(3) wale duplicates kabhi nahi.");
  /* Round-53d (prod probe 161cf03 saboot): "confirm seat" wale sawaal par model ne jawab me 7 trains likhi
   * (jinme 4 poori WL/N-A thin) jabki SEAT rows sirf 3 trains ki thi → cards chhote reh gaye aur user ko
   * laga "trains card me nahi dikh rahi". User ki maang saaf hai: "agar confirm bola to confirm dikhao na
   * sirf". Isliye available-only request par JAWAB bhi sirf seat-wali trains ka hota hai. */
  if (onlyAvailable) {
    const winnerNums = [...new Set(pick.seat.map((r) => r.number))];
    const wlOnly = [...new Set(wlPick.wl.map((r) => r.number))].filter((n) => !winnerNums.includes(n));
    if (!winnerNums.length) {
      lines.push(
        "IS WAQT kisi bhi train me CONFIRMED (AVL/RAC) seat nahi hai. Jawab ki pehli line me SAAF likho: 'is waqt koi confirmed seat nahi hai' — phir jo WL/N-A rows upar di hain wo train-wise ek-ek line me likho (WL number ke saath), aur saaf karo ki ye waitlist hai. Kisi train ki seat AVAILABLE mat likho.",
      );
    } else {
      lines.push(
        `USER NE SIRF CONFIRM/AVAILABLE MAANGA HAI — jawab me SIRF inhi ${winnerNums.length} trains ki lines likho jinme kam se kam ek class AVL/RAC hai` +
          (wlOnly.length
            ? ` (baaki ${wlOnly.length} trains me sirf WL/N-A hai — unka number/naam jawab me mat likho; chaho to ek chhoti line: "baaki ${wlOnly.length} trains me sirf WL/N-A hai")`
            : "") +
          ".",
      );
    }
    lines.push("Jis train ki line likho, uski SAARI classes (AVL + WL/N-A) usi line me likho — koi class chhupao mat (Round-51 ka niyam).");
  }

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
      /* available-only par sirf seat-wali trains ke WL rows (dekho upar wlForReply ki wajah). */
      wlRows: wlForReply,
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
  "only_available = true SIRF tab jab user ne khud 'available/khali/sirf available/confirmed seat' maanga ho; " +
  "warna false bhejo (default) — tab WL/N-A trains bhi aati hain aur jawab me saari trains status ke saath likhni hain; " +
  "TIME FILTER — user ne waqt bola ho to ye ZAROOR bhejo: depart_after = 'subah' | 'dopahar' | 'shaam' | 'raat' (poora window) " +
  "YA '17:00' / '5 baje ke baad'; depart_before = '12:00' / '12 baje se pehle'. " +
  "'subah ki trains batao' jaisa sawaal aaye to poora din ka jawab MAT do — usi window ki trains batao. " +
  "sort_by = 'cheapest' | 'fastest'; train_numbers = sirf in trains par (comma-separated). " +
  "WL ka confirm% kabhi mat batao (data nahi hai) — sirf WL number. "
  "Result ke `summary` field me har train ki har class ki line hai (AVAILABLE + WL/N-A dono) — apne jawab me "
  "wahi SAARI entries likho; sirf AVAILABLE rows likhna adhoora hai (jab tak user ne khud 'sirf available' na maanga ho).";

export const FIND_SEATS_PARAMETERS = {
  type: "object",
  properties: {
    from: { type: "string", description: "Origin station code (LDH) ya city naam (Ludhiana)" },
    to: { type: "string", description: "Destination station code (BEAS) ya city naam (Beas)" },
    date: { type: "string", description: "Journey date YYYY-MM-DD" },
    class_code: { type: "string", description: "'ALL' | 'AC' | '1A'|'2A'|'3A'|'3E'|'SL'|'CC'|'EC'|'2S' (comma-separated bhi)" },
    only_available: { type: "boolean", description: "true = sirf AVAILABLE/RAC (sirf jab user ne available/confirmed maanga ho); false (default) = WL/N-A bhi dikhao" },
    depart_after: { type: "string", description: "Window ka shabd ('subah' | 'dopahar' | 'shaam' | 'raat') ya '17:00' / '5 baje ke baad' / 'raat 9 ke baad'" },
    depart_before: { type: "string", description: "'12:00' ya '12 baje se pehle' (is waqt se pehle wali trains)" },
    sort_by: { type: "string", description: "'cheapest' (sabse sasta) ya 'fastest' (sabse kam time)" },
    train_numbers: { type: "string", description: "Sirf in trains par — comma-separated (jaise '12029,12497')" },
    quota: { type: "string", description: "GN (default) | TQ (tatkal) | PT (premium tatkal) | LD (ladies)" },
    passengers: { type: "number", description: "Kitne log (1-6) — sirf jawab me context ke liye" },
  },
  required: ["from", "to", "date"],
} as const;
