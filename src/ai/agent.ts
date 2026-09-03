import type { DialogSlot, NluResult } from "./nlu";
import { nextMissing } from "./nlu";
import type { Station } from "../types";
import { isGoesToAsk } from "./facts";

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
  if (/\b(timetable|time table|schedule|ka time)\b/.test(t)) return "timetable";
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
    /\b(\d+)(?:st|nd|rd|th)\s+train\b/.test(t) ||
    /\b(pehli|doosri|dusri|teesri|chauthi|first|second|third|fourth)\s+(wali|train)\b/.test(t)
  ) {
    return "train_pick";
  }
  if (
    /\b(kaunsi better|kaun better|compare|recommend)\b/.test(t) ||
    ((/\b(ya|yan|vs|aur|or)\b/.test(t) || /\bkon si\b/.test(t)) && (t.match(/\b\d{5}\b/g) ?? []).length >= 2)
  ) {
    return "more_trains";
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

export function resolveTrainNumber(text: string, ctx: AgentContext): string | undefined {
  const byNum = text.match(/\b(\d{5})\b/)?.[1];
  if (byNum) return byNum;
  if (/\b(yeh? wali|this (one|train)|isi ko)\b/i.test(text) && ctx.selectedTrainNumber) {
    return ctx.selectedTrainNumber;
  }
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
  return ctx.selectedTrainNumber ?? undefined;
}

export function mergeAgentContext(
  prev: AgentContext,
  nlu: Pick<NluResult, "intent" | "from" | "to" | "date" | "passengerCount" | "classCodes" | "trainNumber" | "pnr">,
  text: string,
  extra?: { selectedTrainNumber?: string | null; selectedTrainName?: string | null; lastTrainNumbers?: string[]; bookingStage?: BookingStage },
): AgentContext {
  const next: AgentContext = { ...prev, lastTrainNumbers: [...prev.lastTrainNumbers] };
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
    return { ask, text: `Waise hum${when} ${route} booking continue kar sakte hain. Kis date ko jaana hai?` };
  }
  if (ask === "passengers") {
    return { ask, text: `Waise hum${when} ${route} booking continue kar sakte hain. Kitne passengers hain?` };
  }
  if (ask === "from") {
    return { ask, text: `Waise booking continue kar sakte hain. Kahan se jaana hai?` };
  }
  if (ask === "to") {
    return { ask, text: `Waise booking continue kar sakte hain. Kahan jaana hai?` };
  }
  if (ctx.bookingStage === "results" || ctx.lastTrainNumbers.length) {
    return { ask: "train", text: `Waise ${route} ki trains pehle wali list se continue kar sakte hain. Kaunsi train choose karein?` };
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
