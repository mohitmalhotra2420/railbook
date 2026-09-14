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

export interface VoiceInputState {
  listening: boolean;
  supported: boolean;
  status: string;
  interim: string;
}

const SILENCE_MS = 1800;
const MAX_LISTEN_MS = 22000;
const MAX_RESTARTS = 3;
/* Round-18m-38 (user: "mic pe jo bolta hoon chat mein nahi aata, screen par bhi nahi"):
 * ROOT CAUSE — Android Chrome mein SpeechRecognition ke SAATH koi doosra getUserMedia stream (waveform ke
 * liye AudioContext) ya TTS chal raha ho to recognizer ko audio hi nahi milta → kabhi result nahi.
 * Ab: (1) mic ka EK hi consumer — SpeechRecognition; waveform recognizer ke events se animate hota hai,
 * (2) greet sirf TEXT (TTS default OFF — user chahe to VITE_VOICE_TTS=1), (3) manual-commit: silence par
 * auto-send nahi, recognizer khatam ho to NAYA instance chupchaap start (OK tak), (4) hi-IN recognizer
 * Hindi/Hinglish/English mix ke liye sabse accha on-device option hai; maxAlternatives=3 se fuzzy words
 * ke liye best alternative uthate hain. */
const MANUAL_MAX_LISTEN_MS = 120000;
const MANUAL_MAX_RESTARTS = 60;

export function useVoiceInput(
  onTranscript: (text: string) => void,
  onVoiceError?: (message: string) => void,
  opts: { manualCommit?: boolean; greet?: boolean } = {},
) {
  const manual = opts.manualCommit === true;
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Tap to speak");
  const [interim, setInterim] = useState("");
  /* 0..1 "activity" level for the waveform — driven by recognition events (no second mic stream). */
  const [level, setLevel] = useState(0);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef(0);
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
  const interimRef = useRef("");
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
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
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
      setLevel(0);
      if (!manual) setInterim("");
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
      interimRef.current = "";
      wantListenRef.current = false;
      stopReasonRef.current = "commit";
      teardown();
      const clean = stabilizeTranscript(text);
      if (clean) onTranscriptRef.current(clean);
      setInterim("");
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
    const text = (interimRef.current || bufferRef.current).trim();
    finishWith(text);
  }, [finishWith]);

  /* Manual mode: cancel → kuch nahi bhejna. */
  const cancel = useCallback(() => {
    stopReasonRef.current = "user";
    bufferRef.current = "";
    interimRef.current = "";
    wantListenRef.current = false;
    teardown();
    setInterim("");
    setStatus("Tap to speak");
  }, [teardown]);

  const stop = useCallback(() => {
    if (manual) {
      commit();
      return;
    }
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
    interimRef.current = "";
    setStatus(manual ? "Main sun raha hoon… bolo, khatam ho jaaye to OK dabao." : "Sun raha hoon… bolo, khatam hone ke baad ruk jaunga.");
    setInterim("");
    clearTimers();
    maxTimerRef.current = setTimeout(() => {
      if (manual) {
        setStatus("Bahut der ho gayi — jo bola wo neeche hai, OK dabao ya dobara mic tap karo.");
        return;
      }
      if (wantListenRef.current && !gotResultRef.current) fail("no-speech");
      else if (wantListenRef.current && bufferRef.current.trim()) finishWith(bufferRef.current.trim());
    }, manual ? MANUAL_MAX_LISTEN_MS : MAX_LISTEN_MS);

    /* Permission prompt sirf pehli baar (helper khud tracks band kar deta hai) — koi lambi doosri stream nahi. */
    try {
      await requestMicrophoneAccess();
    } catch (err) {
      startingRef.current = false;
      return fail(mapGetUserMediaError(err));
    }
    /* Optional TTS greet — DEFAULT OFF (Android par recognizer ko block karta tha). */
    if (manual && opts.greet === true && import.meta.env?.VITE_VOICE_TTS === "1" && typeof window !== "undefined" && "speechSynthesis" in window) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        try {
          const u = new SpeechSynthesisUtterance("Main sun raha hoon");
          u.lang = "hi-IN";
          u.rate = 1.1;
          u.onend = finish;
          u.onerror = finish;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
          setTimeout(finish, 1500);
        } catch {
          finish();
        }
      });
      if (!wantListenRef.current) {
        startingRef.current = false;
        return null;
      }
    }
    /* Waveform animation from recognition activity (no AudioContext / second mic stream). */
    lastActivityRef.current = 0;
    levelTimerRef.current = setInterval(() => {
      const since = Date.now() - lastActivityRef.current;
      setLevel(since < 600 ? 0.55 + Math.random() * 0.45 : since < 1500 ? 0.25 + Math.random() * 0.2 : 0.08 + Math.random() * 0.08);
    }, 90);

    const attach = (rec: SpeechRecognitionLike) => {
      rec.onstart = () => {
        startingRef.current = false;
        setListening(true);
        setStatus(manual ? "Main sun raha hoon… (OK dabao jab ho jaye)" : "Sun raha hoon…");
      };

      rec.onresult = (ev) => {
        lastActivityRef.current = Date.now();
        const { interim: mid, final } = collectTranscript(ev);
        if (final) {
          gotResultRef.current = true;
          bufferRef.current = mergeGrowingText([bufferRef.current, final].filter(Boolean));
        }
        const shown = mergeGrowingText([bufferRef.current, mid].filter(Boolean));
        if (shown) {
          interimRef.current = shown;
          setInterim(shown);
        }
        if (bufferRef.current || mid) armSilence();
      };

      rec.onerror = (ev) => {
        if (ev.error === "aborted" && (stopReasonRef.current === "user" || stopReasonRef.current === "commit")) {
          lastErrorRef.current = "user-stop";
          return;
        }
        if (ev.error === "no-speech" && wantListenRef.current) return;
        /* Manual: transient errors → onend restart handles; sirf permission/unsupported surface karo. */
        if (manual && wantListenRef.current && (ev.error === "aborted" || ev.error === "network" || ev.error === "audio-capture")) return;
        const kind = mapSpeechError(ev.error);
        lastErrorRef.current = kind;
        setStatus(VOICE_MESSAGES[kind]);
        if (kind === "denied" || kind === "unsupported" || kind === "insecure") {
          fail(kind);
        }
      };

      rec.onend = () => {
        const leftover = bufferRef.current.trim();
        if (manual) {
          /* User ne abhi OK/cancel nahi dabaya → NAYA recognizer (Android par purane instance ka re-start unreliable). */
          if (
            wantListenRef.current &&
            restartRef.current < MANUAL_MAX_RESTARTS &&
            stopReasonRef.current !== "user" &&
            stopReasonRef.current !== "commit"
          ) {
            restartRef.current += 1;
            lastErrorRef.current = null;
            rec.onstart = null;
            rec.onresult = null;
            rec.onerror = null;
            rec.onend = null;
            const next = createRecognizer("hi-IN");
            if (next) {
              /* Android: recognizer ke result-buffer alag hota hai — pichhla final text bufferRef mein safe hai. */
              attach(next);
              recRef.current = next;
              setTimeout(() => {
                try {
                  next.start();
                } catch {
                  /* next.onend → dobara try */
                }
              }, 150);
              return;
            }
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
        } else if (!gotResultRef.current && stopReasonRef.current !== "user" && stopReasonRef.current !== "commit") {
          setStatus("Mic sun raha tha — thoda tez / saaf boliye, ya type kar do.");
        } else {
          setStatus("Tap to speak");
        }
      };
    };

    const rec = createRecognizer("hi-IN");
    if (!rec) {
      startingRef.current = false;
      return fail("unsupported");
    }
    attach(rec);
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
