import type { Passenger } from "../types";

const FEMALE_RE =
  /\b(female|femail|fimale|fimal|woman|women|girl|ladki|ladkee|ladkiya|aurat|mahila|stree|fe\s*male)\b|महिला|लड़की|लडकी|स्त्री|औरत|फीमेल|फिमेल|फी\s*मेल|फि\s*मेल/i;
const MALE_RE =
  /\b(male|mail|mael|man|boy|ladka|ladkaa|aadmi|admi|purush|mard)\b|पुरुष|लड़का|लडका|आदमी|मर्द|मलै|मैल|(?:^|[\s])मेल(?:$|[\s])/i;
const OTHER_RE =
  /\b(other|others|anya|trans|non[\s-]?binary|nonbinary)\b|अन्य|अदर|ओथर|अदर/i;
const GENDER_NOISE = /जेंडर|जेन्डर|\bgender\b|\bsex\b|\bling\b/gi;

const COMPACT_GENDER: Array<[RegExp, Passenger["gender"]]> = [
  [/^(female|femail|fimale|fimal|ladki|aurat|mahila|फीमेल|फिमेल|महिला|लड़की|लडकी|औरत)$/i, "FEMALE"],
  [/^(male|mail|mael|ladka|aadmi|admi|purush|mard|मेल|मैल|मलै|पुरुष|लड़का|लडका|आदमी|मर्द)$/i, "MALE"],
  [/^(other|others|anya|अन्य|अदर|ओथर)$/i, "OTHER"],
];

const NAME_PREFIX =
  /^(mera naam|meri naam|mera name|my name is|naam hai|naam|i am|i'm|main|mai)\s+/i;
const NAME_SUFFIX = /\s+(hai|hain|hoon|hun)$/i;

export function foldCompact(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

export function parseSpokenGender(text: string): Passenger["gender"] | "" {
  const t = text.normalize("NFKC").trim();
  if (!t) return "";
  const compact = foldCompact(t.replace(GENDER_NOISE, " "));
  for (const [re, value] of COMPACT_GENDER) {
    if (re.test(compact)) return value;
  }
  if (FEMALE_RE.test(t)) return "FEMALE";
  if (MALE_RE.test(t)) return "MALE";
  if (OTHER_RE.test(t)) return "OTHER";
  return "";
}

export function parseSpokenAge(text: string): string | "" {
  const m = text.match(/\b(\d{1,3})\b/);
  if (!m) return "";
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > 120) return "";
  return String(n);
}

export function sanitizePassengerName(raw: string): string {
  let t = raw.normalize("NFKC");
  t = t.replace(/[\d]/g, " ");
  t = t.replace(/[^\p{L}\p{M} .']/gu, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export function parseSpokenName(text: string): string {
  let t = text.normalize("NFKC").trim();
  t = t.replace(NAME_PREFIX, "");
  t = t.replace(NAME_SUFFIX, "");
  t = t.replace(/\b(\d{1,3})\s*(saal|sal|years?|yrs?|umar|umr)?\b/gi, " ");
  t = t.replace(GENDER_NOISE, " ");
  t = t.replace(FEMALE_RE, " ");
  t = t.replace(MALE_RE, " ");
  t = t.replace(OTHER_RE, " ");
  t = t.replace(/\b(gender|sex|umar|age|saal|passenger|hai|hain|hoon|hun|bhariye|bhare|fill)\b/gi, " ");
  t = sanitizePassengerName(t);
  if (t.length < 3) return "";
  if (parseSpokenGender(t)) return "";
  return t.replace(/(^| )([A-Za-z])/g, (_, sp: string, ch: string) => sp + ch.toUpperCase());
}

export function sanitizePassengerAge(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 3);
}

export function isAllowedGender(value: string): value is Passenger["gender"] {
  return value === "" || value === "MALE" || value === "FEMALE" || value === "OTHER";
}

export type PaxAsk = "name" | "age" | "gender" | "berth" | null;

export function nameIsValid(name?: string): boolean {
  const t = (name ?? "").trim();
  if (t.length < 3) return false;
  return /^[\p{L}\p{M}][\p{L}\p{M} .']+$/u.test(t);
}

export function ageIsValid(age?: string): boolean {
  const n = Number(String(age ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 120;
}

export function nextPassengerAsk(p: {
  name?: string;
  age?: string;
  gender?: string;
  berthPreference?: string;
} | null | undefined): PaxAsk {
  if (!p) return "name";
  if (!nameIsValid(p.name)) return "name";
  if (!ageIsValid(p.age)) return "age";
  if (!p.gender) return "gender";
  if (!p.berthPreference) return "berth";
  return null;
}

export function parsePassengerSpeech(
  text: string,
  berths: string[] = [],
  slot: PaxAsk = null,
): Partial<Pick<Passenger, "name" | "age" | "gender" | "berthPreference">> {
  const t = text.normalize("NFKC").trim();
  if (!t) return {};
  const gender = parseSpokenGender(t);
  const age = parseSpokenAge(t);
  const name = parseSpokenName(t);
  const low = t.toLowerCase();
  const berth = berths.find((b) => low.includes(b.toLowerCase()));

  if (slot === "gender") {
    return gender ? { gender } : {};
  }
  if (slot === "age") {
    return age ? { age } : {};
  }
  if (slot === "berth") {
    return berth ? { berthPreference: berth } : {};
  }

  const patch: Partial<Pick<Passenger, "name" | "age" | "gender" | "berthPreference">> = {};
  if (name) patch.name = name;
  if (age) patch.age = age;
  if (gender) patch.gender = gender;
  if (berth) patch.berthPreference = berth;
  return patch;
}
