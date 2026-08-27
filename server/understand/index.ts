import { understand, type DialogSlot, type KnownSlots, type NluResult } from "./legacy-nlu.js";
import { matchStation } from "./legacy-stations.js";
import { parseDatePhrase, todayYmdFrom } from "./legacy-dates.js";
import { extractWithLlm, type AiAttempt } from "./llm.js";
import { enqueueGeminiShadow } from "./shadow.js";
import type { Extraction } from "./schema.js";
import { isOutOfDomain } from "./domain.js";
import { routeRailwayIntent } from "./toolRoute.js";

export interface UnderstandRequest {
  text: string;
  lastAsked?: DialogSlot;
  known?: KnownSlots;
  now?: string;
}

export type UnderstandSource = "ai" | "nlu";

export interface UnderstandResponse {
  nlu: NluResult;
  source: UnderstandSource;
  provider: "nvidia" | null;
  missingFields: string[];
  modelUsed: string | null;
  fallbackAttempt: number;
  latencyMs: number;
  failureReason: string | null;
  attempts: AiAttempt[];
}

const FAST_PATH = new Set<NluResult["intent"]>([
  "CHECK_PNR",
  "VIEW_BOOKINGS",
  "VIEW_WALLET",
  "ADD_MONEY",
  "HELP",
  "SUPPORT",
  "LIVE_TRAIN_STATUS",
  "TRAIN_SCHEDULE",
  "CANCELLED_TRAINS",
  "LIVE_AT_STATION",
  "TRAIN_HISTORY",
  "VIEW_TICKET",
  "CHECK_AVAILABILITY",
  "CHECK_FARE",
  "COMPARE_TRAINS",
  "SELECT_TRAIN",
  "GENERAL_RAILWAY_KNOWLEDGE",
]);

function mapExtraction(ex: Extraction, now: Date, lastAsked: DialogSlot, known: KnownSlots, spoken = ""): NluResult {
  const originRaw = ex.origin?.trim() || null;
  const destRaw = ex.destination?.trim() || null;
  const origin = originRaw ? matchStation(originRaw) : undefined;
  const dest = destRaw ? matchStation(destRaw) : undefined;
  let date = ex.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(ex.dateIso) ? ex.dateIso : undefined;
  if (!date && ex.date) date = parseDatePhrase(ex.date, now, { allowDayOnly: lastAsked === "date" }).date;

  const fromCorr = ex.corrections.find((c) => c.field === "origin");
  const toCorr = ex.corrections.find((c) => c.field === "destination");
  let from = origin ?? (fromCorr ? matchStation(fromCorr.value) : undefined);
  let to = dest ?? (toCorr ? matchStation(toCorr.value) : undefined);
  let unresolvedFrom = !from && (originRaw || fromCorr?.value) ? originRaw || fromCorr!.value : undefined;
  let unresolvedTo = !to && (destRaw || toCorr?.value) ? destRaw || toCorr!.value : undefined;
  const dateCorr = ex.corrections.find((c) => c.field === "date");
  if (dateCorr) {
    date = parseDatePhrase(dateCorr.value, now, { allowDayOnly: true }).date ?? date;
  }
  const paxCorr = ex.corrections.find((c) => c.field === "passengers");
  const passengers = paxCorr ? Number(paxCorr.value) || ex.passengers : ex.passengers;

  const trainPref = ex.preferences?.train;
  let intent = ex.intent as NluResult["intent"];
  if (trainPref === "fastest") intent = "SELECT_FASTEST";
  if (trainPref === "cheapest") intent = "SELECT_CHEAPEST";
  if (trainPref === "best") intent = "SELECT_BEST";

  const classCodes = classFromText(ex.class);
  const timeRaw = ex.preferences?.time;
  const timePref = timeRaw === "night" ? "evening" : timeRaw ?? undefined;

  const low = ex.confidence < 0.45 || ex.clarificationNeeded;
  if (low && !from && !to && !date && !passengers && !unresolvedFrom && !unresolvedTo) {
    return understand(ex.origin || ex.destination || "", { now, lastAsked, known });
  }

  const classHint = ex.class ?? "";
  const routed = routeRailwayIntent(spoken);
  const extractedNo = typeof ex.trainNumber === "string" ? ex.trainNumber.match(/\d{5}/)?.[0] : undefined;
  const trainNumber = extractedNo || spoken.match(/\b(\d{5})\b/)?.[1];
  if (trainNumber && lastAsked === "trainNumber" && intent !== "TRAIN_SCHEDULE") {
    intent = "LIVE_TRAIN_STATUS";
  }
  if (ex.suggestedAction === "getAvailability") intent = "CHECK_AVAILABILITY";
  if (ex.suggestedAction === "getFare") intent = "CHECK_FARE";
  if (ex.suggestedAction === "getLiveStatus") intent = "LIVE_TRAIN_STATUS";
  if (ex.suggestedAction === "getCancelledTrains") intent = "CANCELLED_TRAINS";
  if (ex.suggestedAction === "compareTrains") intent = "COMPARE_TRAINS";
  if (ex.suggestedAction === "selectTrain") intent = "SELECT_TRAIN";
  const toolIntents = new Set([
    "LIVE_TRAIN_STATUS",
    "CANCELLED_TRAINS",
    "CHECK_AVAILABILITY",
    "CHECK_FARE",
    "COMPARE_TRAINS",
    "SELECT_TRAIN",
    "GENERAL_RAILWAY_KNOWLEDGE",
    "VIEW_BOOKINGS",
    "CHECK_PNR",
    "VIEW_WALLET",
    "TRAIN_SCHEDULE",
  ]);
  if (routed.kind && toolIntents.has(routed.kind) && (intent === "SEARCH_TRAIN" || intent === "NONE" || intent === "BOOK_TRAIN")) {
    intent = routed.kind;
  }
  const originOnly = Boolean(from && !to && known.to && /(?:से|\bse\b)/.test(spoken.toLowerCase()));
  const destOnly = Boolean(to && !from && known.from && /(jana|jaana|जाना)/.test(spoken.toLowerCase()) && !/(?:से|\bse\b)/.test(spoken.toLowerCase()));
  return {
    intent,
    from: from ?? (destOnly ? known.from ?? undefined : undefined),
    to: to ?? (originOnly ? known.to ?? undefined : undefined),
    unresolvedFrom,
    unresolvedTo,
    date,
    passengerCount: passengers ?? undefined,
    classCodes,
    acOnly: /ac/i.test(classHint) && !classCodes?.length ? true : undefined,
    timePref,
    berth: ex.preferences?.seat ?? undefined,
    quota: ex.preferences?.quota ?? undefined,
    correction: ex.corrections.length > 0,
    confirmedOnly: undefined,
    trainNumber,
  };
}

function classFromText(raw: string | null): NluResult["classCodes"] {
  if (!raw) return undefined;
  const t = raw.toLowerCase();
  if (/3\s*a|3ac|third/.test(t)) return ["3A"];
  if (/2\s*a|2ac|second ac/.test(t)) return ["2A"];
  if (/1\s*a|first/.test(t)) return ["1A"];
  if (/sleeper|\bsl\b/.test(t)) return ["SL"];
  if (/executive|\bec\b/.test(t)) return ["EC"];
  if (/chair|\bcc\b/.test(t)) return ["CC"];
  if (/2s|sitting/.test(t)) return ["2S"];
  return undefined;
}

function pack(
  nlu: NluResult,
  known: KnownSlots,
  extra: Partial<UnderstandResponse> & Pick<UnderstandResponse, "source">,
): UnderstandResponse {
  return {
    nlu,
    missingFields: missingOf(nlu, known),
    modelUsed: extra.modelUsed ?? null,
    provider: extra.provider ?? null,
    fallbackAttempt: extra.fallbackAttempt ?? 0,
    latencyMs: extra.latencyMs ?? 0,
    failureReason: extra.failureReason ?? null,
    attempts: extra.attempts ?? [],
    source: extra.source,
  };
}

export async function runUnderstand(req: UnderstandRequest): Promise<UnderstandResponse> {
  const now = req.now ? new Date(req.now) : new Date();
  const lastAsked = req.lastAsked ?? null;
  const known = req.known ?? {};

  if (
    isOutOfDomain(req.text, {
      lastAsked,
      hasBookingContext: Boolean(known.from || known.to || known.date || lastAsked),
    })
  ) {
    return pack({ intent: "OUT_OF_DOMAIN" }, known, { source: "nlu", failureReason: "out_of_domain" });
  }

  const deterministic = understand(req.text, { now, lastAsked, known });
  if (FAST_PATH.has(deterministic.intent) || (lastAsked === "trainNumber" && deterministic.trainNumber)) {
    return pack(deterministic, known, { source: "nlu", failureReason: "fast_path" });
  }
  if (lastAsked === "passengers" && deterministic.passengerCount) {
    return pack(deterministic, known, { source: "nlu", failureReason: "fast_path" });
  }
  const destOnlyCluster =
    Boolean(deterministic.unresolvedTo) &&
    !deterministic.from &&
    !deterministic.unresolvedFrom &&
    /jana hai|jaana hai|जाना है/.test(req.text) &&
    !/(?:से|\bse\b|\bfrom\b)/.test(req.text);
  if (destOnlyCluster) {
    return pack(deterministic, known, { source: "nlu", failureReason: "fast_path" });
  }

  const llmInput = {
    text: req.text,
    today: todayYmdFrom(now),
    lastAsked,
    known: {
      origin: known.from ? `${known.from.name} (${known.from.code})` : undefined,
      destination: known.to ? `${known.to.name} (${known.to.code})` : undefined,
      date: known.date ?? undefined,
      passengers: known.passengerCount ?? undefined,
    },
  };
  const llm = await extractWithLlm(llmInput);
  // Shadow only — RapidAPI Gemini never becomes provider and never packs into nlu.
  enqueueGeminiShadow(llmInput, llm);

  if (llm.extraction && llm.extraction.confidence >= 0.4 && llm.source) {
    const nlu = mapExtraction(llm.extraction, now, lastAsked, known, req.text);
    if (!nlu.passengerCount && deterministic.passengerCount) {
      nlu.passengerCount = deterministic.passengerCount;
    }
    if (
      nlu.from ||
      nlu.to ||
      nlu.unresolvedFrom ||
      nlu.unresolvedTo ||
      nlu.date ||
      nlu.passengerCount ||
      nlu.intent !== "NONE"
    ) {
      return pack(nlu, known, {
        source: "ai",
        provider: "nvidia",
        modelUsed: llm.modelUsed,
        fallbackAttempt: 0,
        latencyMs: llm.latencyMs,
        failureReason: null,
        attempts: llm.attempts,
      });
    }
  }

  return pack(deterministic, known, {
    source: "nlu",
    provider: llm.provider,
    modelUsed: llm.modelUsed,
    fallbackAttempt: 0,
    latencyMs: llm.latencyMs,
    failureReason: llm.failureReason ?? "ai_unusable",
    attempts: llm.attempts,
  });
}

function missingOf(nlu: NluResult, known: KnownSlots): string[] {
  const missing: string[] = [];
  if (!nlu.from && !known.from) missing.push("origin");
  if (!nlu.to && !known.to) missing.push("destination");
  if (!nlu.date && !known.date) missing.push("date");
  if (!nlu.passengerCount && !known.passengerCount) missing.push("passengers");
  return missing;
}
