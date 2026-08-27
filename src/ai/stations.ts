import type { Station } from "../types";

export const CLIENT_STATIONS: Station[] = [
  { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" },
  { code: "ASR", name: "Amritsar Junction", city: "Amritsar" },
  { code: "JUC", name: "Jalandhar City", city: "Jalandhar" },
  { code: "JRC", name: "Jalandhar Cantt", city: "Jalandhar" },
  { code: "JAT", name: "Jammu Tawi", city: "Jammu" },
  { code: "BEAS", name: "Beas", city: "Beas" },
  { code: "SVDK", name: "SMVD Katra", city: "Katra" },
  { code: "CDG", name: "Chandigarh", city: "Chandigarh" },
  { code: "UMB", name: "Ambala Cantt", city: "Ambala" },
  { code: "UBC", name: "Ambala City", city: "Ambala" },
  { code: "NDLS", name: "New Delhi", city: "Delhi" },
  { code: "DLI", name: "Delhi Junction", city: "Delhi" },
  { code: "NZM", name: "Hazrat Nizamuddin", city: "Delhi" },
  { code: "AGC", name: "Agra Cantt", city: "Agra" },
  { code: "AF", name: "Agra Fort", city: "Agra" },
  { code: "JP", name: "Jaipur Junction", city: "Jaipur" },
  { code: "LKO", name: "Lucknow NR", city: "Lucknow" },
  { code: "LJN", name: "Lucknow Junction NER", city: "Lucknow" },
  { code: "CNB", name: "Kanpur Central", city: "Kanpur" },
  { code: "CPA", name: "Kanpur Anwarganj", city: "Kanpur" },
  { code: "GKP", name: "Gorakhpur Junction", city: "Gorakhpur" },
  { code: "PNBE", name: "Patna Junction", city: "Patna" },
  { code: "DNR", name: "Danapur", city: "Patna" },
  { code: "HWH", name: "Howrah Junction", city: "Kolkata" },
  { code: "SDAH", name: "Sealdah", city: "Kolkata" },
  { code: "BBS", name: "Bhubaneswar", city: "Bhubaneswar" },
  { code: "BCT", name: "Mumbai Central", city: "Mumbai" },
  { code: "CSMT", name: "CSMT Mumbai", city: "Mumbai" },
  { code: "PUNE", name: "Pune Junction", city: "Pune" },
  { code: "ADI", name: "Ahmedabad Junction", city: "Ahmedabad" },
  { code: "BPL", name: "Bhopal Junction", city: "Bhopal" },
  { code: "RKMP", name: "Rani Kamalapati", city: "Bhopal" },
  { code: "NGP", name: "Nagpur Junction", city: "Nagpur" },
  { code: "HYB", name: "Hyderabad Deccan", city: "Hyderabad" },
  { code: "SC", name: "Secunderabad Junction", city: "Hyderabad" },
  { code: "MAS", name: "Chennai Central", city: "Chennai" },
  { code: "MS", name: "Chennai Egmore", city: "Chennai" },
  { code: "SBC", name: "KSR Bengaluru", city: "Bengaluru" },
  { code: "YPR", name: "Yesvantpur Junction", city: "Bengaluru" },
  { code: "TVC", name: "Thiruvananthapuram Central", city: "Thiruvananthapuram" },
  { code: "KCVL", name: "Kochuveli", city: "Thiruvananthapuram" },
  { code: "BZA", name: "Vijayawada Junction", city: "Vijayawada" },
  { code: "DDN", name: "Dehradun", city: "Dehradun" },
  { code: "HW", name: "Haridwar Junction", city: "Haridwar" },
  { code: "SRE", name: "Saharanpur Junction", city: "Saharanpur" },
  { code: "PTA", name: "Patiala", city: "Patiala" },
  { code: "RPJ", name: "Rajpura Junction", city: "Rajpura" },
  { code: "BTI", name: "Bathinda Junction", city: "Bathinda" },
  { code: "FZR", name: "Firozpur Cantt", city: "Firozpur" },
  { code: "FZP", name: "Firozpur City", city: "Firozpur" },
  { code: "PTK", name: "Pathankot Junction", city: "Pathankot" },
  { code: "PTKC", name: "Pathankot Cantt", city: "Pathankot" },
  { code: "ERS", name: "Ernakulam Junction", city: "Kochi" },
  { code: "ERN", name: "Ernakulam Town", city: "Kochi" },
];

const ALIASES: Record<string, string> = {
  "new delhi": "NDLS",
  "nayi dilli": "NDLS",
  ndls: "NDLS",
  "नई दिल्ली": "NDLS",
  "नयी दिल्ली": "NDLS",
  "delhi junction": "DLI",
  "old delhi": "DLI",
  dli: "DLI",
  nizamuddin: "NZM",
  "hazrat nizamuddin": "NZM",
  nzm: "NZM",
  amritsar: "ASR",
  asr: "ASR",
  ambarsar: "ASR",
  अमृतसर: "ASR",
  अम्रितसर: "ASR",
  ludhiana: "LDH",
  ldh: "LDH",
  लुधियाना: "LDH",
  "jalandhar city": "JUC",
  juc: "JUC",
  "jalandhar cantt": "JRC",
  "jalandhar cant": "JRC",
  jrc: "JRC",
  chandigarh: "CDG",
  chd: "CDG",
  चंडीगढ़: "CDG",
  चण्डीगढ़: "CDG",
  "ambala cantt": "UMB",
  "ambala cant": "UMB",
  "ambala ctt": "UMB",
  "ambala junction": "UMB",
  umb: "UMB",
  "अंबाला कैंट": "UMB",
  "अम्बाला कैंट": "UMB",
  "ambala city": "UBC",
  ubc: "UBC",
  "अंबाला सिटी": "UBC",
  "अम्बाला सिटी": "UBC",
  "mumbai central": "BCT",
  bct: "BCT",
  mmct: "BCT",
  csmt: "CSMT",
  cst: "CSMT",
  howrah: "HWH",
  hwh: "HWH",
  हावड़ा: "HWH",
  sealdah: "SDAH",
  sdah: "SDAH",
  jaipur: "JP",
  जयपुर: "JP",
  "lucknow nr": "LKO",
  lko: "LKO",
  "lucknow junction": "LJN",
  ljn: "LJN",
  "kanpur central": "CNB",
  cnb: "CNB",
  "kanpur anwarganj": "CPA",
  cpa: "CPA",
  "patna junction": "PNBE",
  pnbe: "PNBE",
  danapur: "DNR",
  dnr: "DNR",
  "chennai central": "MAS",
  mas: "MAS",
  "chennai egmore": "MS",
  egmore: "MS",
  ms: "MS",
  "ksr bengaluru": "SBC",
  "ksr bangalore": "SBC",
  sbc: "SBC",
  yesvantpur: "YPR",
  yeshvantpur: "YPR",
  ypr: "YPR",
  "hyderabad deccan": "HYB",
  hyb: "HYB",
  secunderabad: "SC",
  sc: "SC",
  pune: "PUNE",
  पुणे: "PUNE",
  "agra cantt": "AGC",
  "agra cant": "AGC",
  agc: "AGC",
  "agra fort": "AF",
  af: "AF",
  jammu: "JAT",
  जम्मू: "JAT",
  beas: "BEAS",
  बीआस: "BEAS",
  बिआस: "BEAS",
  katra: "SVDK",
  कटरा: "SVDK",
  ahmedabad: "ADI",
  अहमदाबाद: "ADI",
  "bhopal junction": "BPL",
  bpl: "BPL",
  "rani kamalapati": "RKMP",
  habibganj: "RKMP",
  rkmp: "RKMP",
  hbj: "RKMP",
  nagpur: "NGP",
  नागपुर: "NGP",
  dehradun: "DDN",
  "dehra dun": "DDN",
  ddn: "DDN",
  देहरादून: "DDN",
  देहरादुन: "DDN",
  haridwar: "HW",
  हरिद्वार: "HW",
  saharanpur: "SRE",
  सहारनपुर: "SRE",
  patiala: "PTA",
  pta: "PTA",
  पटियाला: "PTA",
  पतियाला: "PTA",
  राजपुरा: "RPJ",
  rajpura: "RPJ",
  bathinda: "BTI",
  bhatinda: "BTI",
  बठिंडा: "BTI",
  firozpur: "FZR",
  ferozepur: "FZR",
  फिरोजपुर: "FZR",
  pathankot: "PTK",
  पठानकोट: "PTK",
};

export const NEARBY: Record<string, string[]> = {
  NDLS: ["DLI", "NZM"],
  DLI: ["NDLS", "NZM"],
  NZM: ["NDLS", "DLI"],
  ASR: ["JUC", "LDH"],
  LDH: ["JUC", "ASR", "PTA"],
  JUC: ["LDH", "ASR"],
  PTA: ["LDH", "RPJ", "CDG"],
  RPJ: ["PTA", "UMB", "CDG"],
  BCT: ["CSMT"],
  CSMT: ["BCT"],
  HWH: ["SDAH"],
  SDAH: ["HWH"],
};

export function stationByCode(code: string): Station | undefined {
  return CLIENT_STATIONS.find((s) => s.code === code.toUpperCase());
}

const CITY_NAME_ALIASES: Record<string, string> = {
  dilli: "delhi",
  दिल्ली: "delhi",
  दिल्ही: "delhi",
  bombay: "mumbai",
  मुंबई: "mumbai",
  बंबई: "mumbai",
  calcutta: "kolkata",
  कोलकाता: "kolkata",
  हैदराबाद: "hyderabad",
  अंबाला: "ambala",
  अम्बाला: "ambala",
  trivandrum: "thiruvananthapuram",
  "thiruvananthapuram": "thiruvananthapuram",
  जालंधर: "jalandhar",
  जालन्धर: "jalandhar",
  jullundur: "jalandhar",
  लखनऊ: "lucknow",
  कानपुर: "kanpur",
  पटना: "patna",
  चेन्नई: "chennai",
  madras: "chennai",
  bangalore: "bengaluru",
  बेंगलुरु: "bengaluru",
  बंगलौर: "bengaluru",
  आगरा: "agra",
  भोपाल: "bhopal",
  फिरोजपुर: "firozpur",
  ferozepur: "firozpur",
  पठानकोट: "pathankot",
  cochin: "kochi",
  ernakulam: "kochi",
  कोच्चि: "kochi",
};

function clustersFromCatalog(): Record<string, string[]> {
  const byCity = new Map<string, Station[]>();
  for (const s of CLIENT_STATIONS) {
    const key = s.city.toLowerCase();
    const list = byCity.get(key) ?? [];
    list.push(s);
    byCity.set(key, list);
  }
  const out: Record<string, string[]> = {};
  for (const [city, list] of byCity) {
    const names = new Set(list.map((s) => s.name.toLowerCase()));
    if (list.length >= 2 && names.size >= 2) {
      out[city] = [...new Set(list.map((s) => s.code))];
    }
  }
  return out;
}

/** Bare city names that must not collapse to one station. */
export const CLUSTER_CITY_CODES: Record<string, string[]> = clustersFromCatalog();

export function canonicalClusterCity(raw: string): string | null {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return null;
  const mapped = CITY_NAME_ALIASES[q] ?? q;
  return CLUSTER_CITY_CODES[mapped] ? mapped : null;
}

export function isClusterCityName(raw: string): boolean {
  return Boolean(canonicalClusterCity(raw));
}

export function clusterStations(raw: string): Station[] {
  const city = canonicalClusterCity(raw);
  const codes = city ? CLUSTER_CITY_CODES[city] ?? [] : [];
  return codes.map((c) => stationByCode(c)).filter((s): s is Station => Boolean(s));
}

export function clusterStationsForText(text: string): { city: string; stations: Station[] } | null {
  const t = text.toLowerCase();
  const keys = [...Object.keys(CLUSTER_CITY_CODES), ...Object.keys(CITY_NAME_ALIASES)].sort(
    (a, b) => b.length - a.length,
  );
  for (const key of keys) {
    if (!tokenInText(key, t)) continue;
    const stations = clusterStations(key);
    if (stations.length >= 2) return { city: stations[0].city, stations };
  }
  return null;
}

export function isStationChoiceQuestion(text: string): boolean {
  const t = text.toLowerCase();
  if (/sirf .{2,48}(kyu|kyun|kya|dikha|dikhata|dikh|show)/.test(t)) return true;
  if (/(kyun|kyu|why).{0,24}(sirf|only|dikha)/.test(t) && clusterStationsForText(text)) return true;
  if (/kaunsa station|which station|konsa station|kaun se station/.test(t) && clusterStationsForText(text)) {
    return true;
  }
  return false;
}

function tokenInText(token: string, text: string): boolean {
  const t = text.toLowerCase();
  const k = token.trim().toLowerCase();
  if (!k) return false;
  let from = 0;
  while (from <= t.length) {
    const idx = t.indexOf(k, from);
    if (idx < 0) return false;
    const before = t[idx - 1] ?? "";
    const after = t[idx + k.length] ?? "";
    const latin = /[a-z]/i.test(k);
    const ok = latin
      ? !/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)
      : !/\p{L}/u.test(before) && !/\p{L}/u.test(after);
    if (ok) return true;
    from = idx + 1;
  }
  return false;
}

/** True only if the spoken text actually contains this station (not ludhiana26 → LDH). */
export function stationGroundedInText(st: Station, text: string): boolean {
  const keys = [st.code, st.city, st.name];
  for (const [alias, code] of Object.entries(ALIASES)) {
    if (code === st.code) keys.push(alias);
  }
  return keys.some((k) => tokenInText(k, text));
}

/** Reject mashed junk like "ludhiana26" — must not fuzzy-match Ludhiana. */
export function isGarbageStationQuery(raw: string): boolean {
  const q = raw.trim();
  if (!q) return false;
  if (/^[A-Za-z0-9]{2,5}$/.test(q)) return false;
  const compact = q.split(/\s+/).length <= 3 ? q : q.split(/\s+/)[0];
  if (/[A-Za-z]{3,}\d|\d[A-Za-z]{3,}/.test(compact)) return true;
  if (/[A-Za-z]{3,}\d|\d[A-Za-z]{3,}/.test(q) && q.split(/\s+/).length <= 3) return true;
  return false;
}

export function matchStation(raw: string): Station | undefined {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q || isGarbageStationQuery(q)) return undefined;
  if (isClusterCityName(q)) return undefined;
  const alias = ALIASES[q];
  if (alias) return stationByCode(alias);
  const exact = CLIENT_STATIONS.find(
    (s) =>
      s.code.toLowerCase() === q ||
      s.city.toLowerCase() === q ||
      s.name.toLowerCase() === q,
  );
  if (exact) return exact;
  if (/[a-z]/i.test(q) && q.length < 3) return undefined;
  // Prefix only (ludhia → Ludhiana). Never "query includes city" — that matched ludhiana26.
  if (q.length >= 4) {
    return CLIENT_STATIONS.find(
      (s) =>
        s.city.toLowerCase().startsWith(q) ||
        s.name.toLowerCase().startsWith(q) ||
        s.code.toLowerCase() === q,
    );
  }
  return undefined;
}

const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

/** Unicode-safe scan — JS word boundaries do not work on Devanagari. */
export function findStationsInText(text: string): Station[] {
  const t = text.toLowerCase();
  const hits: { idx: number; st: Station }[] = [];
  const seen = new Set<string>();
  for (const key of ALIAS_KEYS) {
    const idx = t.indexOf(key);
    if (idx < 0) continue;
    const before = t[idx - 1] ?? "";
    const after = t[idx + key.length] ?? "";
    const latin = /[a-z]/i.test(key);
    const ok = latin
      ? !/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)
      : !/\p{L}/u.test(before) && !/\p{L}/u.test(after);
    if (!ok) continue;
    const st = stationByCode(ALIASES[key]);
    if (st && !seen.has(st.code)) {
      seen.add(st.code);
      hits.push({ idx, st });
    }
  }
  return hits.sort((a, b) => a.idx - b.idx).map((h) => h.st);
}

export const STATION_NAME_RE = new RegExp(
  ALIAS_KEYS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "ig",
);
