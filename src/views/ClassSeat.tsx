import { useEffect } from "react";
import { useBooking } from "../booking/context";
import { VoiceBar, fieldPrompt } from "../components/VoiceBar";
import { Shell } from "../components/Shell";
import { DatePicker } from "../components/Pickers";
import { availabilityLabel, inr } from "../format";
import { BERTH_BY_CLASS, isBookable } from "../types";
import { matchBerthBySpeech, matchClassBySpeech } from "../voice/matchVisible";
import { speakGuide } from "../voice/speakGuide";

export function ClassSelect() {
  const { state, selectClass, setDate } = useBooking();
  const train = state.selectedTrain;
  if (!train) return null;

  return (
    <Shell title="Select class" back>
      <div className="dock-screen">
      <main className="page dock-scroll">
        <DatePicker value={state.date} onChange={setDate} />
        <p className="lede" style={{ marginBottom: 12 }}>
          {train.number} {train.name} · {train.departure} → {train.arrival}
        </p>
        {state.notice && <div className="banner warn">{state.notice}</div>}
        {state.error && <div className="banner err">{state.error}</div>}
        <h2 style={{ marginBottom: 10 }}>Select your class</h2>
        <div className={`class-list ${state.selectedClass ? "done" : "need"}`}>
          {train.classes.map((c) => {
            const ok = isBookable(c.status);
            return (
              <button
                key={c.code}
                className={`class-item ${!ok ? "disabled" : ""} ${state.selectedClass?.code === c.code ? "on" : ""}`}
                disabled={!ok}
                onClick={() => {
                  speakGuide(`Aapki class select ho gayi hai, ${c.label}. Ab aap seat preference select karein.`);
                  void selectClass(c);
                }}
              >
                <div>
                  <strong>{c.label}</strong>
                  <div className="meta">{availabilityLabel(c.status, c)}</div>
                </div>
                <div className="fare">{ok ? inr(c.fare) : "—"}</div>
              </button>
            );
          })}
        </div>
        <VoiceBar
          prompt={fieldPrompt("CLASS", "sleeper, 3AC, SL, 3A…")}
          onSpeak={(text) => {
            const row = matchClassBySpeech(text, train.classes);
            if (row) {
              speakGuide(`Aapki class select ho gayi hai, ${row.label}. Ab aap seat preference select karein.`);
              void selectClass(row);
            } else {
              speakGuide("Class samajh nahi aayi. Sleeper, 3 A C, ya screen pe jo likha hai wahi boliye.");
            }
          }}
        />
      </main>
      </div>
    </Shell>
  );
}

export function SeatSelect() {
  const { state, selectSeat } = useBooking();
  const klass = state.selectedClass;
  if (!klass) return null;
  const options = BERTH_BY_CLASS[klass.code] ?? [];
  const sitting = ["CC", "EC", "2S", "EA"].includes(klass.code);
  const berthHint = options.join(", ");

  useEffect(() => {
    speakGuide(`Ab berth preference select karein — ${berthHint}.`);
  }, [berthHint]);

  return (
    <Shell title="Seat preference" back>
      <div className="dock-screen">
      <main className="page dock-scroll">
        {state.notice && <div className="banner warn">{state.notice}</div>}
        <h2>{sitting ? "Please select your seat preference" : "Please select your seat preference"}</h2>
        <p className="lede" style={{ marginBottom: 16 }}>
          {klass.label} · preference is requested, not guaranteed
        </p>
        <div className={`choice-grid ${state.seatPreference ? "done" : "need"}`}>
          {options.map((opt) => (
            <button
              key={opt}
              className={`choice ${state.seatPreference === opt ? "on" : ""}`}
              onClick={() => {
                speakGuide("Aapki seat select ho gayi hai. Ab passenger ka naam bhariye.");
                selectSeat(opt);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
        <VoiceBar
          prompt={fieldPrompt("SEAT", berthHint)}
          onSpeak={(text) => {
            const opt = matchBerthBySpeech(text, options);
            if (opt) {
              speakGuide("Aapki seat select ho gayi hai. Ab passenger ka naam bhariye.");
              selectSeat(opt);
            } else {
              speakGuide(`Seat samajh nahi aayi. ${berthHint} boliye.`);
            }
          }}
        />
      </main>
      </div>
    </Shell>
  );
}
