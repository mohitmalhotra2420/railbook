/* Round-27 (26 Sep 2026, user: "mic working nahi hai").
 *
 * Wajah: Android **WebView** me Web Speech API (`webkitSpeechRecognition`) hota hi nahi — isliye app ke
 * andar VoiceBar ka mic kabhi start nahi ho paata tha (browser me chalta hai, app me nahi).
 *
 * Ab RailBook app (v1.4.8+) apna **native SpeechRecognizer** deta hai:
 *   page → app : window.RailBookVoice.start("hi-IN") · .stop() · .abort() · .isAvailable()
 *   app → page : window.__railbookVoice.dispatch('{"type":"final","text":"…"}')
 *
 * Ye file us bridge ko Web Speech jaisa hi adapter bana deti hai (`SpeechRecognitionLike`), taaki
 * `useVoiceInput` ka poora flow — silence timers, restarts, manual-commit, fuzzy alternatives — bina
 * kisi badlav ke chale. Browser me bridge nahi hota, wahan purana Web Speech hi chalta rehta hai.
 */
import type { SpeechRecognitionLike } from "./speech";

type NativeVoiceBridge = {
  start?: (lang: string) => void;
  stop?: () => void;
  abort?: () => void;
  isAvailable?: () => boolean;
};

type DispatchPayload = { type?: string; text?: string; code?: string };

type Handlers = {
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string }; length: number }> }) => void) | null;
};

let active: Handlers | null = null;

function bridge(): NativeVoiceBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { RailBookVoice?: NativeVoiceBridge };
  const b = w.RailBookVoice;
  if (!b || typeof b.start !== "function" || typeof b.stop !== "function") return null;
  return b;
}

export function hasNativeVoice(): boolean {
  return bridge() !== null;
}

/** Android se aane wale events ko current session tak pahunchata hai (ek hi jagah install hota hai). */
function installDispatcher(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __railbookVoice?: { dispatch: (json: string) => void } };
  if (w.__railbookVoice) return;
  w.__railbookVoice = {
    dispatch(json: string) {
      let p: DispatchPayload;
      try {
        p = JSON.parse(String(json ?? "{}")) as DispatchPayload;
      } catch {
        return;
      }
      const h = active;
      if (!h) return;
      const text = typeof p.text === "string" ? p.text : "";
      if (p.type === "start") {
        h.onstart?.();
        return;
      }
      if (p.type === "error") {
        h.onerror?.({ error: p.code ?? "failed" });
        return;
      }
      if (p.type === "end") {
        h.onend?.();
        return;
      }
      if ((p.type === "partial" || p.type === "final") && text) {
        const isFinal = p.type === "final";
        /* Wahi shape jo Web Speech deta hai — ek result, index 0. */
        const results = [
          { isFinal, 0: { transcript: text }, length: 1 },
        ] as unknown as ArrayLike<{ isFinal?: boolean; 0: { transcript: string }; length: number }>;
        h.onresult?.({ resultIndex: 0, results });
      }
    },
  };
}

export function createNativeRecognizer(lang = "hi-IN"): SpeechRecognitionLike | null {
  const b = bridge();
  if (!b) return null;
  try {
    if (typeof b.isAvailable === "function" && b.isAvailable() === false) return null;
  } catch {
    /* bridge error → try anyway */
  }
  installDispatcher();
  const handlers: Handlers = { onstart: null, onend: null, onerror: null, onresult: null };
  const rec: SpeechRecognitionLike = {
    lang,
    continuous: false,
    interimResults: true,
    maxAlternatives: 1,
    get onstart() {
      return handlers.onstart;
    },
    set onstart(fn) {
      handlers.onstart = fn;
    },
    get onend() {
      return handlers.onend;
    },
    set onend(fn) {
      handlers.onend = fn;
    },
    get onerror() {
      return handlers.onerror;
    },
    set onerror(fn) {
      handlers.onerror = fn;
    },
    get onresult() {
      return handlers.onresult;
    },
    set onresult(fn) {
      handlers.onresult = fn;
    },
    start() {
      active = handlers;
      b.start?.(this.lang || lang);
    },
    stop() {
      b.stop?.();
    },
    abort() {
      (b.abort ?? b.stop)?.();
      if (active === handlers) active = null;
    },
  };
  return rec;
}
