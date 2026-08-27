/** Short Hindi/Hinglish step prompts after a field is filled. */

let primed = false;
let speakToken = 0;

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

function utter(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  u.lang = voice?.lang && /^hi/i.test(voice.lang) ? voice.lang : "hi-IN";
  u.rate = 0.98;
  const feminine = voice && /female|woman|lekha|neerja|vaishali|kalpana|heera|swara/i.test(voice.name);
  u.pitch = feminine ? 1.05 : 1.18;
  if (voice) u.voice = voice;
  try {
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
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
  return "Sab details fill ho gayi hain. Review fare dabaiye.";
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
