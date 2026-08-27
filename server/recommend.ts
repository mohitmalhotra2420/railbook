import { isBookable, type TrainResult } from "./providers/types.js";

export type RecKind =
  | "best"
  | "fastest"
  | "cheapest"
  | "best-timing"
  | "best-value"
  | "most-convenient";

export interface Recommendation {
  trainNumber: string;
  kind: RecKind;
  label: string;
  reason: string;
}

function minAvailableFare(t: TrainResult): number | null {
  const fares = t.classes.filter((c) => isBookable(c.status)).map((c) => c.fare);
  return fares.length ? Math.min(...fares) : null;
}

function hasAc(t: TrainResult): boolean {
  return t.classes.some(
    (c) =>
      isBookable(c.status) &&
      ["1A", "2A", "3A", "CC", "EC", "EA"].includes(c.code),
  );
}

function depMinutes(t: TrainResult): number {
  const [h, m] = t.departure.split(":").map(Number);
  return h * 60 + m;
}

function scoreBest(t: TrainResult): number {
  const fare = minAvailableFare(t);
  if (fare == null) return -Infinity;
  const timeBonus = depMinutes(t) >= 6 * 60 && depMinutes(t) <= 11 * 60 ? 180 : 0;
  const acBonus = hasAc(t) ? 120 : 0;
  const availBonus = t.classes.some((c) => c.status === "AVAILABLE") ? 80 : 0;
  return 4000 - t.durationMinutes - fare * 0.15 + timeBonus + acBonus + availBonus;
}

export function recommend(trains: TrainResult[]): Recommendation[] {
  const bookable = trains.filter((t) =>
    t.classes.some((c) => isBookable(c.status)),
  );
  if (!bookable.length) return [];

  const recs: Recommendation[] = [];
  const used = new Set<string>();

  const fastest = [...bookable].sort(
    (a, b) => a.durationMinutes - b.durationMinutes || a.departure.localeCompare(b.departure),
  )[0];
  const cheapest = [...bookable].sort((a, b) => {
    return (minAvailableFare(a) ?? 9e9) - (minAvailableFare(b) ?? 9e9);
  })[0];
  const bestTiming = [...bookable]
    .filter((t) => depMinutes(t) >= 6 * 60 && depMinutes(t) <= 10 * 60 + 30)
    .sort((a, b) => Math.abs(depMinutes(a) - 8 * 60) - Math.abs(depMinutes(b) - 8 * 60))[0];
  const best = [...bookable].sort((a, b) => scoreBest(b) - scoreBest(a))[0];

  const reasons: string[] = [];
  if (best === fastest) reasons.push("Fastest journey");
  if (hasAc(best)) reasons.push("AC available");
  const dm = depMinutes(best);
  if (dm >= 6 * 60 && dm <= 11 * 60) reasons.push("Good departure time");
  if (best === cheapest) reasons.push("Lowest fare");
  if (!reasons.length) reasons.push("Best overall match");

  recs.push({
    trainNumber: best.number,
    kind: "best",
    label: "Best for you",
    reason: reasons.join(" · "),
  });
  used.add(best.number);

  if (!used.has(fastest.number)) {
    recs.push({
      trainNumber: fastest.number,
      kind: "fastest",
      label: "Fastest",
      reason: `${fastest.durationLabel} · arrives ${fastest.arrival}`,
    });
    used.add(fastest.number);
  }

  if (!used.has(cheapest.number)) {
    recs.push({
      trainNumber: cheapest.number,
      kind: "cheapest",
      label: "Cheapest",
      reason: `From ₹${minAvailableFare(cheapest)}`,
    });
    used.add(cheapest.number);
  }

  if (bestTiming && !used.has(bestTiming.number)) {
    recs.push({
      trainNumber: bestTiming.number,
      kind: "best-timing",
      label: "Best timing",
      reason: `Departs ${bestTiming.departure}`,
    });
  }

  return recs;
}
