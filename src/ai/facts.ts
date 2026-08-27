/** Railway fact answers: look up real data, or ask one missing slot. Never invent. */

import { spokenTrainNumbers } from "./compare";

const BOOKING_CUE = /\b(jana|jaana|ticket|tickets|book|booking)\b|जाना|टिकट/;

const FACT_VERB =
  /\b(timetable|time table|schedule|ka time|route|kitne ghante|kitni der|duration|kitna time|kab chalti|kis din|running days|jaati|jati|rukti|halt|stops?|via|naam|details|info|batao|btana|btao)\b|कितने घंटे|कितनी देर|रुकती|जाती/;

const CAPABILITY =
  /\b(khana|food|pantry|catering|meal|blanket|bedroll|wifi|wi-fi|charging|charge point|charger|irctc app|platform (number|no)|pf number)\b|खाना|पैंट्री|कंबल|चार्जिंग/;

export function isCapabilityAsk(text: string): boolean {
  return CAPABILITY.test(text.toLowerCase());
}

export function capabilityReply(text: string): string {
  const t = text.toLowerCase();
  if (/\b(khana|food|pantry|catering|meal)\b|खाना|पैंट्री/.test(t)) {
    return "Pantry / khana ka menu railway provider se nahi aata — main gadh ke nahi bataunga. Route, time, seats, fare check kar sakta hoon.";
  }
  if (/\b(blanket|bedroll)\b|कंबल/.test(t)) {
    return "Blanket / bedroll confirm provider payload mein nahi hota. Main invent nahi karunga. Seats/fare/live pooch sakte ho.";
  }
  if (/\b(wifi|wi-fi|charging|charger|charge point)\b|चार्जिंग/.test(t)) {
    return "Wifi / charging point IRCTC amenity list yahan nahi milti. Main gadh ke nahi bataunga. Train timetable ya seats check karun?";
  }
  if (/\b(platform|pf number)\b/.test(t)) {
    return "Platform number live status se aata hai, guess nahi. Train number bolo to live nikaalta hoon.";
  }
  return "Yeh cheez provider se available nahi. Main gadh ke nahi bataunga — trains, seats, fare, live, PNR pooch sakte ho.";
}

export function isTrainFactAsk(text: string): boolean {
  const t = text.toLowerCase();
  const nums = spokenTrainNumbers(t);
  if (!nums.length) return false;
  if (FACT_VERB.test(t)) return true;
  if (/^\d{5}[.?!]*$/.test(t.trim())) return true;
  return nums.length === 1 && !BOOKING_CUE.test(t);
}

export const FACT_INTENTS = new Set([
  "COMPARE_TRAINS",
  "TRAIN_SCHEDULE",
  "LIVE_TRAIN_STATUS",
  "TRAIN_HISTORY",
  "CHECK_AVAILABILITY",
  "CHECK_FARE",
  "CANCELLED_TRAINS",
  "CHECK_PNR",
  "GENERAL_RAILWAY_KNOWLEDGE",
]);

export function preferLocalFactIntent<T extends string>(ai: T, local: T): T {
  if (FACT_INTENTS.has(local) && (ai === "SEARCH_TRAIN" || ai === "BOOK_TRAIN" || ai === "NONE" || !ai)) {
    return local;
  }
  return ai;
}

/** “12054 Delhi jaati hai?” / “Delhi jaati hai ya nahi” — not a booking dest. */
export function isGoesToAsk(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(ticket|tickets|book|booking|jana hai|jaana hai)\b|जाना है/.test(t) && !/\b(jaati|jati|rukti|jaa rahi|jaa rhi|ja rahi)\b/.test(t)) {
    return false;
  }
  return (
    /\b(jaati|jati|jaa rahi|jaa rhi|ja rahi|rukti|halt|goes to)\b/.test(t) ||
    /जाती|रुकती/.test(text) ||
    /\b(ya nahi|yan nahi|yan nhi|ya nhi|hai ya nahi|hai yan nahi)\b/.test(t)
  );
}
