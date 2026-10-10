/**
 * Round-52 (29 Sep 2026) — AI ke tools ko station ka naam "jaise user ne likha" milta hai.
 *
 * Kyun: user Hinglish me likhta hai — "Yaar LDH se SVDK ke liye kal…", "bhai ldh", "kal katra".
 * Model apni marzi se tool ko `origin: "Yaar Ldh"` jaisa bhej sakta hai (chhota/typo/filler bhi).
 * Pehle aise arg par khaali lookup hota tha aur tool "station resolve nahi hua — user se poochho"
 * de deta tha (yaani user ko lagta tha AI samajh hi nahi raha).
 *
 * Yahan ek hi jagah: pehle **local station knowledge** (alias/code/city + phrase ke andar ka saaf
 * station word — `matchStation`), phir provider ka station lookup. Jo mila hi nahi, to null —
 * kuch invent nahi hota.
 */
import { matchStationStrict } from "../understand/legacy-stations.js";
import { routedStationSearch } from "../railway/router.js";
import { STATION_CODES } from "../data/station-codes.js";

export type StationArgHit = { code: string; name?: string | null; via: "local" | "provider" };

/** Station arg → code (ya null). Ambigue city (Delhi/Mumbai…) local me nahi milti — wo provider
 *  ka choice-flow hai (isliye yahan se kuch return nahi hota aur caller wahi sawaal poochhta hai). */
export async function resolveStationArg(raw: string): Promise<StationArgHit | null> {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  /* 1) Saaf code — par sirf tab jab wo ASLI station code ho (8,989 ka local dataset). Warna "delhi"
   * jaisa city-naam bhi 5 akshar ka hai aur galti se "DELHI" code ban jaata (aur station lookup
   * fail — pehle aisa hi bug tha). Dataset me na mile to aage ke steps (local naam/alias → provider). */
  const up = s.toUpperCase();
  if (/^[A-Z0-9]{2,6}$/.test(up) && /[A-Z]/.test(up) && STATION_CODES[up]) return { code: up, name: STATION_CODES[up], via: "local" };
  /* 2) Local knowledge: exact naam/city/alias + phrase ke andar ka station word. */
  const local = matchStationStrict(s);
  if (local) return { code: local.code.toUpperCase(), name: local.name ?? null, via: "local" };
  /* 3) Provider lookup (asli station DB) — ambiguous city par bhi pehla station hi. */
  try {
    const res = await routedStationSearch(s);
    if (res?.stations?.length) {
      const hit = res.needChoice && res.stations.length > 1 ? res.stations[0] : res.stations[0];
      return { code: hit.code.toUpperCase(), name: hit.name ?? null, via: "provider" };
    }
  } catch {
    /* provider fail — neeche null (kuch invent nahi) */
  }
  return null;
}
