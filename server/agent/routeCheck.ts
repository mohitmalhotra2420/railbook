/* ── Round-43k (user: "har sawaal ke liye rule kyun fix kar rahe ho? AI ko KHUD samajhna chahiye") ──────
 * EK shared jagah — "khaas train + user ne bola station" ka poora sach:
 *   1) user ke text se sirf wahi tokens jo SACH ME station hain (stopwords/class codes/train-name words nahi)
 *   2) unhe train ke TIMETABLE ROUTE se match karo — CODE se, aur code na mile to NAAM/SHEHAR se
 *      (MMCT "Mumbai Central" vs purana code BCT "Mumbai Central" — ek hi station, jhoothi "nahi jaati" nahi)
 *   3) route me NAHI hai to `bad` — us station ka seat/fare/board kabhi nahi (koi jhootha N/A board nahi)
 *
 * Yahi function dono jagah chalta hai: `agentic.ts` (CHECK_AVAILABILITY / GET_FARE tool — model ise
 * bypass nahi kar sakta) aur `run.ts` (deterministic single-train handler). Isliye naya sawaal-wala rule
 * likhne ki zaroorat nahi — ek jagah verification, har path par lagu. Route data na mile to koi claim nahi.
 */
import { routedSchedule, routedStationSearch } from "../railway/router.js";
import { scrapeTrainScheduleWeb } from "../railway/webscrape.js";

export const ROUTE_ASK_STOPWORDS = new Set([
  "seat", "seats", "check", "krna", "karna", "karo", "kar", "ke", "ki", "ka", "liye", "liy",
  "wala", "wali", "me", "mein", "hai", "hain", "kya", "batao", "bata", "bataiye", "dekh", "dekhna",
  "dikhao", "train", "gaadi", "gadi", "number", "no", "tak", "kal", "aaj", "parso", "parson", "subah",
  "shaam", "raat", "class", "classes", "book", "booking", "kaise", "kitni", "kitna", "abhi",
  "kahan", "chahiye", "milegi", "milega", "khali", "khaali", "please", "haan", "ha", "na", "nahi",
  "aur", "alawa", "sabse", "kaunsi", "sabhi", "sab", "lagegi", "lagega", "chal", "chalti", "the",
  /* Train-name ke aam shabd — inhe station token maan lena galat tha (jaise "12951 mumbai RAJDHANI…"). */
  "rajdhani", "shatabdi", "janshatabdi", "jan", "express", "exp", "duronto", "tejas", "vande", "bharat",
  "garib", "rath", "intercity", "superfast", "sf", "mail", "passenger", "memu", "demu", "special",
  "humsafar", "antodaya", "antoday", "sampark", "kranti", "yuva", "double", "decker", "vistadome",
  "1a", "2a", "3a", "3e", "2s", "sl", "cc", "ec", "fc", "1e",
  /* Hindi/English postposition + booking ke aam shabd — inhe station token maan lena FALSE "nahi jaati"
   * deta tha (live: "12138 ... ko LDH se CSMT" me "ko" station search se ERN ban gaya). */
  "ko", "se", "par", "pe", "mein", "me", "k", "bhi", "hi", "to", "ta", "taa", "waale", "walo",
  "passenger", "passengers", "pax", "log", "logon", "member", "berth", "confirm", "tatkal", "quota",
  "gn", "general", "date", "tareekh", "din", "kaun", "kab", "kya", "kyu", "kyun", "kaise", "h",
]);

/** User ke text me se station-jaise tokens (train number/stopwords/class codes chhod kar). */
export function candidateStationTokens(text: string, trainNumber?: string | null): string[] {
  const num = String(trainNumber ?? "").toLowerCase();
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .filter((w) => w !== num && w.length >= 2 && w.length <= 12 && !ROUTE_ASK_STOPWORDS.has(w))
    .slice(0, 3);
}

const norm = (s: string | undefined | null) => String(s ?? "").trim().toUpperCase();
const nameToken = (s: string | undefined | null) => String(s ?? "").toLowerCase().split(/[^a-z]+/)[0];
/** Station naam compare (punctuation/Jn suffix ignore) — naye-purane codes (MMCT/BCT) ek hi station hain. */
const normName = (s: string | undefined | null) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(jn|junction|terminal|term|halt)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

type Stop = { code?: string; name?: string; city?: string };

export type RouteStationBad = {
  code: string;
  side: "origin" | "destination";
  first: string;
  last: string;
  /** Isi SHEHAR ka koi doosra station jo route me hai (jaise Ludhiana: LDH stop nahi, par DDL hai).
   *  Isse jawab zyada sahi hota hai — "nahi jaati" ke bajaye exact station bata dete hain. */
  nearby?: { code: string; name?: string; arrival?: string | null; departure?: string | null };
};
export type RouteStationCheck = {
  origin?: string;
  destination?: string;
  bad?: RouteStationBad;
  first?: string;
  last?: string;
  stops: Stop[];
};

/**
 * Train ke timetable route ke against user ke station tokens verify karo. `asked` me jo diya ho wahi pehle
 * check hota hai; warna `userText` ke station tokens se khud nikaalte hain.
 */
export async function checkStationsOnRoute(
  trainNumber: string,
  asked: { origin?: string | null; destination?: string | null } = {},
  userText?: string | null,
): Promise<RouteStationCheck> {
  const sched = await routedSchedule(trainNumber).catch(() => null);
  const stops: Stop[] = sched?.schedule && "stops" in sched.schedule ? (sched.schedule.stops as Stop[]) ?? [] : [];
  /* Timetable na mila → koi claim nahi, par user ka diya hua segment WAISE HI aage badhe (warna provider
   * hiccup par tool "route chahiye" bol kar fail ho jaata, jabki user ne route bola tha). */
  if (stops.length < 2) return { origin: norm(asked.origin) || undefined, destination: norm(asked.destination) || undefined, stops: [] };
  const first = norm(stops[0].code);
  const last = norm(stops[stops.length - 1].code);
  const inRoute = (code: string) => stops.some((st) => norm(st.code) === norm(code));
  const citySiblingOf = async (code: string): Promise<RouteStationBad["nearby"] | undefined> => {
    const hit = await searchHit(code);
    const city = normName(hit?.city ?? "");
    if (!city) return undefined;
    /* CODE se search karne par sirf wahi station milta hai — isliye shehar ke naam se search karo. */
    const res = await routedStationSearch(String(hit?.city ?? "").trim() || code).catch(() => null);
    const sameCity = (res?.stations ?? []).filter((st) => normName(st.city ?? "") === city);
    for (const cand of sameCity) {
      if (norm(cand.code) === norm(code)) continue;
      const inRoute = stops.find((st) => norm(st.code) === norm(cand.code));
      if (inRoute) return { code: norm(inRoute.code), name: inRoute.name, arrival: (inRoute as { arrival?: string | null }).arrival, departure: (inRoute as { departure?: string | null }).departure };
    }
    return undefined;
  };
  const bad = async (code: string, side: "origin" | "destination"): Promise<RouteStationBad> => {
    const sib = await citySiblingOf(code).catch(() => undefined);
    return { code: norm(code), side, first, last, ...(sib ? { nearby: sib } : {}) };
  };

  /* Kisi bhi code ko route ke station se match karo — pehle code, phir naam, phir shehar (ek hi ho to). */
  const mapToRoute = async (code: string): Promise<"in" | "mapped" | "out" | "unknown"> => {
    if (inRoute(code)) return "in";
    const hit = await searchHit(code);
    if (!hit) return "unknown";
    const hn = normName(hit.name ?? "");
    const byName = hn
      ? stops.find((st) => normName(st.name ?? "") === hn) ??
        stops.find((st) => {
          const sn = normName(st.name ?? "");
          return sn.length >= 5 && hn.length >= 5 && (sn.startsWith(hn) || hn.startsWith(sn));
        })
      : undefined;
    if (byName) return "mapped";
    const city = normName((hit as { city?: string }).city ?? "");
    const byCity = city ? stops.filter((st) => normName((st as { city?: string }).city ?? "") === city) : [];
    if (byCity.length === 1) return "mapped";
    return "out";
  };
  /* Station search ka bharosa: exact CODE match, ya kam-se-kam 3 akshar ka token (aur 5+ akshar par
   * search ka top result). Chhote token ("ko", "se") par top result lena jhoothi mismatch deta tha. */
  /* ── DOOSRA SOURCE (Round-43k) ─────────────────────────────────────────────────────────────────────
   * "Ye station is train me nahi hai" ek NEGATIVE claim hai — ek provider ke stop-list me gap ho sakta hai
   * (live case: 12054 ke route me asli me LDH Ludhiana hai, par primary API ne Dhandal Kalan ke saath LDH
   * chhod diya; aise hi 19326). Isliye negative claim se PEHLE ek doosra (web) schedule source check hota
   * hai: agar wahan station mil gaya to claim nahi karte (aur us station ka data lene se rok nahi lagti).
   * Do source chup rahein tab hi "nahi jaati" bolte hain. Positive claims ke liye ye extra call nahi. */
  const inStopsByName = (list: Stop[], code: string, name: string | undefined): boolean => {
    if (list.some((st) => norm(st.code) === norm(code))) return true;
    const hn = normName(name ?? "");
    if (!hn) return false;
    return list.some((st) => {
      const sn = normName(st.name ?? "");
      return sn && (sn === hn || (sn.length >= 5 && hn.length >= 5 && (sn.startsWith(hn) || hn.startsWith(sn))));
    });
  };
  const secondaryStops = async (): Promise<Stop[]> => {
    const sc = await scrapeTrainScheduleWeb(trainNumber).catch(() => null);
    return (sc?.stops ?? []).map((st) => ({ code: st.code, name: st.name })) as Stop[];
  };
  const survivesInSecondSource = async (code: string): Promise<boolean> => {
    const sec = await secondaryStops();
    if (!sec.length) return false;
    const hit = await searchHit(code);
    return inStopsByName(sec, code, hit?.name);
  };

  const searchHit = async (tok: string): Promise<{ code: string; name?: string; city?: string } | null> => {
    const t = norm(tok);
    const res = await routedStationSearch(tok).catch(() => null);
    const list = res?.stations ?? [];
    const exact = list.find((st) => norm(st.code) === t);
    if (exact) return exact as { code: string; name?: string; city?: string };
    if (t.length < 3) return null;
    const top = list[0];
    return top && (top.code === t || t.length >= 5) ? (top as { code: string; name?: string; city?: string }) : null;
  };
  const searchHitCode = async (tok: string): Promise<string | null> => (await searchHit(tok))?.code ?? null;
  const routeCodeOf = async (code: string): Promise<string | null> => {
    if (inRoute(code)) return norm(code);
    const hit = await searchHit(code);
    if (!hit) return null;
    const hn = normName(hit.name ?? "");
    const byName = hn ? stops.find((st) => normName(st.name ?? "") === hn) : undefined;
    const city = normName((hit as { city?: string }).city ?? "");
    const byCity = city ? stops.filter((st) => normName((st as { city?: string }).city ?? "") === city) : [];
    const target = byName ?? (byCity.length === 1 ? byCity[0] : null);
    return target ? norm(target.code) : null;
  };

  let origin = norm(asked.origin ?? "") || undefined;
  let destination = norm(asked.destination ?? "") || undefined;

  const badCands: { code: string; side: "origin" | "destination" }[] = [];
  for (const [side, code] of [
    ["origin", origin],
    ["destination", destination],
  ] as const) {
    if (!code) continue;
    const verdict = await mapToRoute(code);
    if (verdict === "out") badCands.push({ code, side });
    if (verdict === "mapped") {
      const mapped = await routeCodeOf(code);
      if (mapped) {
        if (side === "origin") origin = mapped;
        else destination = mapped;
      }
    }
  }
  /* Dono side NLU/se aaye ho to token-scan ki zaroorat nahi — par VERIFICATION (doosra source + bad
   * claim) yahan bhi honi chahiye, warna "route me nahi" wala station chup-chaap aage chala jaata hai
   * (live bug: 12951 mumbai rajdhani haridwar → dest=HW bina check, phir tool fail). */
  const haveBoth = Boolean(origin && destination);

  const looksDest = /\b(ke liye|k liye|tak|jaana|jana|destination|pahunch)\b/i.test(String(userText ?? ""));
  const fromCue = /\bse\b/i.test(String(userText ?? ""));

  /* Station args me nahi aaya — user ke apne shabdon se (sirf wahi tokens jo SACH ME station hain). */
  for (const cand of haveBoth ? [] : candidateStationTokens(userText ?? "", trainNumber)) {
    if (cand === String(trainNumber)) continue;
    const byCode = stops.find((st) => norm(st.code) === norm(cand));
    const byName = stops.find((st) => nameToken(st.name ?? "") === cand);
    if (byCode || byName) {
      const code = norm((byCode ?? byName)!.code);
      /* Wahi station jo pehle se kisi side lag chuka hai (jaise NLU yaa "ke liye" se destination bankar)
       * dobara LAGAO MAT — warna "HW→HW" banta hai aur provider koi data nahi deta. */
      if (code === origin || code === destination) continue;
      const idx = stops.findIndex((st) => norm(st.code) === code);
      const asDest = looksDest && !fromCue ? true : idx === stops.length - 1;
      if (asDest && !destination) destination = code;
      else if (!origin) origin = code;
      else destination = destination ?? code;
      continue;
    }
    const verdict = await mapToRoute(cand);
    if (verdict === "unknown") continue;
    const resolved = await routeCodeOf(cand);
    if (verdict === "out") {
      /* Message me asli station code dikhao (HW), raw token nahi (HARIDWAR). */
      const realCode = resolved ?? (await searchHitCode(cand)) ?? norm(cand);
      badCands.push({ code: realCode, side: looksDest && !fromCue ? "destination" : origin ? "destination" : "origin" });
      continue;
    }
    const code = resolved ?? norm(cand);
    if (code === origin || code === destination) continue;
    if (!origin) origin = code;
    else if (!destination) destination = code;
  }
  const rescued: string[] = [];
  /* Negative claim ka final faisla: DO source. Ek source me mila → claim nahi (aur us station ko
   * segment endpoint bhi nahi banne dete — warna provider se ulta data maangte). */
  for (const c of badCands) {
    if (await survivesInSecondSource(c.code)) {
      rescued.push(norm(c.code));
      continue;
    }
    return { bad: await bad(c.code, c.side), first, last, stops };
  }
  const inRouteNow = (code: string | undefined) => (code ? stops.some((st) => norm(st.code) === norm(code)) : false);
  const finalOrigin = inRouteNow(origin) && !rescued.includes(norm(origin)) ? origin : undefined;
  const finalDestination = inRouteNow(destination) && !rescued.includes(norm(destination)) ? destination : undefined;
  return { origin: finalOrigin, destination: finalDestination, first, last, stops };
}

/** Tool/handler ka honest route-mismatch message. `forModel` par user-facing wording bhi di jaati hai. */
export function routeMismatchMessage(trainNumber: string, bad: RouteStationBad, forModel = false): string {
  const sibPlain = bad.nearby
    ? ` Isi shehar ka ${bad.nearby.code}${bad.nearby.name ? ` (${bad.nearby.name})` : ""} us route me hai${bad.nearby.departure ? ` — departure ${bad.nearby.departure}` : ""}.`
    : "";
  const sibModel = bad.nearby
    ? ` User ko yahi exact baat batao (us station se travel ho sakti hai) aur uska data chahiye to poochho.`
    : "";
  const head = `${trainNumber} ${bad.code} par stop NAHI karti — us train ka timetable route ${bad.first} → ${bad.last} hai, ${bad.code} us route me nahi.${sibPlain}`;
  const headModel = `${head}${sibModel}`;
  if (!forModel) return head;
  return (
    `${headModel} Is station ka seat/fare/board data dena MANA hai (koi N/A rows nahi). ` +
    `User ko exactly aise bolo (Hinglish, 2-3 line): "${trainNumber} ke timetable me ${bad.code} nahi milta — is train ka route ${bad.first} → ${bad.last} hai, ${bad.code} us route me nahi hai. Ye train kis station tak chahiye, ya ${bad.code} ke liye kaunsi train dekhni hai?"`
  );
}

/**
 * Route ke pehle stop (= origin) ya aakhri stop (= destination) jaisa hi arg dena bekaar hai aur provider
 * usse ulta samajh leta hai (live case: 12054 destination=HW bheja → provider "HW→HW" maan kar koi data
 * nahi diya, jabki poore route ka data turant aa jaata hai). Isliye redundant side DROP karo —
 * `resolveTrainRouteDate` timetable se wahi first/last khud bhar deta hai. Middle segment hamesha rahega.
 */
export function normalizeRouteSegment(
  stops: Stop[],
  seg: { origin?: string | null; destination?: string | null },
): { origin?: string; destination?: string } {
  const first = norm(stops[0]?.code);
  const last = norm(stops[stops.length - 1]?.code);
  let origin = norm(seg.origin) || undefined;
  let destination = norm(seg.destination) || undefined;
  /* Dono ek hi station (provider "X→X" invalid maanta hai) → pehle hi koi segment claim nahi. */
  if (origin && destination && origin === destination) return {};
  if (origin && origin === first) origin = undefined;
  if (destination && destination === last) destination = undefined;
  return { origin, destination };
}

/** Kisi station ke liye train ke route ka "same-city" station (Ludhiana → DDL). Koi doosra tool/handler
 * isse wahi nuance de sakta hai (jaise GET_TIMETABLE ka station line) — verification ek hi jagah rehti hai. */
export async function citySiblingOnRoute(
  trainNumber: string,
  stationCode: string,
): Promise<{ code: string; name?: string; arrival?: string | null; departure?: string | null } | null> {
  const sched = await routedSchedule(trainNumber).catch(() => null);
  const stops: Stop[] = sched?.schedule && "stops" in sched.schedule ? (sched.schedule.stops as Stop[]) ?? [] : [];
  if (stops.length < 2) return null;
  if (stops.some((st) => norm(st.code) === norm(stationCode))) return null; /* khud route me hai */
  const res = await routedStationSearch(String(stationCode)).catch(() => null);
  const hit = (res?.stations ?? []).find((st) => norm(st.code) === norm(stationCode)) ?? null;
  const city = normName(hit?.city ?? "");
  if (!city) return null;
  const cityRes = await routedStationSearch(String(hit?.city ?? "").trim() || stationCode).catch(() => null);
  for (const cand of cityRes?.stations ?? []) {
    if (normName(cand.city ?? "") !== city || norm(cand.code) === norm(stationCode)) continue;
    const inRoute = stops.find((st) => norm(st.code) === norm(cand.code));
    if (inRoute) return { code: norm(inRoute.code), name: inRoute.name, arrival: (inRoute as { arrival?: string | null }).arrival, departure: (inRoute as { departure?: string | null }).departure };
  }
  return null;
}
