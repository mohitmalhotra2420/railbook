export type VoiceErrorKind =
  | "unsupported"
  | "insecure"
  | "denied"
  | "unavailable"
  | "no-speech"
  | "failed"
  | "busy";

export const VOICE_MESSAGES: Record<VoiceErrorKind, string> = {
  unsupported:
    "Is browser mein voice input available nahi hai. Aap type karke bhi booking kar sakte hain.",
  insecure:
    "Is browser mein voice input available nahi hai. Aap type karke bhi booking kar sakte hain.",
  denied:
    "Microphone permission chahiye. Browser settings se microphone allow karein.",
  unavailable:
    "Microphone permission chahiye. Browser settings se microphone allow karein.",
  "no-speech": "Voice input nahi samajh aaya. Dobara try karein.",
  failed: "Voice input nahi samajh aaya. Dobara try karein.",
  busy: "Voice input nahi samajh aaya. Dobara try karein.",
};

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onresult: ((ev: SpeechResultEvent) => void) | null;
}

export interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal?: boolean;
    0: { transcript: string };
    length: number;
  }>;
}

type SpeechCtor = new () => SpeechRecognitionLike;

export function getSpeechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSecureVoiceContext(): boolean {
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true;
}

export function isSpeechSupported(): boolean {
  return isSecureVoiceContext() && getSpeechCtor() !== null;
}

export function mapSpeechError(error?: string): VoiceErrorKind {
  switch (error) {
    case "not-allowed":
    case "permission-denied":
      return "denied";
    case "service-not-allowed":
      return "denied";
    case "audio-capture":
      return "unavailable";
    case "no-speech":
      return "no-speech";
    case "aborted":
      return "busy";
    case "network":
    case "bad-grammar":
    case "language-not-supported":
    default:
      return "failed";
  }
}

export function mapGetUserMediaError(err: unknown): VoiceErrorKind {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "NotReadableError") {
    return "unavailable";
  }
  return "unavailable";
}

let micGranted = false;

/** Ask for mic only after a user tap. After the first grant we skip getUserMedia — Android Chrome ASR breaks if tracks are opened and killed every tap. */
export async function requestMicrophoneAccess(): Promise<void> {
  if (micGranted) return;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
  micGranted = true;
}

export const CHAT_VOICE_ERRORS = new Set<VoiceErrorKind>([
  "unsupported",
  "insecure",
  "denied",
  "unavailable",
]);

export function createRecognizer(lang = "hi-IN"): SpeechRecognitionLike | null {
  const Ctor = getSpeechCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  return rec;
}

export function collapseRepeatWords(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && similarWord(prev, p)) continue;
    out.push(p);
  }
  return out.join(" ");
}

function similarWord(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return true;
  if (Math.abs(x.length - y.length) > 2) return false;
  if (Math.min(x.length, y.length) < 3) return false;
  return levenshtein(x, y) <= 2;
}

function levenshtein(a: string, b: string): number {
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

function wordsOf(text: string): string[] {
  return text
    .replace(/[-–—]/g, " ")
    .replace(/[।.?,!]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** True if `short` is roughly a prefix of `long` (Chrome growing copies + ASR typos). */
function isFuzzyPrefix(short: string, long: string): boolean {
  const a = wordsOf(short);
  const b = wordsOf(long);
  if (!a.length || a.length > b.length) return false;
  let i = 0;
  let miss = 0;
  for (let j = 0; j < b.length && i < a.length; j++) {
    if (similarWord(a[i], b[j])) {
      i++;
      continue;
    }
    miss++;
    if (miss > 2) return false;
  }
  return i >= Math.max(1, a.length - 1);
}

/** Chrome often sends growing copies of the same sentence. Keep one. */
export function mergeGrowingText(chunks: string[]): string {
  let acc = "";
  for (const raw of chunks) {
    const t = raw.trim();
    if (!t) continue;
    if (!acc) {
      acc = t;
      continue;
    }
    const a = acc.toLowerCase();
    const b = t.toLowerCase();
    if (b.startsWith(a) || b.includes(a) || isFuzzyPrefix(acc, t)) acc = t;
    else if (a.startsWith(b) || a.includes(b) || isFuzzyPrefix(t, acc)) continue;
    else acc = `${acc} ${t}`;
  }
  return stabilizeTranscript(acc);
}

export function collapseRepeatedPhrases(text: string): string {
  const words = collapseRepeatWords(text).split(/\s+/).filter(Boolean);
  if (words.length < 4) return words.join(" ");

  // Chrome hi-IN continuous: "A" + "A B" + "A B C" glued together.
  // Last place the first two words restart is the latest copy.
  let last = 0;
  if (words.length >= 5) {
    for (let i = 2; i < words.length - 1; i++) {
      if (similarWord(words[i], words[0]) && similarWord(words[i + 1], words[1])) last = i;
    }
  }
  const trimmed = last > 0 ? words.slice(last) : words;
  if (trimmed.length < 4) return trimmed.join(" ");

  for (let n = trimmed.length - 1; n >= 3; n--) {
    const suffix = trimmed.slice(-n).join(" ");
    const head = trimmed.slice(0, -n).join(" ");
    if (head.includes(suffix) || isFuzzyPrefix(suffix, head)) {
      return collapseRepeatedPhrases(head.length >= suffix.length ? head : suffix);
    }
  }
  return trimmed.join(" ");
}

export function stabilizeTranscript(text: string): string {
  return collapseRepeatedPhrases(collapseRepeatWords(text));
}

export function collectTranscript(ev: SpeechResultEvent): { interim: string; final: string } {
  const finals: string[] = [];
  const interims: string[] = [];
  for (let i = 0; i < ev.results.length; i++) {
    const row = ev.results[i];
    const text = (row[0]?.transcript ?? "").trim();
    if (!text) continue;
    if (row.isFinal !== false) finals.push(text);
    else interims.push(text);
  }
  return { interim: mergeGrowingText(interims), final: mergeGrowingText(finals) };
}
