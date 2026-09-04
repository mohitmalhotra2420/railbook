import type { Station } from "../providers/types.js";

export type StationPick =
  | { kind: "single"; station: Station; stations: Station[] }
  | { kind: "ambiguous"; stations: Station[]; city: string }
  | { kind: "none"; stations: Station[] };

/** City queries that must not collapse to a single default station. */
export const MULTI_STATION_CITIES: Record<string, string[]> = {
  delhi: ["NDLS", "DLI", "NZM", "DEC", "ANVT", "DEE"],
  dilli: ["NDLS", "DLI", "NZM", "DEC", "ANVT", "DEE"],
  दिल्ली: ["NDLS", "DLI", "NZM", "DEC", "ANVT", "DEE"],
  mumbai: ["BCT", "MMCT", "CSMT", "LTT", "BDTS", "DR", "TNA"],
  bombay: ["BCT", "MMCT", "CSMT", "LTT", "BDTS"],
  मुंबई: ["BCT", "MMCT", "CSMT", "LTT", "BDTS"],
  kolkata: ["HWH", "SDAH", "KOAA", "SHM"],
  calcutta: ["HWH", "SDAH", "KOAA"],
  कोलकाता: ["HWH", "SDAH", "KOAA"],
  hyderabad: ["HYB", "SC", "KCG"],
  हैदराबाद: ["HYB", "SC", "KCG"],
  kochi: ["ERS", "ERN"],
  cochin: ["ERS", "ERN"],
  ernakulam: ["ERS", "ERN"],
  ambala: ["UMB", "UBC"],
  अंबाला: ["UMB", "UBC"],
  अम्बाला: ["UMB", "UBC"],
  jalandhar: ["JUC", "JRC"],
  जालंधर: ["JUC", "JRC"],
  lucknow: ["LKO", "LJN"],
  लखनऊ: ["LKO", "LJN"],
  kanpur: ["CNB", "CPA"],
  कानपुर: ["CNB", "CPA"],
  agra: ["AGC", "AF"],
  आगरा: ["AGC", "AF"],
  chennai: ["MAS", "MS"],
  madras: ["MAS", "MS"],
  चेन्नई: ["MAS", "MS"],
  bengaluru: ["SBC", "YPR"],
  bangalore: ["SBC", "YPR"],
  बेंगलुरु: ["SBC", "YPR"],
  bhopal: ["BPL", "RKMP"],
  भोपाल: ["BPL", "RKMP"],
  patna: ["PNBE", "DNR"],
  पटना: ["PNBE", "DNR"],
  firozpur: ["FZR", "FZP"],
  ferozepur: ["FZR", "FZP"],
  pathankot: ["PTK", "PTKC"],
  पठानकोट: ["PTK", "PTKC"],
  thiruvananthapuram: ["TVC", "KCVL"],
  trivandrum: ["TVC", "KCVL"],
};

/** Preferred codes used only to rank real API hits — never invented. */
const PREFERRED: Record<string, string[]> = {
  jammu: ["JAT"],
  जम्मू: ["JAT"],
  beas: ["BEAS"],
  बीआस: ["BEAS"],
  बिआस: ["BEAS"],
  amritsar: ["ASR"],
  अमृतसर: ["ASR"],
  ludhiana: ["LDH"],
  लुधियाना: ["LDH"],
  kochi: ["ERS", "ERN"],
  cochin: ["ERS", "ERN"],
  ernakulam: ["ERS", "ERN"],
  haridwar: ["HW"],
  हरिद्वार: ["HW"],
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokens(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9\u0900-\u097f]+/i)
    .filter(Boolean);
}

function hasWord(hay: string, needle: string): boolean {
  const n = norm(needle);
  if (!n) return false;
  const h = norm(hay);
  if (h === n) return true;
  return tokens(h).includes(n);
}

export function scoreStation(query: string, station: Station): number {
  const q = norm(query);
  if (!q) return 0;
  const code = station.code.toUpperCase();
  const name = station.name || "";
  const city = station.city || "";
  const qUp = q.toUpperCase();

  if (code === qUp) return 100;
  if (norm(name) === q) return 92;

  const preferred = PREFERRED[q] ?? [];
  if (preferred.includes(code) && (hasWord(name, q) || hasWord(city, q) || norm(city) === q || norm(name).startsWith(q))) {
    return 95;
  }

  if (norm(city) === q) return 80;

  if (norm(name).startsWith(q) || norm(city).startsWith(q)) return 70;
  if (hasWord(name, q) || hasWord(city, q)) return 62;

  // Reject lookalikes (KFX KOCHEWAHI for "Kochi") — shared prefix is not enough.
  if (preferred.length && !preferred.includes(code) && !hasWord(name, q) && !hasWord(city, q)) {
    return 0;
  }

  if (q.length >= 4 && (norm(name).includes(q) || norm(city).includes(q))) return 48;
  if (preferred.includes(code)) return 40;
  return 0;
}

export function pickStations(query: string, hits: Station[]): StationPick {
  const q = query.trim();
  if (!q) return { kind: "none", stations: [] };

  const scored = hits
    .map((s) => ({ s, score: scoreStation(q, s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.code.localeCompare(b.s.code));

  const ranked = scored.map((x) => x.s);
  const qn = norm(q);

  if (/^[A-Za-z0-9]{2,5}$/.test(q)) {
    const exact = hits.find((s) => s.code.toUpperCase() === q.toUpperCase());
    if (exact) return { kind: "single", station: exact, stations: [exact, ...ranked.filter((s) => s.code !== exact.code)] };
  }

  const group = MULTI_STATION_CITIES[qn];
  if (group) {
    // Exact city-name query (delhi/calcutta/madras/bombay…): group membership
    // hi authority hai — score gate group members ko nikaal deti thi (jaise
    // "calcutta" → HOWRAH JN name-scorable nahi). Extra API rows score se.
    const inCity = hits.filter((s) => group.includes(s.code.toUpperCase()));
    const unique = new Map(inCity.map((s) => [s.code.toUpperCase(), s]));
    if (unique.size >= 2) {
      // Show EVERY relevant station the lookup API returned — known group
      // members are only an ordering hint (best first), never a filter.
      // Agra City, Sarai Rohilla, Raja ki Mandi… must not disappear.
      const extra = hits
        .filter((s) => !unique.has(s.code.toUpperCase()) && scoreStation(q, s) > 0)
        .sort((a, b) => scoreStation(q, b) - scoreStation(q, a) || a.code.localeCompare(b.code));
      return { kind: "ambiguous", stations: [...unique.values(), ...extra], city: q };
    }
    if (unique.size === 1) {
      const only = [...unique.values()][0];
      return { kind: "single", station: only, stations: [only] };
    }
    // City group known but API rows do not correspond (e.g. Kochi → KFX only).
    return { kind: "none", stations: [] };
  }

  if (!scored.length) return { kind: "none", stations: [] };

  const preferredCodes = PREFERRED[qn] ?? [];
  const preferredHit = ranked.find((s) => preferredCodes.includes(s.code.toUpperCase()));
  if (preferredHit) {
    return { kind: "single", station: preferredHit, stations: ranked };
  }

  const top = scored[0];
  const second = scored[1];
  if (second && top.score < 90 && second.score >= 60 && top.score - second.score < 12) {
    return { kind: "ambiguous", stations: ranked, city: q };
  }
  return { kind: "single", station: top.s, stations: ranked };
}

/** Which query to send to station search given NLU station + raw user text. */
export function isClusterStation(code: string): boolean {
  const up = code.trim().toUpperCase();
  return Object.values(MULTI_STATION_CITIES).some((list) => list.includes(up));
}

export function stationSearchQuery(station: { code: string; name: string; city: string }, userText: string): string {
  const text = userText || "";
  const codeRe = new RegExp(`\\b${station.code}\\b`, "i");
  if (codeRe.test(text)) return station.code;
  const name = station.name.trim();
  if (name && name.toLowerCase() !== station.city.toLowerCase() && text.toLowerCase().includes(name.toLowerCase())) {
    return name;
  }
  return (station.city || station.name || station.code).trim();
}
