/* ══ AI BOOKING (ADDITIVE, Round-62) — conversational booking ka state machine ══════════════════════════
 * User: "RailBook me ek prominent 'AI Booking' option add karo — user text se bhi booking kar sake aur voice
 * se bhi… AI kabhi train, timing, fare, availability ya status invent nahi karega… existing booking state
 * machine ko replace mat karo, reuse/extend karo."
 *
 * Isliye ye file PURE hai (koi React/koi fetch nahi, koi data apne se nahi banati):
 *   • Slots nikaalne ke liye repo ke maujooda helper use karti hai — `findStationsInText` (stations catalog),
 *     `parseDatePhrase` (date phrases), `BERTH_BY_CLASS`/`CLASS_LABELS` (classes), `parsePassengerSpeech`
 *     (passenger fields) — sab additive reuse, koi naya provider/API nahi.
 *   • Jo data iske paas nahi hota (trains list, classes, fare, availability) wo caller se aata hai
 *     (`trains`, `classes`) — matlab UI jo asli search/board dikha raha hai wahi source of truth hai.
 *     Train/class list me na mile to saaf "nahi mila" bolti hai, kabhi naam se guess nahi karti.
 *   • Side effects (actual search, passenger form, review) ke liye sirf ACTION descriptors deti hai;
 *     unhe maujooda booking state machine (booking/context.tsx ke searchRoute/selectClass/
 *     selectTrainAndClassGo/goReview) chalata hai. Yahan koi doosra booking implementation nahi hai.
 *
 * Stages (user ne yahi maange):
 *   AI_BOOKING_START → COLLECT_JOURNEY → SEARCH_TRAINS → SHOW_TRAIN_OPTIONS → TRAIN_SELECTED →
 *   CLASS_SELECTION → PASSENGER_COLLECTION → PASSENGER_REVIEW → BOOKING_REVIEW → FINAL_CONFIRMATION →
 *   IRCTC_HANDOFF
 */
import { parseDatePhrase } from "./dates";
import { CITY_NAME_ALIASES, CLUSTER_CITY_CODES, clusterStations, findStationMentionsInText, findStationsInText } from "./stations";
import { matchOfferedStation } from "./stationPick";
import { BERTH_BY_CLASS, CLASS_LABELS, type ClassAvailability, type ClassCode, type Passenger, type Station, type TrainResult } from "../types";
import { parsePassengerSpeech, type PaxAsk } from "../voice/passengerSpeech";
import { formatLongDate, inr } from "../format";

export const AI_BOOKING_STAGES = [
  "AI_BOOKING_START",
  "COLLECT_JOURNEY",
  "SEARCH_TRAINS",
  "SHOW_TRAIN_OPTIONS",
  "TRAIN_SELECTED",
  "CLASS_SELECTION",
  "PASSENGER_COLLECTION",
  "PASSENGER_REVIEW",
  "BOOKING_REVIEW",
  "FINAL_CONFIRMATION",
  "IRCTC_HANDOFF",
] as const;

export type AiBookingStage = (typeof AI_BOOKING_STAGES)[number];

/** Hindi/Hinglish labels — UI ki stage strip ke liye (internal naam user ko nahi dikhta). */
export const AI_BOOKING_STAGE_LABELS: Record<AiBookingStage, string> = {
  AI_BOOKING_START: "Shuru",
  COLLECT_JOURNEY: "Journey",
  SEARCH_TRAINS: "Search",
  SHOW_TRAIN_OPTIONS: "Trains",
  TRAIN_SELECTED: "Train",
  CLASS_SELECTION: "Class",
  PASSENGER_COLLECTION: "Passengers",
  PASSENGER_REVIEW: "Passenger check",
  BOOKING_REVIEW: "Review",
  FINAL_CONFIRMATION: "Confirm",
  IRCTC_HANDOFF: "IRCTC",
};

/** Kis cheez ka intezaar hai (agla sawaal) — UI isi se microcopy dikhata hai. */
export type AiBookingAsk =
  | "from"
  | "to"
  | "date"
  | "pax"
  | "train"
  | "class"
  | "paxName"
  | "paxAge"
  | "paxGender"
  | "paxBerth"
  /** Sirf tab poochha jata hai jab us train me catering/food options hon (maujooda pantry API). */
  | "paxFood"
  | "review"
  | "confirm"
  | null;

export interface AiPaxDraft {
  name?: string;
  age?: string;
  gender?: string;
  berthPreference?: string;
  /** Passenger form ka maujooda field (VEG / NON_VEG / NO_FOOD) — sirf jab user khud bole. */
  foodChoice?: string;
}

/** Sab side-effecting kaam caller (view) karta hai — maujooda booking flow ke through. */
export type AiBookingAction =
  | { type: "SEARCH"; from: Station; to: Station; date: string; pax: number }
  | { type: "SET_PASSENGER_COUNT"; count: number }
  | { type: "OPEN_PASSENGERS" }
  | { type: "PATCH_PASSENGER"; index: number; patch: AiPaxDraft }
  | { type: "REVIEW" }
  /* R62c (user: "sab kuch automate ho — AI khud review booking khole aur IRCTC bhi khud continue kare"):
   * OPEN_REVIEW → maujooda Review journey screen kholna; IRCTC_HANDOFF → usi screen ka maujooda
   * "Continue to IRCTC" button khud click karna (autofill layer waise hi chalti hai). */
  | { type: "OPEN_REVIEW" }
  | { type: "IRCTC_HANDOFF" }
  | { type: "RESET" };

export interface AiBookingState {
  stage: AiBookingStage;
  from: Station | null;
  to: Station | null;
  /** ymd */
  date: string | null;
  pax: number | null;
  trainNumber: string | null;
  trainName: string | null;
  classCode: string | null;
  /** Kaunsa passenger bhar rahe hain (0-based). */
  paxIndex: number;
  /** Form ka mirror — asli record booking context me hi rehta hai (yahan sirf agla sawaal decide hota hai). */
  drafts: AiPaxDraft[];
  awaiting: AiBookingAsk;
  /** Aakhri AI lines (UI thread + voice ke liye). */
  spoken: string[];
  /** IRCTC handoff tak pahunch gaye (user ke explicit confirmation ke baad hi). */
  handoff: boolean;
  /** User ne final confirmation diya. */
  confirmed: boolean;
  /** View ko batane ke liye ki search chhidi hui hai (Thinking… dikhane ke liye). */
  searching: boolean;
  /** R63-fix: "delhi"/"दिल्ली" jaise city naam jisme kai station hain — kaunsa station, ye ek hi
   *  sawaal baaki hai (loop nahi). Jawab aate hi slot bhar jaata hai. */
  pendingCity: AiPendingCity | null;
  /** Ek message me do city aayein ("jalandhar se mumbai") → dono ka sawaal ek-ek karke, dobara nahi. */
  pendingQueue: AiPendingCity[];
}

/** City (cluster) ka pending sawaal — asli station codes catalog se, invent nahi. */
export interface AiPendingCity {
  city: string;
  slot: "from" | "to";
  codes: string[];
  /** User ne dobara wahi city boli (ya "koi bhi") → default station + saaf disclosure. */
  asked: boolean;
}

export interface AiBookingTurn {
  state: AiBookingState;
  say: string[];
  actions: AiBookingAction[];
}

export interface AiBookingEnv {
  now?: Date;
  /** Asli search result (booking context ke state.trains) — train selection isi se hota hai. */
  trains?: TrainResult[];
  /** Chuni hui train ki asli classes. */
  classes?: ClassAvailability[];
  /** Us train me catering/food options hain? (maujooda pantry API se, read-only).
   *  false/null = food ka sawaal poochha hi nahi jaata — guess nahi. */
  foodExpected?: boolean | null;
}

const MAX_PAX = 6;

export function aiBookingBlank(now = new Date()): AiBookingState {
  void now;
  return {
    stage: "AI_BOOKING_START",
    from: null,
    to: null,
    date: null,
    pax: null,
    trainNumber: null,
    trainName: null,
    classCode: null,
    paxIndex: 0,
    drafts: [],
    awaiting: null,
    spoken: [],
    handoff: false,
    confirmed: false,
    searching: false,
    pendingCity: null,
    pendingQueue: [],
  };
}

/* ── chhote parsers (sab local + grounded; koi model/provider call nahi) ─────────────────────────── */

const PAX_WORDS: Record<string, number> = {
  ek: 1, one: 1, ik: 1, "1": 1,
  do: 2, two: 2, "2": 2,
  teen: 3, tin: 3, three: 3, "3": 3,
  char: 4, chaar: 4, four: 4, "4": 4,
  paanch: 5, panch: 5, five: 5, "5": 5,
  chhe: 6, cheh: 6, six: 6, "6": 6,
};

/** "2", "do passenger", "do logon", "hum 3 log hain" — sirf 1..6 (existing form ka cap).
 *  Dhyan: "1 October ko … 2 passengers" me date ka 1 pakad kar galti nahi karni — isliye pehle
 *  passenger-keyword se juda number dekha jata hai, phir date-jaisa number hata kar. */
const PAX_KW = "(?:passengers?|pax|log|logon|logon ka|tickets?|bandar|admi|aadmi|यात्री|टिकट|लोग|आदमी)";
const MONTH_WORD = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)";

export function parsePaxCount(text: string): number | null {
  const t = text.normalize("NFKC").toLowerCase();
  const ok = (n: number | undefined) => (n && n >= 1 && n <= MAX_PAX ? n : null);

  /* 1) number seedha passenger keyword ke saath: "2 passengers", "३ लोग" */
  const glued = t.match(new RegExp(`\\b([1-9])\\s*${PAX_KW}`));
  if (glued) return ok(Number(glued[1]));
  /* 2) shabd + keyword: "do log", "paanch passengers" */
  for (const [word, n] of Object.entries(PAX_WORDS)) {
    if (/^\d$/.test(word)) continue;
    if (new RegExp(`\\b${word}\\b\\s*${PAX_KW}`).test(t)) return ok(n);
  }
  /* 3) akela shabd: "do" / "teen" (date/train number ke saath nahi) */
  if (!/\b\d{4,5}\b/.test(t) && !new RegExp(`\\d{1,2}\\s*${MONTH_WORD}`).test(t)) {
    for (const [word, n] of Object.entries(PAX_WORDS)) {
      if (/^\d$/.test(word)) continue;
      if (new RegExp(`\\b${word}\\b`).test(t)) return ok(n);
    }
  }
  /* 4) akela digit (slot pax ke jawab me, jaise "2" ya "hum 2 hain") — date wale digit chhod kar */
  const digits = [...t.matchAll(/\b([1-9])\b/g)].filter((m) => {
    const at = (m.index ?? 0) + m[0].length;
    const rest = t.slice(at, at + 12);
    if (new RegExp(`^\\s*${MONTH_WORD}`).test(rest)) return false; /* "1 october" */
    if (/^\s*(ko|तारीख|tarikh|tareekh|tariq)/.test(rest)) return false; /* "1 ko" */
    return true;
  });
  if (digits.length === 1) return ok(Number(digits[0][1]));
  return null;
}

/** Correction me naya number aakhri hota hai ("2 passengers ki jagah 4 kar do") — wahi uthate hain. */
export function lastPaxNumber(text: string): number | null {
  const t = text.normalize("NFKC").toLowerCase();
  const cands: { idx: number; n: number }[] = [];
  for (const m of t.matchAll(new RegExp(`\\b([1-9])\\s*${PAX_KW}`, "g"))) cands.push({ idx: m.index ?? 0, n: Number(m[1]) });
  for (const [word, n] of Object.entries(PAX_WORDS)) {
    if (/^\d$/.test(word)) continue;
    for (const m of t.matchAll(new RegExp(`\\b${word}\\b\\s*${PAX_KW}`, "g"))) cands.push({ idx: m.index ?? 0, n });
  }
  for (const m of t.matchAll(/\b([1-9])\b(?!\s*(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|ko|तारीख|tarikh|tareekh|tariq))/g)) {
    cands.push({ idx: m.index ?? 0, n: Number(m[1]) });
  }
  if (!cands.length) return null;
  const best = cands.sort((a, b) => b.idx - a.idx)[0];
  return best.n >= 1 && best.n <= MAX_PAX ? best.n : null;
}

/** Berth/food ke shabd naam me na reh jaayein (maujooda parsePassengerSpeech naam me "Window"/"veg" chhod
 *  deta hai — wo fields apne-apne column me jaate hain, naam me nahi). */
/* R4-fix: "berth"/"seat"/"बर्थ" jaise generic shabd bhi naam me nahi ghusne chahiye — warna
 * "lower berth de do" par naam "Berth" ban jaata tha (R4 test me pakda gaya). */
const ANY_BERTH_WORD = /^(lower|upper|middle|middle-berth|side|side\s*lower|side\s*upper|window|aisle|berth|berths|birth|seat|seats|no\s*preference|लोअर|लोवर|अपर|मिडल|साइड|विंडो|बर्थ|सीट)$/i;

function stripExtraWords(name: string, berths: string[]): string {
  let out = name;
  for (const b of berths) {
    out = out.replace(new RegExp(`\\b${b}\\b`, "gi"), " ");
  }
  /* R63-fix: jo berth shabd is class me chalta hi nahi (jaise CC me "lower") wo bhi naam me na
   * ghusne paaye — warna "Neha Sharma Lower" jaisa ganda naam ban jaata tha (E2E me pakda gaya). */
  out = out
    .split(/\s+/)
    .filter((w) => w && !ANY_BERTH_WORD.test(w.trim()))
    .join(" ");
  out = out.replace(/\b(veg|non[\s-]?veg|vegetarian|shakahari|no\s*food|meal|khana|khaana|food|वेज|नॉन|शाकाहारी|भोजन|खाना)\b/gi, " ");
  /* R4-fix (screenshot 2): user ne Hindi me instruction bola ("बर्थ प्रेफरेंस में विंडो सेलेक्ट करो")
   * aur wo poora vaakya **naam** ban gaya tha. Ab instruction/filler shabd naam se hat jaate hain. */
  out = out.replace(
    /(बर्थ|बर्थ\s*प्रेफरेंस|प्रेफरेंस|preference|सेलेक्ट|select|choose|चुनो|चुन|चाहिए|चाहिये|करो|कर\s*दो|कर\s*दीजिये|कर\s*दीजिए|भरो|भर\s*दो|लगाओ|रखो|तय|दो|दीजिये|दीजिए|wala|wali|वाला|वाली)/giu,
    " ",
  );
  out = out.replace(/\b(me|mein|ma|mai|m|का|की|के|में|को|से|है|हूँ|हूं|ना|नहीं|karo|kar|do|de|de\s*do|hai|na)\b/giu, " ");
  return out.replace(/\s+/g, " ").trim();
}

/** R4-fix (screenshot 2): user ne Hindi me berth boli ("विंडो") aur AI samajh nahi paayi — sirf Latin
 *  berth naam match hote the. Ye chhota map usi class ki valid berths par lagta hai (invent nahi —
 *  jo berth us class me chalti hi nahi, wo yahan se bhi nahi aayegi). */
const BERTH_WORDS: { re: RegExp; berth: string }[] = [
  { re: /(विंडो|खिड़की|खिडकी|विंडो\s*साइड|window|khidki|khirki)/iu, berth: "Window" },
  { re: /(लोअर|लोवर|नीचे|निचली|lower|nichla|neeche)/iu, berth: "Lower" },
  { re: /(अपर|ऊपर|ऊपरी|upper|upar)/iu, berth: "Upper" },
  { re: /(मिडल|मध्य|बीच|middle|middle\s*berth)/iu, berth: "Middle" },
  { re: /(साइड\s*लोअर|साइड\s*लोवर|side\s*lower)/iu, berth: "Side Lower" },
  { re: /(साइड\s*अपर|साइड\s*ऊपर|side\s*upper)/iu, berth: "Side Upper" },
  { re: /(साइड|side)/iu, berth: "Side Lower" },
  { re: /(कोई\s*नहीं|कोई\s*भी|no\s*preference|koi\s*nahi)/iu, berth: "No Preference" },
];

/** Us class ki **valid** berth jo text me boli gayi ho (Hindi/English dono) — warna null. */
export function berthFromText(text: string, berths: string[]): string | null {
  if (!berths.length) return null;
  for (const { re, berth } of BERTH_WORDS) {
    if (!re.test(text)) continue;
    const hit = berths.find((b) => b.toLowerCase() === berth.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Khane ka choice — maujooda passenger form ka field (kabhi majboori nahi, sirf user bole to). */
export function parseFoodChoice(text: string): "VEG" | "NON_VEG" | "NO_FOOD" | null {
  const t = text.normalize("NFKC").toLowerCase();
  if (/(no\s*food|food\s*nahi|khana\s*nahi|khaana\s*nahi|khana nahi chahiye|without food|\bfood\s*no\b|भोजन नहीं|खाना नहीं)/i.test(t)) return "NO_FOOD";
  if (/(non[\s-]?veg|nonveg|chicken|mutton|fish|egg|anda|मटन|अंडा|नॉन)/i.test(t)) return "NON_VEG";
  if (/(\bveg\b|vegetarian|shakahari|शाकाहारी|वेज|सादा)/i.test(t)) return "VEG";
  return null;
}

/** Correction ("Actually 2 October kar do") — sirf jab text me safai se correction ka ishara ho. */
const CORRECTION_MARKER = /\b(actually|asli\s*me|asli\s*mein|arre|badal|badlo|change|instead|rather|ki\s+jagah|ke\s+jagah|nahi\s*se|kar\s*do|kar\s*dijiye|dusri|doosri|shift|moving)\b|असल में|बदल|की जगह|कर दो/i;

export function looksLikeCorrection(text: string): boolean {
  return CORRECTION_MARKER.test(text.normalize("NFKC"));
}

export function isYes(text: string): boolean {
  const t = text.normalize("NFKC").trim().toLowerCase();
  if (!t || t.length > 60) return false;
  return /\b(haan|han|ha|yes|yep|yeah|ok|okay|theek|thik|sahi|continue|aage|confirm|karun|karo|chalega|chalta hai|proceed|right)\b/.test(t) ||
    /(हाँ|हां|ठीक|सही|आगे|कन्फर्म)/u.test(t);
}

export function isNo(text: string): boolean {
  const t = text.normalize("NFKC").trim().toLowerCase();
  if (!t || t.length > 60) return false;
  return /\b(nahi|nhi|na|no|badlo|badal|change|edit|galat|wrong|reekh|sudhar)\b/.test(t) || /(नहीं|बदलो|गलत)/u.test(t);
}

export function isResetCommand(text: string): boolean {
  return /\b(nayi booking|nayi baat|naya booking|reset|shuru se|phir se|dubara shuru|restart)\b/i.test(text.normalize("NFKC"));
}

/** Train match — pehle number (exact phir prefix), phir naam ke shabd. List se bahar kuch nahi. */
export function matchTrainInList(text: string, trains: TrainResult[]): TrainResult | null {
  if (!trains.length) return null;
  const t = text.normalize("NFKC").toLowerCase();
  const nums = [...t.matchAll(/\b\d{4,5}\b/g)].map((m) => m[0]);
  for (const n of nums) {
    const exact = trains.find((tr) => tr.number === n);
    if (exact) return exact;
  }
  for (const n of nums) {
    const pref = trains.filter((tr) => tr.number.startsWith(n));
    if (pref.length === 1) return pref[0];
  }
  /* Naam se: query ke kaam ke shabd (2+ akshar) train naam me hone chahiye. */
  const words = t
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["ki", "ka", "ke", "se", "ko", "train", "the", "hai", "hain", "wala", "wali", "book", "karo", "kar", "chalo", "le", "leni", "lena", "ye", "yeh", "wo", "usme", "us", "is", "class", "seat", "ticket"].includes(w));
  if (!words.length) return null;
  const scored = trains
    .map((tr) => {
      const name = `${tr.name} ${tr.number}`.toLowerCase();
      const hits = words.filter((w) => name.includes(w)).length;
      return { tr, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].hits === scored[1].hits) return null; /* ambiguous — guess nahi */
  return scored[0].hits >= 1 ? scored[0].tr : null;
}

const CLASS_SYNONYMS: Array<[RegExp, ClassCode]> = [
  [/\b(1a|first ac|ac first|प्रथम)\b/i, "1A"],
  [/\b(2a|ac 2 tier|second ac|2 tier ac|two tier ac)\b/i, "2A"],
  [/\b(3e|3 economy|ac 3 economy|3a economy)\b/i, "3E"],
  [/\b(3a|ac 3 tier|third ac|three tier ac|3 tier ac)\b/i, "3A"],
  [/\b(sl|sleeper|शयन)\b/i, "SL"],
  [/\b(ec|executive|executive chair)\b/i, "EC"],
  [/\b(cc|chair car|ac chair|चेयर)\b/i, "CC"],
  [/\b(2s|second sitting|second seat|2 sitting|जनरल सीट)\b/i, "2S"],
  [/\b(ea|anubhuti)\b/i, "EA"],
];

/** Class match — sirf usi train ki asli classes me se (jo board/search deta hai). */
export function matchClassInList(text: string, classes: ClassAvailability[]): ClassAvailability | null {
  if (!classes.length) return null;
  const t = text.normalize("NFKC").toLowerCase();
  const codes = classes.map((c) => c.code);
  const direct = codes.find((code) => new RegExp(`(^|[^a-z0-9])${code.toLowerCase()}([^a-z0-9]|$)`, "i").test(t));
  if (direct) return classes.find((c) => c.code === direct) ?? null;
  for (const [re, code] of CLASS_SYNONYMS) {
    if (!re.test(t)) continue;
    const hit = classes.find((c) => c.code === code);
    if (hit) return hit;
  }
  return null;
}

export function classLabel(code: string | null): string {
  if (!code) return "";
  return CLASS_LABELS[code as ClassCode] ?? code;
}

/** Berth options — existing class ke hisaab se (BERTH_BY_CLASS), invent nahi. */
export function berthsForClass(code: string | null): string[] {
  if (!code) return [];
  return BERTH_BY_CLASS[code as ClassCode] ?? [];
}

const ASK_SLOT: Record<string, PaxAsk | null> = {
  paxName: "name",
  paxAge: "age",
  paxGender: "gender",
  paxBerth: "berth",
  paxFood: null,
};

type PaxAskName = Exclude<AiBookingAsk, "from" | "to" | "date" | "pax" | "train" | "class" | "review" | "confirm">;

/** Agla missing field. Food sirf tab jab us train me options hon (`opts.food`). */
export function askForDraft(d: AiPaxDraft | undefined, opts: { food?: boolean } = {}): PaxAskName {
  if (!d?.name || d.name.trim().length < 3) return "paxName";
  if (!d.age || !/^\d{1,3}$/.test(String(d.age))) return "paxAge";
  if (!d.gender) return "paxGender";
  if (!d.berthPreference) return "paxBerth";
  if (opts.food && !d.foodChoice) return "paxFood";
  return null;
}

/** Missing details ki saaf list — user ko batane ke liye ("yeh details missing hai"). */
export function aiBookingMissingLine(d: AiPaxDraft | undefined, index: number, opts: { food?: boolean } = {}): string {
  const miss: string[] = [];
  if (!d?.name || d.name.trim().length < 3) miss.push("naam");
  if (!d?.age || !/^\d{1,3}$/.test(String(d.age))) miss.push("age");
  if (!d?.gender) miss.push("gender");
  if (!d?.berthPreference) miss.push("berth preference");
  if (opts.food && !d?.foodChoice) miss.push("khaana (veg / non-veg / no food)");
  if (!miss.length) return `Passenger ${index + 1} ki saari details mil gayi hain ✅`;
  return `Passenger ${index + 1} ki ye details missing hai: ${miss.join(", ")}.`;
}

export function aiBookingAskLine(ask: AiBookingAsk, opts: { index?: number; code?: string | null } = {}): string {
  const n = (opts.index ?? 0) + 1;
  switch (ask) {
    case "from":
      return "Bilkul 😊 Aap kahan se jaana chahte hain?";
    case "to":
      return "Aur kahan jaana hai?";
    case "date":
      return "Kis date ko jaana hai? (jaise 1 October)";
    case "pax":
      return "Kitne passengers hain?";
    case "train":
      return "Kaunsi train leni hai? (train number ya naam bataiye)";
    case "class":
      return `Kaunsi class chahiye?`;
    case "paxName":
      return `Passenger ${n} ka naam bataiye.`;
    case "paxAge":
      return `Passenger ${n} ki age?`;
    case "paxGender":
      return `Passenger ${n} ka gender? (male / female / other)`;
    case "paxBerth":
      return `Passenger ${n} ki berth preference? ${berthsForClass(opts.code ?? null).join(" / ")}`;
    case "paxFood":
      return `Passenger ${n} ke liye khaana? Veg / Non-veg / “No food” (is train me catering hai).`;
    case "review":
      return "Kya sab details theek hain? Kuch change karna hai ya booking continue karun?";
    case "confirm":
      return "Confirm karne ke liye “Continue Booking” dabaiye — aapke click ke baad hi main IRCTC ki taraf le jaungi.";
    default:
      return "";
  }
}

/* ── stages ─────────────────────────────────────────────────────────────────────────────────────── */

function withSpoken(state: AiBookingState, say: string[], actions: AiBookingAction[] = []): AiBookingTurn {
  return { state: { ...state, spoken: say }, say, actions };
}

export function aiBookingStart(now = new Date()): AiBookingTurn {
  void now;
  const state: AiBookingState = { ...aiBookingBlank(now), stage: "COLLECT_JOURNEY", awaiting: "from" };
  return withSpoken(state, [
    "Namaste 🙏 Main RailBook ki AI Booking hoon — poori booking conversation me karwati hoon (text ya voice).",
    aiBookingAskLine("from"),
  ]);
}

/* ── R63-fix: city (cluster) naam — "delhi", "mumbai", "दिल्ली" ─────────────────────────────────────────
 * Wajah (user screenshot 30 Sep 2026): "Mujhe amritsar se delhi jaana hai" par bhi AI ne "Aur kahan
 * jaana hai?" poochha, phir "दिल्ली जाना है" par bhi wahi — kyunki bare "delhi" ALIASES me nahi hai
 * (wo ek city hai jisme kai station hain) aur Devanagari city naam bhi wahan nahi tha. Slot khaali
 * rehne se sawaal loop ban gaya.
 * Ab: city ka naam aate hi ASLI station list (catalog se) dikha kar ek hi sawaal poochha jaata hai —
 * aur agar user dobara wahi city bole (ya "koi bhi") to us city ka pehla asli station le liya jaata
 * hai, saaf disclosure ke saath (koi guess chhupa kar nahi, koi station invent bhi nahi).
 * ────────────────────────────────────────────────────────────────────────────────────────────────── */

/** City keys (latin + Devanagari + roman aliases) — longest pehle, taaki "new delhi" > "delhi" na jaaye. */
const CITY_KEYS: { key: string; city: string }[] = [
  ...Object.keys(CLUSTER_CITY_CODES).map((k) => ({ key: k, city: k })),
  ...Object.entries(CITY_NAME_ALIASES).map(([k, v]) => ({ key: k, city: v })),
].sort((a, b) => b.key.length - a.key.length);

/** Word-boundary wala indexOf (Latin ke liye alnum, Devanagari ke liye letter boundary). */
function indexOfWord(text: string, key: string): number {
  const t = text.toLowerCase();
  const k = key.trim().toLowerCase();
  if (!k) return -1;
  const latin = /[a-z]/i.test(k);
  for (let from = 0; from <= t.length - k.length; ) {
    const idx = t.indexOf(k, from);
    if (idx < 0) return -1;
    const before = t[idx - 1] ?? "";
    const after = t[idx + k.length] ?? "";
    const ok = latin
      ? !/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)
      : !/\p{L}/u.test(before) && !/\p{L}/u.test(after);
    if (ok) return idx;
    from = idx + 1;
  }
  return -1;
}

/** Text me jitni bhi city (cluster) mentions hain + unki position (ordering ke liye).
 *  Ek message me do city ho sakti hain — "jalandhar se mumbai" → dono ka sawaal ek-ek karke. */
function findCityMentions(text: string): { city: string; idx: number }[] {
  const out: { city: string; idx: number }[] = [];
  const seen = new Set<string>();
  for (const { key, city } of CITY_KEYS) {
    if ((CLUSTER_CITY_CODES[city]?.length ?? 0) < 2 || seen.has(city)) continue;
    const idx = indexOfWord(text, key);
    if (idx < 0) continue;
    seen.add(city);
    out.push({ city, idx });
  }
  return out.sort((a, b) => a.idx - b.idx);
}

/** Us city ke asli station (catalog se) — koi invent nahi. */
export function cityStationsFor(city: string): Station[] {
  return clusterStations(city);
}

/** City ke liye default station: naam bilkul city jaisa ho to wahi, warna catalog ka pehla.
 *  (Dono asli stations hain; UI ise hamesha disclosure line ke saath bolta hai.) */
export function primaryStationFor(city: string): Station | null {
  const list = clusterStations(city);
  if (!list.length) return null;
  return list.find((s) => s.name.toLowerCase() === city.toLowerCase()) ?? list[0];
}

/** Ek hi sawaal me asli options (max 6) — "kaunse station se/par jaana hai?". */
export function cityChoiceLine(city: string, list: Station[]): string {
  const opts = list.slice(0, 6).map((s) => `${s.code} ${s.name}`).join(" · ");
  const more = list.length > 6 ? ` … (is city me ${list.length} station hain)` : "";
  const name = city.charAt(0).toUpperCase() + city.slice(1);
  return `“${name}” me ek se zyada station hain — kaunse wala? ${opts}${more}. Station ka naam ya code bata dijiye.`;
}

/** User ne dobara wahi city boli (ya usi city ka koi alias)? */
function sameCityOrAny(text: string, city: string): boolean {
  const t = text.toLowerCase();
  if (indexOfWord(t, city) >= 0) return true;
  return CITY_KEYS.some(({ key, city: c }) => c === city && indexOfWord(t, key) >= 0);
}

/** "koi bhi / jo bhi / aap decide karo / pata nahi" — user ne choice chhod di. */
export function userLeftChoiceToAi(text: string): boolean {
  return /\b(koi\s*bhi|koi\s*sa\s*bhi|jo\s*bhi|joo?\s*bhi|any\s*(one|station)?|aap\s*(hi\s*)?(decide|chun|chuno|dekh)|tum\s*(hi\s*)?(decide|chun|chuno|dekh)|kuch\s*bhi|pata\s*nahi|dont\s*know|don't\s*know)\b/i.test(
    text,
  );
}

/** Pending city ka jawab — sirf asli station list me se (warna null). */
function stationForPendingCity(text: string, city: string): Station | null {
  const list = clusterStations(city);
  if (!list.length) return null;
  const inList = findStationsInText(text).find((s) => list.some((c) => c.code === s.code));
  if (inList) return inList;
  return matchOfferedStation(text, list) ?? null;
}

/** Mention order nikalne ke liye: station ka sabse pehla zikr kahan hua.
 *  R4-fix: pehle sirf Latin code/city/name dekhe jaate the — user Hindi me likhe ("लुधियाना से नई दिल्ली")
 *  to kuch bhi match nahi hota tha aur ordering par city pehle aa jaati thi (route ulta dikhta tha).
 *  Ab maujooda catalog helper (`findStationMentionsInText`) se asli position aati hai, jo
 *  Devanagari + roman sab aliases jaanta hai. */
function mentionsWithIdx(text: string): Map<string, number> {
  const map = new Map<string, number>();
  try {
    for (const m of findStationMentionsInText(text)) map.set(m.station.code, m.idx);
  } catch {
    /* helper fail ho to purana behaviour (sab -1) — kuch na toote */
  }
  return map;
}

/** COLLECT_JOURNEY: jo slots pehle se hain unhe dobara nahi poochhta (user ki shart). */
function collectJourney(state: AiBookingState, text: string, env: AiBookingEnv): AiBookingTurn {
  const now = env.now ?? new Date();
  const next: AiBookingState = { ...state, stage: "COLLECT_JOURNEY" };
  const say: string[] = [];

  const stations = findStationsInText(text);

  /* (a) Pichhla sawaal city ka tha ("Delhi me kaunse station?") → is message me uska jawab dhoondo. */
  if (next.pendingCity) {
    const { city, slot } = next.pendingCity;
    const list = clusterStations(city);
    const picked = stationForPendingCity(text, city);
    if (picked) {
      next[slot] = picked;
      next.pendingCity = null;
      say.push(`${picked.name} (${picked.code}) le liya ✅`);
    } else {
      /* Is city ke bahar ka station khud bata diya (jaise "Jaipur") → user ki baat maano. */
      const outside = stations[0];
      if (outside && !list.some((c) => c.code === outside.code) && outside.code !== next[slot === "from" ? "to" : "from"]?.code) {
        next[slot] = outside;
        next.pendingCity = null;
        say.push(`${outside.name} (${outside.code}) le liya ✅`);
      } else if (sameCityOrAny(text, city) || userLeftChoiceToAi(text) || next.pendingCity.asked) {
        const primary = primaryStationFor(city);
        if (primary) {
          next[slot] = primary;
          next.pendingCity = null;
          say.push(
            `Theek hai — “${city}” ke liye ${primary.name} (${primary.code}) le rahi hoon (yahi is city ka pehla asli station hai).`,
            `Koi doosra station chahiye to bata dijiye — main turant badal dungi.`,
          );
        }
      } else {
        next.pendingCity = { ...next.pendingCity, asked: true };
      }
    }
  }

  /* (b) Naye station/city mentions — text me jin-jin ka zikr hua, usi order me slots bharte hain. */
  if (!next.pendingCity) {
    const known = mentionsWithIdx(text);
    type Mention = { idx: number; st?: Station; city?: string };
    /* Station ka asli position (Devanagari/roman dono). Jahan pata na chale wahan catalog ka
     * kram (findStationsInText) hi sahi hota hai — isliye us kram ko monotonic index do. */
    let autoIdx = 0;
    const stationMentions: Mention[] = stations.map((st) => {
      const idx = known.has(st.code) ? (known.get(st.code) as number) : autoIdx;
      autoIdx = idx + 1;
      return { idx, st };
    });
    const matchedCodes = new Set(stations.map((x) => x.code));
    const mentions: Mention[] = [...stationMentions];
    for (const cm of findCityMentions(text)) {
      /* R4-fix: agar us city ka koi ASLI station is message me mil gaya hai (jaise "नई दिल्ली"),
       * to city ka sawaal bekaar hai — station zyada specific hai (pehle yahan route ulta ho jaata tha). */
      const cityCodes = CLUSTER_CITY_CODES[cm.city] ?? [];
      if (cityCodes.some((c) => matchedCodes.has(c))) continue;
      mentions.push({ idx: cm.idx, city: cm.city });
    }
    mentions.sort((a, b) => a.idx - b.idx);

    /* R4-fix (screenshot 30 Sep): user ne poora route dobara bata diya aur wo maujooda se alag hai
     * ("पर मैंने तो बोला लुधियाना से नई दिल्ली जाना है ना") → purana pair pakda rakhna galat tha;
     * ab user ki baat maani jaati hai (naya pair = jo usne ab bola). */
    if (stations.length >= 2 && next.from && next.to) {
      const samePair = stations[0].code === next.from.code && stations[1].code === next.to.code;
      if (!samePair) {
        next.from = stations[0];
        next.to = stations[1];
        next.trainNumber = null;
        next.trainName = null;
        next.classCode = null;
        next.drafts = [];
        next.paxIndex = 0;
        say.push(`${stations[0].name} se ${stations[1].name} ✅`);
      }
    }

    /* Slot claim: agar "from" ki jagah koi CITY aayi ("delhi se jaipur"), to us slot ko city ne
     * claim kar liya — uske baad ka station seedha "to" me jaata hai (warna Jaipur from ban jaata). */
    let fromClaimed = Boolean(next.from);
    let toClaimed = Boolean(next.to);
    for (const m of mentions) {
      if (m.st) {
        if (!fromClaimed) {
          next.from = m.st;
          fromClaimed = true;
        } else if (!toClaimed && m.st.code !== next.from?.code) {
          next.to = m.st;
          toClaimed = true;
        }
        continue;
      }
      if (!m.city) continue;
      const slot: "from" | "to" | null = !fromClaimed ? "from" : !toClaimed ? "to" : null;
      if (!slot) continue;
      if (slot === "from") fromClaimed = true;
      else toClaimed = true;
      const item: AiPendingCity = { city: m.city, slot, codes: CLUSTER_CITY_CODES[m.city] ?? [], asked: false };
      if (!next.pendingCity) next.pendingCity = item;
      else next.pendingQueue.push(item);
    }
  }

  /* Jo slot station mile bina bhar gaya (jaise "delhi se jaipur") → us slot ki city bekaar rehti hai. */
  if (next.pendingCity) {
    const { slot } = next.pendingCity;
    if (next[slot]) next.pendingCity = null;
  }

  /* Queue me pada doosra city-sawaal (jo slot abhi bhi khaali hai) → usko current bana do. */
  if (!next.pendingCity) {
    next.pendingQueue = next.pendingQueue.filter((q) => !next[q.slot]);
    const queued = next.pendingQueue.shift();
    if (queued) next.pendingCity = { ...queued, asked: queued.asked };
  }

  /* Date/pax pehle hi nikal lo — city ka sawaal pending ho to bhi "2 log" jaisi baat yaad rahe
   * (warna city ke jawab ke baad user ko dobara batana padta tha). */
  const dateHitEarly = parseDatePhrase(text, now, { allowDayOnly: true });
  if (dateHitEarly.date && !next.date) next.date = dateHitEarly.date;
  const paxEarly = parsePaxCount(text);
  if (paxEarly && !next.pax) next.pax = paxEarly;

  /* Slot abhi bhi khaali + city ka sawaal pending → poora slot poochhne ke bajaye ek hi saaf sawaal. */
  if (next.pendingCity) {
    const { city } = next.pendingCity;
    const list = clusterStations(city);
    if (!list.length) next.pendingCity = null;
    else {
      next.awaiting = next.pendingCity ? next.pendingCity.slot : next.awaiting;
      const doneBits: string[] = [];
      if (next.from) doneBits.push(`${next.from.name} se`);
      if (next.to) doneBits.push(`${next.to.name} tak`);
      if (doneBits.length) say.push(`${doneBits.join(" ")} ✅`);
      if (next.date) say.push(`${formatLongDate(next.date)} ki tarikh note kar li.`);
      if (next.pax) say.push(next.pax === 1 ? "1 passenger." : `${next.pax} passengers.`);
      return withSpoken(next, [...say, cityChoiceLine(city, list)]);
    }
  }

  const dateHit = parseDatePhrase(text, now, { allowDayOnly: true });
  if (dateHit.date && !next.date) next.date = dateHit.date;

  const pax = parsePaxCount(text);
  if (pax && !next.pax) next.pax = pax;

  if (next.from && next.to && next.from.code === next.to.code) {
    next.to = null; /* same station — dobara poochho, guess nahi */
  }

  if (next.from && next.to) {
    say.push(`${next.from.name} se ${next.to.name} ✅`);
    if (next.date) say.push(`${formatLongDate(next.date)} ki tarikh note kar li (yahi date search me jayegi).`);
  }
  if (next.pax) say.push(next.pax === 1 ? "1 passenger." : `${next.pax} passengers.`);

  /* Sirf missing cheez poochho — jo message me aa chuki hai wo dobara nahi. */
  if (!next.from) {
    next.awaiting = "from";
    return withSpoken(next, [...say, aiBookingAskLine("from")]);
  }
  if (!next.to) {
    next.awaiting = "to";
    return withSpoken(next, [...say, aiBookingAskLine("to")]);
  }
  if (!next.date) {
    next.awaiting = "date";
    return withSpoken(next, [...say, aiBookingAskLine("date")]);
  }
  if (!next.pax) {
    next.awaiting = "pax";
    return withSpoken(next, [...say, aiBookingAskLine("pax")]);
  }

  /* Sab mil gaya → asli search (action). */
  next.stage = "SEARCH_TRAINS";
  next.awaiting = "train";
  next.searching = true;
  const actions: AiBookingAction[] = [
    { type: "SEARCH", from: next.from, to: next.to, date: next.date, pax: next.pax },
    { type: "SET_PASSENGER_COUNT", count: next.pax },
  ];
  return withSpoken(next, [...say, `Perfect. Main ${formatLongDate(next.date)} ki available trains check karti hoon…`], actions);
}

/** Search ke asli result aane par (view state.trains padh kar bulata hai). */
export function aiBookingTrainsReady(state: AiBookingState, trains: TrainResult[]): AiBookingTurn {
  const next: AiBookingState = { ...state, searching: false };
  if (!trains.length) {
    next.stage = "COLLECT_JOURNEY";
    next.awaiting = "date";
    return withSpoken(next, [
      "Is route/date ke liye mujhe abhi verified train data nahi mila.",
      "Doosri date ya route bataiye — main phir asli provider se check karti hoon. Kuch bana kar nahi bataungi.",
    ]);
  }
  next.stage = "SHOW_TRAIN_OPTIONS";
  next.awaiting = "train";
  const head = trains.slice(0, 4).map((t) => `${t.number} ${t.name}`).join(" · ");
  return withSpoken(next, [
    `${formatLongDate(next.date ?? "")} ko ${trains.length} train${trains.length > 1 ? "s" : ""} mili hain — ${head}${trains.length > 4 ? " …" : ""}.`,
    "Neeche asli board card me availability aur fare ke saath dekh lijiye.",
    aiBookingAskLine("train"),
  ]);
}

function trainSelected(state: AiBookingState, train: TrainResult, env: AiBookingEnv): AiBookingTurn {
  const classes = train.classes?.filter((c) => c.code) ?? env.classes ?? [];
  const next: AiBookingState = {
    ...state,
    stage: "CLASS_SELECTION",
    trainNumber: train.number,
    trainName: train.name,
    classCode: null,
    searching: false,
  };
  if (!classes.length) {
    next.stage = "SHOW_TRAIN_OPTIONS";
    next.awaiting = "train";
    return withSpoken(next, [
      `${train.number} ${train.name} — is train ki class list provider se nahi aayi, isliye main class chunwa kar aage nahi badh rahi (guess nahi karungi).`,
      "Koi doosri train bataiye, ya board se dobara check karte hain.",
    ]);
  }
  next.awaiting = "class";
  const codes = classes.map((c) => `${c.code} (${CLASS_LABELS[c.code] ?? c.code})`).join(", ");
  return withSpoken(next, [
    `${train.number} ${train.name} select kar liya ✅`,
    `${train.number} ke liye ${codes} — kaunsi class chahiye?`,
  ]);
}

/** Class chun li (view ne live availability verify karne ke baad bhi yahi bulata hai). */
export function aiBookingClassSelected(
  state: AiBookingState,
  klass: ClassAvailability,
  live?: { status: string; seats?: number; rac?: number; waitlist?: number },
  opts: { food?: boolean } = {},
): AiBookingTurn {
  const st = (live?.status ?? klass.status ?? "").toUpperCase();
  const detail =
    st === "AVAILABLE" && live?.seats != null
      ? ` (AVL ${live.seats})`
      : st === "RAC" && live?.rac != null
        ? ` (RAC ${live.rac})`
        : st === "WAITLIST" && live?.waitlist != null
          ? ` (WL ${live.waitlist})`
          : st
            ? ` (${st})`
            : "";
  const size = Math.max(1, state.pax ?? 1);
  const drafts: AiPaxDraft[] = Array.from({ length: size }, (_, i) => state.drafts[i] ?? {});
  const next: AiBookingState = {
    ...state,
    stage: "PASSENGER_COLLECTION",
    classCode: klass.code,
    paxIndex: 0,
    drafts,
    awaiting: askForDraft(drafts[0], opts) ?? "paxName",
  };
  return withSpoken(
    next,
    [
      `${klass.code} (${CLASS_LABELS[klass.code] ?? klass.code}) select kar diya${detail} — ye asli board ka status hai.`,
      `Ab main aapka passenger form khol rahi hoon aur ${size === 1 ? "passenger" : `saare ${size} passengers`} ki details ek-ek karke poochh rahi hoon.`,
      aiBookingAskLine(next.awaiting, { index: 0, code: klass.code }),
    ],
    [{ type: "SET_PASSENGER_COUNT", count: size }],
  );
}

function passengerCollection(state: AiBookingState, text: string, env: AiBookingEnv): AiBookingTurn {
  const drafts = state.drafts.map((d) => ({ ...d }));
  const idx = Math.min(state.paxIndex, Math.max(0, drafts.length - 1));
  const cur = drafts[idx] ?? {};
  const slot = state.awaiting ? ASK_SLOT[state.awaiting] ?? null : null;
  const berths = berthsForClass(state.classCode);
  /* Do parse: poora text (ek sentence me kai fields) + jo slot poochha tha wo (warna "31" me se
   * naam bana lo). Dono ko merge karte hain — user ko sirf missing field dobara poochhi jaati hai. */
  const full = parsePassengerSpeech(text, berths, null);
  const slotted = slot ? parsePassengerSpeech(text, berths, slot) : {};
  const patch: AiPaxDraft = { ...full, ...slotted };
  if (patch.name) {
    const cleaned = stripExtraWords(patch.name, berths);
    /* 3 se kam letters = wo naam nahi, koi instruction/filler tha → naam mat likho. */
    if (cleaned.replace(/[^\p{L}]/gu, "").length < 3) delete patch.name;
    else patch.name = cleaned;
  }
  /* User ne aisi berth maangi jo is class me hi nahi hoti (jaise CC me "lower") → saaf batao. */
  /* R4-fix: Hindi me boli gayi berth (jaise CC me "विंडो" nahi chalti, SL me "विंडो" nahi chalti)
   * bhi usi saaf line se batayi jaati hai. Generic shabd (berth/seat) is message se nahi aate. */
  const invalidBerth = berths.length
    ? (text.match(
        /(side\s*lower|side\s*upper|lower|upper|middle|side|window|aisle|साइड\s*लोअर|साइड\s*अपर|साइड|लोअर|लोवर|अपर|मिडल|विंडो|खिड़की)/giu,
      ) ?? []).find(
        (w) => !berths.some((b) => b.toLowerCase() === w.toLowerCase().replace(/\s+/g, " ")),
      )
    : undefined;
  /* Hindi berth shabd (Latin parse se miss hote the) — sirf us class ki valid berth par lagta hai. */
  if (!patch.berthPreference) {
    const b = berthFromText(text, berths);
    if (b) patch.berthPreference = b;
  }
  /* Berth ka sawaal pending tha aur user ne sirf berth/instruction bola → use berth maano, naam nahi. */
  if (slot === "berth" && patch.berthPreference && !cur.name) {
    const cleaned = stripExtraWords(patch.name ?? "", berths);
    if (cleaned.replace(/[^\p{L}]/gu, "").length < 3) delete patch.name;
    else patch.name = cleaned;
  }

  const food = parseFoodChoice(text);
  if (food) patch.foodChoice = food;
  const merged: AiPaxDraft = { ...cur, ...patch };
  drafts[idx] = merged;

  const actions: AiBookingAction[] = [];
  const say: string[] = [];
  /* R63-fix: ye declaration pehle thi nahi (use se neeche), isliye `withFood` use par TS error
   * aata tha aur missing-details line hamesha bina food maange dikhati thi. Ab upar. */
  const withFood = env.foodExpected === true;
  if (Object.keys(patch).length) {
    actions.push({ type: "PATCH_PASSENGER", index: idx, patch });
    const bits: string[] = [];
    if (patch.name) bits.push(patch.name);
    if (patch.age) bits.push(`${patch.age} saal`);
    if (patch.gender) bits.push(patch.gender.toLowerCase());
    if (patch.berthPreference) bits.push(patch.berthPreference);
    if (patch.foodChoice) bits.push(patch.foodChoice === "VEG" ? "veg meal" : patch.foodChoice === "NON_VEG" ? "non-veg meal" : "no food");
    say.push(`Passenger ${idx + 1}: ${bits.join(", ")} note kar liya ✅`);
  } else if (!invalidBerth) {
    say.push("Ye detail samajh nahi aayi — dobara bata dijiye (jaise “Rahul Sharma, 31, male, window, veg”).");
    say.push(aiBookingMissingLine(merged, idx, { food: withFood }));
  }

  if (invalidBerth && !merged.berthPreference) {
    say.push(
      `${state.classCode ?? "Is class"} me “${invalidBerth}” berth nahi hoti — yahan ${berths.join(" / ")} chalti hai.`,
    );
  }

  const missing = askForDraft(merged, { food: withFood });
  const next: AiBookingState = { ...state, stage: "PASSENGER_COLLECTION", drafts, paxIndex: idx };
  if (missing) {
    next.awaiting = missing;
    return withSpoken(next, [...say, aiBookingAskLine(missing, { index: idx, code: state.classCode })], actions);
  }

  say.push(`Passenger ${idx + 1} complete hai.`);
  const total = Math.max(state.pax ?? drafts.length, drafts.length);
  void total;
  const nextIdx = drafts.findIndex((d) => askForDraft(d, { food: withFood }) !== null);
  if (nextIdx >= 0) {
    next.paxIndex = nextIdx;
    next.awaiting = askForDraft(drafts[nextIdx], { food: withFood });
    return withSpoken(
      next,
      [...say, `Ab passenger ${nextIdx + 1} ki details.`, aiBookingAskLine(next.awaiting, { index: nextIdx, code: state.classCode })],
      actions,
    );
  }

  /* Saari details mil gayi → AI khud review booking kholta hai (user ka explicit "AI Book" click
   * ki zaroorat nahi — automation, lekin final IRCTC action user ke confirmation par). */
  next.stage = "PASSENGER_REVIEW";
  next.paxIndex = 0;
  next.awaiting = "review";
  return withSpoken(
    next,
    [...say, "Saari passenger details mil gayi hain ✅", "Main review booking khol rahi hoon…"],
    [...actions, { type: "OPEN_REVIEW" }],
  );
}

/** Booking review ka saaf summary — jo diya gaya wahi likha jata hai (koi number invent nahi). */
export function aiBookingSummaryLines(args: {
  from: Station | null;
  to: Station | null;
  date: string | null;
  trainNumber: string | null;
  trainName?: string | null;
  classCode: string | null;
  passengers: { name?: string; age?: string; gender?: string; berthPreference?: string; foodChoice?: string }[];
  fareTotal?: number | null;
}): string[] {
  const paxNo = (p: { gender?: string }, i: number) => `Passenger ${i + 1}`;
  const lines: string[] = ["Booking summary:"];
  if (args.from && args.to) lines.push(`${args.from.name} → ${args.to.name}`);
  if (args.date) lines.push(formatLongDate(args.date));
  if (args.trainNumber) lines.push(`Train: ${args.trainNumber}${args.trainName ? ` ${args.trainName}` : ""}`);
  if (args.classCode) lines.push(`Class: ${args.classCode} (${classLabel(args.classCode)})`);
  lines.push(`Passengers: ${args.passengers.length}`);
  args.passengers.forEach((p, i) => {
    const food = p.foodChoice === "VEG" ? "veg" : p.foodChoice === "NON_VEG" ? "non-veg" : p.foodChoice === "NO_FOOD" ? "no food" : "";
    const bits = [p.name?.trim(), p.age ? `${p.age}` : "", p.gender ? p.gender.toLowerCase() : "", p.berthPreference ?? "", food].filter(Boolean);
    lines.push(`${paxNo(p, i)}: ${bits.join(", ") || "—"}`);
  });
  lines.push(args.fareTotal != null ? `Fare: ${inr(args.fareTotal)}` : "Fare: review screen par live fare dikh raha hai (invent nahi karti).");
  return lines;
}

/** Review ka conversational intro (ChatGPT jaisa, form jaisa nahi) — sirf asli values se. */
export function aiBookingReviewLine(state: AiBookingState, fareTotal?: number | null): string {
  const bits: string[] = [];
  if (state.from && state.to) bits.push(`${state.from.name} se ${state.to.name}`);
  if (state.date) bits.push(formatLongDate(state.date));
  if (state.trainNumber) bits.push(`train ${state.trainNumber}`);
  if (state.classCode) bits.push(`class ${state.classCode}`);
  if (state.pax) bits.push(state.pax === 1 ? "1 passenger" : `${state.pax} passengers`);
  const head = bits.length ? bits.join(", ") : "Aapki journey";
  const fare = fareTotal != null ? ` Fare ${inr(fareTotal)}.` : "";
  return `Booking summary ready hai 😊 ${head}.${fare} Kya sab details theek hain? Kuch change karna hai ya booking continue karun?`;
}

/** Review screen khul gaya — ab AI final confirmation maangti hai (khud kuch submit nahi karti). */
export function aiBookingFinalPrompt(state: AiBookingState, fareTotal?: number | null): AiBookingTurn {
  const next: AiBookingState = { ...state, stage: "FINAL_CONFIRMATION", awaiting: "confirm" };
  return withSpoken(next, [
    aiBookingReviewLine(next, fareTotal),
    "Kya ye final details hain ya kuch edit karna hai?",
    "Agar sab theek hai to “Haan” boliye ya Continue Booking dabaiye — main Continue to IRCTC khud dabakar aapki details autofill kar dungi. Kuch badalna ho to bata dijiye.",
  ]);
}

/** User ne final confirmation di → maujooda Continue to IRCTC khud click hoga (autofill waise hi). */
export function aiBookingHandoffTurn(state: AiBookingState): AiBookingTurn {
  const next: AiBookingState = { ...state, stage: "IRCTC_HANDOFF", awaiting: null, confirmed: true };
  return withSpoken(
    next,
    [
      "Theek hai 👍 Details confirm hain — main Continue to IRCTC dab rahi hoon.",
      "IRCTC khulte hi aapki journey + passenger details usi tarah autofill hongi (app/extension me). Login / OTP / payment aap hi karenge.",
    ],
    [{ type: "IRCTC_HANDOFF" }],
  );
}

export function aiBookingHandoffLine(): string {
  return "Details confirm ho gayi hain. Ab main aapko IRCTC par le ja rahi hoon — “Continue to IRCTC” aap hi dabaiye, wahan login/OTP/payment aap karenge.";
}

/** "Actually 2 October kar do" — sirf jo slot badla wahi replace hota hai, baaki journey/journey-slots
 *  (route, pax) aur pehle se chuni train/class waise hi rehte hain. Journey badalne par FRESH search
 *  (maujooda searchRoute) chalti hai — koi purani list nahi dikhayi jaati. */
export function aiBookingCorrect(state: AiBookingState, text: string, env: AiBookingEnv = {}): AiBookingTurn | null {
  if (!looksLikeCorrection(text)) return null;
  const now = env.now ?? new Date();
  const next: AiBookingState = { ...state };
  const say: string[] = [];
  let changed = false;

  const dateHit = parseDatePhrase(text, now, { allowDayOnly: false });
  if (dateHit.date && dateHit.date !== state.date) {
    next.date = dateHit.date;
    changed = true;
    say.push(`Theek hai — date ${formatLongDate(dateHit.date)} kar di.`);
  }

  const pax = lastPaxNumber(text) ?? parsePaxCount(text);
  if (pax && pax !== state.pax && /\b(passenger|passengers|pax|log|logon|ticket|tickets|यात्री|टिकट|लोग|kar\s*do|kar\s*dijiye|jagah)\b/i.test(text)) {
    next.pax = pax;
    changed = true;
    say.push(pax === 1 ? "1 passenger kar diya." : `${pax} passengers kar diye.`);
  }

  const stations = findStationsInText(text);
  const wantsStations = /\b(ki\s+jagah|ke\s+jagah|instead|nahi\s*se|se\s+nahi)\b/i.test(text);
  if (wantsStations && stations.length) {
    if (stations.length >= 2) {
      next.from = stations[0];
      next.to = stations[1];
      changed = true;
      say.push(`${stations[0].name} se ${stations[1].name} kar diya.`);
    } else if (state.from && stations[0].code !== state.from.code && !state.to) {
      next.from = stations[0];
      changed = true;
      say.push(`${stations[0].name} se kar diya.`);
    }
  }

  if (!changed) return null;

  /* Baaki journey ki yaad-dahaani (jo user ne pehle bataya tha) — dobara nahi poochha jayega. */
  const kept: string[] = [];
  if (next.from && next.to) kept.push(`${next.from.name} → ${next.to.name}`);
  if (next.date) kept.push(formatLongDate(next.date));
  if (next.pax) kept.push(next.pax === 1 ? "1 passenger" : `${next.pax} passengers`);
  if (kept.length) say.push(`Baaki journey waisi hi hai: ${kept.join(" · ")}.`);

  /* Journey complete hai → fresh search. */
  if (next.from && next.to && next.date && next.pax) {
    next.trainNumber = null;
    next.trainName = null;
    next.classCode = null;
    next.drafts = [];
    next.paxIndex = 0;
    next.awaiting = "train";
    next.searching = true;
    next.stage = "SEARCH_TRAINS";
    return withSpoken(next, [...say, `Nayi details ke saath fresh search kar rahi hoon (${formatLongDate(next.date)}).`], [
      { type: "SEARCH", from: next.from, to: next.to, date: next.date, pax: next.pax },
      { type: "SET_PASSENGER_COUNT", count: next.pax },
    ]);
  }

  /* Adhoora hai → sirf missing slot poochho (wahi collectJourney wala rasta). */
  const rest = collectJourney(next, "", env);
  return { state: rest.state, say: [...say, ...rest.say], actions: rest.actions };
}

/* ── main turn ───────────────────────────────────────────────────────────────────────────────────── */

/** R4-fix (screenshot 30 Sep): user ne poora route dobara bata diya aur wo maujooda pair se alag hai
 *  ("पर मैंने तो बोला लुधियाना से नई दिल्ली जाना है ना") → pehle AI purane (galat) pair ko hi dohraata
 *  rehta tha. Ab user ki baat maani jaati hai: naya pair set hota hai; date/pax pehle se hain to
 *  fresh search chalti hai (maujooda SEARCH action), warna next missing slot poochha jaata hai.
 *  Sirf tab jab message me do saaf stations hon — warna purana behaviour bilkul waisa. */
function routeRestated(state: AiBookingState, text: string, env: AiBookingEnv): AiBookingTurn | null {
  if (state.stage === "AI_BOOKING_START") return null;
  /* Sirf jab dono slots pehle se bhare hon — warna collectJourney hi natural raasta hai. */
  if (!state.from || !state.to || state.from.code === state.to.code) return null;
  const stations = findStationsInText(text);
  if (stations.length < 2) return null;
  if (stations[0].code === state.from.code && stations[1].code === state.to.code) return null;

  const next: AiBookingState = {
    ...state,
    from: stations[0],
    to: stations[1],
    trainNumber: null,
    trainName: null,
    classCode: null,
    drafts: [],
    paxIndex: 0,
    pendingCity: null,
    pendingQueue: [],
  };
  const say = [`Theek hai — ${stations[0].name} se ${stations[1].name} ✅`];
  if (next.date && next.pax) {
    next.stage = "SEARCH_TRAINS";
    next.awaiting = "train";
    next.searching = true;
    return withSpoken(next, [...say, `Nayi details ke saath fresh search kar rahi hoon (${formatLongDate(next.date)}).`], [
      { type: "SEARCH", from: next.from as Station, to: next.to as Station, date: next.date, pax: next.pax },
      { type: "SET_PASSENGER_COUNT", count: next.pax },
    ]);
  }
  /* Adhoora → wahi collectJourney rasta (sirf missing slot poochhega). */
  const collected = collectJourney({ ...next, stage: "COLLECT_JOURNEY" }, text, env);
  return withSpoken(collected.state, [...say, ...collected.say], collected.actions);
}

export function aiBookingTurn(state: AiBookingState, rawText: string, env: AiBookingEnv = {}): AiBookingTurn {
  const text = rawText.normalize("NFKC").trim();
  if (isResetCommand(text)) {
    const fresh = aiBookingBlank(env.now);
    fresh.stage = "COLLECT_JOURNEY";
    fresh.awaiting = "from";
    return withSpoken(fresh, ["Theek hai — nayi booking shuru karte hain.", aiBookingAskLine("from")], [{ type: "RESET" }]);
  }
  if (!text) return withSpoken(state, []);

  /* Correction pehle — "Actually 2 October kar do" jaisa. Slots replace hote hain, baaki sab preserve. */
  const corrected = aiBookingCorrect(state, text, env);
  if (corrected) return corrected;

  /* User ne poora route dobara bata diya (purane pair se alag) → naya pair + aage badho. */
  const restated = routeRestated(state, text, env);
  if (restated) return restated;

  switch (state.stage) {
    case "AI_BOOKING_START": {
      const started = aiBookingStart(env.now);
      return aiBookingTurn(started.state, text, env);
    }
    case "COLLECT_JOURNEY":
      return collectJourney(state, text, env);

    case "SEARCH_TRAINS": {
      /* Search chal rahi hai — agar user ne number bata diya to yaad rakho, warna sabr ka jawab. */
      return withSpoken(state, ["Train list check ho rahi hai (asli provider se) — ek second…"]);
    }

    case "SHOW_TRAIN_OPTIONS":
    case "TRAIN_SELECTED": {
      const trains = env.trains ?? [];
      const train = matchTrainInList(text, trains);
      if (!train) {
        const names = trains.slice(0, 6).map((t) => `${t.number} ${t.name}`).join(" · ");
        return withSpoken(state, [
          "Is number/naam ki train is list me nahi hai — main apne se koi train nahi jodti.",
          names ? `Ye hain: ${names}` : "Pehle search karte hain.",
          aiBookingAskLine("train"),
        ]);
      }
      return trainSelected(state, train, env);
    }

    case "CLASS_SELECTION": {
      const classes = env.classes ?? [];
      const klass = matchClassInList(text, classes);
      if (!klass) {
        const codes = classes.map((c) => c.code).join(", ") || "—";
        return withSpoken(state, [
          `Is train me ye classes hain: ${codes}. In me se bataiye.`,
        ]);
      }
      /* Asli availability check (existing flow) caller karta hai — yahan sirf class note hoti hai. */
      const next: AiBookingState = { ...state, classCode: klass.code };
      return withSpoken(
        next,
        [`${klass.code} (${CLASS_LABELS[klass.code] ?? klass.code}) chun liya — availability verify karke aage badhti hoon.`],
        [{ type: "SET_PASSENGER_COUNT", count: Math.max(1, state.pax ?? 1) }],
      );
    }

    case "PASSENGER_COLLECTION":
      return passengerCollection(state, text, env);

    case "PASSENGER_REVIEW": {
      /* Review screen khul raha hai (ya khul chuka) — ab final question. */
      return aiBookingFinalPrompt(state);
    }

    case "BOOKING_REVIEW":
    case "FINAL_CONFIRMATION": {
      if (isYes(text)) return aiBookingHandoffTurn(state);
      if (isNo(text)) {
        const firstMissing = state.drafts.findIndex((d) => askForDraft(d, { food: env.foodExpected === true }) !== null);
        const idx = firstMissing >= 0 ? firstMissing : 0;
        const missing = askForDraft(state.drafts[idx], { food: env.foodExpected === true });
        const next: AiBookingState = { ...state, stage: "PASSENGER_COLLECTION", paxIndex: idx, awaiting: missing ?? "paxName" };
        return withSpoken(next, [
          "Koi baat nahi — bataiye kya badalna hai (naam / age / gender / berth / khaana).",
          aiBookingAskLine(next.awaiting, { index: idx, code: state.classCode }),
        ]);
      }
      return withSpoken(state, [
        "Bataiye — sab theek hai to “Haan” boliye (main Continue to IRCTC dabkar details autofill kar dungi), warna jo badalna hai bata dijiye.",
      ]);
    }

    case "IRCTC_HANDOFF":
      return withSpoken(state, [aiBookingHandoffLine()]);

    default:
      return withSpoken(state, [aiBookingAskLine(state.awaiting)]);
  }
}

/** View: “AI Book” click ke baad — passenger form khul gaya. */
export function aiBookingPassengerScreenOpen(state: AiBookingState, opts: { food?: boolean } = {}): AiBookingTurn {
  const next: AiBookingState = {
    ...state,
    stage: "PASSENGER_COLLECTION",
    awaiting: askForDraft(state.drafts[state.paxIndex] ?? {}, opts) ?? "paxName",
  };
  return withSpoken(next, [
    `Passenger form khul gaya hai — main wahin details bhar deti hoon (${state.pax ?? 1} passenger).`,
    aiBookingAskLine(next.awaiting, { index: next.paxIndex, code: state.classCode }),
  ]);
}

/** View: class N/A / live availability fail — aage khud nahi badhti (fake booking nahi). */
export function aiBookingClassUnavailable(state: AiBookingState, code: string): AiBookingTurn {
  const next: AiBookingState = { ...state, stage: "CLASS_SELECTION", classCode: null, awaiting: "class" };
  return withSpoken(next, [
    `${code} ki live availability abhi nahi aayi / N-A hai — main isi par aage nahi badh rahi (kuch bana kar nahi bataungi).`,
    aiBookingAskLine("class"),
  ]);
}

/** View: real passenger form ka state badla (AI fields bharta hai, form hi source of truth hai).
 *  Sirf missing field poochhta hai aur same sawaal dobara nahi dohrata (idempotent). */
export function aiBookingPassengersReady(
  state: AiBookingState,
  passengers: { name?: string; age?: string; gender?: string; berthPreference?: string; foodChoice?: string; id?: string }[],
  food = false,
): AiBookingTurn {
  if (!passengers.length) return { state, say: [], actions: [] };
  const size = Math.max(state.pax ?? 1, passengers.length);
  const drafts: AiPaxDraft[] = Array.from({ length: size }, (_, i) => {
    const p = passengers[i];
    return p
      ? {
          name: p.name?.trim() || state.drafts[i]?.name,
          age: p.age || state.drafts[i]?.age,
          gender: p.gender || state.drafts[i]?.gender,
          berthPreference: p.berthPreference || state.drafts[i]?.berthPreference,
          foodChoice: (p as { foodChoice?: string }).foodChoice || state.drafts[i]?.foodChoice,
        }
      : { ...(state.drafts[i] ?? {}) };
  });
  const idx = drafts.findIndex((d) => askForDraft(d, { food }) !== null);
  if (idx >= 0) {
    const ask = askForDraft(drafts[idx], { food });
    /* Same sawaal dobara nahi (warna "Passenger 1 ka naam bataiye" loop ban jaata hai). */
    if (state.stage === "PASSENGER_COLLECTION" && state.awaiting === ask && state.paxIndex === idx) {
      return { state, say: [], actions: [] };
    }
    const next: AiBookingState = { ...state, stage: "PASSENGER_COLLECTION", drafts, paxIndex: idx, awaiting: ask };
    return withSpoken(next, [aiBookingAskLine(ask, { index: idx, code: state.classCode })]);
  }
  if (state.stage === "PASSENGER_REVIEW" || state.stage === "BOOKING_REVIEW") {
    /* Review screen pehle hi khul chuka hai → dobara OPEN_REVIEW nahi bhejna (loop na ho). */
    return { state: { ...state, drafts }, say: [], actions: [] };
  }
  const next: AiBookingState = { ...state, stage: "PASSENGER_REVIEW", drafts, paxIndex: 0, awaiting: "review" };
  return withSpoken(next, ["Saari passenger details mil gayi hain ✅", "Main review booking khol rahi hoon…"], [{ type: "OPEN_REVIEW" }]);
}

/** View: existing review screen khul gaya (user ne explicit confirmation diya). */
export function aiBookingReviewScreenOpen(state: AiBookingState): AiBookingTurn {
  const next: AiBookingState = { ...state, stage: "IRCTC_HANDOFF", awaiting: null, confirmed: true, handoff: true };
  return withSpoken(next, [aiBookingHandoffLine()], []);
}
