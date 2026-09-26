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
const SEAT_ROW_CLASS = "1A|2A|3A|3E|SL|CC|2S|EC|EA|FC";
const SEAT_ROW_STATUS = "AVL|AVAILABLE|AVAIL|RAC|WL|WAITLIST|N\\/A|NOT[ _]?AVAILABLE|REGRET|CANCELLED|DEPARTED";
/* Ek "row chunk": train number se shuru hone wali row (`* 12013 NAAM · CC · AVAILABLE 418 seats · ₹675`)
 * ya separator ke baad aane wali class (`· EC AVL 23 ₹1,015` — dense summary line me). */
const SEAT_ROW_CHUNK = new RegExp(
  "(?:" +
    "(?:[*•]\\s*)?\\d{4,5}\\s[^\\n]*?\\b(?:" + SEAT_ROW_CLASS + ")\\b[^A-Za-z0-9]{0,6}(?:" + SEAT_ROW_STATUS + ")\\b" +
    "|" +
    "[·•|]\\s*\\b(?:" + SEAT_ROW_CLASS + ")\\b[^A-Za-z0-9]{0,6}(?:" + SEAT_ROW_STATUS + ")\\b" +
  ")" +
  "(?:\\s*\\d{1,4})?(?:\\s*seats?)?(?:\\s*[·•|,;:—–\\-]{0,4}\\s*₹\\s?[\\d,]+)?",
  "gi",
);

/** Row-list lines (jo block me behtar shakal me hain) hataata hai — line ke saath chipka prose bacha ke. */
export function stripDuplicatedSeatRows(text: string): string {
  /* AI aksar pehli row ko intro line ke saath chipka deta hai ("… hain: * 12013 …") — pehle usse
   * apni line par le aao, taaki intro sentence bachi rahe aur row alag hat sake. */
  const normalized = String(text ?? "").replace(/\s+(?=[*•]\s*\d{4,5}[\s·•|—-])/g, "\n");
  const out: string[] = [];
  for (const raw of normalized.split("\n")) {
    const t = raw.trim();
    if (!t) {
      out.push(raw);
      continue;
    }
    /* Purani shakal: "* 12013 NAAM — SL — AVAILABLE 444 seats — ₹675" */
    if (/^\*\s*\d{4,5}\s+.+?\s[—-]\s*(?:1A|2A|3A|3E|SL|CC|2S|EC|EA|FC)\b/i.test(t)) continue;
    const chunks = t.match(SEAT_ROW_CHUNK);
    if (chunks && chunks.length) {
      /* Seat-list ki headline line (💺 wali summary ya "18 seat wali trains — …"): rows hatt gayi to
       * sirf adhoora header bachta hai — poori line hi hata do. */
      if (t.startsWith("💺") || /seat wali \d+ trains|trains? (?:me|mẽ) seat/i.test(t)) continue;
      const leftover = t
        .replace(SEAT_ROW_CHUNK, " ")
        .replace(/[\s·•|,;:]+/g, " ")
        .replace(/\s+([.,!?])/g, "$1")
        .trim();
      if ((leftover.match(/[A-Za-z]{3,}/g) ?? []).length >= 1) out.push(leftover);
      continue;
    }
    const tokens = t.match(new RegExp("\\b(?:" + SEAT_ROW_CLASS + ")\\b[^A-Za-z0-9]{0,6}(?:" + SEAT_ROW_STATUS + ")\\b", "gi"));
    if (tokens && tokens.length >= 2) continue;
    out.push(raw);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
