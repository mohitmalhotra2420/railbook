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
  if (/\b(khana|food|pantry|catering|meal|chai|tea)\b|खाना|पैंट्री/.test(t)) {
    return "Pantry/catering: Rajdhani · Duronto · Vande Bharat · Tejas jaise trains me onboard IRCTC catering hoti hai (booking ke waqt meal option — breakfast/lunch/dinner/tea); Sleeper/General me IRCTC eCatering (ecatering.irctc.co.in / 1323) se en-route station par order kar sakte ho, seat par serve hota hai. Kisi specific train (number) ka catering confirm chahiye to number batao — verified source se dekh kar bataunga, guess nahi karunga.";
  }
  if (/\b(blanket|bedroll)\b|कंबल/.test(t)) {
    return "Bedding: AC classes (1A/2A/3A) me blanket + sheet + pillow included hoti hai; Sleeper (SL) aur 2S me bedding nahi milti. Kisi specific train ke liye confirm chahiye to train number batao.";
  }
  if (/\b(wifi|wi-fi|charging|charger|charge point)\b|चार्जिंग/.test(t)) {
    return "Charging point: reserved coaches (SL/3A/2A/1A/CC/EC) me aam taur par berth/seat ke paas hota hai — purane rakes aur General (GS) dabbe me nahi hota. Wifi: kuch premium trains ke naye rakes me hota hai, har train me nahi — exact status provider data me confirm nahi hota, isliye main guess nahi karunga.";
  }
  if (/\b(platform|pf number)\b/.test(t)) {
    return "Platform number live status/chart se confirm hota hai — guess nahi karta. Train number (aur date) bolo, main live status se jo data milta hai wahi bataunga.";
  }
  return "Yeh cheez mere live provider data me confirm nahi hoti — main guess nahi karunga. Jo main sach me bata sakta hoon: trains · timings · seats/fare · live status · PNR · rules (tatkal/RAC/luggage). Poochhiye, seedha jawab dunga.";
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
  "COACH_POSITION",
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
