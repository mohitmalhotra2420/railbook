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

export function stripSeatCardPointer(text: string): string {
  const t = String(text ?? "");
  if (!/seat\s*finder|seatfinder/i.test(t)) return t;
  return t
    .replace(SEAT_CARD_POINTER, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/ +\n/g, "\n")
    .trim();
}
