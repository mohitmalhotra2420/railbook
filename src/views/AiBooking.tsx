/* ══ AI BOOKING (ADDITIVE, Round-62) — prominent alag mode, text + voice ═══════════════════════════════
 * User: "RailBook me ek prominent 'AI Booking' option add karo … user text se bhi booking kar sake aur
 * voice se bhi … existing train cards/TrainBoard/Results UI reuse karo … existing booking state machine
 * ko replace mat karo … AI bina user confirmation ke final booking submit nahi karega … final IRCTC
 * action user ke click par."
 *
 * Ye view sirf NAYA hai — purani kisi cheez ko replace nahi karta:
 *   • Search/availability/fare = maujooda booking context ke wahi functions (searchRoute / selectClass /
 *     selectTrain / goReview) → matlab data wahi provider chain (RailCore/RailKit/web scrape) se aata hai.
 *   • Train cards = maujooda TrainBoard/Results screen (asli board) + uska hi `TrainClassBlock` block.
 *   • Passenger form = maujooda Passengers screen; AI sirf uske fields bharta hai (updatePassenger).
 *   • Review + IRCTC handoff = maujooda ReviewStatus screen (Continue to IRCTC wahi card).
 *   • Voice = maujooda voice stack (useVoiceInput) + naya TTS adapter (server provider ya device voice).
 *
 * Do shakalein:
 *   1) Full screen (jab koi maujooda screen khuli nahi) — poori conversation + asli train/class cards.
 *   2) Dock (jab maujooda screen khuli ho — results/passengers/review) — neeche chhoti AI bar: wahi
 *      conversation jari rehti hai, form upar khula rehta hai. Koi purani screen band nahi hoti.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBooking } from "../booking/context";
import { api } from "../api";
import { TrainClassBlock, type ClassChipData } from "../components/TrainClassBlock";
import { isBookable } from "../types";
import { newId } from "../format";
import { useVoiceInput } from "../voice/useVoiceInput";
import { aiBookingVoice, voiceLinesFor, type VoiceProviderInfo } from "../voice/aiBookingVoice";
import {
  AI_BOOKING_STAGES,
  AI_BOOKING_STAGE_LABELS,
  aiBookingAskLine,
  aiBookingBlank,
  aiBookingClassSelected,
  aiBookingClassUnavailable,
  aiBookingFinalPrompt,
  aiBookingHandoffTurn,
  aiBookingPassengerScreenOpen,
  aiBookingPassengersReady,
  aiBookingStart,
  aiBookingSummaryLines,
  aiBookingTrainsReady,
  aiBookingTurn,
  type AiBookingAction,
  type AiBookingState,
  type AiBookingTurn,
} from "../ai/aiBookingFlow";

interface Msg {
  id: string;
  role: "ai" | "you";
  text: string;
}

export function AiBooking({ open, onClose }: { open: boolean; onClose: () => void }) {
  const booking = useBooking();
  const { state, go, setFrom, setTo, setDate, setPassengerCount, updatePassenger, searchRoute, selectClass, selectTrain, selectTrainAndClassGo, goReview, resetJourney } = booking;
  const live = useRef(booking);
  live.current = booking;
  /* Callbacks ko ref me — effects stale closure par dobara-fire na karein. */
  const cb = useRef({ searchRoute, selectClass, selectTrain, selectTrainAndClassGo, goReview, setFrom, setTo, setDate, setPassengerCount, updatePassenger, resetJourney, go });
  cb.current = { searchRoute, selectClass, selectTrain, selectTrainAndClassGo, goReview, setFrom, setTo, setDate, setPassengerCount, updatePassenger, resetJourney, go };

  const [flow, setFlow] = useState<AiBookingState>(() => aiBookingBlank());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [provider, setProvider] = useState<VoiceProviderInfo | null>(null);
  const [speaking, setSpeaking] = useState(false);
  /* R62c: us train me catering/food options hain? (maujooda pantry API — read-only). null = pata nahi → food ka sawaal nahi. */
  const [foodExpected, setFoodExpected] = useState<boolean | null>(null);
  const started = useRef(false);
  const trainsHandled = useRef(false);
  const reviewHandled = useRef(false);
  const classSynced = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const push = useCallback((role: Msg["role"], text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { id: newId(), role, text }]);
  }, []);

  const speak = useCallback(
    (lines: string[]) => {
      if (!voiceOn || muted) return;
      const say = voiceLinesFor(lines, 2).join(" ");
      if (say) aiBookingVoice.speak(say);
    },
    [voiceOn, muted],
  );

  /* ── Action runner: side effects sirf maujooda booking flow ke through ───────────────────────── */
  const runActions = useCallback(async (actions: AiBookingAction[]) => {
    for (const a of actions) {
      if (a.type === "SET_PASSENGER_COUNT") {
        cb.current.setPassengerCount(a.count);
      } else if (a.type === "PATCH_PASSENGER") {
        const pax = live.current.state.passengers[a.index];
        if (pax) cb.current.updatePassenger(pax.id, a.patch as Partial<typeof pax>);
      } else if (a.type === "SEARCH") {
        /* Correction ke baad nayi search — natija dobara handle karna hai. */
        trainsHandled.current = false;
        /* Journey slots maujooda booking state me rakho (wahi state baaki purane screens padhte hain). */
        cb.current.setFrom(a.from);
        cb.current.setTo(a.to);
        cb.current.setDate(a.date);
        setBusy(true);
        try {
          await cb.current.searchRoute(a.from, a.to, a.date);
        } finally {
          setBusy(false);
        }
      } else if (a.type === "REVIEW" || a.type === "OPEN_REVIEW") {
        /* Maujooda "Continue to review" wahi rasta — goReview() (live availability + fare). */
        setBusy(true);
        try {
          await cb.current.goReview();
        } finally {
          setBusy(false);
        }
      } else if (a.type === "IRCTC_HANDOFF") {
        /* Maujooda "Continue to IRCTC" button khud click — usi ka handoff + autofill layer chalta hai.
         * (Button na mile to saaf fallback line; kuch fake nahi hota.) */
        if (typeof document === "undefined") continue;
        const btn = document.getElementById("irctc-continue") as HTMLButtonElement | null;
        if (btn) {
          btn.click();
        } else {
          push("ai", "IRCTC button abhi screen par nahi hai — Review journey screen par “Continue to IRCTC” dabaiye, details wahin autofill hongi.");
        }
      } else if (a.type === "RESET") {
        cb.current.resetJourney();
        trainsHandled.current = false;
        reviewHandled.current = false;
        classSynced.current = null;
      }
    }
  }, []);

  const applyTurn = useCallback(
    async (turn: AiBookingTurn) => {
      setFlow(turn.state);
      for (const line of turn.say) push("ai", line);
      speak(turn.say);
      if (turn.actions.length) await runActions(turn.actions);
      return turn.state;
    },
    [push, runActions, speak],
  );

  const handleInput = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      push("you", clean);
      const st = live.current.state;
      const env = {
        trains: st.trains,
        classes: st.selectedTrain?.classes ?? st.trains.find((t) => t.number === flow.trainNumber)?.classes ?? [],
        foodExpected,
      };
      const after = await applyTurn(aiBookingTurn(flow, clean, env));

      /* Train chuni gayi → maujooda train-select (isliye asli ClassSelect screen khulti hai). */
      if (after.stage === "CLASS_SELECTION" && after.trainNumber) {
        const train = st.trains.find((t) => t.number === after.trainNumber);
        if (train && st.selectedTrain?.number !== train.number) cb.current.selectTrain(train);
      }

      /* Class chuni gayi → maujooda live availability check (selectClass). */
      if (after.stage === "CLASS_SELECTION" && after.classCode) {
        const klass = env.classes.find((c) => c.code === after.classCode);
        if (klass) {
          await cb.current.selectClass(klass);
          const verified = live.current.state.selectedClass;
          if (verified && verified.code === klass.code) {
            const train = st.selectedTrain ?? st.trains.find((t) => t.number === after.trainNumber) ?? null;
            /* Automation: class select hote hi maujooda passenger form khud khulta hai. */
            if (train) cb.current.selectTrainAndClassGo(train, verified);
            const t2 = await applyTurn(aiBookingClassSelected(after, klass, verified, { food: foodExpected === true }));
            void t2;
          }
        }
      }
    },
    [applyTurn, flow, push],
  );

  /* Voice: maujooda hook (mic permission sirf user ke tap par — background listening nahi). */
  const voice = useVoiceInput(
    (text) => {
      void handleInput(text);
    },
    (msg) => push("ai", msg),
    { manualCommit: true, greet: false },
  );

  /* Start (pehli baar khulte hi) + provider info + "Speaking" state subscription */
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    void applyTurn(aiBookingStart(new Date()));
    void aiBookingVoice.loadProvider().then(setProvider);
  }, [applyTurn, open]);

  useEffect(() => {
    if (!open) return;
    return aiBookingVoice.onState((st) => setSpeaking(st === "speaking"));
  }, [open]);

  /* Food ka sawaal sirf tab jab us train me options hon (maujooda pantry API se — koi guess nahi). */
  useEffect(() => {
    if (!open) return;
    const n = state.selectedTrain?.number ?? flow.trainNumber;
    if (!n) {
      setFoodExpected(null);
      return;
    }
    let alive = true;
    api
      .trainPantry(n)
      .then((p) => {
        if (alive) setFoodExpected(p?.foodChoiceExpected === true);
      })
      .catch(() => {
        if (alive) setFoodExpected(null);
      });
    return () => {
      alive = false;
    };
  }, [open, flow.trainNumber, state.selectedTrain?.number]);

  useEffect(() => {
    if (!open) return;
    /* Purane WebView/jsdom me scrollTo na ho to bhi na toote. */
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open]);

  /* Search ke asli natije (maujooda state.trains) — koi data invent nahi. */
  useEffect(() => {
    if (!open || flow.stage !== "SEARCH_TRAINS" || state.searching || busy) return;
    if (trainsHandled.current) return;
    trainsHandled.current = true;
    void applyTurn(aiBookingTrainsReady(flow, state.trains ?? []));
  }, [applyTurn, busy, flow, open, state.searching, state.trains]);

  /* Passenger form ke asli fields se next ask (form hi source of truth hai). */
  useEffect(() => {
    if (!open || flow.stage !== "PASSENGER_COLLECTION" || busy) return;
    if (!state.passengers.length) return;
    void applyTurn(aiBookingPassengersReady(flow, state.passengers, foodExpected === true));
  }, [applyTurn, busy, flow, open, state.passengers, foodExpected]);

  /* User ne maujooda ClassSelect screen par khud class tap ki → flow usi ko follow kare. */
  useEffect(() => {
    if (!open || flow.classCode || !state.selectedClass) return;
    if (flow.stage !== "CLASS_SELECTION" && flow.stage !== "SHOW_TRAIN_OPTIONS" && flow.stage !== "TRAIN_SELECTED") return;
    const klass = state.selectedClass;
    if (classSynced.current === klass.code) return;
    classSynced.current = klass.code;
    const next: AiBookingState = {
      ...flow,
      stage: "PASSENGER_COLLECTION",
      classCode: klass.code,
      trainNumber: flow.trainNumber ?? state.selectedTrain?.number ?? null,
      trainName: flow.trainName ?? state.selectedTrain?.name ?? null,
      awaiting: "paxName",
    };
    /* Maujooda flow: class chip tap (ClassSelect screen) → passenger form khud khul jaata hai. */
    if (state.selectedTrain) cb.current.selectTrainAndClassGo(state.selectedTrain, klass);
    void applyTurn(aiBookingClassSelected(next, klass, klass, { food: foodExpected === true }));
  }, [applyTurn, flow, open, state.selectedClass, state.selectedTrain]);

  /* Review screen khul gaya → IRCTC handoff line (Continue to IRCTC wahi purana card hai). */
  useEffect(() => {
    if (!open || state.screen !== "review" || reviewHandled.current) return;
    if (flow.stage !== "PASSENGER_REVIEW" && flow.stage !== "BOOKING_REVIEW" && flow.stage !== "FINAL_CONFIRMATION") return;
    reviewHandled.current = true;
    void applyTurn(aiBookingFinalPrompt(flow, state.previewFare?.total ?? null));
  }, [applyTurn, flow, open, state.screen, state.previewFare]);

  /* Voice: mic dabane par pehle bolna band, phir sunna (Android Chrome me dono ek saath nahi chalte). */
  const micTap = useCallback(async () => {
    if (voice.listening) {
      voice.commit();
      return;
    }
    aiBookingVoice.stop();
    setVoiceOn(true);
    const err = await voice.start();
    if (err) push("ai", "Mic nahi chala — aap type bhi kar sakte hain, booking wahi flow chalega.");
  }, [push, voice]);

  const selectedTrainForFlow = useMemo(() => {
    const t = state.selectedTrain;
    if (t && (!flow.trainNumber || t.number === flow.trainNumber)) return t;
    return state.trains.find((x) => x.number === flow.trainNumber) ?? null;
  }, [flow.trainNumber, state.selectedTrain, state.trains]);

  /* “AI Book” — jaise user ne kaha: train+class ke baad passenger screen, aur wahin se AI details. */
  const aiBook = useCallback(async () => {
    const st = live.current.state;
    const train = st.selectedTrain ?? st.trains.find((t) => t.number === flow.trainNumber) ?? null;
    const klass = train?.classes.find((c) => c.code === flow.classCode) ?? st.selectedClass;
    if (!train || !klass) {
      push("ai", "Pehle train aur class chuniye — phir AI Book button aayega.");
      return;
    }
    setBusy(true);
    await cb.current.selectClass(klass); /* maujooda live availability verify */
    setBusy(false);
    const verified = live.current.state.selectedClass;
    if (!verified || verified.code !== klass.code || !isBookable(verified.status)) {
      await applyTurn(aiBookingClassUnavailable(flow, klass.code));
      return;
    }
    cb.current.selectTrainAndClassGo(train, verified);
    await applyTurn({ ...aiBookingPassengerScreenOpen(flow), state: { ...flow, stage: "PASSENGER_COLLECTION", classCode: klass.code } });
  }, [applyTurn, flow, push]);

  const continueBooking = useCallback(async () => {
    /* User ka explicit "haan" (click/voice/text) = confirmation → AI khud IRCTC continue karta hai. */
    await applyTurn(aiBookingHandoffTurn(flow));
  }, [applyTurn, flow]);

  const changeDetails = useCallback(() => {
    cb.current.go("passengers");
    classSynced.current = null;
    void applyTurn(aiBookingTurn(flow, "nahi"));
  }, [applyTurn, flow]);

  if (!open) return null;

  const dock = state.screen !== "home";
  const lastAi = [...msgs].reverse().find((m) => m.role === "ai")?.text ?? "";
  const stageIndex = AI_BOOKING_STAGES.indexOf(flow.stage);
  const thinking = busy || flow.searching;
  const formOpen = state.screen === "passengers";
  const summaryLines = aiBookingSummaryLines({
    from: state.from,
    to: state.to,
    date: state.date,
    trainNumber: state.selectedTrain?.number ?? flow.trainNumber,
    trainName: state.selectedTrain?.name ?? flow.trainName,
    classCode: state.selectedClass?.code ?? flow.classCode,
    passengers: state.passengers.map((p) => ({ name: p.name, age: p.age, gender: p.gender, berthPreference: p.berthPreference, foodChoice: (p as { foodChoice?: string }).foodChoice })),
    fareTotal: state.previewFare?.total ?? null,
  });
  const showBook = Boolean(flow.classCode) && !formOpen && state.screen !== "review";
  const reviewStages = ["PASSENGER_REVIEW", "BOOKING_REVIEW", "FINAL_CONFIRMATION"];
  const showReviewCta = reviewStages.includes(flow.stage) && state.screen === "review";
  const statusLine = voice.listening ? "🎙️ Listening…" : thinking ? "⏳ Thinking…" : speaking ? "🔊 Speaking…" : lastAi;
  const vform = (
    <form
      className="aib-form"
      onSubmit={(e) => {
        e.preventDefault();
        const t = draft.trim();
        setDraft("");
        if (voice.listening) {
          voice.commit();
          return;
        }
        void handleInput(t);
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={voice.listening ? "Listening… (✓ dabao bhejne ke liye)" : "Type kariye ya 🎙️ dabaiye"}
        aria-label="AI Booking me type karo"
        autoComplete="off"
      />
      <button type="button" className={`aib-mic${voice.listening ? " live" : ""}`} onClick={() => void micTap()} aria-label="🎙️ Talk to RailBook" title="🎙️ Talk to RailBook">
        {voice.listening ? "✓" : "🎙️"}
      </button>
      <button type="submit" className="aib-send" aria-label="Send">➤</button>
    </form>
  );
  const voiceControls = (
    <div className="aib-voice-actions" data-testid="aib-voice-actions">
      <button type="button" className="aib-btn-ghost" onClick={() => setMuted((m) => { const n = !m; aiBookingVoice.setMuted(n); if (n) aiBookingVoice.stop(); return n; })}>
        {muted ? "🔇 Unmute" : "🔊 Mute"}
      </button>
      <button type="button" className="aib-btn-ghost" onClick={() => aiBookingVoice.stop()}>⏹ Stop</button>
      <button type="button" className="aib-btn-ghost" onClick={() => { setVoiceOn(false); aiBookingVoice.stop(); voice.cancel(); }}>⌨️ Type instead</button>
      <button type="button" className="aib-btn-ghost" onClick={() => { setVoiceOn(false); aiBookingVoice.stop(); voice.cancel(); }}>✕ End voice</button>
    </div>
  );

  /* ── Dock: maujooda screen (results / passengers / review) ke upar chhoti AI bar ─────────────── */
  if (dock) {
    return (
      <div className="aib-dock" role="region" aria-label="AI Booking">
        {/* Dock me bhi aakhri 2-3 lines dikhti hain — user ko context milta rehta hai. */}
        <div className="aib-dock-log" data-testid="aib-dock-log">
          {msgs.slice(-3).map((m) => (
            <div key={m.id} className={`aib-dock-msg ${m.role}`}>{m.text}</div>
          ))}
        </div>
        <div className="aib-dock-head">
          <b>🎫 AI Booking</b>
          <span className="aib-stage now">{AI_BOOKING_STAGE_LABELS[flow.stage]}</span>
          <span className="aib-dock-text" data-testid="aib-dock-status">
            {statusLine}
          </span>
          <button type="button" className="aib-btn-ghost" onClick={onClose} aria-label="AI Booking band karo">✕</button>
        </div>

        {voice.listening && <div className="aib-voice live" data-testid="aib-voice"><span className="aib-voice-state">Listening…</span><span className="aib-voice-text">{voice.interim || voice.status}</span>{voiceControls}</div>}

        {showReviewCta && (
          <div className="aib-summary" data-testid="aib-summary">
            <b>Booking summary</b>
            <pre>{summaryLines.join("\n")}</pre>
            <div className="aib-actions">
              <button type="button" className="aib-btn" data-testid="aib-change" onClick={changeDetails}>Change Details</button>
              <button type="button" className="aib-primary" data-testid="aib-continue" onClick={() => void continueBooking()}>Continue Booking</button>
            </div>
          </div>
        )}

        <div className="aib-dock-row">
          {showBook && (
            <button type="button" className="aib-primary aib-book-sm" data-testid="aib-book" onClick={() => void aiBook()}>
              🎫 AI Book
            </button>
          )}
          {vform}
        </div>
      </div>
    );
  }

  /* ── Full screen: AI Booking hi primary surface hai ───────────────────────────────────────────── */
  return (
    <div className="aib" role="dialog" aria-label="AI Booking">
      <header className="aib-head">
        <div className="aib-title">
          <span className="aib-mark">🎫</span> AI Booking
          <span className="aib-stage">{AI_BOOKING_STAGE_LABELS[flow.stage]}</span>
        </div>
        <div className="aib-head-right">
          <span className="aib-provider" title="Voice provider (server keys kabhi client par nahi aati)">
            {provider?.kind === "server" ? `voice: ${provider.provider}` : "voice: device"}
          </span>
          <button type="button" className="aib-btn-ghost" onClick={onClose} aria-label="AI Booking band karo">✕</button>
        </div>
      </header>

      <div className="aib-stages" aria-label="Booking steps">
        {AI_BOOKING_STAGES.map((s, i) => (
          <span key={s} className={`aib-stage-chip${i === stageIndex ? " now" : ""}${i < stageIndex ? " done" : ""}`}>
            {AI_BOOKING_STAGE_LABELS[s]}
          </span>
        ))}
      </div>

      <div className="aib-thread" ref={scroller}>
        {msgs.map((m) => (
          <div key={m.id} className={`aib-msg ${m.role}`}>{m.text}</div>
        ))}

        {/* Train options — maujooda TrainClassBlock (asli board/search data) */}
        {flow.stage === "SHOW_TRAIN_OPTIONS" && state.trains.length > 0 && (
          <div className="aib-trains" data-testid="aib-trains">
            {state.trains.slice(0, 6).map((t) => (
              <TrainClassBlock
                key={t.number}
                number={t.number}
                name={t.name}
                timeText={`${t.departure} → ${t.arrival}`}
                countText={`${t.classes.length} classes`}
                tone={t.classes.some((c) => isBookable(c.status)) ? "seat" : "nodata"}
                rows={t.classes.map<ClassChipData>((c) => ({
                  code: c.code,
                  status: c.status,
                  seats: c.seats ?? null,
                  rac: c.rac ?? null,
                  waitlist: c.waitlist ?? null,
                  fare: c.fare ?? null,
                  seat: isBookable(c.status),
                  raw: c,
                }))}
                onHead={() => void handleInput(t.number)}
                onChip={(c) => void handleInput(c.code)}
                chipTitle={(c) => `${c.code} chuno`}
              />
            ))}
          </div>
        )}

        {/* Class chips (asli classes) */}
        {flow.stage === "CLASS_SELECTION" && selectedTrainForFlow && (
          <div className="aib-classes" data-testid="aib-classes">
            {selectedTrainForFlow.classes.map((c) => (
              <button
                key={c.code}
                type="button"
                className={`aib-class${flow.classCode === c.code ? " on" : ""}`}
                onClick={() => void handleInput(c.code)}
              >
                <b>{c.code}</b>
                <span>{c.label || ""}</span>
                <em>{c.status}{c.fare ? ` · ₹${c.fare}` : ""}</em>
              </button>
            ))}
          </div>
        )}

        {flow.stage === "PASSENGER_COLLECTION" && state.screen === "home" && (
          <div className="aib-passenger-note" data-testid="aib-paxnote">
            Passenger form abhi band hai — “AI Book” dabane par khulega aur main wahin details bharoongi.
          </div>
        )}

        {showReviewCta && (
          <div className="aib-summary" data-testid="aib-summary">
            <b>Booking summary</b>
            <pre>{summaryLines.join("\n")}</pre>
          </div>
        )}
      </div>

      {(voice.listening || thinking || voiceOn) && (
        <div className={`aib-voice${voice.listening ? " live" : ""}`} data-testid="aib-voice">
          <span className="aib-voice-state">{voice.listening ? "🎙️ Listening…" : thinking ? "⏳ Thinking…" : speaking ? "🔊 Speaking…" : muted ? "🔇 Muted" : "Voice on"}</span>
          <span className="aib-voice-text">{voice.interim || voice.status}</span>
          {voiceControls}
        </div>
      )}

      <div className="aib-actions">
        {showBook && (
          <button type="button" className="aib-primary" data-testid="aib-book" onClick={() => void aiBook()}>
            🎫 AI Book — passenger form kholo
          </button>
        )}
        {showReviewCta && (
          <>
            <button type="button" className="aib-btn" data-testid="aib-change" onClick={changeDetails}>Change Details</button>
            <button type="button" className="aib-primary" data-testid="aib-continue" onClick={() => void continueBooking()}>Continue Booking</button>
          </>
        )}
      </div>

      {vform}
    </div>
  );
}
