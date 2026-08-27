import type { ClassAvailability, ClassCode, Recommendation, TrainResult } from "../types";
import { isBookable } from "../types";
import type { TimePref } from "./nlu";

export const AC_CODES: ClassCode[] = ["1A", "2A", "3A", "3E", "CC", "EC", "EA"];

export interface Prefs {
  timePref?: TimePref;
  afterHour?: number;
  acOnly?: boolean;
  classCodes?: ClassCode[];
  confirmedOnly?: boolean;
}

export function mergePrefs(prev: Prefs, next: Prefs): Prefs {
  return {
    timePref: next.timePref ?? prev.timePref,
    afterHour: next.afterHour ?? prev.afterHour,
    acOnly: next.acOnly ?? prev.acOnly,
    classCodes: next.classCodes ?? prev.classCodes,
    confirmedOnly: next.confirmedOnly ?? prev.confirmedOnly,
  };
}

function depHour(t: TrainResult): number {
  return Number(t.departure.slice(0, 2));
}

function classOk(c: ClassAvailability, prefs: Prefs): boolean {
  if (prefs.confirmedOnly && c.status !== "AVAILABLE") return false;
  if (!prefs.confirmedOnly && !isBookable(c.status)) return false;
  if (prefs.classCodes?.length && !prefs.classCodes.includes(c.code)) return false;
  if (prefs.acOnly && !AC_CODES.includes(c.code)) return false;
  return true;
}

export function matchingClasses(train: TrainResult, prefs: Prefs): ClassAvailability[] {
  return train.classes.filter((c) => classOk(c, prefs));
}

export function filterTrains(trains: TrainResult[], prefs: Prefs): TrainResult[] {
  return trains.filter((t) => {
    const h = depHour(t);
    if (Number.isFinite(h)) {
      if (prefs.timePref === "morning" && h >= 12) return false;
      if (prefs.timePref === "afternoon" && (h < 12 || h >= 17)) return false;
      if (prefs.timePref === "evening" && h < 16) return false;
      if (prefs.timePref === "after" && prefs.afterHour != null && h < prefs.afterHour) return false;
    }
    // Search payloads often omit class/fare. Empty classes ≠ "no train".
    if (!t.classes.length) return true;
    return matchingClasses(t, prefs).length > 0;
  });
}

export function pickFastest(trains: TrainResult[]): TrainResult | undefined {
  return [...trains].sort((a, b) => a.durationMinutes - b.durationMinutes || a.departure.localeCompare(b.departure))[0];
}

export function minFare(t: TrainResult, prefs: Prefs): number {
  const fares = matchingClasses(t, prefs).map((c) => c.fare);
  return fares.length ? Math.min(...fares) : Infinity;
}

export function pickCheapest(trains: TrainResult[], prefs: Prefs): TrainResult | undefined {
  return [...trains].sort((a, b) => minFare(a, prefs) - minFare(b, prefs))[0];
}

export function pickRecommended(
  trains: TrainResult[],
  recs: Recommendation[],
  prefs: Prefs,
): TrainResult | undefined {
  for (const r of recs) {
    const t = trains.find((x) => x.number === r.trainNumber);
    if (t) return t;
  }
  return pickFastest(trains) ?? trains[0];
}

export function bestClass(train: TrainResult, prefs: Prefs): ClassAvailability | undefined {
  const list = matchingClasses(train, prefs);
  if (!list.length) return undefined;
  const confirmed = list.filter((c) => c.status === "AVAILABLE");
  const pool = confirmed.length ? confirmed : list;
  if (prefs.acOnly || prefs.classCodes?.length) {
    return [...pool].sort((a, b) => a.fare - b.fare)[0];
  }
  return [...pool].sort((a, b) => a.fare - b.fare)[0];
}

export function recLabel(kind: string): string {
  if (kind === "fastest") return "⚡ Fastest";
  if (kind === "cheapest") return "💰 Cheapest";
  if (kind === "best-timing") return "🕐 Best timing";
  if (kind === "best") return "⭐ Best for you";
  return "⭐ Best for you";
}
