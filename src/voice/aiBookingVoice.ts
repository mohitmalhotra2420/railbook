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
import { cancelGuide, speakGuide } from "./speakGuide";
import { hasNativeVoice } from "./nativeSpeech";
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
}

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
  /** UI ke liye: jab AI bol rahi ho ("speaking") / chup ho ("idle"). */
  onState: (cb: (s: "speaking" | "idle") => void) => () => void;
}

const BROWSER_INFO: VoiceProviderInfo = { kind: "browser", provider: null, model: null, languages: ["hi-IN", "en-IN"] };

function defaultDeps(): AiBookingVoiceDeps {
  let current: HTMLAudioElement | null = null;
  return {
    fetchConfig: () => api.voiceConfig(),
    fetchTts: (text, lang) => api.voiceTts(text, lang),
    async play(blob) {
      if (typeof window === "undefined" || typeof window.Audio === "undefined") throw new Error("audio unavailable");
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      current = el;
      el.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      await el.play();
    },
    stopPlayback() {
      try {
        current?.pause();
        current = null;
      } catch {
        /* ignore */
      }
    },
    browserSpeak: (text) => speakGuide(text),
    browserStop: () => cancelGuide(),
  };
}

export function createAiBookingVoice(deps: AiBookingVoiceDeps = defaultDeps()): AiBookingVoice {
  let muted = false;
  let info: VoiceProviderInfo = { ...BROWSER_INFO };
  let usingServer = false;
  let token = 0;
  const listeners = new Set<(s: "speaking" | "idle") => void>();
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
        deps.browserSpeak(line);
        window.setTimeout(() => {
          if (my === token) emit("idle");
        }, speakingMs(line));
        return;
      }
      emit("speaking");
      deps
        .fetchTts(line, "hi-IN")
        .then((blob) => (my === token && !muted ? deps.play(blob) : undefined))
        .then(() => {
          if (my === token) usingServer = true;
        })
        .finally(() => {
          if (my === token) emit("idle");
        })
        .catch(() => {
          /* provider fail → booking flow rukna nahi chahiye: device voice ya bilkul chup */
          if (my !== token || muted) return;
          usingServer = false;
          deps.browserSpeak(line);
        });
    },
    stop() {
      token += 1;
      usingServer = false;
      emit("idle");
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
    onState(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
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
