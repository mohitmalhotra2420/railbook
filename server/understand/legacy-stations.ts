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
  /* Round-16n: "old delhi" / "purani dilli" = Delhi Junction (DLI), NDLS nahi. */
  "old delhi": "DLI",
  "purani dilli": "DLI",
  "purani delhi": "DLI",
  "delhi junction": "DLI",
  "delhi jn": "DLI",
  "पुरानी दिल्ली": "DLI",
  dli: "DLI",
  amritsar: "ASR",
  asr: "ASR",
  ambarsar: "ASR",
  अमृतसर: "ASR",
  अम्रितसर: "ASR",
  अम्रीतसर: "ASR",
  ludhiana: "LDH",
  ldh: "LDH",
  ludiyana: "LDH",
  ludhiyana: "LDH",
  luddiyana: "LDH",
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
  /* Round-29 (26 Sep, user: "vaishno devi" se station parse nahi hua jab tak poora
   * "Shri Mata Vaishno Devi Katra" na likha jaye): teerth ke chhote/partial naam bhi kaafi hain —
   * sab SVDK hi hain (koi naya code/naam invent nahi). */
  "vaishno devi": "SVDK",
  "vaishno devi katra": "SVDK",
  vaishnodevi: "SVDK",
  "vishno devi": "SVDK",
  "mata vaishno devi": "SVDK",
  "shri mata vaishno devi": "SVDK",
  "shri mata vaishno devi katra": "SVDK",
  "smvd katra": "SVDK",
  "smvd katra station": "SVDK",
  "वैष्णो देवी": "SVDK",
  "वैष्णो देवी कटरा": "SVDK",
  वैष्णोदेवी: "SVDK",
  "माता वैष्णो देवी": "SVDK",
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

/* ── Round-12 (2026-09-07, user request: "ChatGPT galat spelling bhi samajh
 * leta hai — mera AI kyun nahi?"): spelling-tolerant station match.
 * "ludiyana"→LDH, "chandigardh"→CDG, "amratsar"→ASR — Levenshtein distance
 * se. Guards (andaza NAHI, sirf pakka match):
 *  - latin query >= 4 chars; max distance 1 (len 4-7) / 2 (len >= 8)
 *  - CLUSTER city (delhi/agra/…) fuzzy NAHI — ambiguity ka jawab options
 *    list hota hai, guess nahi
 *  - best match UNIQUE ho (do stations barabar door → undefined) */
function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

type FuzzTarget = { key: string; st: Station };
const FUZZ_TARGETS: FuzzTarget[] = [
  ...CLIENT_STATIONS.flatMap((s) => [
    { key: s.city.toLowerCase(), st: s },
    { key: s.name.toLowerCase().replace(/ junction$| cantt$| city$| road$| terminal$| central$| jn$/g, ""), st: s },
  ]),
  ...Object.entries(ALIASES)
    .filter(([k]) => /^[a-z][a-z ]{3,}$/.test(k) || /^[\u0900-\u097F][\u0900-\u097F ]{3,}$/.test(k))
    .map(([k, v]) => ({ key: k, st: stationByCode(v) }))
    .filter((x): x is FuzzTarget => Boolean(x.st)),
];

/* Round-18m-11: asli alag shehar jo local list mein nahi — fuzzy inhe kisi
 * milte-julte naam (raipur→jaipur, prayagraj→?) se NAHI jodega; provider lookup
 * karega ya options poochega. */
const DISTINCT_CITIES = new Set([
  "raipur", "prayagraj", "allahabad", "prayag", "rajkot", "udaipur", "jodhpur", "madurai", "guwahati", "ranchi", "patna", "surat", "indore", "bhopal",
  "kota", "ajmer", "bikaner", "rishikesh", "shimla", "kanpur", "mathura", "gwalior", "jhansi", "bareilly", "moradabad", "aligarh", "ayodhya", "faizabad",
  "panipat", "karnal", "kurukshetra", "rohtak", "hisar", "pathankot", "jalandhar", "firozpur", "sirsa", "meerut", "muzaffarnagar", "roorkee", "haldwani",
  "kathgodam", "lucknow", "varanasi", "banaras", "gaya", "dhanbad", "asansol", "durgapur", "bilaspur", "jabalpur", "ujjain", "ratlam", "vadodara", "baroda",
  "rajahmundry", "vijayawada", "warangal", "nanded", "solapur", "kolhapur", "belgaum", "hubli", "mysore", "mysuru", "mangalore", "mangaluru", "kochi", "ernakulam",
  "thrissur", "kozhikode", "calicut", "kannur", "trivandrum", "thiruvananthapuram", "coimbatore", "salem", "erode", "trichy", "tiruchirappalli", "tirupati", "nellore",
  "guntur", "puri", "cuttack", "bhubaneswar", "sambalpur", "rourkela", "siliguri", "malda", "agartala", "dibrugarh", "jorhat", "silchar", "imphal", "dimapur",
  "jaipur", "jammu", "katra", "udhampur", "amritsar", "ludhiana", "chandigarh", "haridwar", "dehradun", "gorakhpur", "nagpur", "pune", "goa", "madgaon", "vasco",
]);

export function matchStationFuzzy(raw: string): Station | undefined {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (DISTINCT_CITIES.has(q) && !FUZZ_TARGETS.some((t) => t.key === q)) return undefined;
  /* Devanagari (Round-12b): matra-typos ("लुधिआना", "चंडीगढ") bhi —
   * Devanagari words codepoints mein lambe hote hain, min 6 ka guard
   * short Hindi words ("क्या") ke false-positive rokta hai. */
  const deva = /^[\u0900-\u097F][\u0900-\u097F ]+$/.test(q);
  if (deva) {
    if (q.length < 6) return undefined;
  } else if (q.length < 4 || !/^[a-z][a-z ]+$/.test(q)) {
    return undefined;
  }
  if (CLUSTER_CITIES.has(q)) return undefined;
  /* Devanagari: nukta/matra variance (आ vs ा) common — hamesha 2 ki
   * chhut (latin ke 1-2 ke bajaye). */
  const max = deva ? 2 : q.length >= 8 ? 2 : 1;
  let bestD = max + 1;
  let bestSt: Station | undefined;
  const hits = new Set<string>();
  for (const { key, st } of FUZZ_TARGETS) {
    if (key.length < 4 || CLUSTER_CITIES.has(key)) continue;
    const d = lev(q, key);
    if (d > max) continue;
    if (d < bestD) {
      bestD = d;
      bestSt = st;
      hits.clear();
      hits.add(st.code);
    } else if (d === bestD) {
      hits.add(st.code);
    }
  }
  if (!bestSt || hits.size !== 1) return undefined;
  return bestSt;
}

/**
 * Round-51/52 (29 Sep 2026) — Hinglish sawaalon me station ke aas-paas filler shabd hote hain
 * ("Yaar LDH se SVDK ke liye kal…", "bhai ldh", "kal katra"). Station ka naam dhoondhne se pehle ye
 * shabd hata diye jaate hain; station wala hissa bachne par hi match hota hai — aur agar koi AJANAB
 * shabd bacha ho (jaise "delhi airport" ka "airport") to match NAHI hota (provider/choice-flow ka kaam,
 * andaza nahi).
 */
const PHRASE_FILLERS = new Set([
  "yaar", "yar", "bhai", "bhaiya", "bro", "dost", "please", "pls", "plz", "zara", "na", "naa", "ya",
  "mujhe", "muje", "main", "mai", "mera", "meri", "mere", "hum", "hume", "humko", "apna", "aap",
  "kal", "aaj", "aj", "parso", "parson", "today", "tomorrow", "kalke", "kalh",
  "se", "ka", "ki", "ke", "ko", "lie", "liye", "liy", "ke liye", "tak", "taraf", "towards",
  "find", "out", "karke", "karo", "kardo", "kar", "krdo", "krke", "do", "de", "dena", "dijiye",
  "batao", "bata", "bataiye", "btado", "batana", "chahiye", "chahta", "chahti", "jana", "jaana",
  "jaunga", "jaungi", "travel", "jana hai", "hai", "hain", "ho", "kya", "kaun", "kaunsi", "konsi",
  "train", "trains", "gaadi", "ticket", "tickets", "seat", "seats", "berth", "confirm", "confirmed",
  "availability", "available", "khali", "khaali", "wala", "wali", "wal", "ka", "aur", "and", "to",
  "from", "the", "for", "at", "in", "of", "morning", "evening", "night", "raat", "subah", "dopahar",
  /* station qualifiers — ye station ke SAATH aate hain (Agra Cantt / Mathura Jn) */
  "jn", "jct", "junction", "cantt", "cantonment", "city", "road", "terminal", "central", "halt",
  "station", "stn", "smvd", "jammu", "tawi",
]);

const CLUSTER_CITIES = new Set([
  "ambala", "अंबाला", "अम्बाला",
  "delhi", "dilli", "दिल्ली", "दिल्ही",
  "mumbai", "bombay", "मुंबई", "मुम्बई", "बंबई",
  "kolkata", "calcutta", "कोलकाता",
  "hyderabad", "हैदराबाद",
  "jalandhar", "jullundur", "जालंधर", "जालन्धर", "जालन्दर", "जलंधर", "जलांधर", "जलंदर",
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
  /* Round-18m-11 (user bug: "prayagraj" → AGC kyunki "pr-agra-j" mein "agra"
   * substring tha): city sirf POORE WORD ke roop mein match ho — "agra cantt
   * se" theek, "prayagraj"/"nagra" galat. Word-boundary Unicode-safe. */
  const hasWord = (hay: string, word: string): boolean => {
    let i = hay.indexOf(word);
    while (i >= 0) {
      const before = hay[i - 1] ?? "";
      const after = hay[i + word.length] ?? "";
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
      i = hay.indexOf(word, i + 1);
    }
    return false;
  };
  /* NLU ke lambe tails ("Delhi Saturday ko 2 passengers ke liye…") ke liye purana loose city-word
   * match waise hi — ye NLU ka kaam hai (from/to nikaalna), aur galat jagahon ("delhi airport") ki
   * rok TOOLS me hai (matchStationStrict — dekho neeche). */
  const byCityWord = CLIENT_STATIONS.find((st) => st.city.toLowerCase() === q || hasWord(q, st.city.toLowerCase()));
  if (byCityWord) return byCityWord;
  return stationWordInPhrase(q);
}

/**
 * Round-52 (tool-path ke liye sakht version): sirf wahi match jo sach me station ka naam ho.
 *  - cluster city (delhi/mumbai…) → undefined (choice-flow ka kaam),
 *  - exact code/naam/city/alias,
 *  - phrase: bache shabd (filler hatane ke baad) 1-2 aur wahi station — "Yaar Ldh" ✓, "Delhi airport" ✗,
 *  - spelling-tolerant fuzzy sirf usi chhote phrase par.
 * Tools (SEARCH_TRAINS/JOURNEY_ANALYZE/FIND_SEATS) isi ko use karte hain — warna "Delhi airport" jaisa
 * ajanab phrase chup-chaap NDLS ban jaata tha (aur user ka galat station search hota tha).
 */
export function matchStationStrict(raw: string): Station | undefined {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return undefined;
  if (CLUSTER_CITIES.has(q)) return undefined;
  const alias = ALIASES[q];
  if (alias) return stationByCode(alias);
  const exact = CLIENT_STATIONS.find(
    (s) => s.code.toLowerCase() === q || s.city.toLowerCase() === q || s.name.toLowerCase() === q,
  );
  if (exact) return exact;
  const leftovers = q.split(" ").filter(Boolean).filter((w) => !PHRASE_FILLERS.has(w));
  if (!leftovers.length || leftovers.length > 2) return undefined;
  const phrase = leftovers.join(" ");
  if (CLUSTER_CITIES.has(phrase)) return undefined;
  const pAlias = ALIASES[phrase];
  if (pAlias) return stationByCode(pAlias);
  const pExact = CLIENT_STATIONS.find(
    (s) => s.code.toLowerCase() === phrase || s.city.toLowerCase() === phrase || s.name.toLowerCase() === phrase,
  );
  if (pExact) return pExact;
  if (leftovers.length === 1) {
    const fuzzy = matchStationFuzzy(phrase);
    if (fuzzy) return fuzzy;
  }
  return undefined;
}

/**
 * Round-51 (user screenshot 11:10: `"Yaar Ldh" ke liye exact station chahiye` — jabki "Ldh" = LDH):
 * user apni baat aise likhta hai — "yaar LDH se SVDK…", "bhai ldh", "kal ldh". Poore phrase par
 * exact/word match fail ho jaata tha, isliye poora phrase hi "unresolved station" ban jaata tha aur
 * app station poochhne lagta tha (purane builds me model isse samajh jaata tha).
 *
 * Yahan phrase ke andar ka **saaf station word** dekha jaata hai — par sirf tab jab ek hi station
 * nikle (poora route likha ho — "ldh se svdk" — to yahan se kuch nahi; wo from/to parser ka kaam
 * hai) aur koi cluster-city (delhi/mumbai/… jo clarification maangti hain) na ho. Alias/code list se
 * hi match hota hai, isliye "kal"/"yaar"/"se" jaise shabd station ban hi nahi sakte.
 */
function stationWordInPhrase(q: string): Station | undefined {
  if (!q.includes(" ")) return undefined;
  /* Pehle filler hata kar dekho — "Yaar Ldh"/"bhai ldh"/"kal katra" seedha yahin resolve ho jaate hain. */
  const leftovers = q.split(" ").filter(Boolean).filter((w) => !PHRASE_FILLERS.has(w));
  if (leftovers.length && leftovers.length <= 2) {
    const phrase = leftovers.join(" ");
    const pAlias = ALIASES[phrase];
    if (pAlias) return stationByCode(pAlias);
    const pExact = CLIENT_STATIONS.find(
      (s) => s.code.toLowerCase() === phrase || s.city.toLowerCase() === phrase || s.name.toLowerCase() === phrase,
    );
    if (pExact) return pExact;
  }
  const hits = findStationsInText(q);
  if (!hits.length) return undefined;
  /* Cluster-city (delhi/mumbai/kolkata…) ke station yahan se NAHI aate — unka sahi jawab options/
   * choice-flow hai, aur "delhi airport" jaise phrase ko NDLS maan lena galat hota hai. Check naam
   * aur city dono par, word-wise (NDLS = "New Delhi"/Delhi, HWH = "Howrah"/Kolkata …). */
  const clusterWord = (v: string | undefined): boolean =>
    String(v ?? "")
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .some((w) => w && CLUSTER_CITIES.has(w));
  if (hits.some((st) => clusterWord(st.city) || clusterWord(st.name))) return undefined;
  const codes = [...new Set(hits.map((st) => st.code))];
  if (codes.length !== 1) return undefined;
  return stationByCode(codes[0]);
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
