import type { Station } from "../providers/types.js";

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
  delhi: "NDLS",
  dilli: "NDLS",
  "new delhi": "NDLS",
  "nayi dilli": "NDLS",
  ndls: "NDLS",
  दिल्ली: "NDLS",
  "नई दिल्ली": "NDLS",
  "नयी दिल्ली": "NDLS",
  दिल्ही: "NDLS",
  amritsar: "ASR",
  asr: "ASR",
  ambarsar: "ASR",
  अमृतसर: "ASR",
  अम्रितसर: "ASR",
  ludhiana: "LDH",
  ldh: "LDH",
  लुधियाना: "LDH",
  jalandhar: "JUC",
  jullundur: "JUC",
  जालंधर: "JUC",
  जालन्धर: "JUC",
  chandigarh: "CDG",
  chd: "CDG",
  चंडीगढ़: "CDG",
  चण्डीगढ़: "CDG",
  "ambala cantt": "UMB",
  "ambala cant": "UMB",
  umb: "UMB",
  "ambala city": "UBC",
  ubc: "UBC",
  mumbai: "BCT",
  bombay: "BCT",
  "mumbai central": "BCT",
  मुंबई: "BCT",
  बंबई: "BCT",
  howrah: "HWH",
  kolkata: "HWH",
  calcutta: "HWH",
  कोलकाता: "HWH",
  हावड़ा: "HWH",
  jaipur: "JP",
  जयपुर: "JP",
  lucknow: "LKO",
  लखनऊ: "LKO",
  kanpur: "CNB",
  कानपुर: "CNB",
  patna: "PNBE",
  पटना: "PNBE",
  chennai: "MAS",
  madras: "MAS",
  चेन्नई: "MAS",
  bengaluru: "SBC",
  bangalore: "SBC",
  बेंगलुरु: "SBC",
  बंगलौर: "SBC",
  hyderabad: "HYB",
  हैदराबाद: "HYB",
  pune: "PUNE",
  पुणे: "PUNE",
  agra: "AGC",
  आगरा: "AGC",
  jammu: "JAT",
  जम्मू: "JAT",
  beas: "BEAS",
  बीआस: "BEAS",
  बिआस: "BEAS",
  katra: "SVDK",
  कटरा: "SVDK",
  ahmedabad: "ADI",
  अहमदाबाद: "ADI",
  bhopal: "BPL",
  भोपाल: "BPL",
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

const CLUSTER_CITIES = new Set([
  "ambala", "अंबाला", "अम्बाला",
  "delhi", "dilli", "दिल्ली", "दिल्ही",
  "mumbai", "bombay", "मुंबई", "बंबई",
  "kolkata", "calcutta", "कोलकाता",
  "hyderabad", "हैदराबाद",
  "jalandhar", "jullundur", "जालंधर", "जालन्धर",
  "lucknow", "लखनऊ",
  "kanpur", "कानपुर",
  "agra", "आगरा",
  "chennai", "madras", "चेन्नई",
  "bengaluru", "bangalore", "बेंगलुरु", "बंगलौर",
  "bhopal", "भोपाल",
  "patna", "पटना",
  "firozpur", "ferozepur", "फिरोजपुर",
  "pathankot", "पठानकोट",
  "thiruvananthapuram", "trivandrum",
  "kochi", "cochin", "ernakulam", "कोच्चि",
]);

export function matchStation(raw: string): Station | undefined {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return undefined;
  if (CLUSTER_CITIES.has(q)) return undefined;
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
  return CLIENT_STATIONS.find(
    (s) => s.city.toLowerCase() === q || q.includes(s.city.toLowerCase()),
  );
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
