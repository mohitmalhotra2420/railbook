import type { ClassCode } from "../types";
import { collapseRepeatWords } from "./speech";

const LETTER: Record<string, string> = {
  ए: "A",
  बी: "B",
  सी: "C",
  डी: "D",
  ई: "E",
  एफ: "F",
  जी: "G",
  एच: "H",
  आई: "I",
  जे: "J",
  के: "K",
  एल: "L",
  एम: "M",
  एन: "N",
  ओ: "O",
  पी: "P",
  क्यू: "Q",
  आर: "R",
  एस: "S",
  टी: "T",
  यू: "U",
  वी: "V",
  डब्ल्यू: "W",
  एक्स: "X",
  वाई: "Y",
  जेड: "Z",
  थ्री: "3",
  तीन: "3",
  टू: "2",
  दो: "2",
  वन: "1",
  एक: "1",
  फर्स्ट: "1",
  सेकंड: "2",
  थर्ड: "3",
};

/** Map "एस एल" / spelled sleeper to a class hint the NLU already knows. */
export function normalizeSpokenClass(text: string): string {
  const code = resolveSpokenClass(text);
  if (code) return code;
  const collapsed = collapseRepeatWords(text);
  const parts = collapsed.split(/\s+/).filter(Boolean);
  const mapped = parts.map((p) => LETTER[p] ?? p);
  const compact = mapped.join("").replace(/\s+/g, "").toUpperCase();
  if (/SLE+P+E*R/.test(compact) || compact.includes("SLEEPER") || compact.includes("SLIPER")) {
    return "sleeper";
  }
  if (/^S+L+$/.test(compact) || compact === "SL") return "SL";
  if (/^C+C+$/.test(compact) || compact === "CC") return "CC";
  if (/^E+C+$/.test(compact) || compact === "EC") return "EC";
  if (compact.includes("3A") || compact === "3AC" || /^B+$/.test(compact)) return "3A";
  if (compact.includes("2A") || compact === "2AC") return "2A";
  if (compact.includes("1A") || compact === "1AC") return "1A";
  if (compact.includes("3E")) return "3E";
  if (compact.includes("2S")) return "2S";
  return collapsed;
}

function foldClass(text: string): string {
  return collapseRepeatWords(text)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[०-९]/g, (ch) => String("०१२३४५६७८९".indexOf(ch)))
    .replace(/ए\s*सी|एसी|a\s*c\b/gi, " ac ")
    .replace(/थ्री|तीन|third|3rd/gi, " 3 ")
    .replace(/टू|दो|second|2nd/gi, " 2 ")
    .replace(/वन|एक|first|1st|फर्स्ट/gi, " 1 ")
    .replace(/टियर|tier/gi, " tier ")
    .replace(/इकोनॉमी|इकोनॉमि|economy/gi, " economy ")
    .replace(/स्लीपर|sleepers?|sliper/gi, " sleeper ")
    .replace(/चेयर\s*कार|chair\s*car/gi, " chaircar ")
    .replace(/एग्जीक्यूटिव|एग्जिक्यूटिव|executive/gi, " executive ")
    .replace(/सिटिंग|sitting/gi, " sitting ")
    .replace(/जनरल|general|अनारक्षित|unreserved/gi, " general ")
    .replace(/[?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CLASS_PATTERNS: Array<{ code: ClassCode; re: RegExp }> = [
  { code: "3E", re: /\b(3\s*e|3e|ac\s*3\s*e|3\s*ac\s*e|economy|3\s*tier\s*eco)/i },
  { code: "1A", re: /\b(1\s*a\s*c?|1a|1ac|ac\s*1|first\s*(ac|class)|ac\s*first)\b/i },
  { code: "2A", re: /\b(2\s*a\s*c?|2a|2ac|ac\s*2|second\s*ac|ac\s*2\s*tier|2\s*tier)\b/i },
  { code: "3A", re: /\b(3\s*a\s*c?|3a|3ac|ac\s*3|third\s*ac|ac\s*3\s*tier|3\s*tier)\b/i },
  { code: "EC", re: /\b(ec|executive)\b/i },
  { code: "CC", re: /\b(cc|chaircar|chair)\b/i },
  { code: "SL", re: /\b(sl|sleeper)\b/i },
  { code: "2S", re: /\b(2\s*s|2s|second\s*sitting|sitting|general|ur|gs)\b/i },
  { code: "EA", re: /\b(ea|anubhuti)\b/i },
];

/** Resolve a spoken/typed class to an IRCTC class code. Lone "3" → 3A. */
export function resolveSpokenClass(text: string): ClassCode | undefined {
  const folded = foldClass(text);
  if (!folded) return undefined;
  const compact = folded.replace(/\s+/g, "");
  if (/^(3|३)$/.test(folded) || compact === "3") return "3A";
  if (/^(2|२)$/.test(folded) || compact === "2") return "2A";
  if (/^(1|१)$/.test(folded) || compact === "1") return "1A";
  for (const row of CLASS_PATTERNS) {
    if (row.re.test(folded) || row.re.test(compact)) return row.code;
  }
  const parts = folded.split(/\s+/).map((p) => LETTER[p] ?? p);
  const spelled = parts.join("").replace(/\s+/g, "").toUpperCase();
  if (/3AC|3A/.test(spelled)) return "3A";
  if (/2AC|2A/.test(spelled)) return "2A";
  if (/1AC|1A/.test(spelled)) return "1A";
  if (/3E/.test(spelled)) return "3E";
  if (/^SL+$/.test(spelled) || spelled === "SL") return "SL";
  if (/SLEEPER|SLIPER/.test(spelled)) return "SL";
  if (/^CC+$/.test(spelled) || spelled === "CC") return "CC";
  if (/^EC+$/.test(spelled) || spelled === "EC") return "EC";
  if (/2S/.test(spelled)) return "2S";
  return undefined;
}
