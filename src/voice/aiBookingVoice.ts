/* ══ AI BOOKING VOICE ADAPTER (ADDITIVE, Round-62) ═════════════════════════════════════════════════════
 * User: "Voice ke liye dedicated adapter banao … Provider configurable hona chahiye. Do not hardcode
 * secret/API key in frontend. Secrets server-side environment variables me rahenge. If realtime voice
 * provider unavailable/fails → text chat booking flow continue hona chahiye."
 *
 * Isliye:
 *   • Sunna (STT) maujooda voice stack se hi hota hai — `useVoiceInput` (Web Speech / native Android
 *     bridge). Yahan koi naya recognizer nahi banaya.
 *   • Bolna (TTS): pehle SERVER provider try hota hai (`POST /api/voice/tts`, keys sirf Render env me —
 *     client kabhi key nahi bhejta/rakhta). Provider configured na ho / fail ho jaye to chupchaap
 *     maujooda browser TTS (`speakGuide`) par gir jaata hai — matlab voice fail hone par bhi booking
 *     ka text flow waise hi chalta rehta hai.
 *   • Sab kuch injectable hai (`configure`) taaki test me fake fetch/audio diya ja sake; adapter kabhi
 *     throw nahi karta.
 */
import { api } from "../api";
import { cancelGuide, speakGuide, unlockSpeech } from "./speakGuide";
import { hasNativeVoice } from "./nativeSpeech";
import { hasNativeAudio, nativePlayAudioBase64, nativeSpeak, nativeStopSpeaking, nativeStopAudio, hasNativeSpeak } from "./nativeSpeak";
import { isSpeechSupported } from "./speech";

export interface VoiceProviderInfo {
  /** "server" (dedicated TTS provider) ya "browser" (device speechSynthesis). */
  kind: "server" | "browser";
  /** Server provider ka naam (openai / elevenlabs / custom) — keys kabhi nahi. */
  provider: string | null;
  model: string | null;
  languages: string[];
}

export interface AiBookingVoiceDeps {
  fetchConfig: () => Promise<{ provider: string; serverTts: boolean; model?: string | null; languages?: string[] }>;
  fetchTts: (text: string, lang: string) => Promise<Blob>;
  play: (blob: Blob) => Promise<void>;
  stopPlayback: () => void;
  browserSpeak: (text: string) => void;
  browserStop: () => void;
  /** R66: audio element ko user-gesture ke andar unlock karo (silent frame) — warna AI ke baad ka
   *  play autoplay policy me block ho jaata hai. */
  unlockAudio?: () => void;
}

/** R66: voice output me kya dikkat aayi (UI imandaari se bataata hai — chup nahi rehta). */
export type VoiceIssue = "server-failed" | "playback-blocked" | "no-output" | null;

export interface AiBookingVoice {
  /** Boli gayi line (muted ho ya text khaali ho to kuch nahi). */
  speak: (text: string) => void;
  /** Abhi jo bol rahe hain wo rok do (playback + browser dono). */
  stop: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  /** Server config ek baar load (fail ho to browser par fallback). */
  loadProvider: () => Promise<VoiceProviderInfo>;
  provider: () => VoiceProviderInfo;
  /** True jab aakhri speak() server TTS se gaya tha (UI chip ke liye). */
  speaking: () => boolean;
  /** Mic support: "native" | "browser" | "none" — sirf jsonp-free capability check. */
  micSupport: () => "native" | "browser" | "none";
  /** R63-fix: AI ki awaaz kahan se aayegi — "server" (provider) | "app" (native TTS) | "device"
   *  (browser speechSynthesis) | "none" (is device par output hi nahi — text chalta rahega). */
  outputSupport: () => "server" | "app" | "device" | "none";
  /** User ke tap par ek baar chalao (Chrome/Android me pehla speak chup na ho jaaye). */
  unlock: () => void;
  /** UI ke liye: jab AI bol rahi ho ("speaking") / chup ho ("idle"). */
  onState: (cb: (s: "speaking" | "idle") => void) => () => void;
  /** R66: playback/server fail hone par ek baar batao (UI line dikha sake). */
  onIssue: (cb: (issue: VoiceIssue) => void) => () => void;
  lastIssue: () => VoiceIssue;
  /** R66: AI ki awaaz kis raaste se jaa rahi hai ("server-audio" | "app-audio" | "app-tts" | "device"). */
  lastRoute: () => "server-audio" | "app-audio" | "app-tts" | "device" | null;
}

const BROWSER_INFO: VoiceProviderInfo = { kind: "browser", provider: null, model: null, languages: ["hi-IN", "en-IN"] };

/** Device (browser speechSynthesis) par sach me koi voice hai? — WebView me hota hai par khaali. */
function deviceVoiceLikelyAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const synth = window.speechSynthesis;
  if (!synth) return false;
  try {
    const voices = synth.getVoices?.() ?? [];
    if (!voices.length) return true; /* voices list abhi load nahi hui — try karna bekaar nahi */
    return voices.some((v) => /hi|en/i.test(v.lang ?? ""));
  } catch {
    return true;
  }
}

/** Blob → base64 (native MediaPlayer ko bhejne ke liye). */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
  return typeof btoa === "function" ? btoa(bin) : "";
}

function defaultDeps(): AiBookingVoiceDeps {
  /* R66-fix (user: "tts ki voice nahi aa rahi"): pehle har baar NAYA `new Audio()` banata tha —
   * Chrome/WebView ki autoplay policy aise element ko (user gesture ke bina) block kar deti hai,
   * aur Android WebView me `mediaPlaybackRequiresUserGesture` default true hone se play() chup-chaap
   * fail ho jaata tha. Ab:
   *   1) ek hi element (persistent) reuse hota hai — sticky activation ka fayda,
   *   2) unlock() (user ke tap par) chhota silent clip baja kar us element ko "allowed" kar deta hai,
   *   3) play() fail ho to MP3 app ke native player ko bheja jaata hai (naya APK — autoplay policy
   *      wahan lagti hi nahi),
   *   4) sab fail → device TTS, aur UI ko honest "issue" (neeche speak() me). */
  let current: HTMLAudioElement | null = null;
  let unlocked = false;
  const el = (): HTMLAudioElement | null => {
    if (typeof window === "undefined" || typeof window.Audio === "undefined") return null;
    if (!current) {
      current = new Audio();
      current.preload = "auto";
      (current as HTMLAudioElement).setAttribute("playsinline", "");
    }
    return current;
  };
  /* 1-frame ka silent WAV — sirf gesture ke andar play hota hai (koi awaaz nahi). */
  const SILENT_WAV =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
  return {
    fetchConfig: () => api.voiceConfig(),
    fetchTts: (text, lang) => api.voiceTts(text, lang),
    async play(blob) {
      const el0 = el();
      if (!el0) throw new Error("audio unavailable");
      const url = URL.createObjectURL(blob);
      try {
        el0.src = url;
        await el0.play();
        unlocked = true;
        el0.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
        return;
      } catch (err) {
        URL.revokeObjectURL(url);
        /* App me hain? → native player (WebView autoplay policy bypass). */
        if (hasNativeAudio()) {
          try {
            const b64 = await blobToBase64(blob);
            if (b64 && nativePlayAudioBase64(b64, blob.type || "audio/mpeg")) return;
          } catch {
            /* neeche throw */
          }
        }
        throw err;
      }
    },
    stopPlayback() {
      try {
        current?.pause();
        if (current) current.removeAttribute("src");
      } catch {
        /* ignore */
      }
      try {
        nativeStopAudio();
      } catch {
        /* ignore */
      }
    },
    unlockAudio() {
      const el0 = el();
      if (!el0) return;
      try {
        el0.src = SILENT_WAV;
        void el0
          .play()
          .then(() => {
            unlocked = true;
          })
          .catch(() => undefined);
      } catch {
        /* ignore */
      }
    },
    /* R63-fix: native TTS pehle (app me WebView ka speechSynthesis chup rehta hai), warna browser. */
    browserSpeak: (text) => {
      if (!nativeSpeak(text)) speakGuide(text);
    },
    browserStop: () => {
      nativeStopSpeaking();
      cancelGuide();
    },
  };
}

export function createAiBookingVoice(deps: AiBookingVoiceDeps = defaultDeps()): AiBookingVoice {
  let muted = false;
  let info: VoiceProviderInfo = { ...BROWSER_INFO };
  let usingServer = false;
  let token = 0;
  let issue: VoiceIssue = null;
  let route: "server-audio" | "app-audio" | "app-tts" | "device" | null = null;
  const listeners = new Set<(s: "speaking" | "idle") => void>();
  const issueListeners = new Set<(i: VoiceIssue) => void>();
  const emitIssue = (i: VoiceIssue) => {
    issue = i;
    for (const l of issueListeners) {
      try {
        l(i);
      } catch {
        /* ignore */
      }
    }
  };
  const emit = (st: "speaking" | "idle") => {
    for (const l of listeners) {
      try {
        l(st);
      } catch {
        /* UI listener fail ho to voice kabhi na ruke */
      }
    }
  };
  /* Browser TTS ka koi "ended" event nahi milta — text length se andaza (jitna bola, utni der). */
  const speakingMs = (line: string) => Math.min(12000, Math.max(1500, line.length * 75));

  return {
    speak(text: string) {
      /* eslint-disable-next-line no-unused-expressions */
      const line = String(text ?? "").trim();
      if (!line || muted) return;
      const my = ++token;
      if (info.kind !== "server") {
        usingServer = false;
        emit("speaking");
        /* App me native TTS hai? wo sabse bharosemand (WebView ka speechSynthesis aksar chup rehta hai). */
        route = hasNativeSpeak() ? "app-tts" : "device";
        if (route === "device" && !deviceVoiceLikelyAvailable()) emitIssue("no-output");
        deps.browserSpeak(line);
        window.setTimeout(() => {
          if (my === token) emit("idle");
        }, speakingMs(line));
        return;
      }
      emit("speaking");
      deps
        .fetchTts(line, "hi-IN")
        .then((blob) => {
          if (my !== token || muted) return undefined;
          route = "server-audio";
          return deps.play(blob).then(() => {
            if (my === token) {
              usingServer = true;
              emitIssue(null);
            }
          });
        })
        .finally(() => {
          if (my === token) emit("idle");
        })
        .catch((err: unknown) => {
          /* Server voice play/fetch fail → booking flow rukna nahi chahiye: device/native voice chalao,
           * aur UI ko saaf batao ki server audio block hua (chup-chaap ku6 na ho). */
          if (my !== token || muted) return;
          usingServer = false;
          const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
          const blocked = /NotAllowed|blocked|gesture|interrupted/i.test(msg);
          route = hasNativeSpeak() ? "app-tts" : "device";
          if (route === "device" && !deviceVoiceLikelyAvailable()) emitIssue("no-output");
          else emitIssue(blocked ? "playback-blocked" : "server-failed");
          deps.browserSpeak(line);
        });
    },
    stop() {
      token += 1;
      usingServer = false;
      emit("idle");
      nativeStopAudio();
      try {
        deps.stopPlayback();
      } catch {
        /* ignore */
      }
      try {
        deps.browserStop();
      } catch {
        /* ignore */
      }
    },
    setMuted(next: boolean) {
      muted = next;
      if (next) {
        token += 1;
        try {
          deps.stopPlayback();
          deps.browserStop();
        } catch {
          /* ignore */
        }
      }
    },
    isMuted: () => muted,
    async loadProvider() {
      try {
        const cfg = await deps.fetchConfig();
        info = cfg.serverTts
          ? {
              kind: "server",
              provider: cfg.provider || "server",
              model: cfg.model ?? null,
              languages: cfg.languages?.length ? cfg.languages : ["hi-IN", "en-IN"],
            }
          : { ...BROWSER_INFO, provider: cfg.provider || null };
      } catch {
        info = { ...BROWSER_INFO };
      }
      return info;
    },
    provider: () => info,
    speaking: () => usingServer,
    micSupport: () => (hasNativeVoice() ? "native" : isSpeechSupported() ? "browser" : "none"),
    outputSupport: () => {
      if (info.kind === "server") return "server";
      if (hasNativeSpeak()) return "app";
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      return synth ? "device" : "none";
    },
    unlock: () => {
      /* Maujooda speechSynthesis unlock (jaisa tha waisa) + R66: audio element bhi gesture ke andar
       * ek silent frame baja kar "allowed" mark kar do (warna AI ke baad wala play block ho jaata hai). */
      emitIssue(null);
      unlockSpeech();
      try {
        deps.unlockAudio?.();
      } catch {
        /* ignore */
      }
    },
    onState(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onIssue(cb) {
      issueListeners.add(cb);
      cb(issue);
      return () => issueListeners.delete(cb);
    },
    lastIssue: () => issue,
    lastRoute: () => route,
  };
}

/** Ek hi instance poore app ke liye (module-level) — UI usi ko share karta hai. */
export const aiBookingVoice = createAiBookingVoice();

/** Text ko chhote bolne-layak tukdon me todna — voice me 2-3 lines hi bolte hain (UX). */
export function voiceLinesFor(lines: string[], max = 2): string[] {
  return lines
    .map((l) => l.replace(/[✅👍😊🙏]/gu, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-max);
}
