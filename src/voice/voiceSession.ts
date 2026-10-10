/* ══ VOICE SESSION — sirf VOICE ka apna chhota state (ADDITIVE, Round "Voice Agent R1") ═══════════════
 * User (R1 brief): "Only maintain Voice-specific state such as isListening / isSpeaking /
 * isProcessingVoice / currentAudio / voiceError. Do NOT duplicate origin, destination, date,
 * passengers, train, fare, booking state, PNR — those already belong to the existing application."
 *
 * Isliye yahan sirf wahi 5 cheezein hain. Journey/booking ka koi data is file me kabhi nahi aayega —
 * wo maujooda booking context / AI Booking flow ka kaam hai (jo humne chhua bhi nahi).
 *
 * Ye file framework-free hai (React/DOM kuch nahi) taaki voice layer kisi bhi surface par reuse ho
 * sake aur tests aasan rahein.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */

/** Abhi jo audio baj rahi hai (sirf display ke liye — text wahi hai jo agent ne diya). */
export interface VoiceAudio {
  text: string;
  at: number;
}

export interface VoiceSessionState {
  isListening: boolean;
  isProcessingVoice: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  voiceError: string | null;
  currentAudio: VoiceAudio | null;
}

export function voiceSessionBlank(): VoiceSessionState {
  return {
    isListening: false,
    isProcessingVoice: false,
    isSpeaking: false,
    isMuted: false,
    voiceError: null,
    currentAudio: null,
  };
}

export interface VoiceSession {
  get(): VoiceSessionState;
  /** Sirf voice flags badalte hain (journey/booking state yahan nahi hai). */
  update(patch: Partial<VoiceSessionState>): VoiceSessionState;
  subscribe(listener: (state: VoiceSessionState) => void): () => void;
}

export function createVoiceSession(initial: Partial<VoiceSessionState> = {}): VoiceSession {
  let state: VoiceSessionState = { ...voiceSessionBlank(), ...initial };
  const listeners = new Set<(s: VoiceSessionState) => void>();

  return {
    get: () => state,
    update(patch) {
      state = { ...state, ...patch };
      for (const l of listeners) {
        try {
          l(state);
        } catch {
          /* UI listener fail ho to voice kabhi na ruke */
        }
      }
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
