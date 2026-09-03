import { addDays, formatShortDate } from "../format";
import type { BookingSnapshot } from "../booking/state";
import type { ClassAvailability, ClassCode, Passenger, Recommendation, Station, TrainResult } from "../types";
import { isBookable } from "../types";
import {
  bestClass,
  filterTrains,
  matchingClasses,
  mergePrefs,
  pickCheapest,
  pickFastest,
  pickRecommended,
  type Prefs,
} from "./filter";
import { parseDatePhrase, parseStatusDate, todayYmdFrom } from "./dates";
import { groundNlu, understand, nextMissing, mergeNlu, isSearchNudge, destCue, originCue, type DialogSlot, type NluResult } from "./nlu";
import { RAIL_ONLY_REPLY, glossaryReply } from "./domain";
import { spokenTrainNumbers } from "./compare";
import { capabilityReply, isCapabilityAsk, isGoesToAsk } from "./facts";
import {
  CLIENT_STATIONS,
  clusterStations,
  clusterStationsForText,
  isGarbageStationQuery,
  isStationChoiceQuestion,
} from "./stations";
import {
  bookingInProgress,
  classifyFollowUp,
  emptyAgentContext,
  mergeAgentContext,
  resolveTrainNumber,
  resumeBookingLine,
} from "./agent";

export type Block =
  | { type: "chips"; options: { id: string; label: string; utterance?: string }[] }
  | { type: "stations"; options: { code: string; name: string; city: string }[]; slot: "from" | "to" }
  | { type: "dates"; options: { date: string; label: string }[] }
  | { type: "train"; train: TrainResult; badge?: string; reason?: string; primary?: boolean }
  | { type: "more"; trains: TrainResult[] }
  | { type: "classes"; train: TrainResult; classes: ClassAvailability[] }
  | { type: "berths"; options: string[] }
  | { type: "passengers" }
  | { type: "saved"; list: Passenger[] }
  | { type: "fare" }
  | { type: "wallet" }
  | { type: "ticket" }
  | { type: "empty"; date: string };

export interface AssistantTurn {
  text: string;
  blocks?: Block[];
  prefs: Prefs;
  apply?: {
    from?: Station;
    to?: Station;
    date?: string;
    passengerCount?: number;
  };
  search?: boolean;
  clearForDate?: boolean;
  selectTrain?: TrainResult;
  selectClass?: ClassAvailability;
  selectSeat?: string;
  goPassengers?: boolean;
  goReview?: boolean;
  confirmBook?: boolean;
  openWallet?: boolean;
  openBookings?: boolean;
  retrievePnr?: string;
  liveTrain?: string;
  liveDate?: string;
  trainSchedule?: string;
  liveStation?: string;
  cancelled?: boolean;
  trainHistory?: string;
  historyDate?: string;
  ask?: DialogSlot;
  resumeAsk?: DialogSlot;
  resumeText?: string;
  lookupFare?: boolean;
  lookupAvailability?: boolean;
  probeSeats?: string;
  probeSeatsDate?: string;
  compareTrains?: string[];
  compareDestCodes?: string[];
}

export interface TurnInput {
  text: string;
  now?: Date;
  booking: BookingSnapshot;
  prefs: Prefs;
  saved: Passenger[];
  walletBalance?: number;
  lastAsked?: DialogSlot;
  extraction?: NluResult;
  lastFactTrain?: string;
}

function city(s: Station | null | undefined): string {
  return s?.city ?? s?.code ?? "—";
}

function askCopy(slot: DialogSlot, haveDest?: boolean): string {
  if (slot === "from") return "Kahan se jana hai?";
  if (slot === "to") return haveDest ? "Aur kahan jana hai?" : "Kahan jana hai?";
  if (slot === "date") return "Bilkul. Kab jaana hai?";
  if (slot === "passengers") return "Kitni tickets chahiye?";
  return "Aur kya help chahiye?";
}

export function planTurn(input: TurnInput): AssistantTurn {
  const now = input.now ?? new Date();
  const lastAsked = input.lastAsked ?? null;
  const userDateKnown = Boolean(
    input.booking.trains.length ||
      input.booking.selectedTrain ||
      input.booking.previewFare,
  );
  const known = {
    from: input.booking.from,
    to: input.booking.to,
    date: input.booking.dateProvided ? input.booking.date || null : null,
    passengerCount: input.booking.paxProvided ? input.booking.passengerCount : null,
  };
  const local = understand(input.text, {
    now,
    lastAsked,
    known,
  });
  const nlu = mergeNlu(input.extraction ? groundNlu(input.extraction, input.text) : undefined, local, input.text, lastAsked);
  if (!nlu.passengerCount && local.passengerCount) {
    nlu.passengerCount = local.passengerCount;
  }
  const spokenTrain = input.text.match(/\b(\d{5})\b/)?.[1];
  if (spokenTrain && (lastAsked === "trainNumber" || nlu.intent === "LIVE_TRAIN_STATUS" || nlu.intent === "TRAIN_SCHEDULE" || nlu.intent === "TRAIN_HISTORY")) {
    nlu.trainNumber = nlu.trainNumber || spokenTrain;
    if (lastAsked === "trainNumber" && nlu.intent !== "TRAIN_SCHEDULE" && nlu.intent !== "TRAIN_HISTORY") {
      nlu.intent = "LIVE_TRAIN_STATUS";
    }
  }

  const junkFrom = nlu.unresolvedFrom && !nlu.from && isGarbageStationQuery(nlu.unresolvedFrom.replace(/\s+(se|from)$/i, "").trim());
  const junkTo = nlu.unresolvedTo && !nlu.to && isGarbageStationQuery(nlu.unresolvedTo.replace(/\s+(jana hai|jaana hai|jana|jaana)$/i, "").trim());
  if (junkFrom) {
    return {
      text: `"${nlu.unresolvedFrom}" koi railway station nahi hai. Sahi naam ya code boliye — jaise Ludhiana ya LDH.`,
      prefs: input.prefs,
      ask: "from",
    };
  }
  if (junkTo) {
    return {
      text: `"${nlu.unresolvedTo}" koi railway station nahi hai. Sahi naam ya code boliye.`,
      prefs: input.prefs,
      ask: "to",
    };
  }

  const prefs = mergePrefs(input.prefs, {
    timePref: nlu.timePref,
    afterHour: nlu.afterHour,
    acOnly: nlu.acOnly,
    classCodes: nlu.classCodes,
    confirmedOnly: nlu.confirmedOnly,
  });

  if (nlu.unresolvedFrom && stationInCluster(input.booking.from, nlu.unresolvedFrom)) {
    delete nlu.unresolvedFrom;
  }
  if (nlu.unresolvedTo && stationInCluster(input.booking.to, nlu.unresolvedTo)) {
    delete nlu.unresolvedTo;
  }

  const from =
    nlu.from ??
    input.booking.from ??
    (nlu.unresolvedFrom ? { code: nlu.unresolvedFrom, name: nlu.unresolvedFrom, city: nlu.unresolvedFrom } : undefined);
  const to =
    nlu.to ??
    input.booking.to ??
    (nlu.unresolvedTo ? { code: nlu.unresolvedTo, name: nlu.unresolvedTo, city: nlu.unresolvedTo } : undefined);
  const spokenDate =
    parseDatePhrase(input.text, now, { allowDayOnly: lastAsked === "date" }).date ||
    (lastAsked === "date" ? nlu.date : undefined);
  let date = spokenDate ?? (input.booking.dateProvided || userDateKnown ? input.booking.date || undefined : undefined);
  const midJourney = Boolean(input.booking.selectedTrain || input.booking.trains.length);
  const paxDone =
    nlu.passengerCount != null ||
    input.booking.paxProvided ||
    midJourney ||
    lastAsked === "train" ||
    lastAsked === "class" ||
    lastAsked === "seat";
  const passengerCount = nlu.passengerCount ?? (paxDone ? input.booking.passengerCount || 1 : undefined);

  const apply: AssistantTurn["apply"] = {};
  if (nlu.from) apply.from = nlu.from;
  else if (nlu.unresolvedFrom && !input.booking.from) {
    apply.from = { code: nlu.unresolvedFrom, name: nlu.unresolvedFrom, city: nlu.unresolvedFrom };
  }
  if (nlu.to) apply.to = nlu.to;
  else if (nlu.unresolvedTo && !input.booking.to) {
    apply.to = { code: nlu.unresolvedTo, name: nlu.unresolvedTo, city: nlu.unresolvedTo };
  }
  const followEarly = classifyFollowUp(input.text);
  const isStatusQuery =
    nlu.intent === "LIVE_TRAIN_STATUS" || nlu.intent === "TRAIN_HISTORY" || followEarly === "live";
  const isAvailQuery = followEarly === "availability";
  const statusDate = isStatusQuery ? parseStatusDate(input.text, now) : undefined;
  if (statusDate) nlu.date = statusDate;
  if (spokenDate && !isStatusQuery && !isAvailQuery) apply.date = spokenDate;
  if (nlu.passengerCount) apply.passengerCount = nlu.passengerCount;

  const agentCtx = mergeAgentContext(emptyAgentContext(), nlu, input.text, {
    selectedTrainNumber: input.booking.selectedTrain?.number ?? null,
    selectedTrainName: input.booking.selectedTrain?.name ?? null,
    lastTrainNumbers: input.booking.trains.map((t) => t.number),
    bookingStage: input.booking.previewFare
      ? "review"
      : input.booking.trains.length
        ? "results"
        : input.booking.from || input.booking.to
          ? "collecting"
          : "idle",
  });
  if (input.booking.from) agentCtx.origin = input.booking.from;
  if (input.booking.to) agentCtx.destination = input.booking.to;
  if (input.booking.dateProvided && input.booking.date) {
    agentCtx.date = input.booking.date;
    agentCtx.dateProvided = true;
  }
  if (input.booking.paxProvided) {
    agentCtx.passengers = input.booking.passengerCount;
    agentCtx.paxProvided = true;
  }
  if (input.booking.selectedClass) agentCtx.classCode = input.booking.selectedClass.code;
  const follow = classifyFollowUp(input.text);
  const refTrain = resolveTrainNumber(input.text, agentCtx);
  if (refTrain && !nlu.trainNumber) nlu.trainNumber = refTrain;

  const glossary = glossaryReply(input.text);
  if (glossary) {
    return withResume({ text: glossary, prefs, apply: {}, ask: lastAsked }, agentCtx);
  }
  if (isCapabilityAsk(input.text) && follow !== "live" && follow !== "availability" && follow !== "fare") {
    const num = spokenTrainNumbers(input.text)[0] || nlu.trainNumber;
    if (num) {
      return withResume(
        {
          text: `${capabilityReply(input.text)}\n\nTrain ${num} ka timetable provider se nikal raha hoon — jo field nahi hai use gadhunga nahi.`,
          prefs,
          apply: {},
          trainSchedule: num,
          ask: lastAsked,
        },
        agentCtx,
      );
    }
    return withResume({ text: capabilityReply(input.text), prefs, apply: {}, ask: lastAsked }, agentCtx);
  }
  if (isGoesToAsk(input.text)) {
    return goesToFactTurn(input, nlu, prefs, agentCtx);
  }

  if (follow === "guide" || nlu.intent === "HELP" || nlu.intent === "SUPPORT") {
    return guideTurn(input, prefs, apply, agentCtx);
  }

  if (nlu.intent === "LIVE_TRAIN_STATUS" || nlu.intent === "TRAIN_HISTORY" || follow === "live") {
    const num = nlu.trainNumber || refTrain || agentCtx.selectedTrainNumber;
    const today = todayYmdFrom(now);
    const when = statusDate ?? (nlu.intent === "TRAIN_HISTORY" ? addDays(today, -1) : undefined);
    if (!num) {
      return { text: "Train number kya hai? 5-digit number likho — jaise 12054.", prefs, apply: {}, ask: "trainNumber" };
    }
    if (when && when < today) {
      return withResume(
        {
          text: `Train ${num} ka ${formatShortDate(when)} (${when}) ka completed run nikal raha hoon — ye aaj ki live nahi hai. Jo provider de wahi dikhaunga.`,
          prefs,
          trainHistory: num,
          historyDate: when,
          ask: null,
        },
        agentCtx,
      );
    }
    return withResume(
      {
        text: `Train ${num} ka live status nikal raha hoon — khud se location nahi gadhunga.`,
        prefs,
        liveTrain: num,
        liveDate: when,
        ask: null,
      },
      agentCtx,
    );
  }

  const stationChoice = stationChoiceTurn(input, prefs, apply, lastAsked);
  if (stationChoice) return stationChoice;

  const clusterAsk = clusterCityAskTurn(nlu, prefs, apply, {
    from: input.booking.from,
    to: input.booking.to,
  });
  if (clusterAsk) return clusterAsk;

  if (isSearchNudge(input.text)) {
    const missing = nextMissing({
      from,
      to,
      date: date ?? null,
      passengerCount: passengerCount ?? null,
    });
    if (from && to && date) {
      return {
        text: `Bilkul 👍 ${city(from)} → ${city(to)}, ${formatShortDate(date)}. Trains check karta hoon.`,
        prefs,
        apply: { ...apply, date },
        search: true,
        ask: "train",
      };
    }
    if (missing && !midJourney) {
      return {
        text: askCopy(missing, Boolean(to)),
        prefs,
        apply,
        ask: missing,
        blocks: missing === "date" ? [{ type: "dates", options: dateChips(now) }] : undefined,
      };
    }
  }

  const switched = switchIntent(nlu, prefs, apply, input.text, agentCtx);
  if (switched) return switched;

  if (nlu.returnDate) {
    return {
      text: "Round-trip booking provider abhi support nahi karta. Pehle onward journey book karte hain.",
      prefs,
      apply,
      ask: nextMissing({ from, to, date: date ?? null }),
    };
  }

  if (nlu.dateAmbiguous?.length && !nlu.date) {
    return {
      text: "Kaunsi date — yeh wala ya agla?",
      blocks: [{ type: "dates", options: nlu.dateAmbiguous }],
      prefs,
      apply,
      ask: "date",
    };
  }

  if (
    !isAvailQuery &&
    (nlu.intent === "CHANGE_DATE" ||
      (nlu.date && input.booking.date && nlu.date !== input.booking.date && (input.booking.trains.length || input.booking.selectedTrain)))
  ) {
    if (from && to && (nlu.date || apply.date)) {
      date = apply.date ?? nlu.date ?? date;
      return {
        text: `Theek hai, date change kar di.\n22 August ke liye availability update ho gayi hai.`.replace(
          "22 August ke liye availability update ho gayi hai.",
          `${formatShortDate(date!)} ke liye availability update ho gayi hai.`,
        ),
        prefs,
        apply: { ...apply, date },
        search: true,
        clearForDate: true,
      };
    }
  }

  if (nlu.intent === "nearby_earlier" as never) {
    /* handled below via text */
  }

  if (/\b(1 day earlier|ek din pehle)\b/i.test(input.text) && input.booking.date) {
    apply.date = addDays(input.booking.date, -1);
    return { text: "Theek hai, ek din pehle check karta hoon.", prefs, apply, search: Boolean(from && to), clearForDate: true };
  }
  if (/\b(1 day later|ek din baad)\b/i.test(input.text) && input.booking.date) {
    apply.date = addDays(input.booking.date, 1);
    return { text: "Theek hai, agle din ke options dekh raha hoon.", prefs, apply, search: Boolean(from && to), clearForDate: true };
  }

  if (follow === "timetable") {
    const num = nlu.trainNumber || refTrain || input.booking.selectedTrain?.number;
    if (num) {
      return withResume(
        {
          text: `Train ${num} ka timetable provider se nikal raha hoon.`,
          prefs,
          apply,
          trainSchedule: num,
          ask: lastAsked,
        },
        agentCtx,
      );
    }
    return { text: "Kaunsi train ka time chahiye? 5-digit number boliye.", prefs, apply, ask: "trainNumber" };
  }
  if (follow === "fare" || nlu.intent === "CHECK_FARE") {
    if (input.booking.selectedTrain && input.booking.selectedClass && input.booking.from && input.booking.to && input.booking.date) {
      return {
        text: `${input.booking.selectedTrain.number} ${input.booking.selectedClass.code} ka fare provider se check karta hoon — gadh ke nahi.`,
        prefs,
        apply,
        lookupFare: true,
        ask: lastAsked,
      };
    }
    const fareNum = nlu.trainNumber || refTrain || input.booking.selectedTrain?.number;
    if (fareNum) {
      const when = spokenDate || parseDatePhrase(input.text, now).date || input.booking.date || todayYmdFrom(now);
      return withResume(
        {
          text: `Train ${fareNum} ka fare/seats provider se nikal raha hoon — approx figure nahi gadhunga.`,
          prefs,
          apply: {},
          probeSeats: fareNum,
          probeSeatsDate: when,
          ask: lastAsked,
        },
        agentCtx,
      );
    }
    return {
      text: "Fare ke liye train number chahiye — jaise 12014. Class + origin/date ho to live fare nikaalta hoon. Approx nahi gadhunga.",
      prefs,
      apply,
      ask: "trainNumber",
    };
  }
  if (follow === "availability" || nlu.intent === "CHECK_AVAILABILITY") {
    const num = nlu.trainNumber || refTrain || input.booking.selectedTrain?.number;
    if (
      input.booking.selectedTrain &&
      input.booking.selectedClass &&
      input.booking.from &&
      input.booking.to &&
      input.booking.date &&
      (!num || num === input.booking.selectedTrain.number)
    ) {
      return {
        text: `${input.booking.selectedTrain.number} ${input.booking.selectedClass.code} ki availability provider se check karta hoon.`,
        prefs,
        apply,
        lookupAvailability: true,
        ask: lastAsked,
      };
    }
    if (input.booking.selectedTrain && (!num || num === input.booking.selectedTrain.number)) {
      return classMenu(input.booking.selectedTrain, prefs, apply, "");
    }
    if (num) {
      const when =
        spokenDate || parseDatePhrase(input.text, now).date || input.booking.date || todayYmdFrom(now);
      return withResume(
        {
          text: `Train ${num} ki ${formatShortDate(when)} ki seats provider se check karta hoon — gadh ke nahi. Train list nahi kholunga.`,
          prefs,
          apply: {},
          probeSeats: num,
          probeSeatsDate: when,
          ask: lastAsked,
        },
        agentCtx,
      );
    }
    return { text: "Kaunsi train ki seats? 5-digit number boliye.", prefs, apply, ask: "trainNumber" };
  }
  if ((follow === "more_trains" || nlu.intent === "COMPARE_TRAINS" || nlu.intent === "SELECT_BEST") && input.booking.trains.length) {
    const nums = spokenTrainNumbers(input.text);
    if (nums.length >= 2) {
      const a = input.booking.trains.find((t) => t.number === nums[0]);
      const b = input.booking.trains.find((t) => t.number === nums[1]);
      if (a && b) {
        return {
          text: `${a.number} ${a.name}: ${a.departure}→${a.arrival} · ${a.durationLabel}\n${b.number} ${b.name}: ${b.departure}→${b.arrival} · ${b.durationLabel}\nSirf isi list ka data — jo field nahi hai use invent nahi karunga. Kaunsi choose karein?`,
          prefs,
          apply,
          ask: "train",
        };
      }
      return namedTrainCompareTurn(input.text, prefs, apply);
    }
    if (nlu.intent === "COMPARE_TRAINS" || follow === "more_trains") {
      const pool = filterTrains(input.booking.trains, prefs);
      return { text: "Yeh aur trains hain (provider list se):", blocks: [{ type: "more", trains: pool }], prefs, ask: "train" };
    }
  }
  if ((follow === "train_pick" || nlu.intent === "SELECT_TRAIN") && input.booking.trains.length) {
    const hit = refTrain ? input.booking.trains.find((t) => t.number === refTrain) : undefined;
    if (hit) return afterTrainPick(hit, input.booking.selectedTrain, prefs, apply, "Selected");
    if (nlu.intent === "SELECT_TRAIN") {
      return { text: "Kaunsi train — list mein number ya pehli/doosri boliye. Main guess nahi karunga.", prefs, apply, ask: "train" };
    }
  }
  if (nlu.intent === "SELECT_TRAIN" && !input.booking.trains.length) {
    const pickNum = nlu.trainNumber || spokenTrainNumbers(input.text)[0];
    if (pickNum) {
      return {
        text: `Train ${pickNum} ka timetable provider se nikal raha hoon. Ticket ke liye origin/date bolo.`,
        prefs,
        apply: {},
        trainSchedule: pickNum,
        ask: null,
      };
    }
    return { text: "Pehle trains search karni hongi. Kahan se kahan jaana hai?", prefs, apply, ask: "from" };
  }
  if (
    (nlu.intent === "COMPARE_TRAINS" || (nlu.intent === "SELECT_BEST" && spokenTrainNumbers(input.text).length >= 2)) &&
    !input.booking.trains.length
  ) {
    const nums = spokenTrainNumbers(input.text);
    if (nums.length >= 2) {
      return namedTrainCompareTurn(input.text, prefs, apply);
    }
    return {
      text: "Compare ke liye do train numbers chahiye — jaise 12014 ya 12498. Main trains invent nahi karunga.",
      prefs,
      apply,
      ask: "train",
    };
  }
  if (
    (nlu.intent === "SELECT_BEST" || nlu.intent === "SELECT_FASTEST" || nlu.intent === "SELECT_CHEAPEST") &&
    !input.booking.trains.length
  ) {
    const recNums = spokenTrainNumbers(input.text);
    if (recNums.length >= 2) return namedTrainCompareTurn(input.text, prefs, apply);
    const destName = nlu.to?.city || nlu.unresolvedTo;
    return {
      text: destName
        ? `${destName} ke liye best/fast train list nikaalne ke liye origin chahiye — kahan se jaana hai? Date bolo to search shuru karunga.`
        : "Best / fastest / cheapest ke liye kahan se kahan jaana hai? Main list invent nahi karunga.",
      prefs,
      apply,
      ask: "from",
    };
  }

  if (nlu.intent === "BOOK_TRAIN") {
    const booked = tryBook(input, prefs);
    if (booked) return booked;
  }

  if (input.booking.selectedTrain && (nlu.classCodes?.length || nlu.acOnly || /available/i.test(input.text) || (nlu.intent === "CONFIRM_YES" && input.lastAsked === "class"))) {
    return resolveClass(input, nlu, prefs, apply);
  }

  if (nlu.berth && input.booking.selectedClass) {
    return {
      text: "Passenger details fill kar dijiye.",
      blocks: input.saved.length ? [{ type: "saved", list: input.saved }, { type: "passengers" }] : [{ type: "passengers" }],
      prefs,
      apply,
      selectSeat: nlu.berth,
      goPassengers: true,
      ask: null,
    };
  }

  const missing = nextMissing({
    from,
    to,
    date: date ?? null,
    passengerCount: passengerCount ?? null,
  });

  if (missing && !midJourney) {
    return {
      text: askCopy(missing, Boolean(to)),
      prefs,
      apply,
      ask: missing,
      blocks: missing === "date" ? [{ type: "dates", options: dateChips(now) }] : undefined,
    };
  }

  if (from && to && date) {
    const shouldSearch =
      !input.booking.trains.length ||
      input.booking.date !== date ||
      input.booking.from?.code !== from.code ||
      input.booking.to?.code !== to.code ||
      Boolean(nlu.date && nlu.correction);
    const picking = nlu.intent === "SELECT_FASTEST" || nlu.intent === "SELECT_CHEAPEST" || nlu.intent === "SELECT_BEST";
    if (shouldSearch && !picking && nlu.intent !== "CONFIRM_YES") {
      return {
        text: `Bilkul 👍 ${city(from)} → ${city(to)}, ${formatShortDate(date)}${(passengerCount ?? 1) > 1 ? `, ${passengerCount} passengers` : ""}. Trains check karta hoon.`,
        prefs,
        apply: { ...apply, date },
        search: true,
        ask: "train",
      };
    }
  }

  return planFromResults(input, nlu, prefs, apply, from, to, date ?? input.booking.date, passengerCount ?? 1);
}

function goesToFactTurn(
  input: TurnInput,
  nlu: NluResult,
  prefs: Prefs,
  ctx: ReturnType<typeof mergeAgentContext>,
): AssistantTurn {
  const num =
    spokenTrainNumbers(input.text)[0] ||
    nlu.trainNumber ||
    input.lastFactTrain ||
    ctx.selectedTrainNumber ||
    undefined;
  const destCluster = clusterStationsForText(input.text);
  const destCity =
    destCluster?.city ||
    nlu.unresolvedTo ||
    nlu.to?.city ||
    nlu.to?.name ||
    undefined;
  const destCodes = destCluster?.stations.map((s) => s.code) ?? (nlu.to ? [nlu.to.code] : []);
  if (!num) {
    return {
      text: destCity
        ? `${destCity} jaati hai ya nahi — kaunsi train? 5-digit number boliye.`
        : "Kaunsi train kaunse shehar jaati hai? Number aur shehar boliye — jaise 12054 Delhi.",
      prefs,
      apply: {},
      ask: "trainNumber",
    };
  }
  if (!destCity && !destCodes.length) {
    return withResume(
      {
        text: `Train ${num} kahan jaati hai — shehar bolo jaise Delhi. Main timetable se halt check karunga.`,
        prefs,
        apply: {},
        trainSchedule: num,
        ask: null,
      },
      ctx,
    );
  }
  return withResume(
    {
      text: `Train ${num} ${destCity || destCodes.join("/")} jaati hai ya nahi — timetable se check karta hoon, guess nahi.`,
      prefs,
      apply: {},
      trainSchedule: num,
      compareDestCodes: destCodes.length ? destCodes : undefined,
      goesToCity: destCity,
      ask: null,
    },
    ctx,
  );
}

function namedTrainCompareTurn(
  text: string,
  prefs: Prefs,
  apply: AssistantTurn["apply"],
): AssistantTurn {
  const nums = spokenTrainNumbers(text).slice(0, 2);
  const destCluster = destCue(text) ? clusterStationsForText(text) : null;
  return {
    text: `${nums.join(" aur ")} ka timetable provider se nikal raha hoon — fare/seats gadh ke nahi bataunga.`,
    prefs,
    apply: {},
    compareTrains: nums,
    compareDestCodes: destCluster?.stations.map((s) => s.code),
    ask: null,
  };
}

function stationInCluster(st: Station | null | undefined, raw: string): boolean {
  if (!st) return false;
  const group = clusterStations(raw);
  if (!group.length) return false;
  return group.some((s) => s.code === st.code) || group.some((s) => s.city.toLowerCase() === (st.city || "").toLowerCase());
}

function clusterCityAskTurn(
  nlu: NluResult,
  prefs: Prefs,
  apply: AssistantTurn["apply"],
  known: { from?: Station | null; to?: Station | null },
): AssistantTurn | null {
  if (
    nlu.intent === "COMPARE_TRAINS" ||
    nlu.intent === "TRAIN_SCHEDULE" ||
    nlu.intent === "CHECK_FARE" ||
    nlu.intent === "CHECK_AVAILABILITY" ||
    nlu.intent === "LIVE_TRAIN_STATUS" ||
    nlu.intent === "TRAIN_HISTORY" ||
    nlu.intent === "SELECT_BEST" ||
    nlu.intent === "SELECT_FASTEST" ||
    nlu.intent === "SELECT_CHEAPEST"
  ) {
    return null;
  }
  const ask = (raw: string | undefined, slot: "from" | "to"): AssistantTurn | null => {
    if (!raw) return null;
    const stations = clusterStations(raw);
    if (stations.length < 2) return null;
    const already = slot === "from" ? known.from : known.to;
    if (stationInCluster(already, raw)) return null;
    return {
      text: `${stations[0].city} mein kai stations hain — ${stations.map((s) => `${s.name} (${s.code})`).join(" / ")}. Chip se choose karo. Main default lock nahi karunga.`,
      blocks: [{ type: "stations", options: stations, slot }],
      prefs,
      apply,
      ask: slot,
    };
  };
  return ask(nlu.unresolvedFrom, "from") ?? ask(nlu.unresolvedTo, "to");
}

function stationChoiceTurn(
  input: TurnInput,
  prefs: Prefs,
  apply: AssistantTurn["apply"],
  lastAsked: DialogSlot,
): AssistantTurn | null {
  if (!isStationChoiceQuestion(input.text) && input.extraction?.intent !== "LIST_CITIES") return null;
  const cluster = clusterStationsForText(input.text);
  if (!cluster) {
    if (!isStationChoiceQuestion(input.text)) return null;
    return null;
  }
  if (input.extraction?.intent === "LIST_CITIES" && !isStationChoiceQuestion(input.text)) return null;
  const slot: "from" | "to" =
    lastAsked === "to" || input.booking.to?.city === cluster.city
      ? "to"
      : lastAsked === "from" || input.booking.from?.city === cluster.city
        ? "from"
        : "from";
  return {
    text: `${cluster.city} mein ek hi station nahi hai — ${cluster.stations.map((s) => `${s.name} (${s.code})`).join(" aur ")}.\nPehle “${cluster.city}” default station pe lock ho jata tha. Ab chip se choose karo. Main station invent nahi karunga.`,
    blocks: [{ type: "stations", options: cluster.stations, slot }],
    prefs,
    apply,
    ask: slot,
  };
}

function bookableCityExamples(): string {
  return "Ludhiana, Patiala, Delhi, Amritsar, Chandigarh, Mumbai";
}

function allBookableCities(): string {
  return [...new Set(CLIENT_STATIONS.map((s) => s.city))].sort((a, b) => a.localeCompare(b)).join(", ");
}

function guideTurn(
  input: TurnInput,
  prefs: Prefs,
  apply: AssistantTurn["apply"],
  ctx: ReturnType<typeof mergeAgentContext>,
): AssistantTurn {
  const b = input.booking;
  const now = input.now ?? new Date();
  if (b.flow === "FARE_REVIEW" && b.previewFare) {
    return {
      text: "Aap fare review pe ho. Ticket tabhi book hogi jab aap Yes, Book It / Confirm & Book dabao — chat se wallet charge nahi hota.\nFare, seats ya live poochna ho to bolo.",
      prefs,
      apply,
      blocks: [{ type: "fare" }],
      ask: null,
    };
  }
  if (b.selectedClass && b.passengers.some((p) => !p.name || !p.age || !p.gender || !p.berthPreference)) {
    return {
      text: "Ab passenger details — naam, umar, gender, berth. Ek field ek baar. Phir Continue, uske baad Confirm & Book.",
      prefs,
      apply,
      blocks: input.saved.length ? [{ type: "saved", list: input.saved }, { type: "passengers" }] : [{ type: "passengers" }],
      goPassengers: true,
      ask: null,
    };
  }
  if (b.selectedTrain && !b.selectedClass) {
    return classMenu(b.selectedTrain, prefs, apply, "Class choose karo (SL, 3A, CC). Jo na samajh aaye pooch lo.\n\n");
  }
  if (b.trains.length) {
    return {
      text: "Trains aa chuki hain. Number boliye jaise “12014 wali”, ya fastest/cheapest. Live status, fare, seats bhi pooch sakte ho.",
      prefs,
      apply,
      ask: "train",
    };
  }
  const missing = nextMissing({
    from: apply?.from ?? b.from,
    to: apply?.to ?? b.to,
    date: apply?.date ?? (b.dateProvided ? b.date : null),
    passengerCount: apply?.passengerCount ?? (b.paxProvided ? b.passengerCount : null),
  });
  if (missing === "date") {
    return {
      text: "Booking ke liye travel date chahiye — kal, parso, ya 24 August. Aaj tabhi jab aap aaj bolo.\nBilkul. Kab jaana hai?",
      prefs,
      apply,
      ask: "date",
      blocks: [{ type: "dates", options: dateChips(now) }],
    };
  }
  if (missing === "passengers") {
    return {
      text: "Kitne logon ke naam pe ticket? 1 se 6 tak number boliye.\nKitni tickets chahiye?",
      prefs,
      apply,
      ask: "passengers",
    };
  }
  if (missing === "to") {
    return { text: "Destination batao — kahan jaana hai?", prefs, apply, ask: "to" };
  }
  if (missing === "from") {
    return {
      text: "Main railway booking assist karti hoon — trains, seats, fare, live, PNR, cancelled, aapki tickets. Origin, date, passengers ek-ek karke poochungi. Final ticket sirf Confirm & Book se.\nKahan se jana hai?",
      prefs,
      apply,
      ask: "from",
    };
  }
  const resume = resumeBookingLine(ctx);
  return {
    text: resume?.text ?? "Boliye kahan se kahan jaana hai — jaise “Delhi se Amritsar kal 2 ticket”. Wallet, bookings aur PNR bhi poochh sakte ho.",
    prefs,
    apply,
    ask: resume?.ask ?? "from",
  };
}

function withResume(turn: AssistantTurn, ctx: ReturnType<typeof mergeAgentContext>): AssistantTurn {
  if (!bookingInProgress(ctx)) return turn;
  const resume = resumeBookingLine(ctx);
  if (!resume) return turn;
  return { ...turn, resumeAsk: resume.ask, resumeText: resume.text };
}

function switchIntent(
  nlu: NluResult,
  prefs: Prefs,
  apply: AssistantTurn["apply"],
  text = "",
  ctx?: ReturnType<typeof mergeAgentContext>,
): AssistantTurn | null {
  if (nlu.intent === "OUT_OF_DOMAIN") {
    return { text: RAIL_ONLY_REPLY, prefs, ask: "from" };
  }
  const wrap = (turn: AssistantTurn) => (ctx ? withResume(turn, ctx) : turn);
  if (nlu.intent === "VIEW_WALLET" || nlu.intent === "ADD_MONEY") {
    return wrap({
      text: nlu.intent === "ADD_MONEY" ? "Wallet khol raha hoon — paise add kar sakte ho." : "Wallet check karte hain.",
      prefs,
      apply,
      openWallet: true,
      blocks: [{ type: "wallet" }],
      ask: null,
    });
  }
  if (nlu.intent === "VIEW_BOOKINGS" || nlu.intent === "VIEW_TICKET" || nlu.intent === "DOWNLOAD_TICKET" || nlu.intent === "CANCEL_BOOKING") {
    return wrap({ text: "Theek hai, aapki bookings khol raha hoon.", prefs, apply, openBookings: true, ask: null });
  }
  if (nlu.intent === "CANCELLED_TRAINS") {
    return wrap({
      text: "Cancelled trains RailKit se nikal raha hoon — list invent nahi karunga.",
      prefs,
      apply,
      cancelled: true,
      ask: null,
    });
  }
  if (nlu.intent === "LIVE_AT_STATION") {
    const code = nlu.from?.code;
    if (!code) {
      return { text: "Kaunsa station? Code ya naam boliye — jaise LDH ya Ludhiana.", prefs, apply, ask: null };
    }
    return wrap({
      text: `${code} ka station board nikal raha hoon.`,
      prefs,
      apply,
      liveStation: code,
      ask: null,
    });
  }
  if (nlu.intent === "TRAIN_HISTORY") {
    if (nlu.trainNumber) {
      return wrap({
        text: `Train ${nlu.trainNumber} ki completed history nikal raha hoon.`,
        prefs,
        apply,
        trainHistory: nlu.trainNumber,
        ask: null,
      });
    }
    return { text: "Kaunsi train ki history? 5-digit number boliye.", prefs, apply, ask: null };
  }
  if (nlu.intent === "LIVE_TRAIN_STATUS") {
    const num = nlu.trainNumber || ctx?.selectedTrainNumber;
    if (num) {
      return wrap({
        text: `Train ${num} ka live status nikal raha hoon — khud se location nahi gadhunga.`,
        prefs,
        apply,
        liveTrain: num,
        ask: null,
      });
    }
    return { text: "Train number kya hai? 5-digit number likho — jaise 12054.", prefs, apply, ask: "trainNumber" };
  }
  if (nlu.intent === "TRAIN_SCHEDULE") {
    if (nlu.trainNumber) {
      return {
        text: `Train ${nlu.trainNumber} ka timetable nikal raha hoon.`,
        prefs,
        apply,
        trainSchedule: nlu.trainNumber,
        ask: null,
      };
    }
    return { text: "Kaunsi train ka timetable chahiye? Number boliye.", prefs, apply, ask: "trainNumber" };
  }
  if (nlu.intent === "CHECK_PNR") {
    if (nlu.pnr) {
      return {
        text: `PNR ${nlu.pnr} check kar raha hoon.`,
        prefs,
        apply,
        retrievePnr: nlu.pnr,
        openBookings: true,
        ask: null,
      };
    }
    return { text: "PNR number kya hai?", prefs, apply, ask: "pnr" };
  }
  if (nlu.intent === "TRAVELLERS") {
    return { text: "Saved travellers khol raha hoon.", prefs, apply, ask: null };
  }
  if (nlu.intent === "LIST_CITIES") {
    const wantAll = /poori|saari|saare|full list|all cities|पूरी|सारी|saari list/i.test(text);
    if (wantAll) {
      return {
        text: `Koi bhi shehar bol sakte ho. Stations RailCore se resolve hote hain (RailKit fallback). Live IRCTC booking nahi — main train invent nahi karta.\n\nLocal examples: ${allBookableCities()}.\n\nJahan city mein kai stations hon (Delhi, Mumbai, Ambala) wahan chips se choose karo.\nKahan se kahan jaana hai?`,
        prefs,
        apply,
        ask: "from",
      };
    }
    return {
      text: `Koi bhi shehar ka naam bol sakte ho — AI naam samajh leti hai.\n\nTicket search live IRCTC nahi hai. Trains RailCore se aati hain (RailKit fallback) — jaise ${bookableCityExamples()}.\nJo station resolve nahi hota, uske liye main train gadh ke nahi bataunga.\n\nDelhi / Mumbai / Ambala jaise cities mein kai stations hote hain — chips se choose karo.\nPoori list chahiye to “poori city list” bolo. Warna kahan se kahan jaana hai?`,
      prefs,
      apply,
      ask: "from",
    };
  }
  if (nlu.intent === "ABOUT_ASSISTANT") {
    return {
      text: "Haan — railway booking ke sawaal ka jawab deta hoon.\n\nMain RailBook assistant hoon. Journey samajhta hoon (kahan se, kahan, date, kitne log). Trains, seats, fare, live status aur PNR provider se aate hain — gadh ke nahi.\n\nCode, mausam, jokes nahi. Official IRCTC rulebook bhi nahi.\n\nBoliye kahan se kahan jaana hai.",
      prefs,
      apply,
      ask: "from",
    };
  }
  if (nlu.intent === "RAIL_POLICY") {
    return {
      text: "IRCTC ke official rules main gadh-kar nahi bataata. Main railway booking assistant hoon — origin, destination, date, passengers samajhta hoon; trains, seats, fare aur PNR provider se aate hain.\n\nKahan se kahan jaana hai?",
      prefs,
      apply,
      ask: "from",
    };
  }
  if (nlu.intent === "REFUND_STATUS") {
    return wrap({
      text: "Refund official IRCTC rule se main gadh ke nahi bataunga. Jo ticket yahan book hui ho uske liye bookings khol sakta hoon.",
      prefs,
      apply,
      openBookings: true,
      ask: null,
    });
  }
  if (nlu.intent === "CHANGE_BOARDING_STATION") {
    return {
      text: "Boarding station change provider data ke bina claim nahi kar sakta. Origin update karna ho to naya station batao.",
      prefs,
      apply,
      ask: "from",
    };
  }
  if (nlu.intent === "PROFILE") {
    return { text: "Profile alag login ke bina demo user pe hai. Booking continue kar sakte ho.", prefs, apply };
  }
  return null;
}

function tryBook(input: TurnInput, prefs: Prefs): AssistantTurn | null {
  if (input.booking.flow === "FARE_REVIEW" && input.booking.previewFare) {
    const need = input.booking.previewFare.total;
    if (input.walletBalance != null && input.walletBalance < need) {
      return {
        text: `Wallet mein ₹${input.walletBalance.toLocaleString("en-IN")} hain. ₹${(need - input.walletBalance).toLocaleString("en-IN")} aur chahiye.`,
        blocks: [{ type: "wallet" }],
        prefs,
        openWallet: true,
      };
    }
    return {
      text: "Fare review ready hai. Ticket book karne ke liye Confirm & Book / Yes, Book It dabao — chat se wallet charge ya PNR nahi banega.",
      prefs,
      blocks: [{ type: "fare" }],
    };
  }
  if (!input.booking.selectedTrain || !input.booking.selectedClass) return null;
  if (input.booking.passengers.some((p) => !p.name || !p.age || !p.gender || !p.berthPreference)) {
    return {
      text: "Passenger details fill kar dijiye.",
      blocks: input.saved.length ? [{ type: "saved", list: input.saved }, { type: "passengers" }] : [{ type: "passengers" }],
      prefs,
      goPassengers: true,
    };
  }
  return {
    text: "Sab details ready hain. Fare check karke confirm maangta hoon — bina confirm ke book nahi hogi.",
    prefs,
    goReview: true,
  };
}

function resolveClass(
  input: TurnInput,
  nlu: NluResult,
  prefs: Prefs,
  apply: AssistantTurn["apply"],
): AssistantTurn {
  const train = input.booking.selectedTrain!;
  const wanted = nlu.classCodes?.[0] ?? (nlu.intent === "CONFIRM_YES" ? bestClass(train, prefs)?.code : undefined);
  if (!wanted) {
    return classMenu(train, prefs, apply, "");
  }
  const row = train.classes.find((c) => c.code === wanted);
  if (!row || !isBookable(row.status)) {
    const alt = train.classes.find((c) => isBookable(c.status) && c.status === "AVAILABLE")
      ?? train.classes.find((c) => isBookable(c.status));
    const seats = alt?.seats != null ? `${alt.seats} seats` : "seats";
    return {
      text: `${wanted} mein seat available nahi hai.${alt ? `\n${alt.code} mein ${seats} available hain. Kya ${alt.code} try karein?` : ""}`,
      blocks: [{ type: "classes", train, classes: train.classes }],
      prefs,
      apply,
      ask: "class",
    };
  }
  return {
    text: `${row.code} selected. Ab passenger details fill kar dijiye.`,
    blocks: input.saved.length ? [{ type: "saved", list: input.saved }, { type: "passengers" }] : [{ type: "passengers" }],
    prefs,
    apply,
    selectClass: row,
    selectSeat: nlu.berth ?? "No Preference",
    goPassengers: true,
    ask: null,
  };
}

function classMenu(train: TrainResult, prefs: Prefs, apply: AssistantTurn["apply"], lead: string): AssistantTurn {
  if (!train.classes.length) {
    return {
      text: `${lead}${train.number} ${train.name} — class/seat selection\n\nIs train ki seat/fare list search mein nahi aati. Class choose karo — availability provider se check hogi, gadh ke nahi.`,
      blocks: [{ type: "classes", train, classes: [] }],
      prefs,
      apply,
      ask: "class",
    };
  }
  const lines = train.classes.map((c) => {
    const ok = isBookable(c.status);
    const mark = c.status === "AVAILABLE" ? "🟢" : ok ? "🟡" : "🔴";
    const label = c.status === "AVAILABLE" ? "Available" : c.status === "NOT_AVAILABLE" ? "Not Available" : c.status;
    return `${mark} ${c.code} — ${label}`;
  });
  return {
    text: `${lead}${train.number} ${train.name} — class/seat selection\n\nIs train mein available classes:\n\n${lines.join("\n")}\n\nAap kaunsi class mein book karna chahenge?`,
    blocks: [{ type: "classes", train, classes: train.classes }],
    prefs,
    apply,
    ask: "class",
  };
}

function dateChips(now: Date): { date: string; label: string }[] {
  const t = todayYmdFrom(now);
  return [
    { date: t, label: "Aaj" },
    { date: addDays(t, 1), label: "Kal" },
    { date: addDays(t, 2), label: "Parso" },
  ];
}

function emptyTurn(date: string, prefs: Prefs, apply: AssistantTurn["apply"]): AssistantTurn {
  return {
    text: `😕 Is date par confirmed seat nahi mili.\nMain nearby dates check karun?`,
    blocks: [{
      type: "chips",
      options: [
        { id: "earlier", label: "1 day earlier", utterance: "1 day earlier" },
        { id: "later", label: "1 day later", utterance: "1 day later" },
        { id: "alt", label: "Find another train", utterance: "Find another train" },
      ],
    }],
    prefs,
    apply,
  };
}

function planFromResults(
  input: TurnInput,
  nlu: NluResult,
  prefs: Prefs,
  apply: AssistantTurn["apply"],
  from: Station | undefined,
  to: Station | undefined,
  date: string,
  passengerCount: number,
): AssistantTurn {
  const booking = input.booking;
  if (nlu.intent === "FIND_ALTERNATE" || /\b(aur options|more options|show options)\b/i.test(input.text)) {
    const pool = filterTrains(booking.trains, prefs);
    if (!pool.length) return emptyTurn(booking.date, prefs, apply);
    return { text: "Yeh alternate options hain:", blocks: [{ type: "more", trains: pool }], prefs, ask: "train" };
  }

  const filtered = filterTrains(booking.trains, prefs);
  if (!booking.trains.length) return emptyTurn(booking.date, prefs, apply);
  if (!filtered.length) return emptyTurn(booking.date, prefs, apply);

  if (nlu.intent === "SELECT_FASTEST" || /fastest wali/.test(input.text.toLowerCase())) {
    const t = pickFastest(filtered)!;
    return afterTrainPick(t, booking.selectedTrain, prefs, apply, "⚡ Fastest");
  }
  if (nlu.intent === "SELECT_CHEAPEST") {
    const t = pickCheapest(filtered, prefs)!;
    return afterTrainPick(t, booking.selectedTrain, prefs, apply, "💰 Cheapest");
  }
  if (nlu.intent === "SELECT_BEST") {
    const t = pickRecommended(filtered, booking.recommendations, prefs) ?? filtered[0];
    return afterTrainPick(t, booking.selectedTrain, prefs, apply, "⭐ Best");
  }

  if (booking.selectedTrain && !booking.selectedClass) {
    return classMenu(booking.selectedTrain, prefs, apply, "");
  }

  const featured = pickRecommended(filtered, booking.recommendations, prefs) ?? filtered[0];
  const rec = booking.recommendations.find((r) => r.trainNumber === featured.number);
  const alts = filtered.filter((t) => t.number !== featured.number);
  const fastest = pickFastest(filtered);
  const cheap = pickCheapest(filtered, prefs);
  const cheapFares = cheap ? matchingClasses(cheap, prefs).map((c) => c.fare).filter((n) => n > 0) : [];

  return {
    text: `${filtered.length} trains mil gayi hain. Best options:\n\n🚆 Fastest — ${fastest?.durationLabel ?? "—"}\n💰 Cheapest — ${cheapFares.length ? `₹${Math.min(...cheapFares)}` : "class/fare train select ke baad"}\n⭐ Best balance — ${rec?.reason ?? featured.durationLabel}\n\nKaunsa choose karein?`,
    blocks: [
      {
        type: "train",
        train: featured,
        badge: rec ? recLabelSafe(rec) : "⭐ Best for you",
        reason: rec?.reason ?? featured.durationLabel,
        primary: true,
      },
      ...(alts.length ? [{ type: "more" as const, trains: alts }] : []),
    ],
    prefs,
    apply,
    ask: "train",
  };
}

function afterTrainPick(
  t: TrainResult,
  prev: TrainResult | null,
  prefs: Prefs,
  apply: AssistantTurn["apply"],
  badge: string,
): AssistantTurn {
  const changed = Boolean(prev && prev.number !== t.number);
  const notice = changed
    ? "Please reselect your seat/class for this train.\n(Is train ke liye seat/class dobara select karein.)\n\n"
    : "";
  const menu = classMenu(t, prefs, apply, `${notice}${t.number} ${t.name} select ho gayi.\n\n`);
  return { ...menu, selectTrain: t, prefs, apply };
}

function recLabelSafe(r: Recommendation): string {
  if (r.kind === "fastest") return "⚡ Fastest";
  if (r.kind === "cheapest") return "💰 Cheapest";
  if (r.kind === "best-timing") return "🕐 Best timing";
  return "⭐ Best for you";
}

export function resultsTurn(
  booking: BookingSnapshot,
  prefs: Prefs,
  _saved: Passenger[],
): AssistantTurn {
  return planFromResults(
    {
      text: "",
      booking,
      prefs,
      saved: [],
    },
    understand(""),
    prefs,
    {},
    booking.from ?? undefined,
    booking.to ?? undefined,
    booking.date,
    booking.passengerCount,
  );
}
