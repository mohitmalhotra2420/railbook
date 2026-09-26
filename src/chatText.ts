/* Round-25 (26 Sep 2026, user screenshot 2 me last line): "+5 aur SL available trains Seat Finder
 * card mein hain. ⚙️ find seats".
 *
 * Wajah: purane rounds me chat ke andar ek "Seat Finder card" mount hota tha, aur us waqt AI ki line
 * "baaki trains Seat Finder card me" sach thi. Round-21c me wo card chat se hata diya gaya (user:
 * "seat finder aur direct trains ab same hi hain") — par AI apne jawab me wahi baat likhta raha, aur
 * chat me aisa koi card dikhta hi nahi. Yaani user ko jhoothi jagah bheja ja raha tha.
 *
 * Server ab saari trains isi jawab me likhta hai (seatFilter.missingSeatLines + prompt rule), aur ye
 * helper **safety net** hai: agar kabhi model phir bhi aisa pointer likh de to dikhne se pehle hi
 * saaf ho jaata hai ("card" ka zikr hat jaata hai, baaki baat waisi hi rehti hai — kuch chhupta nahi).
 */
const SEAT_CARD_POINTER =
  /\s*\(?\s*(?:seat\s*finder|seatfinder)\s*(?:ka|ki|ke)?\s*card\s*(?:mein|me|me|ke\s*andar|andar|par)?\s*\)?\s*/gi;

/**
 * Round-27 (26 Sep, user: "yahan koi class pe tap kare to seedha passenger form pe laajao"): chat me
 * seat ka jawab ab train-wise tappable block me aata hai (SeatListBlock — har train ki saari classes).
 * Us block me wahi rows hain jo AI ne text me likhi hoti hain, isliye text wali `* 12013 … — SL — …`
 * lines hatane se page saaf rehta hai — data kahin chhupta nahi (block me saari classes dikhti hain,
 * aur zyada detail ke saath). 💺 summary line aur baaki prose waise hi rehte hain.
 */
export function stripDuplicatedSeatRows(text: string): string {
  const lines = String(text ?? "").split("\n");
  const kept = lines.filter((l) => {
    const t = l.trim();
    if (!t.startsWith("*")) return true;
    /* Seat row ki shakal: "* 12013 NAAM — SL — AVAILABLE 444 seats — ₹675" */
    return !/^\*\s*\d{4,5}\s+.+?\s[—-]\s*(?:1A|2A|3A|3E|SL|CC|2S|EC|EA|FC)\b/i.test(t);
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function stripSeatCardPointer(text: string, withSeatBlock = false): string {
  let t = String(text ?? "");
  if (withSeatBlock) t = stripDuplicatedSeatRows(t);
  if (!/seat\s*finder|seatfinder/i.test(t)) return t;
  return t
    .replace(SEAT_CARD_POINTER, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/ +\n/g, "\n")
    .trim();
}

/** Round-27: chat ke seat answer ki rows → train-wise groups (har train ki saari classes ek saath).
 *  Server ke seatFilter payload (live board rows) par chalta hai — kuch invent nahi. */
export interface SeatListRow {
  number: string;
  name: string;
  classCode: string;
  status: string;
  seats: number | null;
  rac: number | null;
  waitlist: number | null;
  fare: number | null;
  departure: string | null;
}
export function seatListGroups(rows: SeatListRow[]): { number: string; name: string; rows: SeatListRow[]; seatCount: number }[] {
  const map = new Map<string, { number: string; name: string; rows: SeatListRow[]; seatCount: number }>();
  for (const r of rows) {
    const g = map.get(r.number) ?? { number: r.number, name: r.name, rows: [], seatCount: 0 };
    g.rows.push(r);
    if (r.status === "AVAILABLE" || r.status === "RAC") g.seatCount += 1;
    map.set(r.number, g);
  }
  return [...map.values()];
}
