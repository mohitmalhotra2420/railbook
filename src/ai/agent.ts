import type { DialogSlot, NluResult } from "./nlu";
import { nextMissing } from "./nlu";
import type { Station } from "../types";
import { isGoesToAsk } from "./facts";

/** Server /api/agent `trains` payload — organized train table (2026-09-05). */
export interface AgentTrainRow {
  number: string;
  name: string;
  departure: string;
  arrival: string;
  arrivalDayOffset: number;
  durationMinutes: number | null;
  durationLabel: string | null;
  classes: string[];
  fare?: { classCode: string; amount: number } | null;
}

export interface AgentTrainTable {
  from: string;
  to: string;
  date: string;
  fastest: string | null;
  rows: AgentTrainRow[];
}

/** Round-17: server RANK_JOURNEY_OPTIONS ka deterministic plan (BEST OPTION card). */
export interface AgentRouteLeg {
  trainNumber: string;
  trainName: string;
  from: string;
  to: string;
  fromName?: string | null;
  toName?: string | null;
  departure: string;
  arrival: string;
  arrivalDayOffset: number;
  departureDayOffset?: number;
  durationMinutes: number | null;
  /** Round-18m-3: is leg ke segment ki seat (provider-proven) — null = data nahi. */
  availability?: { classCode: string; status: string; seats: number | null; rac: number | null; waitlist: number | null; fare: number | null; source: string; stale?: boolean } | null;
  /** Round-18m-7: is leg par har class jisme seat hai (AVL/RAC). */
  classOptions?: { classCode: string; status: string; seats: number | null; rac: number | null; waitlist: number | null; fare: number | null; source: string; stale?: boolean }[];
  /** Round-18m-18: ConfirmTkt-trick on a connecting leg — ticket from train origin / upto 1-2 stops beyond. */
  ticketFrom?: string | null;
  ticketFromName?: string | null;
  ticketUpto?: string | null;
  ticketUptoName?: string | null;
}
export interface AgentRouteOption {
  rank: number;
  category: string;
  badges: string[];
  trainNumbers: string[];
  trainNames: string[];
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  arrivalDayOffset: number;
  durationMinutes: number | null;
  durationLabel: string | null;
  changes: number;
  legs: AgentRouteLeg[];
  layoverMinutes: number | null;
  classes: string[];
  availability: { classCode: string; status: string; seats: number | null; rac: number | null; waitlist: number | null; fare: number | null; source: string; stale?: boolean } | null;
  /** Round-18m-12: full class board (every class probed) for this train — RAC/WL rows included. */
  classOptions?: { classCode: string; status: string; seats: number | null; rac: number | null; waitlist: number | null; fare: number | null; source: string; stale?: boolean }[];
  probed?: boolean;
  reliability: null;
  source: string;
  why: string;
}
export interface AgentBoardFromEarlier {
  trainNumber: string;
  trainName: string;
  bookFrom: string;
  bookFromName: string | null;
  bookFromDeparture: string | null;
  boardAt: string;
  boardAtName: string | null;
  boardAtDeparture: string | null;
  destination: string;
  destinationName: string | null;
  arrival: string | null;
  arrivalDayOffset: number;
  availability: NonNullable<AgentRouteOption["availability"]>;
  /** Round-18m-7: bookFrom→destination par sab seat-wali classes. */
  classOptions?: NonNullable<AgentRouteOption["availability"]>[];
  durationMinutes?: number | null;
  directStatus: string | null;
  stopsBefore: number;
  source: string;
  /** Round-18m-16: ConfirmTkt "Book Upto" — ticket destination ke aage tak, utro destination par. */
  bookUpto?: string | null;
  bookUptoName?: string | null;
  bookUptoArrival?: string | null;
  stopsAfter?: number;
}
export interface AgentConnection {
  station: string;
  stationName?: string | null;
  arrivalTrain: string;
  departureTrain: string;
  arrivalAt: string;
  departsAt: string;
  layoverMinutes: number;
  valid: boolean;
  totalDurationMinutes: number | null;
  legs: AgentRouteLeg[];
  source: string;
}
export interface AgentPartialSegment {
  from: string;
  fromName: string | null;
  to: string;
  toName: string | null;
  trainNumber: string;
  classCode: string;
  status: string;
  seats: number | null;
  waitlist: number | null;
  fare: number | null;
  departure: string | null;
  arrival: string | null;
  berth: { coach: string; berth: number; type: string } | null;
}
export interface AgentJourneyPlan {
  query: { from: string; to: string; date: string; travelClass: string | null; preference: string; passengers?: number | null };
  best: AgentRouteOption | null;
  routeOptions: AgentRouteOption[];
  connections: AgentConnection[];
  alternativeDates: { date: string; count: number; fastest: { number: string; durationMinutes: number } | null; seatProof?: string | null }[];
  directUnavailable: boolean;
  directStaleAvailable?: boolean;
  /** Round-18m-13: AI (LLM) decision — recommendedId/ranking/verdict; source "ai" | "rules". */
  decision?: { source: "ai" | "rules"; model?: string | null; recommendedId: string | null; ranking: string[]; verdict?: string | null; whyPoints: string[]; verifyFirst?: { id: string; trainNumber: string; label: string; durationMinutes: number | null; availability: AgentRouteOption["availability"] } | null; recommended: { id: string; kind: "direct" | "bfe" | "connecting"; trainNumbers: string[]; label: string; seatTier: "fresh" | "stale" | "none"; bookFrom?: string | null; boardAt?: string | null; hub?: string | null } | null; candidates: { id: string; kind: "direct" | "bfe" | "connecting"; trainNumbers: string[]; seatTier: "fresh" | "stale" | "none" }[] };
  /** Round-18l: server-built plain-language summary (best → fallback → alt date). */
  summary?: string | null;
  /** Round-18m-9: 3–5 deterministic reasons for the recommendation. */
  whyPoints?: string[];
  whySource?: "ai" | "rules";
  audit?: { passengers: number | null; directTrains: number; directProbed: number; bfeTrains: number; bfeStopsChecked: number; connHubs: string[]; connLeg1Checked: number; connLeg2Checked: number };
  /** Round-18m-10: per-hub leg-1/leg-2 seat-wale trains + joint best. */
  legPlans?: { hub: string; hubName: string | null; leg1: AgentRouteLeg[]; leg2: AgentRouteLeg[]; checkedLeg1: number; checkedLeg2: number; best: AgentConnection | null; leg1All?: AgentRouteLeg[]; leg2All?: AgentRouteLeg[] }[];
  recovery: {
    reason: string;
    differentTrain: AgentRouteOption[];
    partialRoute: {
      trainNumber: string;
      trainName: string | null;
      classCode: string;
      direct: AgentPartialSegment | null;
      plans: { switchStation: string; switchStationName: string | null; segments: AgentPartialSegment[]; fullyAvailable: boolean; note: string }[];
      sameTrainSwitch: { afterStation: string; afterStationName: string | null; segment: AgentPartialSegment } | null;
      note: string;
    } | null;
    connecting: AgentConnection[];
    alternativeDates: AgentJourneyPlan["alternativeDates"];
    /** Round-18 §8: same-city alternate boarding/destination — different assumption, needs user confirm. */
    alternateStations?: { from: string; to: string; changed: "origin" | "destination" | "both"; count: number; best: AgentRouteOption | null; source: string; note: string }[];
    /** Round-18m-6: same train, ticket from an earlier stop, board at origin. */
    boardFromEarlier?: AgentBoardFromEarlier[];
  } | null;
  sources: string[];
  notes: string[];
  provenance?: { retrievedAt: string; requestDate: string; travelDate: string; freshness: string; sourceTypes: string[] };
  conflicts?: { trainNumber: string; message: string; sources: string[] }[];
}

/** Round-18: alternatives when the selected train's seat is poor. */
export interface AgentAlternatives {
  selected: { trainNumber: string; trainName: string | null; classCode: string | null; status: string | null; seats: number | null; waitlist: number | null; rac: number | null; source: string | null };
  reason: "waitlist" | "rac" | "low_availability" | "not_available" | "class_unavailable" | "unknown" | "fine";
  origin: string;
  destination: string;
  date: string;
  alternatives: AgentRouteOption[];
  otherClasses: { classCode: string; status: string; seats: number | null; fare: number | null; source: string }[];
  partialRoute: AgentJourneyPlan["recovery"] extends infer R ? (R extends { partialRoute: infer P } ? P : null) : null;
  connecting: AgentConnection[];
  alternativeDates: AgentJourneyPlan["alternativeDates"];
  sources: string[];
  note: string;
  provenance: { retrievedAt: string; requestDate: string; travelDate: string; freshness: string; sourceTypes: string[] };
}
/** Round-18: SELECT TRAIN smart picker (real validated matches). */
export interface AgentTrainPick {
  number: string;
  name: string;
  from: string | null;
  fromName?: string | null;
  to: string | null;
  toName?: string | null;
  departure: string | null;
  arrival: string | null;
  type?: string | null;
  match: "exact_number" | "exact_name" | "partial_name" | "route_context";
  source: string;
}
export interface AgentTrainPicker {
  query: string;
  kind: "number" | "name";
  matches: AgentTrainPick[];
  single: boolean;
  source: string;
  note: string | null;
}

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
  /** Pichhli search ki trains (number+name) — naam se reference resolve karne ke liye. */
  lastTrains: { number: string; name: string }[];
  fastestTrainNumber: string | null;
  bookingStage: BookingStage;
  pendingAsk: DialogSlot;
  lastTool: AgentToolName;
  lastToolOk: boolean | null;
  /** Round-8: "nayi baat/reset" one-shot client signal. */
  justReset?: boolean;
  /** Round-9 (Agra-bug): cluster-city jiska station abhi choose nahi hua. */
  pendingOriginChoice?: string | null;
  pendingDestinationChoice?: string | null;
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
  | "timetable"
  | "cancelled"
  | "pnr"
  | "bookings"
  | "wallet"
  | "more_trains"
  | "compare"
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
  if (/\b\d{5}\b/.test(t) && /\b(cancel(?:led)?|radd)\b/.test(t) && !/\b(booking|ticket)\b/.test(t)) return "cancelled";
  if (
    /\b(live status|running status|kahan hai|kaha hai|abhi kahan|track train)\b/.test(t) ||
    /कहां है|कहाँ है|लाइव|स्टेटस/.test(text)
  ) {
    return "live";
  }
  if (/\b(timetable|time table|schedule|ka time|k[ai]tn[ea]?\s+time|time\s+le[nt]i?|time\s+lagta|duration|kitna\s+samay|kitne\s+samay)\b/.test(t)) return "timetable";
  if (/\b(fare|kitna padega|kitna lagega|price|kitna fare)\b/.test(t) || /किराया|कितना पड़ेगा/.test(text)) return "fare";
  if (
    /\b(available|availability|avl|seat(?:s)?\s*(?:hai|hain|available|batao|bata|btana|btao|bta|dikhao|check|status|btana)|kitni seats?)\b/.test(t) ||
    /सीट/.test(text) ||
    (/\b\d{5}\b/.test(t) && /\bseats?\b/.test(t))
  ) {
    return "availability";
  }
  if (/\b(aur koi train|aur trains?|more trains?|koi aur train|aur options)\b/.test(t)) return "more_trains";
  /* Round-18h (browser E2E): "Bharat ki pehli train kab chali thi" / "India's
   * first train" GENERAL KNOWLEDGE hai — list-pick nahi. Knowledge phrasing
   * (kab/kahan/history/kis saal/bharat/india/duniya) ho to agent ko jaane do. */
  const knowledgePhrasing = /\b(kab|kahan|kaha|kis saal|kis year|history|itihas|bharat|india|hindustan|duniya|world|chali thi|chali|shuru|start(?:ed)?|launch)\b/.test(t);
  if (
    !knowledgePhrasing &&
    (/\b(\d{5})\s*wali\b/.test(t) ||
      /^(yeh? wali|isi ko|pehli wali|first wali|doosri wali|dusri wali|teesri wali|this (one|train))$/i.test(t) ||
      /\b(\d+)(?:st|nd|rd|th)\s+train\b/.test(t) ||
      /\b(pehli|doosri|dusri|teesri|chauthi|first|second|third|fourth)\s+(wali|train)\b/.test(t))
  ) {
    return "train_pick";
  }
  /* Round-16d (user screenshot 2026-09-08: "12053 better hai yan 12014?" →
   * "evidence mein 12014 nahi hai"): comparison ab alag kind hai — ye LOCAL UI
   * query NAHI hai, agent ko jaana chahiye jo dono trains ka data laata hai. */
  if (
    /\b(kaunsi better|kaun better|kon better|better hai|compare|recommend|behtar)\b/.test(t) ||
    ((/\b(ya|yan|vs|aur|or)\b/.test(t) || /\bkon si\b/.test(t)) && (t.match(/\b\d{5}\b/g) ?? []).length >= 2)
  ) {
    return "compare";
  }
  return null;
}

export function isInfoFollowUp(kind: FollowUp): boolean {
  return kind === "live" || kind === "timetable" || kind === "cancelled" || kind === "pnr" || kind === "fare" || kind === "availability";
}

/** Station chips must not swallow live / seats / PNR / fare questions. */
export function isStationPickInterrupt(text: string): boolean {
  const follow = classifyFollowUp(text);
  if (isInfoFollowUp(follow) || follow === "guide" || follow === "bookings" || follow === "wallet") return true;
  if (follow === "train_pick" && /\b\d{5}\b/.test(text)) return true;
  if (isGoesToAsk(text)) return true;
  return false;
}

/* Train NAAM se resolve (server parity, 2026-09-05). */
const TRAIN_NAME_GENERIC_TOKENS = new Set(["EXP", "EXPRESS", "MAIL", "SF", "SPL", "SPECIAL", "TRAIN", "TRAINS", "VIA"]);

export function trainNameTokens(name: string): string[] {
  return String(name ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length >= 3 && !TRAIN_NAME_GENERIC_TOKENS.has(t));
}

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

const TRAIN_TYPE_KEYWORD_RE_CLIENT =
  /\b(shatabdi|shatbdi|rajdhani|vande\s+bharat|vande|garib\s+rath|duronto|intercity|tejas|humsafar|gatimaan|gatiman|kranti|saryu|yamuna|jallianwala|punjab\s+mail|golden\s+temple|satluj|sutlej|akal|navyug|himsagar|janshatabdi|jan\s+shatabdi|double\s+decker)\b/i;
const TRAIN_NAME_SUFFIX_RE_CLIENT = /\b[a-z]{3,}(?:\s+[a-z]{3,})*\s+(?:express|exp|mail)\b/i;

export function mentionsTrainName(text: string, trains: { number: string; name: string }[] = []): boolean {
  if (TRAIN_TYPE_KEYWORD_RE_CLIENT.test(text) || TRAIN_NAME_SUFFIX_RE_CLIENT.test(text)) return true;
  return trains.length ? Boolean(matchTrainNameInList(text, trains)) : false;
}

export function resolveTrainNumber(text: string, ctx: AgentContext): string | undefined {
  const byNum = text.match(/\b(\d{5})\b/)?.[1];
  if (byNum) return byNum;
  if (/\bsabse\s+(fast|tez|jaldi|shighra)\b|\bfastest\b/i.test(text) && ctx.fastestTrainNumber) {
    return ctx.fastestTrainNumber;
  }
  if (/\b(yeh? wali|this (one|train)|isi ko)\b/i.test(text) && ctx.selectedTrainNumber) {
    return ctx.selectedTrainNumber;
  }
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
  if (mentionsTrainName(text, listTrains)) return undefined;
  return ctx.selectedTrainNumber ?? undefined;
}

export function mergeAgentContext(
  prev: AgentContext,
  nlu: Pick<NluResult, "intent" | "from" | "to" | "date" | "passengerCount" | "classCodes" | "trainNumber" | "pnr" | "unresolvedFrom" | "unresolvedTo">,
  text: string,
  extra?: { selectedTrainNumber?: string | null; selectedTrainName?: string | null; lastTrainNumbers?: string[]; bookingStage?: BookingStage },
): AgentContext {
  const next: AgentContext = {
    ...prev,
    lastTrainNumbers: [...prev.lastTrainNumbers],
    lastTrains: [...(prev.lastTrains ?? [])],
  };
  /* Round-9 (Agra-bug): unresolved cluster-city yaad rakho, resolve par clear. */
  if (nlu.from) next.pendingOriginChoice = null;
  else if (nlu.unresolvedFrom && /^[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .]{1,28}$/.test(nlu.unresolvedFrom)) {
    next.pendingOriginChoice = nlu.unresolvedFrom;
    next.origin = null; // Round-16g: naya (unresolved) origin bola → purana stale origin hatao
  }
  if (nlu.to) next.pendingDestinationChoice = null;
  else if (nlu.unresolvedTo && /^[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .]{1,28}$/.test(nlu.unresolvedTo)) {
    next.pendingDestinationChoice = nlu.unresolvedTo;
    next.destination = null; // Round-16g (server parity): purana destination hatao
  }
  /* Round-8 (topic-switch): poora naya route + koi train reference nahi →
   * purani selected train clear. EXCEPTION: pichhla intent selected-train
   * ka INFO ask tha (availability/fare/...) — slot-resume, train retain. */
  const INFO_INTENTS_ON_SELECTED_TRAIN = new Set([
    "CHECK_AVAILABILITY",
    "CHECK_FARE",
    "LIVE_TRAIN_STATUS",
    "TRAIN_SCHEDULE",
    "TRAIN_HISTORY",
    "COACH_POSITION",
  ]);
  const fullNewRoute =
    Boolean(nlu.from && nlu.to) &&
    (!prev.origin || prev.origin.code !== nlu.from!.code) &&
    (!prev.destination || prev.destination.code !== nlu.to!.code) &&
    !INFO_INTENTS_ON_SELECTED_TRAIN.has(String(prev.intent ?? ""));
  if (nlu.intent && nlu.intent !== "NONE" && nlu.intent !== "CONFIRM_YES" && nlu.intent !== "CONFIRM_NO") {
    next.intent = nlu.intent;
  }
  if (nlu.from) next.origin = nlu.from;
  if (nlu.to) next.destination = nlu.to;
  /* Round-16g: from == to kabhi valid nahi — jo slot is turn mein nahi bola wo stale hai. */
  if (next.origin && next.destination && next.origin.code === next.destination.code) {
    if (nlu.from && !nlu.to) next.destination = null;
    else if (nlu.to && !nlu.from) next.origin = null;
  }
  /* Round-9: slot kisi bhi raaste se bhara to pending clear. */
  if (next.origin) next.pendingOriginChoice = null;
  if (next.destination) next.pendingDestinationChoice = null;
  /* Round-16j (user screenshot 2026-09-08: "ludhiana se koaa" par date nahi
   * poochhi): NAYI journey (koi bhi end pichhle se alag, ya naya unresolved
   * city) bola aur is turn mein date nahi di → purani chat ki date STALE hai;
   * dateProvided reset — date dobara poochhi jayegi. */
  const routeChanged =
    (nlu.from && prev.origin && nlu.from.code !== prev.origin.code) ||
    (nlu.to && prev.destination && nlu.to.code !== prev.destination.code) ||
    /* Round-18m-7 (user: "kal bola, station chunne ke baad date phir poochi"):
     * pending city ka station pick (Varanasi → BSB) NAYA route nahi hai —
     * us slot ko routeChanged mat maano, di hui date rakho. */
    (nlu.from && !prev.origin && !prev.pendingOriginChoice) ||
    (nlu.to && !prev.destination && !prev.pendingDestinationChoice) ||
    (Boolean(nlu.unresolvedFrom) && !prev.pendingOriginChoice) ||
    (Boolean(nlu.unresolvedTo) && !prev.pendingDestinationChoice);
  if (routeChanged && !nlu.date && (nlu.from || nlu.to || nlu.unresolvedFrom || nlu.unresolvedTo)) {
    next.date = null;
    next.dateProvided = false;
  }
  /* Round-18m-15 (user: "AI passenger nahi poochta, seedha 1 assume karta hai"):
   * NAYI journey = purani journey ka passenger count bhi STALE — reset, taaki
   * search se pehle dobara poochha jaye aur seats usi hisaab se match hon. */
  if (routeChanged && !nlu.passengerCount && (nlu.from || nlu.to || nlu.unresolvedFrom || nlu.unresolvedTo)) {
    next.passengers = null;
    next.paxProvided = false;
  }
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
  /* Round-8: naya poora route + explicit train number nahi bola → selected
   * train clear (resolveTrainNumber ka fallback stale train de deta hai). */
  const explicitTrainSpoken = /\b\d{5}\b/.test(text) || Boolean(extra?.selectedTrainNumber);
  if (fullNewRoute && !explicitTrainSpoken) {
    next.selectedTrainNumber = null;
    next.selectedTrainName = null;
  }
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
  // User instruction (2026-09-05): "Waise hum continue kar sakte hain" jaisi
  // proactive offer-lines KABHI nahi — seedha slot-filling sawaal poochho.
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

/** AI never authorizes money or booking. Always true — only the Confirm UI may charge. */
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
