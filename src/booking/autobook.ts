/**
 * Round-29 (26 Sep, user screenshot: "22432 mein 3A book krdo" → AI wahin "check kar raha hoon"
 * ghuma-ghuma ke kehta raha aur passenger form kabhi nahi khula; "Check hui?" par bhi wahi jawab).
 * User: "AI khud passenger form pe shift ho jaye… user ko dobara nahi poochhna pade… seat-check flow
 * atka na rahe."
 *
 * Yahan sirf RESOLUTION logic hai (pure, testable): booking intent par kaunsi row banti hai.
 *   • train number / class / route / date humein bahar se milte hain (user ka message + client
 *     state + provider rows) — yahan koi andaza, koi naya number/naam, koi fare guess nahi.
 *   • status pata na ho (UNKNOWN) to bhi form khulta hai: asli availability + fare booking ke
 *     "Review journey" step par provider se aate hain (booking/context.tsx → api.availability/fare).
 *   • sirf jab train/class chal hi nahi rahi (N/A / REGRET / CANCELLED) tab form nahi khulta —
 *     wahan pehle fresh check maangna sahi hai.
 */
import type { SeatRow } from "../seatfinder";

/** In statuses par passenger form kholna sahi hai (badge me jhootha "available" nahi likhte). */
export const OPENABLE_STATUSES = ["AVAILABLE", "RAC", "WAITLIST", "UNKNOWN"] as const;

export function isOpenableStatus(status?: string | null): boolean {
  return (OPENABLE_STATUSES as readonly string[]).includes(String(status ?? "").toUpperCase());
}

/** Live board / seat rows ka chhota shape (server payload se, jaise ka taisa). */
export type AutoBookRow = {
  number: string;
  name?: string | null;
  classCode?: string | null;
  status?: string | null;
  seats?: number | null;
  rac?: number | null;
  waitlist?: number | null;
  fare?: number | null;
  departure?: string | null;
};

/** Train list (traintable) ka row — sirf timings/naam ke liye. */
export type AutoBookTrainRow = {
  number: string;
  name?: string | null;
  departure?: string | null;
  arrival?: string | null;
  durationLabel?: string | null;
  classes?: string[] | null;
  fare?: { classCode: string; amount: number } | null;
};

/**
 * Booking ke liye row chuno:
 *   • class boli gayi ho → usi class ki openable row;
 *   • class boli hi na ho → us train ki pehli openable row (jo list me dikhi thi — order preserve).
 * Kuch na mile to null (phir bhi form khulta hai, sirf status UNKNOWN rehta hai).
 */
export function pickRowForBooking(
  rows: AutoBookRow[],
  trainNumber: string,
  classWanted?: string | null,
): AutoBookRow | null {
  const same = rows.filter((r) => String(r.number ?? "") === String(trainNumber ?? ""));
  if (classWanted) {
    return (
      same.find(
        (r) => String(r.classCode ?? "").toUpperCase() === classWanted.toUpperCase() && isOpenableStatus(r.status),
      ) ?? null
    );
  }
  /* Round-35 (user: "19028 mein multiple class me seats available thi... AI ne class nahi poochhi"):
   * class boli hi na ho to pehle SEAT WALI class chuno (AVAILABLE/RAC) — WL/N-A row pehle aa jaye to
   * uspe form nahi kholna. Ek se zyada seat-wali class ho to client user se poochhta hai (classchoice). */
  const withSeats = same.filter((r) => String(r.status ?? "").toUpperCase() === "AVAILABLE" || String(r.status ?? "").toUpperCase() === "RAC");
  return withSeats.find((r) => isOpenableStatus(r.status)) ?? same.find((r) => isOpenableStatus(r.status)) ?? null;
}

/**
 * SeatRow (booking engine ka input) banao — jo data hai wahi, kuch invent nahi.
 * class/route/date slot sirf tab khaali-ish rehte hain jab row me kuch na ho (form me dikh jaayega).
 */
export function buildAutoBookSeat(args: {
  trainNumber: string;
  classWanted?: string | null;
  row?: AutoBookRow | null;
  trainRow?: AutoBookTrainRow | null;
  source?: string | null;
}): SeatRow {
  const { trainNumber, classWanted, row, trainRow, source } = args;
  const status = String(row?.status ?? "UNKNOWN").toUpperCase();
  const count = row?.seats ?? row?.rac ?? row?.waitlist ?? null;
  const code = (row?.classCode ?? classWanted ?? trainRow?.classes?.[0] ?? "—") as SeatRow["classCode"];
  const listFare = trainRow?.fare && (!row?.classCode || trainRow.fare.classCode === row.classCode) ? trainRow.fare.amount : null;
  return {
    number: String(trainNumber ?? ""),
    name: String(row?.name ?? trainRow?.name ?? ""),
    departure: row?.departure ?? trainRow?.departure ?? null,
    arrival: trainRow?.arrival ?? null,
    durationLabel: trainRow?.durationLabel ?? null,
    classCode: code,
    status,
    seats: status === "AVAILABLE" ? count : null,
    rac: status === "RAC" ? count : null,
    waitlist: status === "WAITLIST" ? count : null,
    fare: row?.fare ?? listFare ?? null,
    seat: status === "AVAILABLE" || status === "RAC",
    timesKnown: Boolean(row?.departure ?? trainRow?.departure),
    source: source ?? null,
  };
}

/**
 * Round-29 (26 Sep, user: "22432 mein 3A book krdo" par AI khud passenger form pe shift ho jaye,
 * details pehle se bhari hon — "check hui?" dobara na poochhna pade). Yahan sirf ye decode hota hai
 * ki user BOOKING maang raha hai ya nahi — train/class/route/date kahin se invent nahi hote (wo
 * message + verified rows + client state se aate hain). Sawaal ("kya book kar sakta hoon?") par
 * kabhi trigger nahi hota, aur model ka koi andaza isme shaamil nahi.
 */
export function isBookingIntent(text: string, intent?: string | null): boolean {
  if (intent === "BOOK_TRAIN") return true;
  const t = String(text ?? "").toLowerCase();
  const imperative = /\b(?:kardo|krdo|kar\s*do|kr\s*do|karo|kro|kijiye|dena|de\s*do|do)\b/.test(t);
  /* Sawaal jaisa sawaal (aur koi seedha hukm nahi) → booking nahi. */
  if (/[?？]/.test(t) && !imperative) return false;
  const asked = /\b(?:book|booking|reserve)\b[\s\S]{0,28}?\b(?:kar|kro|kardo|krdo|kr|karo|kijiye|do|de|dena|chahiye|chaiye)\b/.test(t);
  if (asked) return true;
  /* Round-34 (user screenshot: "Book 12380" — AI ne phir passengers poochh liye aur seat list dobara
   * dekhne chala, jabki seats pehle hi dikh chuki thi): seedha "book <train-number>" bhi ek hukm hai —
   * isme koi "kar/krdo" shabd nahi hota. Train number ke bina akele "book" par trigger NAHI hota
   * (warna "book karna hai?" jaise sawaal/speculation pakde jayenge — wo upar ke guards se bhi
   * rukte hain, par yahan safe rehna hai). */
  if (/\b(?:book|booking|reserve)\b[\s\S]{0,24}?\b\d{4,5}\b/.test(t) && !/[?？]/.test(t)) return true;
  if (/\b\d{4,5}\b[\s\S]{0,18}?\b(?:book|booking|reserve)\b/.test(t) && !/[?？]/.test(t)) return true;
  return /\bticket\b[\s\S]{0,20}?\b(?:kar|book|kro|kardo|krdo|chahiye|chaiye|do|dena)\b/.test(t);
}


/* ── Round-37 (27 Sep, user screenshot: "12054 mein 2S book krdo" TEEN BAAR bheja, AI ne teen
 * baar wahi class-sawaal dohraya aur passenger form khula hi nahi) ──────────────────────────────
 * Root cause: form kholne wala client gate route/date sirf `state.from/to` + `ctx.origin/destination`
 * se leta tha. Jab user ne train picker se train chuni thi (ya model ne seat data diya tha), ctx me
 * origin/destination null reh jaate hain → gate fail → koi form nahi, aur model wahi sawaal dohra deta.
 *
 * `resolveBookingTarget` har verified source se train/class/route/date nikaalta hai (recency order,
 * koi andaza nahi) aur batata hai kya missing hai — taaki UI sahi cheez maange, galat sawaal nahi. */
export type BookingTargetSources = {
  /** User ke message se / context se train number (pehle se nikaala hua). */
  trainNumber: string | null;
  /** User ne is message me class boli ho to. */
  classWanted: string | null;
  state: {
    from: { code: string } | null;
    to: { code: string } | null;
    date: string;
    dateProvided: boolean;
    selectedTrain: { number: string; from?: { code: string } | null; to?: { code: string } | null; date?: string | null } | null;
  };
  ctx: { origin?: { code: string } | null; destination?: { code: string } | null; date?: string | null; dateProvided?: boolean | null } | null;
  /** Aakhri picker tap (client ne khud bheja tha: "12054 … (ASR → HW) select ki"). */
  picked: { number: string; from: string; to: string; date?: string | null } | null;
  /** Is turn ka seatFilter (server) — asli seat data. */
  seat: { from?: string | null; to?: string | null; date?: string | null } | null;
  /** Pichhle seat turn ki yaad rakhi rows (route+date). */
  remembered: { from: string; to: string; date: string; rows: { number: string }[] } | null;
  /** Is turn ki train list rows (route ke liye). */
  trains: { number: string; from?: { code: string } | null; to?: { code: string } | null }[] | null;
  /** Round-37b: user ke apne pichhle messages se nikaala hua route/date (jaise "ASR se HW kal"). */
  said?: { from?: string; to?: string; date?: string } | null;
};

export type BookingTarget = {
  trainNumber: string | null;
  classCode: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  missing: ("train" | "route" | "date")[];
};

export function resolveBookingTarget(s: BookingTargetSources): BookingTarget {
  const trainNumber = String(s.trainNumber ?? "").trim() || null;
  const classCode = String(s.classWanted ?? "").trim().toUpperCase() || null;
  const num = trainNumber ?? "";

  const trainRow = (s.trains ?? []).find((t) => String(t.number) === num) ?? null;
  const picked = s.picked && (!num || String(s.picked.number) === num) ? s.picked : null;
  const sel = s.state.selectedTrain && (!num || String(s.state.selectedTrain.number) === num) ? s.state.selectedTrain : null;
  const inRemembered = Boolean(s.remembered && num && s.remembered.rows.some((r) => String(r.number) === num));
  const remembered = s.remembered && (!num || inRemembered) ? s.remembered : null;

  /* Route: jo source sabse taaza/authoritative ho wahi — sab verified data se aate hain. */
  const route =
    (sel?.from?.code && sel?.to?.code ? { from: sel.from.code, to: sel.to.code } : null) ??
    (s.seat?.from && s.seat?.to ? { from: s.seat.from, to: s.seat.to } : null) ??
    (picked ? { from: picked.from, to: picked.to } : null) ??
    (remembered ? { from: remembered.from, to: remembered.to } : null) ??
    (trainRow?.from?.code && trainRow?.to?.code ? { from: trainRow.from.code, to: trainRow.to.code } : null) ??
    (s.ctx?.origin?.code && s.ctx?.destination?.code ? { from: s.ctx.origin.code, to: s.ctx.destination.code } : null) ??
    (s.said?.from && s.said?.to ? { from: s.said.from, to: s.said.to } : null) ??
    (s.state.from?.code && s.state.to?.code ? { from: s.state.from.code, to: s.state.to.code } : null);

  /* Date: user/server ne jo di — form ka default (aaj) kabhi nahi. */
  const date =
    (s.state.dateProvided && s.state.date ? s.state.date : "") ||
    (s.ctx?.dateProvided && s.ctx?.date ? s.ctx.date : "") ||
    (s.seat?.date ?? "") ||
    (remembered?.date ?? "") ||
    (picked?.date ?? "") ||
    (s.said?.date ?? "") ||
    (sel?.date ?? "") ||
    (s.ctx?.date ?? "") ||
    (s.state.date ?? "");

  const missing: BookingTarget["missing"] = [];
  if (!trainNumber) missing.push("train");
  if (!route?.from || !route?.to) missing.push("route");
  if (!date) missing.push("date");

  return {
    trainNumber,
    classCode,
    from: route?.from ?? null,
    to: route?.to ?? null,
    date: date || null,
    missing,
  };
}


/* ── Round-37b ─────────────────────────────────────────────────────────────────────────────────
 * Server ka context har turn par route/date reset kar deta hai (kai baar dono null ho jaate hain —
 * "12054 mein 2S book krdo" ke turn me origin/destination/date sab null the), aur phir client ka form
 * gate route/date na hone par chup-chaap kuch nahi karta. Isliye user ke APNE pichhle messages se
 * route/date nikaala jaata hai (jo usne khud bola: "ASR se HW kal ke liye") — koi andaza nahi, sirf
 * user ke shabdon ka matlab. Station ke naam local catalogue se code me map hote hain. */
export type ChatTurn = { role: string; text: string };

const DATE_WORDS: { re: RegExp; days: number }[] = [
  { re: /\b(aaj|today|aj)\b/i, days: 0 },
  { re: /\b(kal|tomorrow|kl)\b/i, days: 1 },
  { re: /\b(parso|parson|day after)\b/i, days: 2 },
];

export function extractRouteDateFromChat(
  messages: ChatTurn[],
  opts: {
    todayYmd: string;
    addDays: (ymd: string, days: number) => string;
    stationByCode?: (code: string) => { code: string } | undefined;
    matchStationFuzzy?: (raw: string) => { code: string } | undefined;
  },
): { from?: string; to?: string; date?: string } {
  const users = messages.filter((m) => m.role === "user" && m.text).slice(-8).reverse();
  let from: string | undefined;
  let to: string | undefined;
  let date: string | undefined;
  const codeOk = (c: string) => (/^[A-Z]{2,5}$/.test(c) && (opts.stationByCode ? Boolean(opts.stationByCode(c)) : true));
  for (const m of users) {
    const t = m.text;
    if (!from || !to) {
      /* 1) codes: "ASR se HW", "LDH → NDLS", "LDH to NDLS" */
      const codes = /\b([A-Z]{2,5})\s*(?:se|to|→|->|—>)\s*([A-Z]{2,5})\b/.exec(t);
      if (codes && codeOk(codes[1]) && codeOk(codes[2]) && codes[1] !== codes[2]) {
        from = from ?? codes[1];
        to = to ?? codes[2];
      } else {
        /* 2) station ke naam: "ludhiana se amritsar", "ambala se delhi" */
        const names = /\b([a-z][a-z .]{2,22}?)\s*(?:se|to|→|->)\s*([a-z][a-z .]{2,22}?)\b(?!.*\b(?:se|to)\b)/i.exec(t);
        if (names && opts.matchStationFuzzy) {
          const a = opts.matchStationFuzzy(names[1].trim());
          const b = opts.matchStationFuzzy(names[2].trim());
          if (a && b && a.code !== b.code) {
            from = from ?? a.code;
            to = to ?? b.code;
          }
        }
      }
    }
    if (!date) {
      const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(t);
      if (dmy) {
        const [dd, mm, yy] = [dmy[1].padStart(2, "0"), dmy[2].padStart(2, "0"), dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]];
        date = `${yy}-${mm}-${dd}`;
      } else {
        const hit = DATE_WORDS.find((w) => w.re.test(t));
        if (hit) date = opts.addDays(opts.todayYmd, hit.days);
      }
    }
    if (from && to && date) break;
  }
  return { from, to, date };
}
