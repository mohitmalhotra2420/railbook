/** Deterministic railway tool/intent router. NVIDIA may override; this is the fallback. */

export type RoutedTool =
  | "getLiveStatus"
  | "getCoachPosition"
  | "getTimetable"
  | "getAvailability"
  | "getFare"
  | "getCancelledTrains"
  | "checkPNR"
  | "getMyBookings"
  | "getWallet"
  | "searchTrains"
  | "compareTrains"
  | "selectTrain"
  | "glossary"
  | null;

export type RoutedKind =
  | "LIVE_TRAIN_STATUS"
  | "COACH_POSITION"
  | "TRAIN_SCHEDULE"
  | "CHECK_AVAILABILITY"
  | "CHECK_FARE"
  | "CANCELLED_TRAINS"
  | "CHECK_PNR"
  | "VIEW_BOOKINGS"
  | "VIEW_WALLET"
  | "COMPARE_TRAINS"
  | "SELECT_TRAIN"
  | "SELECT_FASTEST"
  | "SELECT_CHEAPEST"
  | "GENERAL_RAILWAY_KNOWLEDGE"
  | "SEARCH_TRAIN"
  | null;

const GLOSS_TERM =
  /\b(cc|sl|3a|3ac|2a|2ac|1a|1ac|2s|3e|ec|rac|wl|gnwl|rlwl|pqwl|tatkal|sleeper|chair car|waitlist)\b|सीसी|स्लीपर|आरएसी|वेटलिस्ट|तत्काल/;

export function isGlossaryQuestion(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b\d{5}\b/.test(t)) return false;
  if (/\b(available|fare|live|status|seat|pnr|kahan|kaha)\b/.test(t)) return false;
  if (!/\b(kya hota|kya hai|matlab|meaning|difference|farq|fark)\b/.test(t) && !/क्या होता|मतलब|क्या है|फर्क/.test(text)) {
    return false;
  }
  return GLOSS_TERM.test(t) || /सीसी|स्लीपर|आरएसी|वेटलिस्ट/.test(text);
}

export function routeRailwayIntent(text: string): { kind: RoutedKind; tool: RoutedTool; trainNumber?: string; selectionIndex?: number } {
  const t = text.trim().toLowerCase();
  const nums = [...t.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]);
  const trainNumber = nums[0];

  if (isGlossaryQuestion(text)) {
    return { kind: "GENERAL_RAILWAY_KNOWLEDGE", tool: "glossary" };
  }
  if (/\b(meri bookings?|my bookings?|ticket history|meri tickets?|last ticket|last booking|purani booking|booking history)\b/.test(t) || /मेरी (बुकिंग|टिकट)/.test(text)) {
    return { kind: "VIEW_BOOKINGS", tool: "getMyBookings" };
  }
  if (/\b(wallet|balance kitna|mere paise)\b/.test(t)) {
    return { kind: "VIEW_WALLET", tool: "getWallet" };
  }
  if (/\b(pnr)\b/.test(t) && !/\b(rac|wl)\b/.test(t)) {
    return { kind: "CHECK_PNR", tool: "checkPNR" };
  }
  if (
    /\b(\d{5})\b/.test(t) &&
    /\b(cancel(?:led)?|radd)\b/.test(t) &&
    !/\b(booking|ticket)\b/.test(t)
  ) {
    return { kind: "CANCELLED_TRAINS", tool: "getCancelledTrains", trainNumber };
  }
  if (/\b(cancel(?:led)? trains?|radd trains?|cancel list|kaunsi train cancel|रद्द ट्रेन)\b/.test(t)) {
    return { kind: "CANCELLED_TRAINS", tool: "getCancelledTrains" };
  }
  if (
    /\b(coach(?:es)?\s*(?:position|layout|composition)?|dibba|dabba)\b/.test(t) ||
    /कोच|डिब्बा/.test(text)
  ) {
    return { kind: "COACH_POSITION", tool: "getCoachPosition", trainNumber };
  }
  if (
    /\b(live status|running status|kahan hai|kaha hai|abhi kahan|kitni late|kitna late|track train)\b/.test(t) ||
    (/लाइव|स्टेटस|कहां है|कहाँ है/.test(text) && /\b\d{5}\b/.test(t))
  ) {
    return { kind: "LIVE_TRAIN_STATUS", tool: "getLiveStatus", trainNumber };
  }
  if (/\b(\d{5})\b/.test(t) && /\b(kahan|kaha|late|pahunch|pahuch|abhi)\b/.test(t)) {
    return { kind: "LIVE_TRAIN_STATUS", tool: "getLiveStatus", trainNumber };
  }
  if (
    /\b(\d{5})\b/.test(t) &&
    /\b(timetable|time table|schedule|ka time|route|kitne ghante|kitni der|duration|kab chalti|kis din|running days|jaati|jati|rukti|halt|stops?|via|details|info)\b/.test(
      t,
    )
  ) {
    return { kind: "TRAIN_SCHEDULE", tool: "getTimetable", trainNumber };
  }
  if (
    nums.length >= 2 &&
    /\b(better|compare|recommend|kaunsi|kaun si|kon si|konsi|vs|versus|ya|yan|or|aur)\b/.test(t)
  ) {
    return { kind: "COMPARE_TRAINS", tool: "compareTrains", trainNumber: nums[0] };
  }
  if (
    /\b(\d{5})\b/.test(t) &&
    (/\b(available|availability|avl|seat|seats)\b/.test(t) || /सीट/.test(text))
  ) {
    return { kind: "CHECK_AVAILABILITY", tool: "getAvailability", trainNumber };
  }
  if (/\b(\d{5})\b/.test(t) && (/\b(fare|kitna padega|kitna lagega|price)\b/.test(t) || /किराया/.test(text))) {
    return { kind: "CHECK_FARE", tool: "getFare", trainNumber };
  }
  if (/\b(fastest|sabse tez|sabse fast|jaldi|fast wali)\b/.test(t) || /जल्दी|सबसे तेज/.test(text)) {
    return { kind: "SELECT_FASTEST", tool: "selectTrain" };
  }
  if (/\b(cheapest|sabse sast|sasti)\b/.test(t)) {
    return { kind: "SELECT_CHEAPEST", tool: "selectTrain" };
  }
  if (/\b(\d{5})\s*wali\b/.test(t)) {
    return { kind: "SELECT_TRAIN", tool: "selectTrain", trainNumber };
  }
  const nth = t.match(/\b(\d+)(?:st|nd|rd|th)\s+train\b/);
  if (nth) {
    return { kind: "SELECT_TRAIN", tool: "selectTrain", selectionIndex: Number(nth[1]) };
  }
  if (/\b(pehli|first)(\s+wali|\s+train)?\b/.test(t)) {
    return { kind: "SELECT_TRAIN", tool: "selectTrain", selectionIndex: 1 };
  }
  if (/\b(doosri|dusri|second)(\s+wali|\s+train)?\b/.test(t)) {
    return { kind: "SELECT_TRAIN", tool: "selectTrain", selectionIndex: 2 };
  }
  if (/\b(teesri|third)(\s+wali|\s+train)?\b/.test(t)) {
    return { kind: "SELECT_TRAIN", tool: "selectTrain", selectionIndex: 3 };
  }
  if (/^(yeh? wali|isi ko|this (one|train))$/i.test(t)) {
    return { kind: "SELECT_TRAIN", tool: "selectTrain" };
  }
  return { kind: null, tool: null, trainNumber };
}
