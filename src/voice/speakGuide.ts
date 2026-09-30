/** Short Hindi/Hinglish step prompts after a field is filled. */

/* R63-fix (user: "background AI voice bhi nahi aa rahi"): Android/Chrome par speechSynthesis
 * aksar chup rehta hai — teen wajah:
 *   1) pehla `speak()` user gesture se pehle chala jaata hai (autoplay policy → chup),
 *   2) voices list khaali hoti hai jab tak `getVoices()`/`voiceschanged` na chale,
 *   3) lamba text ya `paused` state (Chrome bug) me rakha jaata hai.
 * Ab: user ke tap par `unlockSpeech()` (ek silent utterance), voices ka intezaar, saaf line ko
 * chhote tukdon me bolna, aur ek retry — taaki device voice sach me sunai de. API waise hi hai
 * (`speakGuide` / `cancelGuide`), isliye purana koi caller nahi tootta.
 */

let primed = false;
let speakToken = 0;
let unlocked = false;

function voices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

function scoreVoice(v: SpeechSynthesisVoice): number {
  const n = `${v.name} ${v.lang}`.toLowerCase();
  let s = 0;
  if (/^hi-in/i.test(v.lang)) s += 14;
  else if (/^hi/i.test(v.lang)) s += 10;
  else if (/en-in/i.test(v.lang)) s += 5;
  if (/hindi|हिन्दी|हिंदी/.test(n)) s += 6;
  if (/india|indian/.test(n)) s += 4;
  if (/female|woman|lekha|neerja|vaishali|kalpana|heera|swara|nira/.test(n)) s += 12;
  if (/google हिन्दी|google hindi/.test(n)) s += 5;
  if (/male|ravi|man\b|david|mark|daniel|fred/.test(n)) s -= 10;
  if (/en-us|en-gb|en-au/.test(v.lang) && !/in/i.test(v.lang)) s -= 12;
  return s;
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const list = voices();
  if (!list.length) return undefined;
  const ranked = [...list].sort((a, b) => scoreVoice(b) - scoreVoice(a));
  const best = ranked[0];
  if (!best || scoreVoice(best) < 4) {
    return list.find((v) => /^hi/i.test(v.lang)) || list.find((v) => /in/i.test(v.lang));
  }
  return best;
}

/** User ke gesture par ek baar chalao — iske bina Chrome/Android pehla speak() chup kar deta hai. */
export function unlockSpeech(): void {
  if (unlocked) return;
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  unlocked = true;
  try {
    const s = window.speechSynthesis;
    s.getVoices();
    s.resume();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.rate = 1;
    s.speak(u);
  } catch {
    /* ignore */
  }
}

export function cancelGuide(): void {
  speakToken += 1;
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    const s = window.speechSynthesis;
    // Chrome Android often ignores a single cancel() while speaking.
    s.cancel();
    s.pause();
    s.resume();
    s.cancel();
  } catch {
    /* ignore */
  }
}

/** Lamba jawab ek saans me nahi bolna — sentence/120-char tukdon me todo (Chrome long-text bug). */
function chunks(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?…।])\s+/u)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= 140) {
      out.push(p);
      continue;
    }
    let buf = "";
    for (const w of p.split(/\s+/)) {
      if ((buf + " " + w).trim().length > 140) {
        if (buf) out.push(buf.trim());
        buf = w;
      } else buf = `${buf} ${w}`;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.length ? out : [text];
}

function utter(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const s = window.speechSynthesis;
  const voice = pickVoice();
  const lang = voice?.lang && /^hi/i.test(voice.lang) ? voice.lang : "hi-IN";
  const feminine = voice && /female|woman|lekha|neerja|vaishali|kalpana|heera|swara/i.test(voice.name);
  for (const piece of chunks(text)) {
    const u = new SpeechSynthesisUtterance(piece);
    u.lang = lang;
    u.rate = 0.98;
    u.pitch = feminine ? 1.05 : 1.18;
    u.volume = 1;
    if (voice) u.voice = voice;
    try {
      s.speak(u);
    } catch {
      /* ignore */
    }
  }
  /* Chrome kabhi kabhi queue ko pause kar deta hai (khaaskar lambi line ke baad) — resume se chalu. */
  try {
    s.resume();
    window.setTimeout(() => {
      try {
        if (s.paused) s.resume();
      } catch {
        /* ignore */
      }
    }, 700);
  } catch {
    /* ignore */
  }
  /* Retry: agar 600ms me kuch shuru hi nahi hua (voices late aayi) → ek baar phir. */
  const token = speakToken;
  window.setTimeout(() => {
    try {
      if (token !== speakToken) return;
      if (s.speaking || s.pending) return;
      const u2 = new SpeechSynthesisUtterance(chunks(text)[0]);
      u2.lang = lang;
      u2.rate = 0.98;
      u2.volume = 1;
      if (voice) u2.voice = voice;
      s.speak(u2);
    } catch {
      /* ignore */
    }
  }, 600);
}

/** Speak a short guide line. Cancels any previous line first. Prefers Indian Hindi female. */
export function speakGuide(text: string): void {
  const line = text.trim();
  if (!line) return;
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (!primed) {
    primed = true;
    try {
      window.speechSynthesis.getVoices();
    } catch {
      /* ignore */
    }
  }
  cancelGuide();
  const token = speakToken;
  const go = () => {
    if (token !== speakToken) return;
    utter(line);
  };
  if (!voices().length) {
    const onVoices = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
      go();
    };
    try {
      window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    } catch {
      /* ignore */
    }
    window.setTimeout(go, 180);
    return;
  }
  go();
}

export function passengerAskLine(slot: "name" | "age" | "gender" | "berth" | null): string {
  if (slot === "name") return "Naam bhariye. Sirf letters, jaise Rahul Sharma.";
  if (slot === "age") return "Umar bhariye. Sirf number, jaise 28.";
  if (slot === "gender") return "Gender bhariye. Male, female, ya other.";
  if (slot === "berth") return "Berth bhariye. Lower, upper, middle, ya window.";
  return "Sab details fill ho gayi hain. Review journey dabaiye.";
}

export function afterPassengerFill(
  filled: "name" | "age" | "gender" | "berth",
  next: "name" | "age" | "gender" | "berth" | null,
): string {
  const done =
    filled === "name"
      ? "Naam fill ho gaya hai."
      : filled === "age"
        ? "Umar fill ho gayi hai."
        : filled === "gender"
          ? "Gender fill ho gaya hai."
          : "Berth fill ho gayi hai.";
  return `${done} ${passengerAskLine(next)}`.trim();
}
