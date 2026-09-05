import type { ClassCode, Station } from "../providers/types.js";
import { parseDatePhrase, type DateHit } from "./legacy-dates.js";
import { findStationsInText, matchStation } from "./legacy-stations.js";
import { isOutOfDomain } from "./domain.js";
import { routeRailwayIntent } from "./toolRoute.js";

export type TimePref = "morning" | "afternoon" | "evening" | "after";

export type DialogSlot =
  | "from"
  | "to"
  | "date"
  | "passengers"
  | "class"
  | "train"
  | "seat"
  | "pnr"
  | "trainNumber"
  | null;

export type UserIntent =
  | "BOOK_TRAIN"
  | "SEARCH_TRAIN"
  | "CHECK_PNR"
  | "VIEW_BOOKINGS"
  | "CANCEL_BOOKING"
  | "REFUND_STATUS"
  | "VIEW_TICKET"
  | "DOWNLOAD_TICKET"
  | "CHANGE_BOARDING_STATION"
  | "VIEW_WALLET"
  | "ADD_MONEY"
  | "PROFILE"
  | "TRAVELLERS"
  | "HELP"
  | "SUPPORT"
  | "LIVE_TRAIN_STATUS"
  | "COACH_POSITION"
  | "TRAIN_SCHEDULE"
  | "LIVE_AT_STATION"
  | "CANCELLED_TRAINS"
  | "TRAIN_HISTORY"
  | "LIST_CITIES"
  | "RAIL_POLICY"
  | "ABOUT_ASSISTANT"
  | "SELECT_FASTEST"
  | "SELECT_CHEAPEST"
  | "SELECT_BEST"
  | "FIND_ALTERNATE"
  | "CHANGE_DATE"
  | "CONFIRM_YES"
  | "CONFIRM_NO"
  | "OUT_OF_DOMAIN"
  | "CHECK_AVAILABILITY"
  | "CHECK_FARE"
  | "COMPARE_TRAINS"
  | "SELECT_TRAIN"
  | "GENERAL_RAILWAY_KNOWLEDGE"
  | "NONE";

export interface KnownSlots {
  from?: Station | null;
  to?: Station | null;
  date?: string | null;
  passengerCount?: number | null;
}

export interface NluContext {
  now?: Date;
  lastAsked?: DialogSlot;
  known?: KnownSlots;
}

export interface NluResult {
  intent: UserIntent;
  from?: Station;
  to?: Station;
  date?: string;
  dateAmbiguous?: { date: string; label: string }[];
  passengerCount?: number;
  classCodes?: ClassCode[];
  acOnly?: boolean;
  timePref?: TimePref;
  afterHour?: number;
  beforeHour?: number;
  confirmedOnly?: boolean;
  berth?: string;
  quota?: string;
  pnr?: string;
  trainNumber?: string;
  addMoneyAmount?: number;
  returnDate?: string;
  correction?: boolean;
  childMention?: boolean;
  /** Spoken city that is not in the bookable catalog. */
  unresolvedFrom?: string;
  unresolvedTo?: string;
  /** COMPARE_TRAINS: dono (ya sab) bole gaye train numbers (2026-09-06). */
  compareNumbers?: string[];
}

const NUM_WORDS: Record<string, number> = {
  ek: 1, ik: 1, one: 1, "1": 1, एक: 1, इक: 1, "१": 1,
  do: 2, two: 2, "2": 2, दो: 2, "२": 2,
  teen: 3, three: 3, "3": 3, तीन: 3, "३": 3,
  char: 4, four: 4, "4": 4, चार: 4, "४": 4,
  panch: 5, five: 5, "5": 5, पांच: 5, पाँच: 5, "५": 5,
  chhe: 6, che: 6, six: 6, "6": 6, छह: 6, छे: 6, "६": 6,
};

const TICKET_UNIT = /(?:logon ke|logon|logs?|passengers?|pax|people|persons?|tickets?|seats?|टिकटें?|टिकिट|सीटें?|लोगों?)/i;

const FILLER = /मुझे|मैने|मैं|main|mujhe|kal|aaj|parso|आज|कल|परसों|परसो/g;

const CLASS_MAP: Array<{ re: RegExp; code: ClassCode }> = [
  { re: /\b(executive(?:\s+chair(?:\s+car)?)?|ec)\b/, code: "EC" },
  { re: /\b(chair car|cc)\b/, code: "CC" },
  { re: /\b(3\s*ac|3a|third ac|ac 3|3rd ac)\b/, code: "3A" },
  { re: /\b(2\s*ac|2a|second ac|ac 2)\b/, code: "2A" },
  { re: /\b(1\s*ac|1a|first ac|first class|ac first)\b/, code: "1A" },
  { re: /\b(second sitting|2s)\b/, code: "2S" },
  { re: /\b(sleeper|sl class)\b/, code: "SL" },
];

const BERTH_MAP: Array<{ re: RegExp; value: string }> = [
  { re: /\b(side lower|sl berth)\b/, value: "Side Lower" },
  { re: /\b(side upper|su)\b/, value: "Side Upper" },
  { re: /\b(lower berth|lower|lb)\b/, value: "Lower" },
  { re: /\b(upper berth|upper|ub)\b/, value: "Upper" },
  { re: /\b(middle berth|middle|mb)\b/, value: "Middle" },
  { re: /\b(no preference|koi preference nahi)\b/, value: "No Preference" },
  { re: /\b(window)\b/, value: "Window" },
  { re: /\b(aisle)\b/, value: "Aisle" },
];

export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/→/g, " to ")
    .replace(/[?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nextMissing(known: KnownSlots): DialogSlot {
  if (!known.from) return "from";
  if (!known.to) return "to";
  if (!known.date) return "date";
  if (!known.passengerCount) return "passengers";
  return null;
}

function extractClasses(t: string, lastAsked: DialogSlot): { classCodes?: ClassCode[]; acOnly?: boolean } {
  const codes: ClassCode[] = [];
  for (const row of CLASS_MAP) {
    if (row.re.test(t)) codes.push(row.code);
  }
  if (/\bsl\b/.test(t) && lastAsked !== "seat" && !codes.includes("SL")) codes.push("SL");
  if (/\b(general|gn)\b/.test(t) && !codes.includes("2S")) codes.push("2S");
  if (codes.length) return { classCodes: [...new Set(codes)] };
  if (/\bac\b/.test(t) || /\bac\s*mein\b/.test(t)) return { acOnly: true };
  return {};
}

function foldDigits(text: string): string {
  return text.replace(/[०-९]/g, (ch) => String("०१२३४५६७८९".indexOf(ch)));
}

function extractPassengers(t: string, lastAsked: DialogSlot): number | undefined {
  const folded = foldDigits(t);
  if (/\b(me and my wife|main aur meri wife|mere liye aur meri wife|apni wife)\b/.test(folded)) {
    const kids = folded.match(/\b(\d+)\s*(?:bachche|kids?|children)\b/);
    return Math.min(6, 2 + (kids ? Number(kids[1]) : 0));
  }
  if (/\bfamily of\s+(\d+)\b/.test(folded)) return Math.min(6, Number(RegExp.$1));
  const plus = folded.match(/\bmere saath\s+(\d+)\s*aur\b/);
  if (plus) return Math.min(6, Number(plus[1]) + 1);
  const hum = folded.match(/\bhum\s+(\d+)\s*log/);
  if (hum) return clampPax(Number(hum[1]));
  const digitUnit = folded.match(new RegExp(`(\\d)\\s*${TICKET_UNIT.source}`, "i"));
  if (digitUnit) return clampPax(Number(digitUnit[1]));
  const unitDigit = folded.match(new RegExp(`${TICKET_UNIT.source}\\s*(\\d)`, "i"));
  if (unitDigit) return clampPax(Number(unitDigit[1]));
  for (const [w, n] of Object.entries(NUM_WORDS)) {
    if (!w || /^\d+$/.test(w)) continue;
    const re = new RegExp(`(?:^|[\\s])${w}(?:\\s+|\\s*)${TICKET_UNIT.source}`, "i");
    if (re.test(folded)) return n;
  }
  if (lastAsked === "passengers") {
    const compact = folded.replace(/\s+/g, " ").trim();
    if (/^\d+$/.test(compact)) return clampPax(Number(compact));
    const lead = compact.match(/(\d)/);
    if (lead) return clampPax(Number(lead[1]));
    if (NUM_WORDS[compact]) return NUM_WORDS[compact];
    for (const tok of compact.split(/\s+/)) {
      if (NUM_WORDS[tok]) return NUM_WORDS[tok];
    }
    if (TICKET_UNIT.test(compact) || /chahiye|चाहिए/.test(compact)) return 1;
  }
  return undefined;
}

function clampPax(n: number): number | undefined {
  if (n >= 1 && n <= 6) return n;
  return undefined;
}

const END_BITS =
  /(?:^|\s)(?:jana hai|jaana hai|jana|jaana|jaunga|jaungi|ki train|ke liye|ki|ke|ko|kal|aaj|parso|train|tickets?|logon?|hai|hain|chahiye|wali|wala)$/i;

const NOT_PLACE =
  /^(kal|aaj|parso|haan|han|yes|ok|okay|theek|nahi|no|train|ticket|tickets|date|august|january|february|march|april|june|july|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|log|logon|passenger|passengers|subah|shaam|\d+)$/i;

function cleanPlace(raw: string): string {
  let s = raw.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 8; i++) {
    const next = s.replace(END_BITS, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function looksLikePlace(raw: string): boolean {
  const q = cleanPlace(raw);
  if (q.length < 3) return false;
  if (NOT_PLACE.test(q)) return false;
  if (/^\d/.test(q)) return false;
  return true;
}

function isBarePlace(raw: string): boolean {
  const q = cleanPlace(raw);
  if (!looksLikePlace(q)) return false;
  if (/\b(jana|jaana|hai|hain|train|ticket|from|to)\b/i.test(q)) return false;
  return q.split(/\s+/).filter(Boolean).length <= 3;
}

function titlePlace(raw: string): string {
  const q = cleanPlace(raw);
  if (/[\u0900-\u097F]/.test(q)) return q;
  return q.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
}

function resolveBare(raw: string): { station?: Station; unresolved?: string } | null {
  if (!isBarePlace(raw)) return null;
  const cleaned = cleanPlace(raw);
  const station = matchStation(cleaned);
  if (station) return { station };
  return { unresolved: titlePlace(cleaned) };
}

function asRoute(
  a: { station?: Station; unresolved?: string } | null,
  b: { station?: Station; unresolved?: string } | null,
): { from?: Station; to?: Station; unresolvedFrom?: string; unresolvedTo?: string } | null {
  if (!a || !b) return null;
  if (a.station && b.station && a.station.code === b.station.code) return null;
  if (!a.station && !a.unresolved) return null;
  if (!b.station && !b.unresolved) return null;
  return {
    from: a.station,
    to: b.station,
    unresolvedFrom: a.station ? undefined : a.unresolved,
    unresolvedTo: b.station ? undefined : b.unresolved,
  };
}

function extractPair(t: string): {
  from?: Station;
  to?: Station;
  unresolvedFrom?: string;
  unresolvedTo?: string;
} {
  const se = t.match(
    /([\p{L}][\p{L} .]{0,28}?)\s+(?:से|se|from)\s+([\p{L}][\p{L} .]{0,28}?)(?:\s|$)/u,
  );
  if (se) {
    const hit = asRoute(resolveBare(se[1]), resolveBare(se[2]));
    if (hit) return hit;
  }
  const to = t.match(
    /([\p{L}][\p{L} .]{0,28}?)\s+(?:to|tak|->|तक)\s+([\p{L}][\p{L} .]{0,28}?)(?:\s|$)/u,
  );
  if (to) {
    const hit = asRoute(resolveBare(to[1]), resolveBare(to[2]));
    if (hit) return hit;
  }
  const names = uniqueStations(t);
  const fromTail = t.match(/([\p{L}][\p{L} ]{0,20}?)\s+(?:से|se)(?:\s|$)/u);
  if (fromTail && names.length) {
    const origin = matchStation(fromTail[1].replace(FILLER, " ").trim());
    const dest = names.find((s) => s.code !== origin?.code);
    if (origin && dest) return { from: origin, to: dest };
    if (origin && names.length === 1) return { from: origin };
  }
  if (names.length >= 2) return { from: names[0], to: names[1] };
  return {};
}

function uniqueStations(t: string): Station[] {
  return findStationsInText(t);
}

function destCue(t: string): boolean {
  return /jana hai|jaana hai|jaana|ke liye|tak jana|destination|going to|want to go|जाना है|जाना चाह|जाऊंगा|जाऊँगा|जा रही|के लिए/.test(t);
}

function originCue(t: string): boolean {
  return /se nikal|se jana|se jaunga|se niklunga|se departure|from |se train|se nikalna|से जाना|से निकल|से ट्रेन|(?:से|se)\s*$/.test(t);
}

function extractTime(t: string): Pick<NluResult, "timePref" | "afterHour" | "beforeHour"> {
  const before = t.match(/\b(\d{1,2})\s*(?::00|baje|am|pm)?\s*(?:se pehle|pehle|before)\b/);
  if (before) {
    let h = Number(before[1]);
    if (/\bpm\b/.test(t) && h < 12) h += 12;
    return { timePref: "after", beforeHour: h };
  }
  const after = t.match(/\b(\d{1,2})\s*(?::00|baje|am|pm)?\s*(?:ke baad|baad|after)\b/);
  if (after) {
    let h = Number(after[1]);
    if (/\bpm\b/.test(t) && h < 12) h += 12;
    if (h <= 7 && !/\bam\b/.test(t)) h += 12;
    return { timePref: "after", afterHour: h };
  }
  if (/\b(early morning|subah jaldi|saverey)\b/.test(t)) return { timePref: "morning" };
  if (/\b(late night|raat late|der raat)\b/.test(t)) return { timePref: "evening" };
  if (/\b(subah|subha|morning|savere)\b/.test(t)) return { timePref: "morning" };
  if (/\b(dopahar|afternoon)\b/.test(t)) return { timePref: "afternoon" };
  if (/\b(shaam|sham|evening)\b/.test(t)) return { timePref: "evening" };
  if (/\b(raat|night)\b/.test(t)) return { timePref: "evening" };
  return {};
}

function extractBerth(t: string, lastAsked: DialogSlot): string | undefined {
  if (lastAsked === "class" && /\bsl\b/.test(t)) return undefined;
  for (const row of BERTH_MAP) {
    if (row.re.test(t)) return row.value;
  }
  if (lastAsked === "seat" && /\bsl\b/.test(t)) return "Side Lower";
  return undefined;
}

function extractQuota(t: string): string | undefined {
  if (/\b(tatkal|premium tatkal)\b/.test(t)) return "TQ";
  if (/\b(ladies|mahila)\b/.test(t)) return "LD";
  if (/\b(senior citizen|senior)\b/.test(t)) return "SS";
  if (/\b(defence|military)\b/.test(t)) return "DF";
  if (/\b(student)\b/.test(t)) return "ST";
  if (/\b(general quota|gn quota)\b/.test(t)) return "GN";
  return undefined;
}

function extractIntentKind(t: string): UserIntent {
  const routed = routeRailwayIntent(t);
  if (routed.kind === "GENERAL_RAILWAY_KNOWLEDGE") return "GENERAL_RAILWAY_KNOWLEDGE";
  if (routed.kind === "CHECK_AVAILABILITY") return "CHECK_AVAILABILITY";
  if (routed.kind === "CHECK_FARE") return "CHECK_FARE";
  if (routed.kind === "COMPARE_TRAINS") return "COMPARE_TRAINS";
  if (routed.kind === "SELECT_TRAIN") return "SELECT_TRAIN";
  if (routed.kind === "CANCELLED_TRAINS") return "CANCELLED_TRAINS";
  if (routed.kind === "LIVE_TRAIN_STATUS") return "LIVE_TRAIN_STATUS";
  if (routed.kind === "VIEW_BOOKINGS") return "VIEW_BOOKINGS";
  if (routed.kind === "CHECK_PNR") return "CHECK_PNR";
  if (routed.kind === "VIEW_WALLET") return "VIEW_WALLET";
  if (routed.kind === "SELECT_FASTEST") return "SELECT_FASTEST";
  if (routed.kind === "SELECT_CHEAPEST") return "SELECT_CHEAPEST";
  if (routed.kind === "TRAIN_SCHEDULE") return "TRAIN_SCHEDULE";
  if (/irctc|आईआरसीटीसी|आई आर सी टी सी|railway rules?|रेलवे (नियम|रूल)|रूल्स|rules pata|rules maloom/.test(t)) {
    return "RAIL_POLICY";
  }
  if (
    /^(hi|hello|hey|namaste|namaskar|hola)(\s|$)/.test(t) ||
    /kaun ho|who are you|what are you|tum kaun|aap kaun|tum ai|kya tum ai|are you (an )?ai|ai ho kya|answer nhi|jawab nahi|sawaal.*(jawab|answer)|questions?.*(jawab|answer)|mere questions?|mere sawaal|aap kya kar sakte|kya kar sakte ho|what can you do/.test(
      t,
    )
  ) {
    return "ABOUT_ASSISTANT";
  }
  if (
    /कौन.?कौन|kaun.?kaun|which (cities|stations)|kaunse (shehar|shahr|city|station)|shehar hain|शहर हैं|stations (hain|list)|supported (cities|stations)|tumhare paas|आपके पास.*(शहर|स्टेशन)|koi bhi (city|shehar|shahr)|any city|kisi bhi (city|shehar)|saari cities|demo (cities|list)|poori (city |cities |shehar )?list|पूरी (लिस्ट|city list)|full list|all cities/.test(
      t,
    )
  ) {
    return "LIST_CITIES";
  }
  if (/\b(cancel(?:led)? trains?|radd trains?|cancel list|kaunsi train cancel|रद्द ट्रेन)\b/.test(t)) {
    return "CANCELLED_TRAINS";
  }
  if (/\b(station board|live at station|platform pe trains|station pe trains|station par trains)\b/.test(t)) {
    return "LIVE_AT_STATION";
  }
  if (/\b(\d{5})\b/.test(t) && /\b(history|kal ki journey|completed journey)\b/.test(t)) {
    return "TRAIN_HISTORY";
  }
  if (/\b(live status|running status|live running|track train|train (ka )?status|status pata|iska live|uska live)\b/.test(t)) {
    return "LIVE_TRAIN_STATUS";
  }
  if (/\b(\d{5})\b/.test(t) && /\b(kahan|kaha|late|pahunch|pahuch|status|live|abhi)\b/.test(t)) {
    return "LIVE_TRAIN_STATUS";
  }
  if (/\b(\d{5})\b/.test(t) && /\b(timetable|time table|schedule|ka time)\b/.test(t)) {
    return "TRAIN_SCHEDULE";
  }
  if (/\b(pnr|waiting kitni|rac hai|wl hai|ticket confirm hai|confirm hui)\b/.test(t)) return "CHECK_PNR";
  if (/\b(cancel booking|booking cancel|ticket cancel)\b/.test(t)) return "CANCEL_BOOKING";
  if (/\b(refund)\b/.test(t)) return "REFUND_STATUS";
  if (/\b(download ticket|ticket download)\b/.test(t)) return "DOWNLOAD_TICKET";
  if (/\b(view ticket|ticket dikhao|meri train ticket)\b/.test(t)) return "VIEW_TICKET";
  if (/\b(boarding (station )?change|change boarding)\b/.test(t)) return "CHANGE_BOARDING_STATION";
  if (/\b(add money|recharge|top up|paise daalo|wallet mein \d+|500 add)\b/.test(t)) return "ADD_MONEY";
  if (/\b(wallet|balance kitna|mere paise|paise kitne)\b/.test(t)) return "VIEW_WALLET";
  if (/\b(meri bookings?|my bookings?|previous tickets?|booking history|purani booking|last booking|meri tickets)\b/.test(t)) {
    return "VIEW_BOOKINGS";
  }
  if (/\b(profile|mera account)\b/.test(t)) return "PROFILE";
  if (/\b(travellers?|saved passenger)\b/.test(t)) return "TRAVELLERS";
  if (/\b(help|madad chahiye|madad karo|customer care)\b/.test(t) && !/\b(kaise book|booking kaise)\b/.test(t)) return "HELP";
  if (/\b(support|customer care)\b/.test(t)) return "SUPPORT";
  if (/\b(fastest wali|jo fastest|sabse tez|sabse fast|fastest)\b/.test(t) || /jaldi pahuch|jaldi pahunch/.test(t) || /जल्दी पहुँच|सबसे तेज|सबसे फास्ट/.test(t)) return "SELECT_FASTEST";
  if (/\b(cheapest|sabse sast|sasti)\b/.test(t)) return "SELECT_CHEAPEST";
  if (/\b(jo best|best wala|recommend)\b/.test(t)) return "SELECT_BEST";
  if (/\b(book kar do|book kardo|book karo|book it|yes,? book)\b/.test(t)) return "BOOK_TRAIN";
  if (/\bdate change\b/.test(t)) return "CHANGE_DATE";
  const dateCue =
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|ravivar|somvar|kal|parso|aaj|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/.test(t) ||
    /\d{1,2}[/-]\d{1,2}/.test(t) ||
    /\d{1,2}\s*(?:ko|aug|august)/.test(t);
  if (dateCue && /\b(iski jagah|wali train dikhao|change karke)\b/.test(t)) return "CHANGE_DATE";
  if (/\b(no seat|seat nahi|nahi mili|not available)\b/.test(t)) return "FIND_ALTERNATE";
  if (/\b(haan|han|yes|ok|theek|select karo|isi ko)\b/.test(t)) return "CONFIRM_YES";
  if (/\b(nahi|no|mat karo)\b/.test(t) && !/\bnahi[,\s]+\w/.test(t)) return "CONFIRM_NO";
  if (/\b(train list|kaunsi train|trains? dikhao|search train)\b/.test(t)) return "SEARCH_TRAIN";
  return "NONE";
}

function applyCorrection(
  t: string,
  known: KnownSlots,
  now: Date,
  lastAsked: DialogSlot,
): Partial<NluResult> | null {
  const nahiLead = t.match(/^(?:nahi|no)[,.\s]+(.+)/);
  if (nahiLead && (known.from || known.to || known.date || known.passengerCount)) {
    const rest = nahiLead[1].trim();
    const dateHit = parseDatePhrase(rest, now, { allowDayOnly: true });
    if (dateHit.date) return { correction: true, date: dateHit.date };
    const paxSpoken = extractPassengers(rest, null);
    const paxForced = /\b(passenger|passengers|log|ticket|tickets|टिकट)\b/.test(rest)
      ? extractPassengers(`${rest} passengers`, "passengers")
      : undefined;
    if (paxSpoken || paxForced) return { correction: true, passengerCount: paxSpoken ?? paxForced };
    const hasSe = /(?:से|\bse\b)/.test(rest);
    const hasJaana = destCue(rest);
    const place = matchStation(cleanPlace(rest)) || uniqueStations(rest)[0];
    if (place && hasSe) {
      return { correction: true, from: place, to: known.to ?? undefined };
    }
    if (place && hasJaana && !hasSe) {
      return { correction: true, to: place, from: known.from ?? undefined };
    }
  }
  const actually = t.match(/^(?:actually|asli mein|wait)\s+(.+)/);
  if (actually) {
    const rest = understand(actually[1], { now, lastAsked, known });
    return { ...rest, correction: true };
  }
  const m = t.match(/(?:sorry[, ]+)?(.+?)\s+nahi[,\s]+(.+)/);
  if (!m) return null;
  const left = m[1].trim();
  const right = m[2].trim();
  const out: Partial<NluResult> = { correction: true };

  const leftSt = matchStation(left);
  const rightSt = matchStation(right);
  if (leftSt && rightSt) {
    if (known.from?.code === leftSt.code) out.from = rightSt;
    else if (known.to?.code === leftSt.code) out.to = rightSt;
    else if (lastAsked === "from") out.from = rightSt;
    else if (lastAsked === "to") out.to = rightSt;
    else if (known.from?.code === leftSt.code || !known.to) out.to = rightSt;
    else out.from = rightSt;
    return out;
  }

  const rightDate = parseDatePhrase(right, now);
  const leftDate = parseDatePhrase(left, now);
  if (leftDate.date || rightDate.date || /kal|parso|aaj|august|sunday|monday/.test(left + " " + right)) {
    if (rightDate.date) out.date = rightDate.date;
    else if (rightDate.ambiguous) out.dateAmbiguous = rightDate.ambiguous;
    return out;
  }

  const leftPax = extractPassengers(left, "passengers");
  const rightNum = right.match(/(\d+)/);
  const rightPax =
    extractPassengers(right, "passengers") ??
    extractPassengers(`${right} passengers`, "passengers") ??
    (rightNum ? Number(rightNum[1]) : undefined);
  if (leftPax != null || rightPax != null || lastAsked === "passengers") {
    if (rightPax) out.passengerCount = clampPax(rightPax);
    return out;
  }

  const rightClass = extractClasses(right, "class");
  if (rightClass.classCodes?.length) {
    out.classCodes = rightClass.classCodes;
    return out;
  }
  return out;
}

export function understand(text: string, ctx: NluContext = {}): NluResult {
  const now = ctx.now ?? new Date();
  const lastAsked = ctx.lastAsked ?? null;
  const known: KnownSlots = ctx.known ?? {};
  const raw = text.trim();
  const t = normalizeUtterance(raw);

  if (
    isOutOfDomain(raw, {
      lastAsked,
      hasBookingContext: Boolean(known.from || known.to || known.date || lastAsked),
    })
  ) {
    return { intent: "OUT_OF_DOMAIN" };
  }

  const topic = extractIntentKind(t);
  const pnrMatch = t.match(/\b((?:mock)?\d{6,12})\b/i)?.[1]?.toUpperCase();
  if (lastAsked === "pnr" && pnrMatch) {
    return { intent: "CHECK_PNR", pnr: pnrMatch };
  }
  const addAmt = t.match(/\b(\d{2,6})\s*(?:rs|rupees|add|daalo)?\b/);

  const trainNo = t.match(/\b(\d{5})\b/)?.[1];
  if (lastAsked === "trainNumber" && trainNo) {
    return { intent: "LIVE_TRAIN_STATUS", trainNumber: trainNo };
  }
  if (topic === "CHECK_PNR" || topic === "VIEW_BOOKINGS" || topic === "VIEW_WALLET" || topic === "ADD_MONEY"
    || topic === "CANCEL_BOOKING" || topic === "HELP" || topic === "SUPPORT" || topic === "PROFILE"
    || topic === "TRAVELLERS" || topic === "VIEW_TICKET" || topic === "DOWNLOAD_TICKET"
    || topic === "LIST_CITIES" || topic === "RAIL_POLICY" || topic === "ABOUT_ASSISTANT"
    || topic === "REFUND_STATUS" || topic === "CHANGE_BOARDING_STATION"
    || topic === "LIVE_TRAIN_STATUS" || topic === "TRAIN_SCHEDULE"
    || topic === "LIVE_AT_STATION" || topic === "CANCELLED_TRAINS" || topic === "TRAIN_HISTORY") {
    const stationHit = uniqueStations(t)[0];
    return {
      intent: topic,
      pnr: pnrMatch && (pnrMatch.startsWith("MOCK") || pnrMatch.length >= 6) ? pnrMatch : undefined,
      addMoneyAmount: topic === "ADD_MONEY" && addAmt ? Number(addAmt[1]) : undefined,
      trainNumber: trainNo,
      from: topic === "LIVE_AT_STATION" ? stationHit : undefined,
    };
  }

  const corrText = t.replace(/\s+(?:ki jagah|ke bajaye|ke badle)\s+/g, " nahi ");
  const correction = applyCorrection(corrText, known, now, lastAsked);
  if (correction) {
    return {
      intent: topic === "NONE" ? "BOOK_TRAIN" : topic,
      ...correction,
    };
  }

  const pair = extractPair(t);
  const names = uniqueStations(t);
  let from = pair.from;
  let to = pair.to;
  let unresolvedFrom = pair.unresolvedFrom;
  let unresolvedTo = pair.unresolvedTo;
  if (!from && !to && names.length === 1) {
    const s = names[0];
    if (destCue(t) && !originCue(t)) to = s;
    else if (originCue(t)) from = s;
    else if (lastAsked === "from") from = s;
    else if (lastAsked === "to") to = s;
    else if (!known.from) from = s;
    else if (!known.to && s.code !== known.from.code) to = s;
  }
  if (!from && !to && !unresolvedFrom && !unresolvedTo && names.length === 0) {
    const destOnly = t.match(
      /(?:^|\s)([\p{L}][\p{L} .]{1,24}?)\s+(?:jana hai|jaana hai|jana|jaana|जाना है)/u,
    );
    if (destOnly && destCue(t) && !originCue(t) && looksLikePlace(destOnly[1])) {
      unresolvedTo = titlePlace(destOnly[1]);
    } else if (lastAsked === "from" && looksLikePlace(t)) {
      unresolvedFrom = titlePlace(t);
    } else if (lastAsked === "to" && looksLikePlace(t)) {
      unresolvedTo = titlePlace(t);
    }
  }

  const dateHit: DateHit = parseDatePhrase(t, now, { allowDayOnly: lastAsked === "date" });
  const date = dateHit.date;

  const pax = extractPassengers(t, lastAsked);
  const klass = extractClasses(t, lastAsked);
  const time = extractTime(t);
  const berth = extractBerth(t, lastAsked);
  const quota = extractQuota(t);

  const ret = t.match(/\b(?:wapas|return|waapas)\b/);
  let returnDate: string | undefined;
  if (ret) {
    const bits = t.split(/\b(?:wapas|return)\b/);
    const after = parseDatePhrase(bits[1] ?? "", now);
    if (after.date) returnDate = after.date;
  }

  let intent = topic;
  if (intent === "NONE" && (from || to || date || pax || klass.classCodes || unresolvedFrom || unresolvedTo)) {
    intent = "SEARCH_TRAIN";
  }
  if (intent === "CONFIRM_NO" && (from || to || date)) intent = "SEARCH_TRAIN";

  /* COMPARE_TRAINS: "12014 and 12054 mein se kon si better" — dono numbers
   * (2026-09-06): deterministic compare executor ke liye. */
  const compareNumbers =
    intent === "COMPARE_TRAINS"
      ? [...t.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3)
      : undefined;
  return {
    intent,
    from,
    to,
    unresolvedFrom,
    unresolvedTo,
    compareNumbers,
    date,
    dateAmbiguous: dateHit.ambiguous,
    passengerCount: pax,
    ...klass,
    ...time,
    berth,
    quota,
    confirmedOnly: /\b(confirm(?:ed)?|confirmed seat)\b/.test(t) || undefined,
    childMention: /\b(baby|infant|bachcha|child|saal ka)\b/.test(t) || undefined,
    returnDate,
  };
}

/** Back-compat wrapper used by older tests and voice path. */
export function toLegacyIntent(n: NluResult) {
  const action =
    n.intent === "SELECT_FASTEST" ? "select_fastest" as const
    : n.intent === "SELECT_CHEAPEST" ? "select_cheapest" as const
    : n.intent === "SELECT_BEST" ? "select_recommended" as const
    : n.intent === "BOOK_TRAIN" ? "book" as const
    : n.intent === "CHANGE_DATE" ? "change_date" as const
    : n.intent === "FIND_ALTERNATE" ? "find_alternate" as const
    : n.intent === "VIEW_BOOKINGS" || n.intent === "CHECK_PNR" || n.intent === "VIEW_TICKET" ? "check_booking" as const
    : n.intent === "CONFIRM_YES" ? "yes" as const
    : n.intent === "CONFIRM_NO" ? "no" as const
    : n.intent === "SEARCH_TRAIN" ? "search" as const
    : undefined;
  return {
    raw: "",
    from: n.from,
    to: n.to,
    date: n.date,
    dateAmbiguous: n.dateAmbiguous,
    passengerCount: n.passengerCount,
    timePref: n.timePref,
    afterHour: n.afterHour,
    acOnly: n.acOnly,
    classCodes: n.classCodes,
    confirmedOnly: n.confirmedOnly,
    action,
  };
}
