import type { DialogSlot, NluResult } from "../understand/legacy-nlu.js";
import { nextMissing } from "../understand/legacy-nlu.js";
import type { Station } from "../providers/types.js";

export type AgentToolName =
  | "searchStations"
  | "searchTrains"
  | "getTrainInfo"
  | "getTimetable"
  | "getLiveStatus"
  | "getCoachPosition"
  | "getAvailability"
  | "getFare"
  | "getCancelledTrains"
  | "checkPNR"
  | "getMyBookings"
  | "getWallet"
  | null;

export type BookingStage = "idle" | "collecting" | "results" | "review" | "paused";

export interface AgentContext {
  intent: string | null;
  origin: Station | null;
  destination: Station | null;
  date: string | null;
  dateProvided: boolean;
  passengers: number | null;
  paxProvided: boolean;
  classCode: string | null;
  selectedTrainNumber: string | null;
  selectedTrainName: string | null;
  lastTrainNumbers: string[];
  /** Pichhli search ki trains (number+name) — "shatabdi wali" jaise NAAM se
   * reference resolve karne ke liye (user feedback 2026-09-05). */
  lastTrains: { number: string; name: string }[];
  /** Search ke turant baad "sabse fast wali" jaise references resolve karne ke liye. */
  fastestTrainNumber: string | null;
  bookingStage: BookingStage;
  pendingAsk: DialogSlot;
  lastTool: AgentToolName;
  lastToolOk: boolean | null;
}

export function emptyAgentContext(): AgentContext {
  return {
    intent: null,
    origin: null,
    destination: null,
    date: null,
    dateProvided: false,
    passengers: null,
    paxProvided: false,
    classCode: null,
    selectedTrainNumber: null,
    selectedTrainName: null,
    lastTrainNumbers: [],
    lastTrains: [],
    fastestTrainNumber: null,
    bookingStage: "idle",
    pendingAsk: null,
    lastTool: null,
    lastToolOk: null,
  };
}

export type FollowUp =
  | "fare"
  | "availability"
  | "live"
  | "coach"
  | "timetable"
  | "cancelled"
  | "pnr"
  | "bookings"
  | "wallet"
  | "more_trains"
  | "train_pick"
  | "guide"
  | null;

export function classifyFollowUp(text: string): FollowUp {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (
    /\b(samajh nahi|samajh nhi|confused|ab kya|next (step|kya)|kya karna|kya karun|kaise book|booking kaise|kaise kare|help me|madad chahiye|explain|samjhao|समझ नहीं|अब क्या|कैसे बुक)\b/.test(t) ||
    /^(help|madad|guide)$/i.test(t)
  ) {
    return "guide";
  }
  if (/\b(meri bookings?|my bookings?|meri tickets?|ticket history|purani booking)\b/.test(t) || /मेरी (बुकिंग|टिकट)/.test(text)) {
    return "bookings";
  }
  if (/\b(wallet|balance kitna|mere paise)\b/.test(t)) return "wallet";
  if (/\b(pnr)\b/.test(t)) return "pnr";
  if (/\b(cancel(?:led)? trains?|radd trains?|cancel list)\b/.test(t) || /रद्द ट्रेन/.test(text)) return "cancelled";
  if (
    /\b(live status|running status|kahan hai|kaha hai|abhi kahan|track train)\b/.test(t) ||
    /कहां है|कहाँ है|लाइव|स्टेटस/.test(text)
  ) {
    return "live";
  }
  if (/\b(coach(?:es)?\s*(?:position|layout|composition)?|dibba|dabba)\b/.test(t) || /कोच|डिब्बा/.test(text)) return "coach";
  // User feedback (2026-09-06): "kon kon se stops / har stop ka naam / poora
  // timetable / route" — ye sab TIMETABLE follow-up hai, journey-slot sawaal nahi.
  if (
    /\b(stops?|halts?|route|via|kahan\s?kahan|kahan\s+se\s+kahan|kahaa\s+se\s+kahaa|kaha\s+se\s+kaha|kon\s?kon\s?se|kaun\s?kaun\s?se|har\s+stop|sabhi\s+stops?|poora\s+(timetable|time\s?table|schedule|route)|stations?\s+ki\s+(list|details|detail)|raste\s+(mein|ka|ki)|kis\s+station\s+se)\b/.test(t) ||
    /रूट|रास्ता|कौन.?कौन से|रुकती|रुकता|कहां से कहां|कहाँ से कहाँ/.test(text)
  ) {
    return "timetable";
  }
  if (/\b(timetable|time table|schedule|timing|ka time|k[ai]tn[ea]?\s+time|time\s+le[nt]i?|time\s+lagta|duration|kitna\s+samay|kitne\s+samay)\b/.test(t)) return "timetable";
  if (/\b(fare|kitna padega|kitna lagega|price|kitna fare)\b/.test(t) || /किराया|कितना पड़ेगा/.test(text)) return "fare";
  if (
    /\b(available|availability|avl|seat(?:s)?\s*(?:hai|hain|available|batao|bata|btana|btao|bta|dikhao|check|status|btana)|kitni seats?)\b/.test(t) ||
    /सीट/.test(text) ||
    (/\b\d{5}\b/.test(t) && /\bseats?\b/.test(t))
  ) {
    return "availability";
  }
  if (/\b(aur koi train|aur trains?|more trains?|koi aur train|aur options)\b/.test(t)) return "more_trains";
  if (
    /\b(\d{5})\s*wali\b/.test(t) ||
    /^(yeh? wali|isi ko|pehli wali|first wali|doosri wali|dusri wali|teesri wali|this (one|train))$/i.test(t) ||
    /\b(\d+)(st|nd|rd|th)\s+train\b/.test(t) ||
    /\b(pehli|doosri|dusri|teesri|chauthi|first|second|third|fourth)\s+(wali|train)\b/.test(t)
  ) {
    return "train_pick";
  }
  return null;
}

/* ── Train NAAM se resolve (user feedback 2026-09-05) ──────────────────
 * Bug: user ne doosri train ka NAAM bola (jaise "swarn shatabdi") par system
 * pichhli selected train (vande bharat) ka jawab de deta tha. Ab: (1) list
 * mein se naam match hota hai to wahi train; (2) naam bola par match nahi/
 * ambiguous → selected par SILENT fallback kabhi nahi (undefined → engine
 * clarify karega ya API se search karega). */

const TRAIN_NAME_GENERIC_TOKENS = new Set(["EXP", "EXPRESS", "MAIL", "SF", "SPL", "SPECIAL", "TRAIN", "TRAINS", "VIA"]);

/** Train ke naam ke distinctive tokens: "SWARN SHATABDI EXP" → ["SWARN","SHATABDI"]. */
export function trainNameTokens(name: string): string[] {
  return String(name ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 3 && !TRAIN_NAME_GENERIC_TOKENS.has(t));
}

/** User text mein se list-train ka naam match: ek hit → number, multiple → ambiguous. */
export function matchTrainNameInList(
  text: string,
  trains: { number: string; name: string }[],
): { number: string; name: string } | { ambiguous: { number: string; name: string }[] } | null {
  const words = new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const hits: { number: string; name: string }[] = [];
  for (const tr of trains) {
    const toks = trainNameTokens(tr.name);
    if (!toks.length) continue;
    if (toks.every((tok) => words.has(tok.toLowerCase()))) hits.push(tr);
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return { ambiguous: hits };
  return null;
}

/** Common train-type/name keywords — inka hona API name-search justify karta hai. */
export const TRAIN_TYPE_KEYWORD_RE =
  /\b(shatabdi|shatbdi|rajdhani|vande\s+bharat|vande|garib\s+rath|duronto|intercity|tejas|humsafar|gatimaan|gatiman|kranti|saryu|yamuna|jallianwala|punjab\s+mail|golden\s+temple|satluj|sutlej|akal|navyug|himsagar|janshatabdi|jan\s+shatabdi|double\s+decker)\b/i;

/** "...express/exp/mail/sf" suffix — named train phrase jaise "saryu yamuna express". */
export const TRAIN_NAME_SUFFIX_RE = /\b[a-z]{3,}(?:\s+[a-z]{3,})*\s+(?:express|exp|mail)\b/i;

const NAME_STOPWORDS = new Set(
  ("ka ki ke ko se mein me kya kitne kitna kitni kab kahan kaise hai hain hota hoti hote batao bata batade btana btavo time samay leti leta lena lijaati jaati jaata jana jaana nikal nikalti niklega chalti wali wala yeh ye woh wo is us train trains railway gari gaadi book booking ticket tatkal fare kiraya seat seats availability available rate rupees rupaye abhi aaj kal kal ki parso tomorrow yesterday today date din raat subah shaam monday tuesday wednesday thursday friday saturday sunday somvar mangalvar budhvar guruvar shukravar ravivar confirm cancel refund pnr status live running position kahan pehle baad aage piche se lekar tak only sirf please kripya boliye bataiye chahiye chahta chahti karna karni kardo karde dena do dijiye express mail aur ya and or bhi sabse achhi acchi achi best better behtar kaunsi kaunsa kaunse kaun koi kuch sasti sasta sastme mehnga mehngi expensive cheap fast tez jaldi late lateest latest tareek tarikh number code quota general acchi sabse wali accha").split(
    " ",
  ),
);

/** Text mein se likely train-name phrase nikaalo (stopwords hata kar longest alpha run). */
export function trainNamePhrase(text: string): string | null {
  const tokens = String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let best: string[] = [];
  let cur: string[] = [];
  for (const tok of tokens) {
    if (NAME_STOPWORDS.has(tok) || /^\d+$/.test(tok) || tok.length < 3) {
      if (cur.length > best.length) best = cur;
      cur = [];
    } else {
      cur.push(tok);
    }
  }
  if (cur.length > best.length) best = cur;
  if (!best.length) return null;
  const phrase = best.join(" ").trim();
  return phrase.length >= 3 ? phrase : null;
}

/** Kya user ne koi train ka NAAM bola (keyword/suffix ya list-match se)? */
export function mentionsTrainName(text: string, trains: { number: string; name: string }[] = []): boolean {
  if (TRAIN_TYPE_KEYWORD_RE.test(text) || TRAIN_NAME_SUFFIX_RE.test(text)) return true;
  return trains.length ? Boolean(matchTrainNameInList(text, trains)) : false;
}

/** Schedule stops se origin→destination SEGMENT duration (user feedback
 * 2026-09-05: "kitne time leti hai" par poora-route duration bol raha tha).
 * Stops: {code, arrival, departure, day?}. */
export function segmentOfStops(
  stops: { code: string; arrival: string | null; departure: string | null; day?: number | string | undefined }[],
  origin: string | null | undefined,
  destination: string | null | undefined,
): { from: string; to: string; departure: string; arrival: string; durationMinutes: number; durationLabel: string } | null {
  if (!origin || !destination || !stops.length) return null;
  const o = stops.findIndex((st) => st.code.toUpperCase() === origin.toUpperCase());
  const d = stops.findIndex((st) => st.code.toUpperCase() === destination.toUpperCase());
  if (o < 0 || d < 0 || d <= o) return null;
  const minOf = (hhmm: string | null): number | null => {
    const m = String(hhmm ?? "").match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const depStop = stops[o];
  const arrStop = stops[d];
  const dep = minOf(depStop.departure ?? depStop.arrival);
  const arr = minOf(arrStop.arrival ?? arrStop.departure);
  if (dep == null || arr == null) return null;
  const dayNum = (d: number | string | undefined): number => {
    if (typeof d === "number" && Number.isFinite(d)) return d;
    if (typeof d === "string" && d.trim() !== "" && Number.isFinite(Number(d))) return Number(d);
    return 0;
  };
  const dayO = dayNum(depStop.day);
  const dayD = dayNum(arrStop.day);
  let mins = (dayD - dayO) * 1440 + (arr - dep);
  if (mins < 0) mins += 1440; // day missing ho to overnight assumption
  if (mins <= 0 || mins > 24 * 60 * 3) return null;
  const label = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  return {
    from: depStop.code,
    to: arrStop.code,
    departure: String(depStop.departure ?? depStop.arrival ?? "--:--"),
    arrival: String(arrStop.arrival ?? arrStop.departure ?? "--:--"),
    durationMinutes: mins,
    durationLabel: label,
  };
}

/* ── 2026-09-06 (live e2e bug): "kon kon se stops hai" jaise FOLLOW-UP
 * question-phrases train KE NAAM nahi hote — par fuzzy train-search unhe
 * hijack kar leti thi ("kon kon" → KONKAN KANYA!). Test: phrase se question/
 * filler/stops-words hatao — agar KUCH solid naam nahi bachta, to ye train
 * naam nahi hai. ("shane punjab ki stops" → "shane punjab" bacha = naam hai.) */
const QUESTION_PHRASE_WORDS =
  /\b(kon|kaun|kahan|kahaa|kaha|se|si|sab|sabhi|kuch|kitne|kitni|stops?|halts?|route|timetable|time|table|details?|detail|pura|poora|hai|hain|batao|bata|btaw|do|dijiye|chahiye|ka|ki|ke|mein|me|par|pe|to|ye|yeh|wo|woh|wali|milegi|milti|deta|deti|mujhe|mhujhe|jaana|jana|nahi|nhn|nhi|sirf|bas|arré|arre|chhodo|chhod)\b/gi;

export function isQuestionPhraseNotTrainName(phrase: string): boolean {
  const p = String(phrase ?? "").trim();
  if (!p) return true;
  const rest = p.replace(QUESTION_PHRASE_WORDS, " ").replace(/\s+/g, " ").trim();
  return rest.length < 3 || /^\d{1,2}$/.test(rest);
}

export function resolveTrainNumber(text: string, ctx: AgentContext): string | undefined {
  const byNum = text.match(/\b(\d{5})\b/)?.[1];
  if (byNum) return byNum;
  // Memory (2026-09-05): "sabse fast wali / sabse tez train" — pichhli search
  // ka fastest yaad hai to wahi resolve karo, model se dobara mat poochhwao.
  if (/\bsabse\s+(fast|tez|jaldi|shighra)\b|\bfastest\b/i.test(text) && ctx.fastestTrainNumber) {
    return ctx.fastestTrainNumber;
  }
  if (/\b(yeh? wali|this (one|train)|isi ko)\b/i.test(text) && ctx.selectedTrainNumber) {
    return ctx.selectedTrainNumber;
  }
  // NAAM se pehchaan (2026-09-05): list ki trains mein se naam match — ek hi
  // solid match ho to seedha wahi number ("swarn shatabdi" → 12030).
  const listTrains = ctx.lastTrains ?? [];
  const listHit = listTrains.length ? matchTrainNameInList(text, listTrains) : null;
  if (listHit && !("ambiguous" in listHit)) return listHit.number;
  const list = ctx.lastTrainNumbers;
  const ordinal = text.match(/\b(\d+)(?:st|nd|rd|th)\s+train\b/i);
  if (ordinal) {
    const i = Number(ordinal[1]) - 1;
    if (i >= 0 && list[i]) return list[i];
  }
  if (/\b(pehli|first)(\s+wali|\s+train)?\b/i.test(text) && list[0]) return list[0];
  if (/\b(doosri|dusri|second)(\s+wali|\s+train)?\b/i.test(text) && list[1]) return list[1];
  if (/\b(teesri|third)(\s+wali|\s+train)?\b/i.test(text) && list[2]) return list[2];
  if (/\b(chauthi|fourth)(\s+wali|\s+train)?\b/i.test(text) && list[3]) return list[3];
  // NAAM bola par resolve NAHI hua (list mein nahi / ambiguous) → pichhli selected
  // train par silent fallback GALAT train ka jawab deta tha. undefined → engine
  // clarify karega ya naam se search karega. (User feedback 2026-09-05.)
  if (mentionsTrainName(text, listTrains)) return undefined;
  return ctx.selectedTrainNumber ?? undefined;
}

export function mergeAgentContext(
  prev: AgentContext,
  nlu: Pick<NluResult, "intent" | "from" | "to" | "date" | "passengerCount" | "classCodes" | "trainNumber" | "pnr">,
  text: string,
  extra?: { selectedTrainNumber?: string | null; selectedTrainName?: string | null; lastTrainNumbers?: string[]; bookingStage?: BookingStage },
): AgentContext {
  const next: AgentContext = {
    ...prev,
    lastTrainNumbers: [...prev.lastTrainNumbers],
    lastTrains: [...(prev.lastTrains ?? [])],
  };
  if (nlu.intent && nlu.intent !== "NONE" && nlu.intent !== "CONFIRM_YES" && nlu.intent !== "CONFIRM_NO") {
    next.intent = nlu.intent;
  }
  if (nlu.from) next.origin = nlu.from;
  if (nlu.to) next.destination = nlu.to;
  if (nlu.date) {
    next.date = nlu.date;
    next.dateProvided = true;
  }
  if (nlu.passengerCount) {
    next.passengers = nlu.passengerCount;
    next.paxProvided = true;
  }
  if (nlu.classCodes?.[0]) next.classCode = nlu.classCodes[0];
  const spokenTrain = resolveTrainNumber(text, next) ?? nlu.trainNumber;
  if (spokenTrain) {
    next.selectedTrainNumber = spokenTrain;
  }
  if (extra?.selectedTrainNumber) next.selectedTrainNumber = extra.selectedTrainNumber;
  if (extra?.selectedTrainName) next.selectedTrainName = extra.selectedTrainName;
  if (extra?.lastTrainNumbers?.length) next.lastTrainNumbers = extra.lastTrainNumbers;
  if (extra?.bookingStage) next.bookingStage = extra.bookingStage;
  else if (next.origin || next.destination || next.dateProvided) {
    if (next.bookingStage === "idle") next.bookingStage = "collecting";
  }
  next.pendingAsk = nextMissing({
    from: next.origin,
    to: next.destination,
    date: next.dateProvided ? next.date : null,
    passengerCount: next.paxProvided ? next.passengers : null,
  });
  return next;
}

export function bookingInProgress(ctx: AgentContext): boolean {
  return Boolean(ctx.origin || ctx.destination || ctx.dateProvided || ctx.bookingStage === "collecting" || ctx.bookingStage === "results");
}

export function decideTool(follow: FollowUp, ctx: AgentContext, nluIntent?: string): AgentToolName {
  if (follow === "coach" || nluIntent === "COACH_POSITION") return "getCoachPosition";
  if (follow === "live" || nluIntent === "LIVE_TRAIN_STATUS") return "getLiveStatus";
  if (follow === "timetable" || nluIntent === "TRAIN_SCHEDULE") return "getTimetable";
  if (follow === "cancelled" || nluIntent === "CANCELLED_TRAINS") return "getCancelledTrains";
  if (follow === "pnr" || nluIntent === "CHECK_PNR") return "checkPNR";
  if (follow === "bookings" || nluIntent === "VIEW_BOOKINGS" || nluIntent === "VIEW_TICKET") return "getMyBookings";
  if (follow === "wallet" || nluIntent === "VIEW_WALLET") return "getWallet";
  if (follow === "fare") return "getFare";
  if (follow === "availability") return "getAvailability";
  if (follow === "more_trains" || nluIntent === "SEARCH_TRAIN" || nluIntent === "BOOK_TRAIN") {
    if (ctx.origin && ctx.destination && ctx.dateProvided) return "searchTrains";
  }
  return null;
}

export function resumeBookingLine(ctx: AgentContext): { ask: DialogSlot; text: string } | null {
  if (!bookingInProgress(ctx)) return null;
  const ask = nextMissing({
    from: ctx.origin,
    to: ctx.destination,
    date: ctx.dateProvided ? ctx.date : null,
    passengerCount: ctx.paxProvided ? ctx.passengers : null,
  });
  const route =
    ctx.origin || ctx.destination
      ? `${ctx.origin?.city ?? ctx.origin?.code ?? "?"} → ${ctx.destination?.city ?? ctx.destination?.code ?? "?"}`
      : "aapki booking";
  const when = ctx.dateProvided && ctx.date ? ` ${ctx.date} ki` : "";
  if (ask === "date") {
    return { ask, text: `${route}${when} kis date ko jaana hai?` };
  }
  if (ask === "passengers") {
    return { ask, text: `${route}${when} kitne passengers hain?` };
  }
  if (ask === "from") {
    return { ask, text: "Kahan se jaana hai?" };
  }
  if (ask === "to") {
    return { ask, text: "Kahan jaana hai?" };
  }
  if (ctx.bookingStage === "results" || ctx.lastTrainNumbers.length) {
    return { ask: "train", text: `${route} ki trains — kaunsi choose karein?` };
  }
  return null;
}

export function factReplyUnavailable(kind: FollowUp | AgentToolName): string {
  if (kind === "live" || kind === "getLiveStatus") {
    return "Live status abhi railway provider se available nahi ho pa raha. Main fake location nahi bataunga.";
  }
  if (kind === "fare" || kind === "getFare") {
    return "Fare abhi available nahi hai. Main approx figure invent nahi karunga.";
  }
  if (kind === "availability" || kind === "getAvailability") {
    return "Availability abhi provider se nahi mili. Main seats invent nahi karunga.";
  }
  if (kind === "cancelled" || kind === "getCancelledTrains") {
    return "Cancelled-train list abhi available nahi hai.";
  }
  if (kind === "pnr" || kind === "checkPNR") {
    return "PNR status abhi available nahi hai.";
  }
  if (kind === "coach" || kind === "getCoachPosition") {
    return "Coach position abhi provider se nahi aayi. Main fake layout nahi bataunga.";
  }
  if (kind === "timetable" || kind === "getTimetable" || kind === "getTrainInfo") {
    return "Timetable abhi provider se nahi mili.";
  }
  return "Yeh jaankari abhi railway provider se available nahi hai. Main gadh ke nahi bataunga.";
}

export function neverAutoBook(_intent?: string, _bookingFlow?: string): boolean {
  return true;
}

export const AI_FORBIDDEN_MONEY_TOOLS = [
  "createBooking",
  "confirmBooking",
  "addMoney",
  "debit",
  "credit",
  "cancelBooking",
  "bookTrain",
  "charge",
] as const;

export function isForbiddenMoneyTool(tool: string | null | undefined): boolean {
  if (!tool) return false;
  const t = tool.toLowerCase();
  return (
    AI_FORBIDDEN_MONEY_TOOLS.some((name) => name.toLowerCase() === t) ||
    t.includes("debit") ||
    t.includes("charge") ||
    t.includes("createbooking") ||
    t.includes("confirmbooking")
  );
}
