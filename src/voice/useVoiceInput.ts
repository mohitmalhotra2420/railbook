import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_VOICE_ERRORS,
  VOICE_MESSAGES,
  collectTranscript,
  createRecognizer,
  mergeGrowingText,
  stabilizeTranscript,
  isSecureVoiceContext,
  isSpeechSupported,
  mapGetUserMediaError,
  mapSpeechError,
  requestMicrophoneAccess,
  type SpeechRecognitionLike,
  type VoiceErrorKind,
} from "./speech";
import { cancelGuide } from "./speakGuide";

export interface VoiceInputState {
  listening: boolean;
  supported: boolean;
  status: string;
  interim: string;
}

const SILENCE_MS = 1800;
const MAX_LISTEN_MS = 22000;
const MAX_RESTARTS = 3;
/* Round-18m-32 (user: "mic beech mein ruk kar search kar deta hai — user bole, screen par dikhe, phir OK dabaye
 * tabhi bheje; tap par 'main sun raha hoon' + waveform"): MANUAL-COMMIT mode — silence par auto-send NAHI,
 * recognizer restart hota rehta hai (browser 5-8 s silence par khud band kar deta hai); user OK dabaye tab
 * transcript jaata hai. Max 90 s, restarts unlimited jab tak user sun raha hai. */
const MANUAL_MAX_LISTEN_MS = 90000;
const MANUAL_MAX_RESTARTS = 40;

export function useVoiceInput(
  onTranscript: (text: string) => void,
  onVoiceError?: (message: string) => void,
  opts: { manualCommit?: boolean; greet?: boolean } = {},
) {
  const manual = opts.manualCommit === true;
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Tap to speak");
  const [interim, setInterim] = useState("");
  /* 0..1 mic level (waveform) — AnalyserNode se, ~30fps. */
  const [level, setLevel] = useState(0);
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onVoiceError);
  const startingRef = useRef(false);
  const gotResultRef = useRef(false);
  const stopReasonRef = useRef<"user" | "commit" | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const notifiedRef = useRef(false);
  const wantListenRef = useRef(false);
  const bufferRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartRef = useRef(0);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onVoiceError;
  }, [onTranscript, onVoiceError]);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const teardown = useCallback(
    (abort = true) => {
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.onstart = null;
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        if (abort) {
          try {
            rec.abort();
          } catch {
            /* already stopped */
          }
        }
      }
      startingRef.current = false;
      wantListenRef.current = false;
      clearTimers();
      setListening(false);
      if (!manual) setInterim("");
      const a = audioRef.current;
      audioRef.current = null;
      if (a) {
        cancelAnimationFrame(a.raf);
        for (const t of a.stream.getTracks()) t.stop();
        void a.ctx.close().catch(() => undefined);
      }
      setLevel(0);
    },
    [clearTimers, manual],
  );

  useEffect(() => () => teardown(), [teardown]);

  const notify = useCallback((msg: string) => {
    if (notifiedRef.current) return;
    notifiedRef.current = true;
    onErrorRef.current?.(msg);
  }, []);

  const fail = useCallback(
    (kind: VoiceErrorKind) => {
      lastErrorRef.current = kind;
      teardown();
      const msg = VOICE_MESSAGES[kind];
      setStatus(msg);
      if (CHAT_VOICE_ERRORS.has(kind)) notify(msg);
      return msg;
    },
    [notify, teardown],
  );

  const finishWith = useCallback(
    (text: string) => {
      bufferRef.current = "";
      wantListenRef.current = false;
      stopReasonRef.current = "commit";
      teardown();
      const clean = stabilizeTranscript(text);
      if (clean) onTranscriptRef.current(clean);
      setStatus("Tap to speak");
    },
    [teardown],
  );

  const armSilence = useCallback(() => {
    if (manual) return; // manual-commit: silence par kuch nahi — user OK dabayega
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (wantListenRef.current && bufferRef.current.trim()) {
        finishWith(bufferRef.current.trim());
      }
    }, SILENCE_MS);
  }, [finishWith, manual]);

  /* Manual mode: OK → commit jo bhi bola (final + interim). */
  const commit = useCallback(() => {
    stopReasonRef.current = "commit";
    const text = (interim || bufferRef.current).trim();
    finishWith(text);
    setInterim("");
  }, [finishWith, interim]);

  /* Manual mode: cancel → kuch nahi bhejna. */
  const cancel = useCallback(() => {
    stopReasonRef.current = "user";
    bufferRef.current = "";
    wantListenRef.current = false;
    teardown();
    setInterim("");
    setStatus("Tap to speak");
  }, [teardown]);

  const stop = useCallback(() => {
    if (manual) { commit(); return; }
    stopReasonRef.current = "user";
    const leftover = bufferRef.current.trim();
    finishWith(leftover);
  }, [commit, finishWith, manual]);

  const start = useCallback(async (): Promise<string | null> => {
    if (startingRef.current) return null;
    if (recRef.current || listening) {
      stop();
      return null;
    }

    if (!isSecureVoiceContext() || !isSpeechSupported()) {
      return fail(!isSecureVoiceContext() ? "insecure" : "unsupported");
    }

    startingRef.current = true;
    gotResultRef.current = false;
    stopReasonRef.current = null;
    lastErrorRef.current = null;
    notifiedRef.current = false;
    wantListenRef.current = true;
    restartRef.current = 0;
    bufferRef.current = "";
    setStatus(manual ? "Main sun raha hoon… bolo, khatam ho jaaye to OK dabao." : "Sun raha hoon… bolo, khatam hone ke baad ruk jaunga.");
    setInterim("");
    clearTimers();
    maxTimerRef.current = setTimeout(() => {
      if (manual) { setStatus("Bahut der ho gayi — jo bola wo neeche hai, OK dabao ya dobara mic tap karo."); return; }
      if (wantListenRef.current && !gotResultRef.current) fail("no-speech");
      else if (wantListenRef.current && bufferRef.current.trim()) finishWith(bufferRef.current.trim());
    }, manual ? MANUAL_MAX_LISTEN_MS : MAX_LISTEN_MS);

    try {
      await requestMicrophoneAccess();
    } catch (err) {
      startingRef.current = false;
      return fail(mapGetUserMediaError(err));
    }
    /* "Main sun raha hoon" PEHLE bolo aur khatam hone do — TTS aur recognizer ek saath Android Chrome par
     * recognizer ko mute/abort kar dete hain (isi wajah se transcript nahi aa raha tha). Max 1.8 s wait. */
    if (manual && opts.greet !== false && typeof window !== "undefined" && "speechSynthesis" in window) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        try {
          const u = new SpeechSynthesisUtterance("Main sun raha hoon");
          u.lang = "hi-IN"; u.rate = 1.1; u.volume = 1;
          u.onend = finish; u.onerror = finish;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
          setTimeout(finish, 1800);
        } catch {
          finish();
        }
      });
      if (!wantListenRef.current) { startingRef.current = false; return null; } // user ne beech mein cancel kiya
    }
    /* Waveform: mic stream → AnalyserNode → RMS level (0..1). Recognition se alag stream — dono saath chalte hain. */
    if (manual && typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          setLevel(Math.min(1, rms * 4));
          if (audioRef.current) audioRef.current.raf = requestAnimationFrame(tick);
        };
        audioRef.current = { ctx, stream, raf: requestAnimationFrame(tick) };
      } catch {
        /* meter optional */
      }
    }

    const rec = createRecognizer("hi-IN");
    if (!rec) {
      startingRef.current = false;
      return fail("unsupported");
    }

    rec.onstart = () => {
      startingRef.current = false;
      setListening(true);
      setStatus("Sun raha hoon…");
    };

    rec.onresult = (ev) => {
      const { interim: mid, final } = collectTranscript(ev);
      if (final) {
        gotResultRef.current = true;
        bufferRef.current = mergeGrowingText([bufferRef.current, final].filter(Boolean));
      }
      const shown = mergeGrowingText([bufferRef.current, mid].filter(Boolean));
      if (shown) setInterim(shown);
      if (manual) setStatus("Main sun raha hoon… (OK dabao jab ho jaye)");
      if (bufferRef.current || mid) armSilence();
    };

    rec.onerror = (ev) => {
      if (
        ev.error === "aborted" &&
        (stopReasonRef.current === "user" || stopReasonRef.current === "commit")
      ) {
        lastErrorRef.current = "user-stop";
        return;
      }
      if (ev.error === "no-speech" && wantListenRef.current) return;
      if (manual && wantListenRef.current && (ev.error === "aborted" || ev.error === "network" || ev.error === "audio-capture")) return; // onend restart handles
      const kind = mapSpeechError(ev.error);
      lastErrorRef.current = kind;
      setStatus(VOICE_MESSAGES[kind]);
    };

    rec.onend = () => {
      const leftover = bufferRef.current.trim();
      if (manual) {
        /* User ne abhi OK/cancel nahi dabaya → NAYA recognizer chupchaap start (Android Chrome par purane
         * instance ka dobara start() aksar "already started"/silent fail deta hai). */
        if (wantListenRef.current && restartRef.current < MANUAL_MAX_RESTARTS && stopReasonRef.current !== "user" && stopReasonRef.current !== "commit") {
          restartRef.current += 1;
          lastErrorRef.current = null;
          try {
            const next = createRecognizer("hi-IN");
            if (next) {
              next.onstart = rec.onstart; next.onresult = rec.onresult; next.onerror = rec.onerror; next.onend = rec.onend;
              rec.onstart = null; rec.onresult = null; rec.onerror = null; rec.onend = null;
              recRef.current = next;
              setTimeout(() => { try { next.start(); } catch { /* next onend → retry */ } }, 120);
              return;
            }
          } catch { /* fall through */ }
        }
        if (stopReasonRef.current === "user" || stopReasonRef.current === "commit") return;
        teardown(false);
        setStatus(leftover ? "Mic band ho gaya — jo bola wo neeche hai, OK dabao." : "Tap to speak");
        return;
      }
      if (wantListenRef.current && leftover) {
        finishWith(leftover);
        return;
      }
      if (
        wantListenRef.current &&
        !leftover &&
        restartRef.current < MAX_RESTARTS &&
        stopReasonRef.current !== "user" &&
        stopReasonRef.current !== "commit"
      ) {
        restartRef.current += 1;
        lastErrorRef.current = null;
        try {
          rec.start();
          setStatus("Sun raha hoon… boliye.");
          return;
        } catch {
          /* fall through */
        }
      }
      const hadError = Boolean(lastErrorRef.current) && lastErrorRef.current !== "user-stop";
      teardown(false);
      if (leftover) {
        onTranscriptRef.current(stabilizeTranscript(leftover));
        setStatus("Tap to speak");
        return;
      }
      if (hadError && lastErrorRef.current && lastErrorRef.current !== "user-stop") {
        const kind = lastErrorRef.current as VoiceErrorKind;
        const msg = VOICE_MESSAGES[kind] ?? VOICE_MESSAGES.failed;
        setStatus(msg);
        if (CHAT_VOICE_ERRORS.has(kind)) notify(msg);
      } else if (
        !gotResultRef.current &&
        stopReasonRef.current !== "user" &&
        stopReasonRef.current !== "commit"
      ) {
        setStatus("Mic sun raha tha — thoda tez / saaf boliye, ya type kar do.");
      } else {
        setStatus("Tap to speak");
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      startingRef.current = false;
      return fail("failed");
    }
    return null;
  }, [armSilence, clearTimers, fail, finishWith, listening, manual, notify, opts.greet, stop, teardown]);

  const toggle = useCallback(async () => {
    if (listening || recRef.current) {
      stop();
      return null;
    }
    return start();
  }, [listening, start, stop]);

  return {
    listening,
    supported: typeof window === "undefined" ? true : isSpeechSupported(),
    status,
    interim,
    level,
    start,
    stop,
    toggle,
    commit,
    cancel,
  } satisfies VoiceInputState & {
    level: number;
    start: () => Promise<string | null>;
    stop: () => void;
    toggle: () => Promise<string | null>;
    commit: () => void;
    cancel: () => void;
  };
}
