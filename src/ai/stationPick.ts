import type { Station } from "../types";

/** Spoken names that map to a real IRCTC code. Only used if that code is already in the offered list. */
const CODE_ALIASES: Record<string, string[]> = {
  NDLS: [
    "ndls",
    "new delhi",
    "newdelhi",
    "nayi dilli",
    "nayi delhi",
    "naya delhi",
    "न्यू दिल्ली",
    "न्यूदिल्लि",
    "नई दिल्ली",
    "नयी दिल्ली",
    "नू दिल्ली",
  ],
  DLI: [
    "dli",
    "delhi junction",
    "old delhi",
    "purani dilli",
    "दिल्ली जंक्शन",
    "दिल्ली जंक्सन",
    "पुरानी दिल्ली",
    "पुरानी दिल्ली",
  ],
  DEC: [
    "dec",
    "delhi cantt",
    "delhi cant",
    "delhi cantonment",
    "cantt",
    "cant",
    "दिल्ली कैंट",
    "दिल्ली कैन्ट",
    "दिल्ली कैंट्ट",
    "कैंट",
    "कैन्ट",
  ],
  DEE: [
    "dee",
    "delhi sarai rohilla",
    "sarai rohilla",
    "rohilla",
    "दिल्ली सराय रोहिल्ला",
    "सराय रोहिल्ला",
    "रोहिल्ला",
  ],
  NZM: ["nzm", "nizamuddin", "hazrat nizamuddin", "निजामुद्दीन", "हजरत निजामुद्दीन"],
  ANVT: ["anvt", "anand vihar", "anand vihar terminal", "आनंद विहार"],
  UMB: ["umb", "ambala cantt", "ambala cant", "ambala cantonment", "ambala junction", "अंबाला कैंट", "अम्बाला कैंट"],
  UBC: ["ubc", "ambala city", "अंबाला सिटी", "अम्बाला सिटी"],
  LKO: ["lko", "lucknow nr", "lucknow charbagh", "charbagh", "लखनऊ एनआर"],
  LJN: ["ljn", "lucknow junction", "lucknow ner", "lucknow jn", "लखनऊ जंक्शन"],
};

function fold(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/कैन्ट+|कैंट+|कैण्ट+/g, "cantt")
    .replace(/न्यू/g, "new")
    .replace(/नई|नयी/g, "nayi")
    .replace(/जंक्शन|जंक्सन/g, "junction")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(s: string): string {
  return fold(s).replace(/\s+/g, "");
}

/** Pick one of the stations already shown as chips. Never invents a new station. */
export function matchOfferedStation(text: string, offered: Station[]): Station | undefined {
  if (!offered.length) return undefined;
  const q = fold(text);
  if (!q) return undefined;
  const qc = compact(text);

  const exactCode = offered.find((s) => s.code.toLowerCase() === q || s.code.toLowerCase() === qc);
  if (exactCode) return exactCode;

  const exactName = offered.find((s) => {
    const n = fold(s.name);
    const c = fold(s.city);
    return n === q || compact(s.name) === qc || (c && c === q && offered.filter((x) => fold(x.city) === q).length === 1);
  });
  if (exactName) return exactName;

  const aliasHits: Station[] = [];
  for (const s of offered) {
    const keys = CODE_ALIASES[s.code.toUpperCase()] ?? [];
    if (keys.some((k) => fold(k) === q || compact(k) === qc)) aliasHits.push(s);
  }
  if (aliasHits.length === 1) return aliasHits[0];

  const contains: Station[] = [];
  for (const s of offered) {
    const keys = [s.code, s.name, ...(CODE_ALIASES[s.code.toUpperCase()] ?? [])].map(fold);
    if (keys.some((k) => k.length >= 3 && (q.includes(k) || k.includes(q)))) contains.push(s);
  }
  const unique = [...new Map(contains.map((s) => [s.code, s])).values()];
  if (unique.length === 1) return unique[0];
  return undefined;
}
