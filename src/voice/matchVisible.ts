import type { ClassAvailability, ClassCode, TrainResult } from "../types";
import { resolveSpokenClass } from "./spokenClass";
import { collapseRepeatWords } from "./speech";

const FILLER =
  /\b(select|सिलेक्ट|kro|karo|kar do|kardo|wali|wala|yeh|this|that|class|berth|seat|preference|chahiye|please|train|express|ko|ki|ke|ka|the|naam|number|gaadi|gadi|वाली|ट्रेन|ट्रेस|ट्रांस|गाड़ी|गाडी)\b/gi;

const HI: Array<[RegExp, string]> = [
  [/स्लीपर/g, " sleeper "],
  [/थ्री\s*ए\s*सी|थ्री\s*एसी|थ्रीएसी|3\s*ए\s*सी|3\s*एसी/g, " 3ac "],
  [/टू\s*ए\s*सी|टू\s*एसी|2\s*एसी/g, " 2ac "],
  [/फर्स्ट\s*एसी|1\s*एसी/g, " 1ac "],
  [/एसी\s*थ्री\s*टियर|एसी\s*थ्री|एसी\s*3/g, " 3ac "],
  [/एसी\s*टू\s*टियर|एसी\s*टू|एसी\s*2/g, " 2ac "],
  [/इकोनॉमी|इकोनॉमि/g, " economy "],
  [/चेयर\s*कार/g, " cc "],
  [/एग्जीक्यूटिव|एग्जिक्यूटिव/g, " executive "],
  [/सेकंड\s*सिटिंग/g, " 2s "],
  [/जनरल|अनारक्षित/g, " general "],
  [/एक्सप्रेस|एक्स्प्रेस/g, " express "],
  [/जन\s*शताब्दी|जनशताब्दी|जनसतब्दी/g, " janshatabdi "],
  [/शताब्दी|शतब्दी|शताब्दि/g, " shatabdi "],
  [/राजधानी/g, " rajdhani "],
  [/दुरंतो|दुरन्तो/g, " duronto "],
  [/हमसफर/g, " humsafar "],
  [/गरीब\s*रथ/g, " garibrath "],
  [/सुपरफास्ट|सुपर\s*फास्ट/g, " superfast "],
  [/इंटरसिटी|इन्टरसिटी/g, " intercity "],
  [/वंदे|वन्दे/g, " vande "],
  [/भारत/g, " bharat "],
  [/न्यू|नया|नयी/g, " new "],
  [/शक्ति/g, " shakti "],
  [/मालवा/g, " malwa "],
  [/हरिद्वार|हरिद्वर/g, " haridwar "],
  [/देहरादून|देहरादुन/g, " dehradun "],
  [/अमृतसर/g, " amritsar "],
  [/जम्मू|जम्मु/g, " jammu "],
  [/लुधियाना/g, " ludhiana "],
  [/दिल्ली/g, " delhi "],
  [/लोअर|नीचे वाली|नीचे/g, " lower "],
  [/अपर|ऊपर वाली|ऊपर/g, " upper "],
  [/मिडिल|बीच वाली|बीच/g, " middle "],
  [/साइड\s*लोअर/g, " side lower "],
  [/साइड\s*अपर/g, " side upper "],
  [/विंडो|खिड़की/g, " window "],
  [/आइल|aisle/g, " aisle "],
  [/कूपे|कूप|coupe|koopay|koope/g, " coupe "],
  [/केबिन|cabin|kebin/g, " cabin "],
];

export function foldVoice(text: string): string {
  let t = collapseRepeatWords(text).toLowerCase().normalize("NFKC");
  for (const [re, to] of HI) t = t.replace(re, to);
  t = t.replace(FILLER, " ");
  t = t.replace(/[^a-z0-9\u0900-\u097f ]+/g, " ");
  t = t
    .replace(/\bshtabdi\b/g, "shatabdi")
    .replace(/\bshatabdhi\b/g, "shatabdi")
    .replace(/\bshatabadi\b/g, "shatabdi")
    .replace(/\bsatabdi\b/g, "shatabdi")
    .replace(/\bshatabd\b/g, "shatabdi")
    .replace(/\bexp(ress|res)?\b/g, "express")
    .replace(/\bjn\b/g, "junction")
    .replace(/\bmail\b/g, "mail");
  return t.replace(/\s+/g, " ").trim();
}

function editDist(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function tokenHit(speech: string, token: string): boolean {
  if (!token || token.length < 2) return false;
  if (speech.includes(token) || token.includes(speech)) return true;
  if (token.length >= 5) {
    for (const w of speech.split(" ").filter((x) => x.length >= 4)) {
      if (editDist(w, token) <= 2) return true;
    }
  }
  return false;
}

function contains(hay: string, needle: string): boolean {
  if (!needle || needle.length < 2) return false;
  return hay === needle || hay.includes(needle) || needle.includes(hay);
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

export function matchTrainBySpeech(speech: string, trains: TrainResult[]): TrainResult | undefined {
  const s = foldVoice(speech);
  const byNum = speech.match(/\b(\d{5})\b/)?.[1];
  if (byNum) {
    const hit = trains.find((t) => t.number === byNum);
    if (hit) return hit;
  }
  if (!s) return undefined;
  const sCompact = compact(s);
  let best: TrainResult | undefined;
  let bestScore = 0;
  let second = 0;
  for (const t of trains) {
    const name = foldVoice(t.name);
    const bits = name.split(" ").filter((w) => w.length >= 3);
    const nCompact = compact(name);
    let score = 0;
    if (contains(s, name) || contains(name, s)) score += 5;
    if (sCompact.length >= 5 && (nCompact.includes(sCompact) || sCompact.includes(nCompact))) score += 5;
    for (const b of bits) {
      if (s.includes(b) || sCompact.includes(b)) score += b.length >= 6 ? 3 : 2;
    }
    if (s.includes(t.number) || speech.includes(t.number)) score += 6;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = t;
    } else if (score > second) {
      second = score;
    }
  }
  if (bestScore < 2) return undefined;
  if (second === bestScore) return undefined;
  return best;
}

const CLASS_HINTS: Array<{ code: ClassCode; keys: string[] }> = [
  { code: "SL", keys: ["sl", "sleeper", "sleepers", "sliper"] },
  { code: "3A", keys: ["3a", "3ac", "3 ac", "ac 3", "third ac", "ac 3 tier", "ac3"] },
  { code: "2A", keys: ["2a", "2ac", "2 ac", "ac 2", "second ac", "ac 2 tier", "ac2"] },
  { code: "1A", keys: ["1a", "1ac", "1 ac", "ac 1", "first ac", "ac first", "ac1"] },
  { code: "3E", keys: ["3e", "3 e", "economy"] },
  { code: "CC", keys: ["cc", "chair car", "chair"] },
  { code: "EC", keys: ["ec", "executive"] },
  { code: "2S", keys: ["2s", "second sitting", "general"] },
  { code: "EA", keys: ["ea", "anubhuti"] },
];

function pickCode(code: ClassCode, classes: ClassAvailability[]): ClassAvailability | undefined {
  const exact = classes.find((c) => c.code === code);
  if (exact) return exact;
  if (code === "3A") return classes.find((c) => c.code === "3E");
  if (code === "2S") return classes.find((c) => c.code === "2S");
  return undefined;
}

export function matchClassBySpeech(
  speech: string,
  classes: ClassAvailability[],
): ClassAvailability | undefined {
  const resolved = resolveSpokenClass(speech);
  if (resolved) {
    const hit = pickCode(resolved, classes);
    if (hit) return hit;
  }
  const s = foldVoice(speech);
  for (const c of classes) {
    const label = foldVoice(c.label);
    const code = c.code.toLowerCase();
    if (s === code || s.includes(code) || (label && contains(s, label))) return c;
    const hint = CLASS_HINTS.find((h) => h.code === c.code);
    if (hint?.keys.some((k) => s === k || s.includes(k))) return c;
  }
  return undefined;
}

export function matchBerthBySpeech(speech: string, options: string[]): string | undefined {
  const s = foldVoice(speech);
  const exact = options.find((o) => foldVoice(o) === s);
  if (exact) return exact;
  const hit = options.find((o) => {
    const l = foldVoice(o);
    return s.includes(l) || l.includes(s);
  });
  if (hit) return hit;
  if (/side\s*lower/.test(s)) return options.find((o) => /side lower/i.test(o));
  if (/side\s*upper/.test(s)) return options.find((o) => /side upper/i.test(o));
  if (/\bcoupe\b/.test(s)) return options.find((o) => /coupe/i.test(o));
  if (/\bcabin\b/.test(s)) return options.find((o) => /cabin/i.test(o));
  if (/\blower\b/.test(s)) return options.find((o) => o === "Lower");
  if (/\bupper\b/.test(s)) return options.find((o) => o === "Upper");
  if (/\bmiddle\b/.test(s)) return options.find((o) => o === "Middle");
  if (/\bwindow\b/.test(s)) return options.find((o) => o === "Window");
  if (/\baisle\b/.test(s)) return options.find((o) => o === "Aisle");
  return undefined;
}
