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
