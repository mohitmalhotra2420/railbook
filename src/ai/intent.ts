import type { ClassCode, Station } from "../types";
import type { DateHit } from "./dates";
import { toLegacyIntent, understand, type DialogSlot, type KnownSlots, type TimePref } from "./nlu";

export type { TimePref };

export type IntentAction =
  | "search"
  | "select_fastest"
  | "select_cheapest"
  | "select_recommended"
  | "change_date"
  | "check_availability"
  | "book"
  | "show_more"
  | "find_alternate"
  | "nearby_earlier"
  | "nearby_later"
  | "yes"
  | "no"
  | "use_saved"
  | "change_details"
  | "check_booking";

export interface Intent {
  raw: string;
  from?: Station;
  to?: Station;
  unresolvedFrom?: string;
  unresolvedTo?: string;
  date?: string;
  dateAmbiguous?: { date: string; label: string }[];
  passengerCount?: number;
  timePref?: TimePref;
  afterHour?: number;
  acOnly?: boolean;
  classCodes?: ClassCode[];
  confirmedOnly?: boolean;
  action?: IntentAction;
  dateHit?: DateHit;
}

export function extractIntent(
  text: string,
  now = new Date(),
  lastAsked: DialogSlot = null,
  known: KnownSlots = {},
): Intent {
  const n = understand(text, { now, lastAsked, known });
  const legacy = toLegacyIntent(n);
  return {
    ...legacy,
    raw: text.trim(),
    unresolvedFrom: n.unresolvedFrom,
    unresolvedTo: n.unresolvedTo,
    dateHit: n.date ? { date: n.date, ambiguous: n.dateAmbiguous } : { date: undefined, ambiguous: n.dateAmbiguous },
  };
}

export function missingSlot(ctx: {
  from?: Station | null;
  to?: Station | null;
  date?: string | null;
}): "from" | "to" | "date" | null {
  if (!ctx.from) return "from";
  if (!ctx.to) return "to";
  if (!ctx.date) return "date";
  return null;
}

export type { DialogSlot, KnownSlots };
