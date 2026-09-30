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
import { findStationsInText } from "./stations";
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
function stripExtraWords(name: string, berths: string[]): string {
  let out = name;
  for (const b of berths) {
    out = out.replace(new RegExp(`\\b${b}\\b`, "gi"), " ");
  }
  out = out.replace(/\b(veg|non[\s-]?veg|vegetarian|shakahari|no\s*food|meal|khana|khaana|food|वेज|नॉन|शाकाहारी|भोजन|खाना)\b/gi, " ");
  return out.replace(/\s+/g, " ").trim();
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

const ASK_SLOT: Record<string, PaxAsk> = {
  paxName: "name",
  paxAge: "age",
  paxGender: "gender",
  paxBerth: "berth",
};

function askForDraft(d: AiPaxDraft | undefined): Exclude<AiBookingAsk, "from" | "to" | "date" | "pax" | "train" | "class" | "review" | "confirm"> {
  if (!d?.name || d.name.trim().length < 3) return "paxName";
  if (!d.age || !/^\d{1,3}$/.test(String(d.age))) return "paxAge";
  if (!d.gender) return "paxGender";
  if (!d.berthPreference) return "paxBerth";
  return null;
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

/** COLLECT_JOURNEY: jo slots pehle se hain unhe dobara nahi poochhta (user ki shart). */
function collectJourney(state: AiBookingState, text: string, env: AiBookingEnv): AiBookingTurn {
  const now = env.now ?? new Date();
  const next: AiBookingState = { ...state, stage: "COLLECT_JOURNEY" };
  const say: string[] = [];

  const stations = findStationsInText(text);
  if (stations.length >= 2) {
    next.from = stations[0];
    next.to = stations[1];
  } else if (stations.length === 1) {
    const st = stations[0];
    if (!next.from) next.from = st;
    else if (!next.to && st.code !== next.from.code) next.to = st;
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
export function aiBookingClassSelected(state: AiBookingState, klass: ClassAvailability, live?: { status: string; seats?: number; rac?: number; waitlist?: number }): AiBookingTurn {
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
    awaiting: askForDraft(drafts[0]) ?? "paxName",
  };
  return withSpoken(next, [
    `${klass.code} (${CLASS_LABELS[klass.code] ?? klass.code}) select kar diya${detail} — ye asli board ka status hai.`,
    "Ab “AI Book” dabaiye — aapka passenger form khul jayega, aur main wahin details poochti rahungi.",
    aiBookingAskLine("paxName", { index: 0 }),
  ]);
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
    if (!cleaned) delete patch.name;
    else patch.name = cleaned;
  }
  const food = parseFoodChoice(text);
  if (food) patch.foodChoice = food;
  const merged: AiPaxDraft = { ...cur, ...patch };
  drafts[idx] = merged;

  const actions: AiBookingAction[] = [];
  const say: string[] = [];
  if (Object.keys(patch).length) {
    actions.push({ type: "PATCH_PASSENGER", index: idx, patch });
    const bits: string[] = [];
    if (patch.name) bits.push(patch.name);
    if (patch.age) bits.push(`${patch.age} saal`);
    if (patch.gender) bits.push(patch.gender.toLowerCase());
    if (patch.berthPreference) bits.push(patch.berthPreference);
    if (patch.foodChoice) bits.push(patch.foodChoice === "VEG" ? "veg meal" : patch.foodChoice === "NON_VEG" ? "non-veg meal" : "no food");
    say.push(`Passenger ${idx + 1}: ${bits.join(", ")} note kar liya ✅`);
  } else {
    say.push("Ye detail samajh nahi aayi — dobara bata dijiye (jaise “Rahul Sharma, 31, male, window”).");
  }

  const missing = askForDraft(merged);
  const next: AiBookingState = { ...state, stage: "PASSENGER_COLLECTION", drafts, paxIndex: idx };
  if (missing) {
    next.awaiting = missing;
    return withSpoken(next, [...say, aiBookingAskLine(missing, { index: idx, code: state.classCode })], actions);
  }

  say.push(`Passenger ${idx + 1} complete hai.`);
  const total = Math.max(state.pax ?? drafts.length, drafts.length);
  const nextIdx = drafts.findIndex((d) => askForDraft(d) !== null);
  if (nextIdx >= 0) {
    next.paxIndex = nextIdx;
    next.awaiting = askForDraft(drafts[nextIdx]);
    return withSpoken(next, [...say, aiBookingAskLine(next.awaiting, { index: nextIdx, code: state.classCode })], actions);
  }

  next.stage = "PASSENGER_REVIEW";
  next.paxIndex = 0;
  next.awaiting = "review";
  void total;
  return withSpoken(next, [...say, "Saare passenger details bhar gaye hain.", aiBookingReviewLine(next)], actions);
}

/** Booking review ka saaf summary — jo diya gaya wahi likha jata hai (koi number invent nahi). */
export function aiBookingSummaryLines(args: {
  from: Station | null;
  to: Station | null;
  date: string | null;
  trainNumber: string | null;
  trainName?: string | null;
  classCode: string | null;
  passengers: { name?: string; age?: string; gender?: string; berthPreference?: string }[];
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
    const bits = [p.name?.trim(), p.age ? `${p.age}` : "", p.gender ? p.gender.toLowerCase() : "", p.berthPreference ?? ""].filter(Boolean);
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

    case "PASSENGER_REVIEW":
    case "BOOKING_REVIEW": {
      if (isYes(text)) {
        const next: AiBookingState = { ...state, stage: "FINAL_CONFIRMATION", awaiting: "confirm" };
        return withSpoken(next, ["Theek hai 👍 “Continue Booking” dabaiye — main aapko review screen par le chalti hoon, wahan live fare aur Continue to IRCTC hoga."], []);
      }
      if (isNo(text)) {
        const firstMissing = state.drafts.findIndex((d) => askForDraft(d) !== null);
        const idx = firstMissing >= 0 ? firstMissing : 0;
        const missing = askForDraft(state.drafts[idx]);
        const next: AiBookingState = { ...state, stage: "PASSENGER_COLLECTION", paxIndex: idx, awaiting: missing ?? "paxName" };
        return withSpoken(next, ["Koi baat nahi — bataiye kya badalna hai.", aiBookingAskLine(next.awaiting, { index: idx, code: state.classCode })]);
      }
      return withSpoken(state, [aiBookingAskLine("review")]);
    }

    case "FINAL_CONFIRMATION": {
      if (isYes(text)) {
        const next: AiBookingState = { ...state, stage: "BOOKING_REVIEW", awaiting: "review" };
        return withSpoken(next, ["Confirmed ✅ — review screen khol rahi hoon (fare live API se aata hai)."]);
      }
      return withSpoken(state, [aiBookingAskLine("confirm")]);
    }

    case "IRCTC_HANDOFF":
      return withSpoken(state, [aiBookingHandoffLine()]);

    default:
      return withSpoken(state, [aiBookingAskLine(state.awaiting)]);
  }
}

/** View: “AI Book” click ke baad — passenger form khul gaya. */
export function aiBookingPassengerScreenOpen(state: AiBookingState): AiBookingTurn {
  const next: AiBookingState = { ...state, stage: "PASSENGER_COLLECTION", awaiting: askForDraft(state.drafts[state.paxIndex] ?? {}) ?? "paxName" };
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
export function aiBookingPassengersReady(state: AiBookingState, passengers: { name?: string; age?: string; gender?: string; berthPreference?: string; id?: string }[]): AiBookingTurn {
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
  const idx = drafts.findIndex((d) => askForDraft(d) !== null);
  if (idx >= 0) {
    const ask = askForDraft(drafts[idx]);
    /* Same sawaal dobara nahi (warna "Passenger 1 ka naam bataiye" loop ban jaata hai). */
    if (state.stage === "PASSENGER_COLLECTION" && state.awaiting === ask && state.paxIndex === idx) {
      return { state, say: [], actions: [] };
    }
    const next: AiBookingState = { ...state, stage: "PASSENGER_COLLECTION", drafts, paxIndex: idx, awaiting: ask };
    return withSpoken(next, [aiBookingAskLine(ask, { index: idx, code: state.classCode })]);
  }
  if (state.stage === "PASSENGER_REVIEW" || state.stage === "BOOKING_REVIEW") {
    return { state: { ...state, drafts }, say: [], actions: [] };
  }
  const next: AiBookingState = { ...state, stage: "PASSENGER_REVIEW", drafts, paxIndex: 0, awaiting: "review" };
  return withSpoken(next, ["Saare passenger details bhar gaye hain.", aiBookingReviewLine(next)]);
}

/** View: existing review screen khul gaya (user ne explicit confirmation diya). */
export function aiBookingReviewScreenOpen(state: AiBookingState): AiBookingTurn {
  const next: AiBookingState = { ...state, stage: "IRCTC_HANDOFF", awaiting: null, confirmed: true, handoff: true };
  return withSpoken(next, [aiBookingHandoffLine()], []);
}
