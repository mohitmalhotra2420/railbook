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

export function useVoiceInput(
  onTranscript: (text: string) => void,
  onVoiceError?: (message: string) => void,
) {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Tap to speak");
  const [interim, setInterim] = useState("");
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
      setInterim("");
    },
    [clearTimers],
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
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (wantListenRef.current && bufferRef.current.trim()) {
        finishWith(bufferRef.current.trim());
      }
    }, SILENCE_MS);
  }, [finishWith]);

  const stop = useCallback(() => {
    stopReasonRef.current = "user";
    const leftover = bufferRef.current.trim();
    finishWith(leftover);
  }, [finishWith]);

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
    setStatus("Sun raha hoon… bolo, khatam hone ke baad ruk jaunga.");
    setInterim("");
    clearTimers();
    maxTimerRef.current = setTimeout(() => {
      if (wantListenRef.current && !gotResultRef.current) fail("no-speech");
      else if (wantListenRef.current && bufferRef.current.trim()) finishWith(bufferRef.current.trim());
    }, MAX_LISTEN_MS);

    try {
      await requestMicrophoneAccess();
    } catch (err) {
      startingRef.current = false;
      return fail(mapGetUserMediaError(err));
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
      const kind = mapSpeechError(ev.error);
      lastErrorRef.current = kind;
      setStatus(VOICE_MESSAGES[kind]);
    };

    rec.onend = () => {
      const leftover = bufferRef.current.trim();
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
  }, [armSilence, clearTimers, fail, finishWith, listening, notify, stop, teardown]);

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
    start,
    stop,
    toggle,
  } satisfies VoiceInputState & {
    start: () => Promise<string | null>;
    stop: () => void;
    toggle: () => Promise<string | null>;
  };
}
