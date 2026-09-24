/* Seat-intent samajhna — SERVER side (24 Sep 2026).
 *
 * User: "yeh jo seat intent questions hain AI khud samjhe and filter kare, jaisa tum plan kar rahe the;
 *        jo client side jo tumne build kara hai wo fallback me use karo. Baaki AI ka search karne ka
 *        way, tools calling ka way, API calling ka way, alternatives/connecting journeys ka logic
 *        mat change karna."
 *
 * Ye module SIRF bhasha padhta hai (Hindi / Devanagari / English / Hinglish) — koi provider call nahi,
 * koi LLM call nahi, koi tool/API change nahi. Client ke `src/seatfinder.ts` ke wahi 14 patterns ka
 * server mirror hai, taaki har surface (app, API caller, voice) ek hi vocabulary samjhe.
 *
 * Flag: SEAT_FILTER_SERVER (default ON). Off karo to ye layer sirf log hoti hai, behaviour aaj jaisa.
 */

export type SeatSortBy = "fastest" | "cheapest";

export interface SeatIntentSlots {
  /** User seat/availability ke baare me poochh raha hai? */
  seatIntent: boolean;
  /** Kis class ki baat ho rahi hai (khaali array = "sab class" / koi filter nahi). */
  classCodes: string[];
  /** "seat wali" = AVAILABLE + RAC (dono me seat pakki hone ke kareeb). */
  onlyAvailable: boolean;
  /** "sirf confirmed" — aaj onlyAvailable jaisa hi treat hota hai. */
  confirmedOnly: boolean;
  /** "sabse jaldi" / "sabse sasta". */
  sortBy: SeatSortBy | null;
  /** "5 baje ke baad" → minute-of-day (17:00 = 1020). */
  departAfterMinute: number | null;
  /** TQ (tatkal) / PT (premium tatkal) / LD (ladies) — GN default. */
  quota: string | null;
  /** Kin shabdon se samjha (diagnostics; koi PII nahi). */
  matched: string[];
}

/* ── class: Devanagari numerals, Hindi shabd, Hinglish, English ────────────── */
const CLASS_RULES: [RegExp, string][] = [
  [/\b1a\b|\b1ac\b|\b1\s*ac\b|first\s*(?:ac|class)|(?:१|1)\s*(?:ए|एसी)|पहली\s*(?:एसी|श्रेणी)/i, "1A"],
  [/\b2a\b|\b2ac\b|\b2\s*ac\b|second\s*ac|second\s*class|2nd\s*ac|(?:२|2)\s*(?:ए|एसी)|दूसरी\s*(?:एसी|श्रेणी)/i, "2A"],
  [/\b3e\b|3\s*economy|third\s*economy|(?:३|3)\s*economy/i, "3E"],
  [/\b3a\b|\b3ac\b|\b3\s*ac\b|third\s*(?:ac|class)|3rd\s*ac|(?:३|3)\s*(?:ए|एसी)|तीसरी\s*(?:एसी|श्रेणी)/i, "3A"],
  [/sleeper|\bsl\b|स्लीपर|शयनयान/i, "SL"],
  [/executive|\bec\b|एग्ज़ीक्यूटिव|एग्जीक्यूटिव/i, "EC"],
  [/chair\s*car|\bcc\b|चेयर\s*कार/i, "CC"],
  [/\b2s\b|second\s*sitting|sitting\s*class|सेकंड\s*सिटिंग/i, "2S"],
];
/* "sab class / koi bhi class / paise ka farq nahi" → koi class filter nahi. */
const NO_CLASS = /sab\s*class|sabhi\s*(?:class|क्लास)|koi\s*bhi\s*class|किसी\s*भी\s*(?:class|क्लास)|any\s*class|all\s*class/i;

const SEAT_WORDS =
  /\b(seat|seats|berth|berths|available|availability|avl|vacant|khali|khaali|jagah)\b|सीट|बर्थ|जगह|खाली|उपलब्ध/iu;
const QUESTION_WORDS = /(hai|hain|है|हैं|क्या|kaun|which|konsi|konsi\s*si|dikha|दिखा|batao|बताओ|chahiye|चाहिए)/iu;
const CONFIRMED_WORDS =
  /(?:sirf|only|केवल|सिर्फ)[^.!?]{0,16}(?:confirm|confirmed|कन्फर्म)|(?:confirmed|confirm)\s*(?:seat|seats|ticket|tickets)|कन्फर्म/i;
const FASTEST_WORDS =
  /sabse\s*(?:jaldi|fast|tez|तेज़)|fastest|kam\s*time|jaldi\s*pahunch|सबसे\s*(?:जल्दी|तेज़)|कम\s*समय/iu;
const CHEAPEST_WORDS =
  /sabse\s*sast|low\s*fare|cheapest|kam\s*kiraya|budget|सस्त|कम\s*किराया/iu;

function classFrom(text: string): string[] {
  if (NO_CLASS.test(text)) return [];
  const out: string[] = [];
  for (const [re, code] of CLASS_RULES) {
    if (re.test(text) && !out.includes(code)) out.push(code);
  }
  return out;
}

function pmOf(text: string): -1 | 0 | 1 {
  /* -1 = subah (am hi rahega), 1 = shaam/raat (pm banao), 0 = koi hint nahi */
  if (/सुबह|subah|morning|सवेरे/i.test(text)) return -1;
  if (/रात|raat|night|शाम|shaam|sham|evening|दोपहर|dopahar|afternoon/i.test(text)) return 1;
  return 0;
}

/** "5 baje ke baad" → 17:00 (shaam), "after 5" → 05:00 (literal), "17:30 ke baad" → 17:30. */
export function departAfterMinute(text: string): number | null {
  const t = String(text ?? "");
  const hm =
    /(\d{1,2}):(\d{2})\s*(?:ke\s*baad|के\s*बाद|baad|after)/i.exec(t) ||
    /(?:after|baad|बाद)\s*(\d{1,2}):(\d{2})/i.exec(t);
  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (h <= 23 && m <= 59) return h * 60 + m;
  }
  /* "रात 9 के बाद" / "शाम 5 के बाद" / "सुबह 6 के बाद" — baje shabd ke bina bhi. */
  const pref =
    /(?:सुबह|शाम|रात|दोपहर|सवेरे|subah|shaam|sham|raat|dopahar|morning|evening|night|afternoon)\s*(\d{1,2})\s*(?:ke\s*baad|के\s*बाद|baad)/i.exec(t);
  if (pref) {
    const raw = Number(pref[1]);
    if (raw > 23) return null;
    const pm = pmOf(t);
    const h = pm === -1 ? raw : pm === 1 ? (raw % 12) + 12 : raw <= 7 ? raw + 12 : raw;
    return (h % 24) * 60;
  }
  const baje = /(\d{1,2})\s*(?:baje|बजे|bje)\s*(?:ke\s*baad|के\s*बाद|baad)/i.exec(t);
  if (baje) {
    const raw = Number(baje[1]);
    if (raw > 23) return null;
    const pm = pmOf(t);
    const h = pm === -1 ? raw : pm === 1 ? (raw % 12) + 12 : raw <= 7 ? raw + 12 : raw;
    return (h % 24) * 60;
  }
  const en = /(?:after|baad\s*se)\s*(\d{1,2})\b/i.exec(t);
  if (en) {
    const raw = Number(en[1]);
    if (raw <= 23) return raw * 60;
  }
  return null;
}

export function parseSeatIntent(rawText: string): SeatIntentSlots {
  const text = String(rawText ?? "");
  const classCodes = classFrom(text);
  const matched: string[] = [];
  const seatWord = SEAT_WORDS.test(text);
  const hasQuestion = QUESTION_WORDS.test(text);
  const confirmedOnly = CONFIRMED_WORDS.test(text);
  const earliest = FASTEST_WORDS.test(text);
  const cheapest = CHEAPEST_WORDS.test(text);
  const departAfterMinuteValue = departAfterMinute(text);
  const quota = /premium\s*tatkal|प्रीमियम\s*तत्काल/i.test(text)
    ? "PT"
    : /tatkal|तत्काल/i.test(text)
      ? "TQ"
      : /ladies|महिला/i.test(text)
        ? "LD"
        : null;

  if (seatWord) matched.push("seat-word");
  if (classCodes.length) matched.push(`class:${classCodes.join("+")}`);
  if (confirmedOnly) matched.push("confirmed");
  if (earliest) matched.push("sort:fastest");
  if (cheapest) matched.push("sort:cheapest");
  if (departAfterMinuteValue != null) matched.push(`after:${departAfterMinuteValue}`);
  if (quota) matched.push(`quota:${quota}`);

  /* Seat intent = seat ka zikr, ya class + sawaal ("2A hai?"), ya sirf-confirmed / sort maanga gaya. */
  const seatIntent = seatWord || confirmedOnly || (classCodes.length > 0 && hasQuestion);

  return {
    seatIntent,
    classCodes,
    onlyAvailable: seatIntent,
    confirmedOnly,
    sortBy: cheapest ? "cheapest" : earliest ? "fastest" : null,
    departAfterMinute: departAfterMinuteValue,
    quota,
    matched,
  };
}
