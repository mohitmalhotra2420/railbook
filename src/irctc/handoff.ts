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

/** Round-21 (25 Sep 2026): EXTENDED payload ka apna key — food/catering, IRCTC ke do checkbox aur
 *  contact (mobile/email) ke saath. Naya app (v1.4.4+) pehle yahi padhta hai, warna purana key.
 *  Purana key hamesha PURANE shape me hi likha jaata hai, isliye purane app/extension bhi kaam karte rehte hain. */
export const HANDOFF_STORAGE_KEY_V2 = "railbookAutofillPayloadV2";

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
  /** Round-21: IRCTC ke checkbox — sirf tab likhe jaate hain jab user ne tick kiya ho. */
  bookOnlyIfConfirm?: true;
  autoUpgrade?: true;
}

/** Round-21: IRCTC ka contact block — sirf wahi jo user ne khud bhara ho. */
export interface HandoffContact {
  mobile?: string;
  email?: string;
}

export interface IrctcHandoffPayload {
  kind: typeof HANDOFF_KIND;
  version: 1;
  test: true;
  createdAt: string;
  journey: HandoffJourney;
  passengers: HandoffPassenger[];
}

/** Extended payload (app v1.4.4+ / naya autofill) — purane shape ke upar sirf 3 cheezein add. */
export interface IrctcHandoffPayloadV2 extends Omit<IrctcHandoffPayload, "version"> {
  version: 2;
  contact?: HandoffContact;
}

export type HandoffBuild =
  | {
      ok: true;
      errors: [];
      /** Extended payload (V2) — naya autofill yahi padhta hai. */
      payload: IrctcHandoffPayloadV2;
      /** Bilkul purana shape (V1) — purane app/extension ke liye. */
      payloadLegacy: IrctcHandoffPayload;
    }
  | { ok: false; errors: string[]; payload: null; payloadLegacy: null };

/** Everything the handoff needs, all of it already present on the review screen. */
export interface HandoffInput {
  train: Pick<TrainResult, "number" | "from" | "to" | "date">;
  date: string;
  classCode: ClassCode;
  passengers: Array<Pick<Passenger, "name" | "age" | "gender" | "berthPreference" | "foodChoice" | "bookOnlyIfConfirm" | "autoUpgrade">>;
  /** Round-21: contact details — sirf jab user ne form me bhare ho. */
  contact?: { mobile?: string; email?: string } | null;
}

const GENDERS = new Set(["male", "female", "transgender", "other"]);

/* Round-21: RailBook ka food choice → IRCTC ke apne option labels (wahi jo authorised autofill engine
 * exact match karta hai; "No Food" site ke apne option text se match hota hai, value guess nahi hoti).
 * Khaali chhoda ho to "" → IRCTC ka apna default (Catering Service Option) chalta rehta hai. */
const FOOD_LABELS: Record<string, string> = { VEG: "Veg", NON_VEG: "Non Veg", NO_FOOD: "No Food" };

/** Mobile sirf tab bheja jaata hai jab 10 digit ka ho; email basic shape par. */
function cleanContact(input?: { mobile?: string; email?: string } | null): HandoffContact | null {
  const mobile = String(input?.mobile ?? "").replace(/[^0-9]/g, "").slice(0, 10);
  const email = String(input?.email ?? "").trim().slice(0, 60);
  const out: HandoffContact = {};
  if (/^\d{10}$/.test(mobile)) out.mobile = mobile;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.email = email;
  return out.mobile || out.email ? out : null;
}

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
  /* Review screen prints train.date; booking state.date can lag on a restored session.
   * Prefer a real calendar date on the selected train when present so the IRCTC handoff
   * matches what the user sees on Review (e.g. 27 Sep), not a stale default (today). */
  const trainDate = String(input.train?.date ?? "").trim();
  const stateDate = String(input.date ?? "").trim();
  const date = isRealCalendarDate(trainDate) ? trainDate : stateDate;

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
      /* Round-21: user ka apna khaana (IRCTC label) — khaali ho to site ka default chalta rehta hai. */
      food: FOOD_LABELS[String(p?.foodChoice ?? "").toUpperCase()] ?? "",
    };
  });

  /* Round-21: user ne mobile/email bhara hai to wo valid hona chahiye — warna saaf error (chupke se drop
   * nahi karte: IRCTC par pahunchta hi nahi aur user ko pata bhi nahi chalta). */
  const rawMobile = String(input.contact?.mobile ?? "").replace(/[^0-9]/g, "").slice(0, 10);
  const rawEmail = String(input.contact?.email ?? "").trim();
  if (rawMobile && !/^\d{10}$/.test(rawMobile)) errors.push("contact mobile must be a 10 digit number (ya khaali chhodo)");
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) errors.push("contact email looks invalid (ya khaali chhodo)");

  if (errors.length) return { ok: false, errors, payload: null, payloadLegacy: null };
  const contact = cleanContact(input.contact);

  /* Round-21: extended (V2) payload — food + IRCTC checkboxes + contact. Jis passenger ne checkbox tick nahi
   * kiya uske liye key hi nahi jaati (site ka default waisa hi rehta hai). Contact sirf valid hone par. */
  const passengersV2: HandoffPassenger[] = passengers.map((p, i) => {
    const src = list[i];
    return {
      ...p,
      ...(src?.bookOnlyIfConfirm === true ? { bookOnlyIfConfirm: true as const } : {}),
      ...(src?.autoUpgrade === true ? { autoUpgrade: true as const } : {}),
    };
  });
  const payload: IrctcHandoffPayloadV2 = {
    kind: HANDOFF_KIND,
    version: 2,
    test: true,
    createdAt: now.toISOString(),
    journey: { from: fromName, fromCode, to: toName, toCode, date, trainNumber, classCode },
    passengers: passengersV2,
    ...(contact ? { contact } : {}),
  };
  /* Purana shape bilkul waise hi (V1) — purane app/extension ke liye. */
  const payloadLegacy: IrctcHandoffPayload = {
    kind: HANDOFF_KIND,
    version: 1,
    test: true,
    createdAt: payload.createdAt,
    journey: payload.journey,
    passengers: passengers.map((p) => ({ name: p.name, age: p.age, gender: p.gender, berth: p.berth, food: p.food })),
  };

  /* Belt-and-braces: the frozen validator scans the serialised payload for sensitive words. */
  const hit = JSON.stringify(payload).match(FORBIDDEN_WORDS);
  if (hit) return { ok: false, errors: [`payload contains a forbidden sensitive word: ${hit[0]}`], payload: null, payloadLegacy: null };

  return { ok: true, errors: [], payload, payloadLegacy };
}

/**
 * Keep the payload available to the authorised autofill component, exactly like the POC contract:
 * its storage key plus a same-origin window message. Local only — no network, no cookies.
 * A failure to store must never block the user's own IRCTC journey, so nothing here throws.
 */
export function storeHandoff(payload: IrctcHandoffPayloadV2 | IrctcHandoffPayload, legacy?: IrctcHandoffPayload): { stored: boolean; posted: boolean } {
  let stored = false;
  let posted = false;
  const legacyPayload: IrctcHandoffPayload =
    legacy ??
    {
      kind: payload.kind,
      version: 1,
      test: true,
      createdAt: payload.createdAt,
      journey: payload.journey,
      passengers: payload.passengers.map((p) => ({ name: p.name, age: p.age, gender: p.gender, berth: p.berth, food: p.food })),
    };
  try {
    /* Purana key = purana shape (v1.4.3 tak ke app/extension bilkul waise hi chalte hain). */
    window.localStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(legacyPayload));
    stored = true;
  } catch {
    stored = false;
  }
  /* Naya (V2) payload apne key me — app v1.4.4+ isse padhta hai (food + checkboxes + contact). */
  try {
    window.localStorage.setItem(HANDOFF_STORAGE_KEY_V2, JSON.stringify(payload));
  } catch {
    /* ignore — payload purane path se phir bhi jaata hai */
  }
  try {
    /* postMessage me LEGACY shape hi (purana app sniffer unknown keys par poora payload reject kar deta hai). */
    window.postMessage(legacyPayload, window.location.origin);
    posted = true;
  } catch {
    posted = false;
  }
  return { stored, posted };
}

/** Read back what the last handoff left locally (read-only helper; used by tests/diagnostics). */
export function readStoredHandoff(): IrctcHandoffPayloadV2 | IrctcHandoffPayload | null {
  try {
    const raw = window.localStorage.getItem(HANDOFF_STORAGE_KEY_V2) || window.localStorage.getItem(HANDOFF_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IrctcHandoffPayloadV2) : null;
  } catch {
    return null;
  }
}

/** Clear the local handoff (user-initiated housekeeping; never automatic). */
export function clearStoredHandoff(): void {
  try {
    window.localStorage.removeItem(HANDOFF_STORAGE_KEY);
    window.localStorage.removeItem(HANDOFF_STORAGE_KEY_V2);
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

/** Official IRCTC Rail Connect Android package (Play Store / device). */
export const IRCTC_ANDROID_PACKAGE = "cris.org.in.prs.ima";

export type IrctcOpenResult = {
  opened: boolean;
  /** How we tried to open IRCTC. */
  via: "android-app-intent" | "new-tab" | "same-tab-fallback" | "blocked";
  /** True only when we fired an Android intent toward the Rail Connect package (best-effort). */
  triedOfficialApp: boolean;
};

function isAndroidMobile(): boolean {
  try {
    return /Android/i.test(navigator.userAgent || "") && /Mobile|wv/i.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}

/**
 * Best-effort open of IRCTC for the current device.
 *
 *  · Desktop / iOS / non-Android → https://www.irctc.co.in/... in a new tab (unchanged).
 *  · Android mobile → try an intent that targets the official Rail Connect package so the
 *    *system* can open the IRCTC app if installed; if the app is missing or the browser
 *    ignores the intent, fall back to the same IRCTC **website** URL.
 *
 * HARD LIMIT (browser security — not a RailBook bug):
 *  We can ask Android to open the IRCTC app/site. We CANNOT push From/To/Date/pax into the
 *  official IRCTC app’s private screens. Auto-fill of those fields needs either:
 *    (a) Chrome extension on desktop, or
 *    (b) RailBook’s own Android WebView app (injects fill JS into irctc.co.in web).
 *  The website-only path always shows a copy-ready summary so the user can paste/type fast.
 */
export function openIrctcHandoff(): IrctcOpenResult {
  /* 1) Android: try official app via intent (user gesture required — call only from click). */
  if (typeof window !== "undefined" && isAndroidMobile()) {
    try {
      const intentUrl =
        "intent://www.irctc.co.in/nget/train-search#Intent;" +
        "scheme=https;" +
        "package=" + IRCTC_ANDROID_PACKAGE + ";" +
        "S.browser_fallback_url=" + encodeURIComponent(IRCTC_HANDOFF_URL) + ";" +
        "end";
      /* Same-tab navigate is the reliable way to fire VIEW intents from Chrome/Android browsers. */
      window.location.href = intentUrl;
      return { opened: true, via: "android-app-intent", triedOfficialApp: true };
    } catch {
      /* fall through to new-tab */
    }
  }

  /* 2) Default: new tab to official IRCTC website */
  try {
    const w = window.open(IRCTC_HANDOFF_URL, "_blank", "noopener,noreferrer");
    if (w != null) return { opened: true, via: "new-tab", triedOfficialApp: false };
  } catch {
    /* ignore */
  }

  /* 3) Popup blocked → same-tab last resort (still user-initiated). */
  try {
    window.location.assign(IRCTC_HANDOFF_URL);
    return { opened: true, via: "same-tab-fallback", triedOfficialApp: false };
  } catch {
    return { opened: false, via: "blocked", triedOfficialApp: false };
  }
}

/** Human-readable card the user can copy into IRCTC (website-only path; no PII beyond journey pax names). */
export function formatHandoffSummary(payload: IrctcHandoffPayloadV2 | IrctcHandoffPayload): string {
  const j = payload.journey;
  const lines: string[] = [
    "RailBook → IRCTC handoff (copy/paste)",
    "--------------------------------",
    `From: ${j.from}${j.fromCode ? ` (${j.fromCode})` : ""}`,
    `To:   ${j.to}${j.toCode ? ` (${j.toCode})` : ""}`,
    `Date: ${j.date}`,
    `Train (hint): ${j.trainNumber}`,
    `Class: ${j.classCode}`,
    "",
    "Passengers:",
  ];
  payload.passengers.forEach((p, i) => {
    lines.push(
      `  ${i + 1}. ${p.name} · age ${p.age} · ${p.gender} · berth ${p.berth || "No Preference"}` +
        (p.food ? ` · food ${p.food}` : "") +
        (p.bookOnlyIfConfirm ? " · book only if confirm berths" : "") +
        (p.autoUpgrade ? " · consider for auto up-gradation" : ""),
    );
  });
  const c = (payload as IrctcHandoffPayloadV2).contact;
  if (c && (c.mobile || c.email)) {
    lines.push("", "Contact (IRCTC me):");
    if (c.mobile) lines.push(`  mobile: ${c.mobile}`);
    if (c.email) lines.push(`  email:  ${c.email}`);
  }
  lines.push(
    "",
    "Note: IRCTC me Search / Book / Login / Pay aap khud karenge.",
    "Website se official IRCTC app ke andar fields auto-fill nahi ho sakti (OS security).",
  );
  return lines.join("\n");
}

/** Clipboard helper — user gesture only. Returns false if clipboard API blocked. */
export async function copyHandoffSummary(payload: IrctcHandoffPayloadV2 | IrctcHandoffPayload): Promise<boolean> {
  const text = formatHandoffSummary(payload);
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
