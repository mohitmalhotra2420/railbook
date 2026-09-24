/* 24 Sep 2026 — AI Seat Finder ka client layer (ConfirmTkt "AI Seat Finder / TARA" jaisa flow).
 *
 * User: "ludhiana se new delhi kal ke liye trains dikhao" → list aayi; phir "2A mein seats hai?"
 * → ConfirmTkt 2A filter karke seat wali trains deta hai. RailBook me list rows "2A UNKNOWN" thi
 * (availability merge nahi hoti thi) — isliye filter nahi lagta tha.
 *
 * Ye module 100% CLIENT-SIDE hai: koi AI logic, koi provider, koi API/architecture change nahi.
 * Jo live board server par pehle se hai (`/api/availability?from&to&date` — route board), usi se
 * rows me availability merge karke seat/WL me baantta hai. Bhasha: Hindi (देवनागरी), English, Hinglish.
 */
import type { ClassCode } from "./types";
import { resolveSpokenClass } from "./voice/spokenClass";

export type SeatIntent = {
  /** User seat/availability ke baare me poochh raha hai? */
  wants: boolean;
  /** Kis class ki baat ho rahi hai (null = sab). */
  classCode: ClassCode | null;
  /** "AC trains / AC class" (koi ek class nahi batayi) → AC group.
   * 24 Sep 2026 user: "AC trains dikhao" par 2S/SL bhi dikh rahe the. */
  acOnly: boolean;
  /** "confirmed wali dikhao" (WL hata do). */
  confirmedOnly: boolean;
  /** "5 baje ke baad" / "after 5" / "शाम 5 के बाद" → minute of day. */
  afterMin: number | null;
  /** "sabse jaldi pahunchne wali" (kam travel time). */
  earliest: boolean;
  /** "low fare / sasta / kam kiraya" — fare ke hisaab se sort. */
  cheapest: boolean;
};

export type BoardClassRow = {
  classCode?: string | null;
  code?: string | null;
  status?: string | null;
  seats?: number | null;
  rac?: number | null;
  waitlist?: number | null;
  fare?: number | null;
  source?: string | null;
};
export type BoardTrainRow = { trainNumber?: string | null; trainName?: string | null; classes?: BoardClassRow[] };
export type SeatSearchRow = {
  number: string;
  name: string;
  departure: string;
  arrival: string;
  durationLabel?: string | null;
  arrivalDayOffset?: number | null;
};
export type SeatRow = {
  number: string;
  name: string;
  departure: string | null;
  arrival: string | null;
  durationLabel: string | null;
  classCode: ClassCode | "—";
  status: string;
  seats: number | null;
  rac: number | null;
  waitlist: number | null;
  fare: number | null;
  /** AVAILABLE/RAC = seat mil jayegi; WAITLIST/N-A = pakki nahi. */
  seat: boolean;
  /** Times search list me nahi the (board-only train) — UI "—" dikhata hai. */
  timesKnown: boolean;
  source: string | null;
};

/* ── bhasha: class ─────────────────────────────────────────────────────
 * Pehle server ka apna spoken-class resolver (reuse — usme code chheda nahi),
 * phir Devanagari/Hinglish/English ke apne patterns. */
const CLASS_PATTERNS: [RegExp, ClassCode][] = [
  [/(?:२|2)\s*(?:ए|एसी|ac)/i, "2A"],
  [/दूसर(?:ी|े|ा)\s*(?:एसी|ए\.सी|ac)/i, "2A"],
  [/सेकंड\s*(?:एसी|ac)/i, "2A"],
  [/(?:2|two)\s*(?:nd|nd ac|tier|ac\s*tier)/i, "2A"],
  [/\b2a\b|\b2ac\b|\b2\s*ac\b/i, "2A"],
  [/(?:३|3)\s*(?:ए|एसी|ac)/i, "3A"],
  [/तीसर(?:ी|े|ा)\s*(?:एसी|ac)/i, "3A"],
  [/(?:3|three)\s*(?:rd|tier|ac\s*tier)/i, "3A"],
  [/\b3a\b|\b3ac\b|\b3\s*ac\b/i, "3A"],
  [/(?:१|1)\s*(?:ए|एसी|ac)/i, "1A"],
  [/पहल(?:ी|े|ा)\s*(?:एसी|ac)/i, "1A"],
  [/\b1a\b|\b1ac\b|\bfirst\s*ac/i, "1A"],
  [/स्लीपर|स्लीपिंग|sleep(?:er|ing)|शयनयान/i, "SL"],
  [/\bsl\b|\bsleeper\b/i, "SL"],
  [/चेयर\s*कार|chair\s*car|\bcc\b/i, "CC"],
  /* 24 Sep 2026: "EC" pehle galti se CC ban jaata tha — EC = Executive Chair Car (alag class). */
  [/\bec\b|executive|एग्ज़ीक्यूटिव/i, "EC"],
  [/\b3e\b|3\s*economy|थ्री\s*इकोनॉमी/i, "3E"],
  [/सेकंड\s*सिटिंग|second\s*sitting|\b2s\b/i, "2S"],
];

export function classFromText(text: string): ClassCode | null {
  const t = ` ${String(text ?? "").toLowerCase()} `;
  /* "sab class / koi bhi class / kisi bhi class" = koi class filter nahi (aur "sab class" me "sl" na dhoondo). */
  if (/(sab\s*class|koi\s*bhi\s*class|kisi\s*bhi\s*class|any\s*class|सभी\s*क्लास|कोई\s*भी\s*क्लास)/i.test(t)) return null;
  for (const [re, code] of CLASS_PATTERNS) if (re.test(t)) return code;
  const spoken = resolveSpokenClass(t);
  return (spoken as ClassCode | undefined) ?? null;
}

/* ── "AC trains" = AC group, kisi ek class ka naam nahi (24 Sep 2026 user shikayat) ──
 * "AC trains dikhao" bola → 2S / SL bhi dikh rahe the. AC = 1A/2A/3A/3E/CC/EC. */
const AC_GROUP_WORDS = /\b(?:ac|एसी|ए\.सी\.|air\s*condition(?:ed|ing)?|वातानुकूलित)\b/i;
export const AC_CLASS_SET: ClassCode[] = ["1A", "2A", "3A", "3E", "CC", "EC"];

export function acGroupFromText(text: string): boolean {
  const t = ` ${String(text ?? "")} `;
  if (/(sab\s*class|koi\s*bhi\s*class|any\s*class|सभी\s*क्लास)/i.test(t)) return false;
  return AC_GROUP_WORDS.test(t);
}

/* ── bhasha: seat intent ─────────────────────────────────────────────── */
const SEAT_WORDS = /(\bseat|\bseats\b|\bberth|सीट|सीटें|सीटे|बर्थ|खाली|khali|available|availability|उपलब्ध|jagah|जगह|mil\s*jaye|मिल\s*जाए|मिल\s*सकत|mil\s*sakt|pakki|पक्की|कन्फर्म|confirm)/i;
const CONFIRMED_WORDS = /(confirmed|कन्फर्म|confirm|pakki|पक्की|seat\s*wali|सीट\s*वाली|जो\s*पक्की)/i;
const EARLIEST_WORDS = /(sabse\s*(?:jaldi|fast|तेज़|tez)|सबसे\s*(?:जल्दी|तेज़)|sabse\s*pehle|सबसे\s*पहले|earliest|fastest|shortest|जल्दी\s*पहुंच|jaldi\s*pahunch|kam\s*time|कम\s*समय)/i;
const CHEAPEST_WORDS = /(low\s*fare|sasta|sast[ie]|सस्त[ाीे]|cheapest|kam\s*(?:fare|kiraya|pais[ae]|daam)|कम\s*(?:किराया|पैसे|कीमत)|budget|किफायत|sabse\s*kam\s*fare)/i;

const HINDI_NUM: Record<string, number> = {
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6,
  "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12,
};

/** "5 baje ke baad" / "after 5" / "शाम 5 के बाद" / "17:30 ke baad" / "रात 9 ke baad" → minute of day. */
export function afterMinuteFromText(text: string): number | null {
  const t = String(text ?? "").toLowerCase();
  /* Sirf "ke baad"/"after" wale sawaal — warna "5 baje" ka matlab departure 5 baje hota hai. */
  if (!/(ke\s*baad|के\s*बाद|baad|बाद|after|pas|पश्चात)/i.test(t)) return null;
  let hour: number | null = null;
  let minute = 0;
  const clock = t.match(/(\d{1,2})[:.](\d{2})\s*(am|pm|baje|बजे)?/);
  if (clock) {
    hour = Number(clock[1]);
    minute = Number(clock[2]) || 0;
    const mer = clock[3];
    if ((mer === "pm" || mer === "baje" || mer === "बजे") && hour >= 1 && hour <= 7) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
  } else {
    const m = t.match(/(\d{1,2})\s*(baje|बजे|o.?clock|pm|am)?/);
    const hindi = Object.keys(HINDI_NUM).find((h) => t.includes(h));
    if (m && m[1] && /\d/.test(m[1])) {
      hour = Number(m[1]);
      const mer = m[2];
      /* Train ke context me "5 baje" = shaam 5 (subah chahiye to log "subah 5" bolte hain). */
      if ((mer === "baje" || mer === "बजे" || mer === "pm") && hour >= 1 && hour <= 7) hour += 12;
    } else if (hindi) {
      hour = HINDI_NUM[hindi];
    }
  }
  if (hour == null) {
    if (/(रात|raat|night)/.test(t)) hour = 21;
    else if (/(शाम|shaam|evening)/.test(t)) hour = 17;
    else if (/(सुबह|subah|morning)/.test(t)) hour = 6;
    else if (/(दोपहर|dopahar|afternoon)/.test(t)) hour = 12;
    else return null;
  }
  /* Bina "baje" wale din ke shabd: "शाम 5", "रात 9", "सुबह 6". */
  if (hour >= 1 && hour <= 7 && /(शाम|shaam|evening|दोपहर|dopahar|afternoon|रात|raat|night)/.test(t)) hour += 12;
  else if (hour >= 8 && hour <= 11 && /(रात|raat|night)/.test(t)) hour += 12;
  else if (hour === 12 && /(सुबह|subah|morning|am)/.test(t)) hour = 0;
  return (hour % 24) * 60 + minute;
}

export function detectSeatIntent(text: string): SeatIntent {
  const raw = String(text ?? "");
  const cls = classFromText(raw);
  const acOnly = acGroupFromText(raw) && cls === null;
  const wants =
    SEAT_WORDS.test(raw) ||
    acOnly ||
    (Boolean(cls) && /(hai|hain|है|हैं|क्या|kaun|which|konsi|dikha|दिखा|batao|बताओ)/i.test(raw));
  return {
    wants,
    classCode: cls,
    acOnly,
    confirmedOnly: CONFIRMED_WORDS.test(raw),
    afterMin: afterMinuteFromText(raw),
    earliest: EARLIEST_WORDS.test(raw),
    cheapest: CHEAPEST_WORDS.test(raw),
  };
}

/* ── merge + split ───────────────────────────────────────────────────── */
const statusRank = (s: string) => (s === "AVAILABLE" ? 0 : s === "RAC" ? 1 : s === "WAITLIST" ? 2 : 3);

function classRowOf(row: BoardTrainRow, code: ClassCode | null): BoardClassRow | null {
  const rows = (row.classes ?? []).filter((c) => c.status && String(c.status).toUpperCase() !== "UNKNOWN");
  if (code) return rows.find((c) => String(c.classCode ?? c.code ?? "").toUpperCase() === code) ?? null;
  /* Class nahi batayi → sabse achhi class (pehle AVAILABLE, phir RAC, phir WL). */
  rows.sort((a, b) => statusRank(String(a.status)) - statusRank(String(b.status)) || (b.seats ?? b.rac ?? 0) - (a.seats ?? a.rac ?? 0));
  return rows[0] ?? null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Search list (times) + live route board (status) ko merge karke seat/WL me baantta hai. */
export function buildSeatRows(
  searchRows: SeatSearchRow[],
  boardRows: BoardTrainRow[],
  classCode: ClassCode | null,
): { seat: SeatRow[]; wl: SeatRow[]; missingClass: number } {
  const byNumber = new Map<string, BoardTrainRow>();
  for (const b of boardRows) byNumber.set(String(b.trainNumber ?? "").trim(), b);
  const seen = new Set<string>();
  const seat: SeatRow[] = [];
  const wl: SeatRow[] = [];
  let missingClass = 0;

  const push = (t: SeatSearchRow | null, b: BoardTrainRow, c: BoardClassRow, key: string) => {
    seen.add(key);
    const status = String(c.status ?? "UNKNOWN").toUpperCase();
    const row: SeatRow = {
      number: key || String(b.trainNumber ?? ""),
      name: String(b.trainName ?? t?.name ?? ""),
      departure: t?.departure ?? null,
      arrival: t?.arrival ?? null,
      durationLabel: t?.durationLabel ?? null,
      classCode: (String(c.classCode ?? c.code ?? "—").toUpperCase() as ClassCode) || "—",
      status,
      seats: num(c.seats),
      rac: num(c.rac),
      waitlist: num(c.waitlist),
      fare: num(c.fare),
      seat: status === "AVAILABLE" || status === "RAC",
      timesKnown: Boolean(t),
      source: c.source ?? null,
    };
    (row.seat ? seat : wl).push(row);
  };

  for (const t of searchRows) {
    const key = String(t.number).trim();
    const b = byNumber.get(key);
    if (!b) continue;
    const c = classRowOf(b, classCode);
    if (!c) {
      if (classCode) missingClass += 1;
      continue;
    }
    push(t, b, c, key);
  }
  /* Board me hain par search list me nahi (jaise 14036 DHAULADHAR) — user ne kaha inhe bhi dikhao (times "—"). */
  for (const [key, b] of byNumber) {
    if (seen.has(key)) continue;
    const c = classRowOf(b, classCode);
    if (!c) continue;
    push(null, b, c, key);
  }

  const depMin = (r: SeatRow) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(r.departure ?? "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : 9e9;
  };
  seat.sort((a, b) => statusRank(a.status) - statusRank(b.status) || (b.seats ?? b.rac ?? 0) - (a.seats ?? a.rac ?? 0) || depMin(a) - depMin(b));
  /* WL: WAITLIST pehle (kam number pehle), N-A sabse neeche. */
  wl.sort((a, b) => statusRank(a.status) - statusRank(b.status) || (a.waitlist ?? 9e9) - (b.waitlist ?? 9e9) || depMin(a) - depMin(b));
  return { seat, wl, missingClass };
}

/* ── HAR train × HAR class (24 Sep 2026) ──────────────────────────────
 * User: "Confirm button ko replace karke Available kro — Available pe click kre to Available + RAC
 * dono dikhao; aur 'Sabhi trains' pe click kre to sabhi dikhao, including all classes jo bhi us
 * particular train me hain. Bas kuch bhi fake na ho — sab data real ho."
 *
 * buildSeatRows() ek train ki sirf EK class dikhata hai (class chip wali ya sabse achhi).
 * Ye function do modes deta hai:
 *   mode "avail" → sirf AVAILABLE + RAC rows (dono me seat pakki hone ke kareeb).
 *   mode "all"   → har train ki HAR class, uski REAL status ke saath (WL / N-A / unknown) +
 *                  jinki board row hi nahi aayi wo `noData` me — unhe "seat nahi" NAHI maana.
 * Sab kuch live board se — koi guess, koi banaya hua row nahi. */
export type SeatMode = "all" | "avail";

export function buildAllClassRows(
  searchRows: SeatSearchRow[],
  boardRows: BoardTrainRow[],
  classCode: ClassCode | null,
  mode: SeatMode = "all",
  acOnly = false,
): { seat: SeatRow[]; wl: SeatRow[]; noData: SeatRow[]; missingClass: number } {
  const byNumber = new Map<string, BoardTrainRow>();
  for (const b of boardRows) byNumber.set(String(b.trainNumber ?? "").trim(), b);
  const seen = new Set<string>();
  const seat: SeatRow[] = [];
  const wl: SeatRow[] = [];
  const noData: SeatRow[] = [];
  let missingClass = 0;

  const codeOf = (c: BoardClassRow) =>
 String(c.classCode ?? c.code ?? "").trim().toUpperCase();
  const rowsOf = (b: BoardTrainRow): BoardClassRow[] => {
    const all = (b.classes ?? []).filter((c) => codeOf(c));
    if (classCode) return all.filter((c) => codeOf(c) === classCode);
    /* "AC trains" = sirf AC group (2S/SL nahi) — user ki shikayat ka fix. */
    if (acOnly) return all.filter((c) => (AC_CLASS_SET as string[]).includes(codeOf(c)));
    return all; /* "Sabhi trains" = har class, chahe status UNKNOWN ho — real row hi dikhega. */
  };

  const push = (t: SeatSearchRow | null, b: BoardTrainRow, c: BoardClassRow, key: string) => {
    const status = String(c.status ?? "UNKNOWN").toUpperCase();
    const row: SeatRow = {
      number: key,
      name: String(b.trainName ?? t?.name ?? ""),
      departure: t?.departure ?? null,
      arrival: t?.arrival ?? null,
      durationLabel: t?.durationLabel ?? null,
      classCode: (codeOf(c) as ClassCode) || "—",
      status,
      seats: num(c.seats),
      rac: num(c.rac),
      waitlist: num(c.waitlist),
      fare: num(c.fare),
      seat: status === "AVAILABLE" || status === "RAC",
      timesKnown: Boolean(t),
      source: c.source ?? null,
    };
    if (row.seat) seat.push(row);
    else if (mode === "all") wl.push(row);
  };

  for (const t of searchRows) {
    const key = String(t.number).trim();
    const b = byNumber.get(key);
    if (!b) {
      /* Board me row hi nahi aayi (jaise 22429 / 14617) — "seat nahi" nahi, "data nahi aayi". */
      if (mode === "all") {
        noData.push({
          number: key, name: String(t.name ?? ""), departure: t.departure ?? null, arrival: t.arrival ?? null,
          durationLabel: t.durationLabel ?? null, classCode: "—", status: "NO_DATA", seats: null, rac: null,
          waitlist: null, fare: null, seat: false, timesKnown: true, source: null,
        });
      }
      continue;
    }
    seen.add(key);
    const rows = rowsOf(b);
    if (!rows.length) {
      if (classCode) missingClass += 1;
      continue;
    }
    for (const c of rows) push(t, b, c, key);
  }
  /* Board par hain par search list me nahi (times "—") — user ne kaha inhe bhi dikhao. */
  for (const [key, b] of byNumber) {
    if (seen.has(key)) continue;
    for (const c of rowsOf(b)) push(null, b, c, key);
  }

  const depMin = (r: SeatRow) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(r.departure ?? "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : 9e9;
  };
  seat.sort((a, b) => statusRank(a.status) - statusRank(b.status) || (b.seats ?? b.rac ?? 0) - (a.seats ?? a.rac ?? 0) || depMin(a) - depMin(b));
  wl.sort((a, b) => statusRank(a.status) - statusRank(b.status) || (a.waitlist ?? 9e9) - (b.waitlist ?? 9e9) || depMin(a) - depMin(b));
  noData.sort((a, b) => depMin(a) - depMin(b));
  return { seat, wl, noData, missingClass };
}

/** Kitni alag trains hain (rows me ek hi train ki kai class ho sakti hain). */
export function uniqueTrainCount(rows: SeatRow[]): number {
  return new Set(rows.map((r) => r.number)).size;
}

/** Filter (user ke chips) — sab client-side, koi naya server call nahi. */
export function filterSeatRows(
  rows: SeatRow[],
  opts: { confirmedOnly?: boolean; afterMin?: number | null; earliest?: boolean; cheapest?: boolean },
): SeatRow[] {
  let out = rows.slice();
  if (opts.confirmedOnly) out = out.filter((r) => r.seat);
  if (opts.afterMin != null) {
    const min = opts.afterMin;
    out = out.filter((r) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(r.departure ?? "");
      return m ? Number(m[1]) * 60 + Number(m[2]) >= min : false;
    });
  }
  if (opts.cheapest) {
    /* "low fare" — sasta pehle (fare na ho to sabse neeche). */
    out.sort((a, b) => (a.fare ?? Number.POSITIVE_INFINITY) - (b.fare ?? Number.POSITIVE_INFINITY));
  }
  if (opts.earliest) {
    const mins = (s: string | null) => {
      if (!s) return 9e9;
      const m = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/.exec(s);
      return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 9e9;
    };
    out.sort((a, b) => mins(a.durationLabel) - mins(b.durationLabel));
  }
  return out;
}

/** Live route board (server par pehle se maujood endpoint — koi API change nahi).
 *  24 Sep 2026 (user screenshot: card me saari 28 trains "data nahi aayi" — us waqt board call
 *  khaali aayi thi, provider busy): ab ek baar khud retry karte hain aur FAIL ko cache nahi karte,
 *  taaki "↻ dobara try" par fresh call jaaye. */
const boardCache = new Map<string, Promise<BoardTrainRow[]>>();
export function clearRouteBoardCache(from: string, to: string, date: string): void {
  boardCache.delete(`${from}>${to}>${date}`);
}
export function fetchRouteBoard(from: string, to: string, date: string): Promise<BoardTrainRow[]> {
  const key = `${from}>${to}>${date}`;
  const hit = boardCache.get(key);
  if (hit) return hit;
  const one = async (): Promise<BoardTrainRow[]> => {
    try {
      const r = await fetch(`/api/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${encodeURIComponent(date)}`);
      if (!r.ok) return [];
      const j = (await r.json()) as { trains?: BoardTrainRow[] };
      return j.trains ?? [];
    } catch {
      return [];
    }
  };
  const p = (async () => {
    let out = await one();
    if (!out.length) {
      await new Promise((r) => setTimeout(r, 1200));
      out = await one();
    }
    if (!out.length) boardCache.delete(key); /* fail cache na karo */
    return out;
  })();
  boardCache.set(key, p);
  return p;
}

/** Voice se poochha gaya ho to ye summary boli jaati hai (screen par poora card hota hai). */
export function seatSummaryLine(seat: SeatRow[], cls: ClassCode | null, to: string, stationName: string): string {
  const label = cls ? cls : "kisi bhi class";
  if (!seat.length) return `${label} me seat wali koi train nahi mili. Poori list screen par hai.`;
  const top = seat.slice(0, 3).map((r) => {
    const when = r.departure ? r.departure.replace(":", " baje ") : "time list me nahi";
    const how = r.status === "AVAILABLE" ? `${r.seats ?? 0} seat` : `RAC ${r.rac ?? 0}`;
    return `${r.name}, ${when}, ${how}${r.fare ? `, ${r.fare} rupaye` : ""}`;
  });
  return `${label} me ${seat.length} train me seat hai. ${top.join(". ")}. ${stationName} ke liye. Baaki detail screen par hai.`;
}

/* ── Ek train ka POORA class board (24 Sep 2026) ──────────────────────────────────────────────
 * User (screenshot): Swarn Shatabdi ke seats card me sirf EK class dikhi, jabki us train me CC aur
 * EC dono available the. Route board kuch classes "UNKNOWN" ke saath deta hai (ya poori list nahi).
 * Isliye: jo endpoint app ke TrainBoard "Refresh seats" me PEHLE SE use hota hai
 * (/api/availability?trainNumber=…) wahi per-train class board yahan bhi — koi naya endpoint nahi.
 * Merge sirf tab hota hai jab route board me wo class missing/UNKNOWN ho (fresh row jeet ti hai). */
const trainBoardCache = new Map<string, Promise<BoardClassRow[]>>();

export function fetchTrainClasses(
  trainNumber: string,
  date: string,
  from: string,
  to: string,
): Promise<BoardClassRow[]> {
  const key = `${trainNumber}>${from}>${to}>${date}`;
  const hit = trainBoardCache.get(key);
  if (hit) return hit;
  const p = fetch(
    `/api/availability?trainNumber=${encodeURIComponent(trainNumber)}&date=${encodeURIComponent(date)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  )
    .then((r) => (r.ok ? r.json() : { classes: [] }))
    .then((j: { classes?: BoardClassRow[] }) =>
      (j.classes ?? [])
        .map((c) => ({ ...c, classCode: String(c.classCode ?? c.code ?? "").trim().toUpperCase() }))
        .filter((c) => c.classCode && String(c.status ?? "").toUpperCase() !== "UNKNOWN"),
    )
    .catch(() => [] as BoardClassRow[]);
  trainBoardCache.set(key, p);
  return p;
}

/** Route board (asli) + per-train board — union, dup nahi.
 *  24 Sep 2026: base row jiska status UNKNOWN ho use per-train ki REAL row se badal dete hain
 *  (warna Swarn Shatabdi ki EC "unknown" me atak jaati thi jabki available thi). Jis class ka
 *  base row pehle se asli status ke saath hai, use nahi chhedte. Kuch banaya nahi jaata. */
export function mergeClassBoards(base: BoardClassRow[], extra: BoardClassRow[] | undefined): BoardClassRow[] {
  if (!extra || !extra.length) return base;
  const out = base.slice();
  const codeOf = (c: BoardClassRow) => String(c.classCode ?? c.code ?? "").trim().toUpperCase();
  const idx = new Map<string, number>();
  out.forEach((c, i) => idx.set(codeOf(c), i));
  for (const c of extra) {
    const code = codeOf(c);
    if (!code) continue;
    const at = idx.get(code);
    if (at == null) {
      idx.set(code, out.length);
      out.push(c);
      continue;
    }
    if (String(out[at].status ?? "UNKNOWN").toUpperCase() === "UNKNOWN") out[at] = c;
  }
  return out;
}

/** Kis train ka per-train board laana chahiye (bounded, honest — sirf missing/UNKNOWN ke liye). */
export function trainsNeedingClasses(
  board: BoardTrainRow[],
  cls: ClassCode | null,
  acOnly: boolean,
  max = 10,
): string[] {
  const out: string[] = [];
  for (const b of board) {
    const rows = (b.classes ?? []).filter((c) => String(c.classCode ?? c.code ?? "").trim());
    const codes = new Set(rows.map((c) => String(c.classCode ?? c.code ?? "").trim().toUpperCase()));
    const number = String(b.trainNumber ?? "").trim();
    if (!number) continue;
    const unknown = (code?: string) =>
      rows.some(
        (c) =>
          String(c.status ?? "UNKNOWN").toUpperCase() === "UNKNOWN" &&
          (!code || String(c.classCode ?? c.code ?? "").trim().toUpperCase() === code),
      );
    let need = false;
    if (cls) need = !codes.has(cls) || unknown(cls);
    else if (acOnly) {
      const acRate = rows.filter((c) => (AC_CLASS_SET as string[]).includes(String(c.classCode ?? c.code ?? "").trim().toUpperCase()));
      need = acRate.length === 0 || acRate.some((c) => String(c.status ?? "UNKNOWN").toUpperCase() === "UNKNOWN");
    } else need = rows.length <= 1 || unknown();

    if (need) {
      out.push(number);
      if (out.length >= max) break;
    }
  }
  return out;
}
