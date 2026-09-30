/* ══ VOICE AGENT — thin adapter (ADDITIVE, Round "Voice Agent R1") ═════════════════════════════════════
 * User (R1 brief): "Create a new isolated Voice layer/module … voiceInput ↓
 * existingAgent.processUserMessage(transcribedText) ↓ existingAgentResponse ↓ voiceOutput.speak(...).
 * Do not duplicate the agent."
 *
 * Ye file bilkul wahi karti hai — aur kuch nahi:
 *   • sunna (STT)  → maujooda adapter (`useVoiceInput` / native bridge) inject hota hai, yahan naya
 *                    recognizer nahi banta;
 *   • samajhna     → EXISTING AI Booking Agent ka handler (`onTranscript`) — is file me koi AI logic,
 *                    koi railway tool, koi booking state, koi prompt nahi;
 *   • bolna (TTS)  → maujooda voice adapter (`aiBookingVoice`) inject hota hai; lines ka chhota
 *                    presentation-strip maujooda `voiceLinesFor()` se hi hota hai (duplicate nahi).
 *
 * Voice sirf ek naya input/output layer hai — jawab/decision hamesha existing agent ka.
 * Failure isolation: is file ka koi bhi method throw nahi karta; voice toote to text booking chalta rehta hai.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */
import { voiceLinesFor } from "./aiBookingVoice";
import { createVoiceSession, type VoiceSession, type VoiceSessionState } from "./voiceSession";

/** Maujooda speech input ka contract (useVoiceInput/native bridge isi shape me dete hain). */
export interface VoiceInputAdapter {
  /** Start karo; koi user-facing error ho to string wapas, warna null. */
  start(): Promise<string | null>;
  stop(): void;
  cancel(): void;
  listening?(): boolean;
}

/** Maujooda TTS ka contract (aiBookingVoice isi shape me use hota hai). */
export interface VoiceOutputAdapter {
  speak(text: string): void;
  stop(): void;
  onState(cb: (s: "speaking" | "idle") => void): () => void;
  setMuted?(muted: boolean): void;
}

export interface VoiceAgentOptions {
  input: VoiceInputAdapter;
  output: VoiceOutputAdapter;
  /** EXISTING agent ka handler (AI Booking ka handleInput / chat ka send) — voice isi ko bulata hai. */
  onTranscript: (text: string) => void | Promise<void>;
  /** Kitni lines bolni hain (default 2 — wahi maujooda voiceLinesFor). */
  maxSpokenLines?: number;
  session?: VoiceSession;
}

export interface VoiceAgent {
  state(): VoiceSessionState;
  subscribe(listener: (s: VoiceSessionState) => void): () => void;
  /** Mic tap: pehle chal rahi awaaz rukti hai (interruption), phir sunna shuru hota hai. */
  startListening(): Promise<string | null>;
  stopListening(): void;
  cancelListening(): void;
  /** Transcript bilkul typed message ki tarah EXISTING agent ko diya jaata hai. */
  submit(text: string): Promise<void>;
  /** EXISTING agent ke jawab ki lines bolna (content wahi, sirf chhota kar ke). */
  speak(lines: string[]): void;
  /** Bolo to ruk jao — conversation/booking state ko chhua nahi jaata. */
  interrupt(): void;
  end(): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export function createVoiceAgent(opts: VoiceAgentOptions): VoiceAgent {
  const session = opts.session ?? createVoiceSession();
  const max = Math.max(1, opts.maxSpokenLines ?? 2);
  let unsubOutput: (() => void) | null = null;
  try {
    unsubOutput = opts.output.onState((s) => session.update({ isSpeaking: s === "speaking" }));
  } catch {
    unsubOutput = null;
  }

  const agent: VoiceAgent = {
    state: () => session.get(),
    subscribe: (listener) => session.subscribe(listener),

    async startListening() {
      /* Interruption (explicit): AI bol rahi ho aur user mic dabaye → awaaz turant rukti hai.
       * Ye mic sirf user ke tap par chalta hai — background listening kabhi nahi. */
      if (session.get().isSpeaking) agent.interrupt();
      session.update({ voiceError: null });
      try {
        const err = await opts.input.start();
        session.update({ isListening: !err, voiceError: err ?? null });
        return err ?? null;
      } catch {
        session.update({ isListening: false, voiceError: "voice input failed" });
        return "voice input failed";
      }
    },

    stopListening() {
      try {
        opts.input.stop();
      } catch {
        /* ignore */
      }
      session.update({ isListening: false });
    },

    cancelListening() {
      try {
        opts.input.cancel();
      } catch {
        /* ignore */
      }
      session.update({ isListening: false });
    },

    async submit(text: string) {
      const line = String(text ?? "").trim();
      if (!line) return;
      session.update({ isProcessingVoice: true, voiceError: null });
      try {
        /* Yahan koi voice-specific brain nahi — seedha existing agent. */
        await opts.onTranscript(line);
      } catch {
        session.update({ voiceError: "voice agent handler failed" });
      } finally {
        session.update({ isProcessingVoice: false, isListening: false });
      }
    },

    speak(lines: string[]) {
      const text = voiceLinesFor(Array.isArray(lines) ? lines : [], max).join(" ").trim();
      if (!text || session.get().isMuted) return;
      /* Presentation strip sirf yahan tak (emoji/blank lines) — decision/result badla nahi jaata. */
      session.update({ currentAudio: { text, at: Date.now() } });
      try {
        opts.output.speak(text);
      } catch {
        session.update({ voiceError: "voice output failed", currentAudio: null });
      }
    },

    interrupt() {
      try {
        opts.output.stop();
      } catch {
        /* ignore */
      }
      /* Conversation/booking state ko chhua nahi — sirf audio rukti hai. */
      session.update({ isSpeaking: false, currentAudio: null });
    },

    end() {
      agent.cancelListening();
      agent.interrupt();
      session.update({ isListening: false, isProcessingVoice: false });
    },

    setMuted(muted: boolean) {
      const m = Boolean(muted);
      session.update({ isMuted: m });
      try {
        opts.output.setMuted?.(m);
      } catch {
        /* ignore */
      }
      if (m) agent.interrupt();
    },

    dispose() {
      unsubOutput?.();
      unsubOutput = null;
    },
  };

  return agent;
}
