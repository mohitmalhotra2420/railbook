/* RailBook → IRCTC handoff — ADDITIVE, user-initiated, client-side only.
 *
 * Why this exists: the review step can OPTIONALLY continue the same journey on the official IRCTC
 * site. RailBook only (a) builds a local payload with journey + non-sensitive passenger fields,
 * (b) keeps it locally for the authorised autofill component, and (c) opens the official IRCTC page
 * in a NEW tab after an explicit user click.
 *
 * Hard limits, enforced by CONSTRUCTION (allowlist authoring, never filtering/sanitising):
 *  - only the allowed keys below are ever copied into the payload, so credentials, OTP/PIN, CAPTCHA,
 *    payment, card/UPI, session/cookie or token values have no path into it;
 *  - this module never fills, clicks, navigates or submits anything on IRCTC;
 *  - login, OTP, CAPTCHA, payment and the final booking action stay with the user on IRCTC;
 *  - no network call, no new dependency, no server/API change, no existing flow touched.
 *
 * The payload contract below is the one the frozen/authorised autofill component already validates
 * (chrome-extension-poc/fieldmap.js → validatePayload). Keep this file the single source of truth
 * for that shape on the web side.
 */
import type { ClassCode, Passenger, TrainResult } from "../types";

/** Official IRCTC page the user is taken to. Opened only from an explicit click, in a new tab. */
export const IRCTC_HANDOFF_URL = "https://www.irctc.co.in/nget/train-search";

/** Storage key the authorised autofill component reads (unchanged, same as the POC contract). */
export const HANDOFF_STORAGE_KEY = "railbookAutofillTestPayload";

/** Frozen validator requires this literal kind + test flag; the REAL gate stays on the extension side. */
export const HANDOFF_KIND = "railbook-autofill-test";

/** Classes the frozen autofill validator accepts (fieldmap.js SUPPORTED_CLASSES). */
const SUPPORTED_CLASSES = new Set<string>(["1A", "2A", "3A", "3E", "CC", "EC", "SL", "2S", "EA", "FC"]);

/** Same sensitive-word scan the frozen validator applies to the whole payload (fieldmap.js). */
const FORBIDDEN_WORDS =
  /\b(password|passwd|pwd|pin|otp|cvv|cvc|card|upi|vpa|login|user\s*name|username|userid|user\s*id|token|secret|session|cookie|csrf|captcha|nlpanswer|netbanking|wallet|aadhaar|aadhar|pan)\b/i;

export interface HandoffJourney {
  from: string;
  fromCode: string;
  to: string;
  toCode: string;
  date: string;
  trainNumber: string;
  classCode: string;
}

export interface HandoffPassenger {
  name: string;
  age: number;
  gender: "male" | "female" | "transgender" | "other";
  berth: string;
  food: string;
}

export interface IrctcHandoffPayload {
  kind: typeof HANDOFF_KIND;
  version: 1;
  test: true;
  createdAt: string;
  journey: HandoffJourney;
  passengers: HandoffPassenger[];
}

export type HandoffBuild =
  | { ok: true; errors: []; payload: IrctcHandoffPayload }
  | { ok: false; errors: string[]; payload: null };

/** Everything the handoff needs, all of it already present on the review screen. */
export interface HandoffInput {
  train: Pick<TrainResult, "number" | "from" | "to">;
  date: string;
  classCode: ClassCode;
  passengers: Array<Pick<Passenger, "name" | "age" | "gender" | "berthPreference">>;
}

const GENDERS = new Set(["male", "female", "transgender", "other"]);

function isRealCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Build the handoff payload from the current review state.
 * Returns `{ ok: false, errors }` (and never a payload) when anything is missing/invalid — the caller
 * must then do nothing at all: no tab, no store, no partial handoff.
 */
export function buildHandoffPayload(input: HandoffInput, now: Date = new Date()): HandoffBuild {
  const errors: string[] = [];

  const fromName = String(input.train?.from?.name ?? "").trim();
  const fromCode = String(input.train?.from?.code ?? "").trim().toUpperCase();
  const toName = String(input.train?.to?.name ?? "").trim();
  const toCode = String(input.train?.to?.code ?? "").trim().toUpperCase();
  const trainNumber = String(input.train?.number ?? "").trim();
  const classCode = String(input.classCode ?? "").trim().toUpperCase();
  const date = String(input.date ?? "").trim();

  if (!fromName || !toName) errors.push("journey from/to missing");
  if (!/^\d{4,6}$/.test(trainNumber)) errors.push("invalid train number");
  if (!SUPPORTED_CLASSES.has(classCode)) errors.push(`class ${input.classCode} is not supported by the authorised autofill`);
  if (!isRealCalendarDate(date)) errors.push("invalid travel date (expected a real YYYY-MM-DD date)");

  const list = Array.isArray(input.passengers) ? input.passengers : [];
  if (list.length < 1) errors.push("at least 1 passenger is required");
  else if (list.length > 6) errors.push("IRCTC allows at most 6 passengers per handoff");

  const passengers: HandoffPassenger[] = list.map((p, i) => {
    const name = String(p?.name ?? "").trim().slice(0, 60);
    const age = Number(p?.age);
    const gender = String(p?.gender ?? "").trim().toLowerCase();
    if (!name) errors.push(`passenger ${i + 1}: name missing`);
    if (!Number.isFinite(age) || age < 1 || age > 120) errors.push(`passenger ${i + 1}: invalid age`);
    if (!GENDERS.has(gender)) errors.push(`passenger ${i + 1}: gender missing`);
    return {
      name,
      age,
      gender: (GENDERS.has(gender) ? gender : "other") as HandoffPassenger["gender"],
      /* No silent substitution: the user's own choice is carried; only a blank becomes IRCTC's own
       * default ("No Preference"). "Any" is carried as-is (the component maps it) and Window/Aisle/
       * Cabin/Coupe stay untouched. */
      berth: String(p?.berthPreference ?? "").trim() || "No Preference",
      /* RailBook has no meal field — "" means "leave the site's own default unchanged". */
      food: "",
    };
  });

  if (errors.length) return { ok: false, errors, payload: null };

  const payload: IrctcHandoffPayload = {
    kind: HANDOFF_KIND,
    version: 1,
    test: true,
    createdAt: now.toISOString(),
    journey: { from: fromName, fromCode, to: toName, toCode, date, trainNumber, classCode },
    passengers,
  };

  /* Belt-and-braces: the frozen validator scans the serialised payload for sensitive words. */
  const hit = JSON.stringify(payload).match(FORBIDDEN_WORDS);
  if (hit) return { ok: false, errors: [`payload contains a forbidden sensitive word: ${hit[0]}`], payload: null };

  return { ok: true, errors: [], payload };
}

/**
 * Keep the payload available to the authorised autofill component, exactly like the POC contract:
 * its storage key plus a same-origin window message. Local only — no network, no cookies.
 * A failure to store must never block the user's own IRCTC journey, so nothing here throws.
 */
export function storeHandoff(payload: IrctcHandoffPayload): { stored: boolean; posted: boolean } {
  let stored = false;
  let posted = false;
  try {
    window.localStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(payload));
    stored = true;
  } catch {
    stored = false;
  }
  try {
    window.postMessage(payload, window.location.origin);
    posted = true;
  } catch {
    posted = false;
  }
  return { stored, posted };
}

/** Read back what the last handoff left locally (read-only helper; used by tests/diagnostics). */
export function readStoredHandoff(): IrctcHandoffPayload | null {
  try {
    const raw = window.localStorage.getItem(HANDOFF_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IrctcHandoffPayload) : null;
  } catch {
    return null;
  }
}

/** Clear the local handoff (user-initiated housekeeping; never automatic). */
export function clearStoredHandoff(): void {
  try {
    window.localStorage.removeItem(HANDOFF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Open the official IRCTC page in a NEW user-controlled tab. Called only from a click handler.
 * `noopener,noreferrer` so the new tab gets no handle on RailBook. Returns false if the browser
 * blocked the new tab (then the user can simply click again).
 */
export function openIrctcInNewTab(): boolean {
  try {
    const w = window.open(IRCTC_HANDOFF_URL, "_blank", "noopener,noreferrer");
    return w != null;
  } catch {
    return false;
  }
}
