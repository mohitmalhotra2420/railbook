import { useEffect, useMemo, useRef } from "react";
import { useBooking } from "../booking/context";
import { VoiceBar, fieldPrompt } from "../components/VoiceBar";
import { Shell } from "../components/Shell";
import { BERTH_BY_CLASS } from "../types";
import {
  ageIsValid,
  nameIsValid,
  nextPassengerAsk,
  parsePassengerSpeech,
  sanitizePassengerAge,
  sanitizePassengerName,
  type PaxAsk,
} from "../voice/passengerSpeech";
import { afterPassengerFill, passengerAskLine, speakGuide } from "../voice/speakGuide";

function fieldClass(filled: boolean, on: boolean): string {
  if (filled) return "done";
  return on ? "need" : "need";
}

export function Passengers() {
  const {
    state,
    fieldErrors,
    updatePassenger,
    addPassenger,
    removePassenger,
    goReview,
  } = useBooking();
  const berths = state.selectedClass
    ? BERTH_BY_CLASS[state.selectedClass.code]
    : [];

  const focus = useMemo(() => {
    for (const p of state.passengers) {
      const slot = nextPassengerAsk(p);
      if (slot) return { id: p.id, slot };
    }
    return { id: state.passengers[0]?.id ?? "", slot: null as PaxAsk };
  }, [state.passengers]);

  const ready = !focus.slot;
  const prevAsk = useRef<{ id: string; slot: PaxAsk } | null>(null);
  const greeted = useRef(false);

  const prompt = useMemo(() => {
    if (focus.slot === "name") return fieldPrompt("NAAM", "sirf letters, jaise Rahul Sharma");
    if (focus.slot === "age") return fieldPrompt("UMAR", "sirf number, jaise 28");
    if (focus.slot === "gender") return fieldPrompt("GENDER", "male, female, ya other");
    if (focus.slot === "berth") return fieldPrompt("BERTH", "Lower, Upper, Window…");
    return (
      <>
        <strong className="vb-field">SAB READY</strong>
        <span className="vb-rest"> — Review fare dabaiye.</span>
      </>
    );
  }, [focus.slot]);

  useEffect(() => {
    if (!focus.id || !focus.slot) return;
    const el = document.getElementById(`${focus.slot}-${focus.id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus.id, focus.slot]);

  useEffect(() => {
    const prev = prevAsk.current;
    if (!greeted.current) {
      greeted.current = true;
      prevAsk.current = { id: focus.id, slot: focus.slot };
      speakGuide(passengerAskLine(focus.slot));
      return;
    }
    if (prev && (prev.slot !== focus.slot || prev.id !== focus.id) && prev.slot) {
      speakGuide(afterPassengerFill(prev.slot, focus.slot));
    } else if (prev && prev.slot && !focus.slot) {
      speakGuide(afterPassengerFill(prev.slot, null));
    }
    prevAsk.current = { id: focus.id, slot: focus.slot };
  }, [focus.id, focus.slot]);

  function onVoice(text: string) {
    const target = state.passengers.find((p) => p.id === focus.id) ?? state.passengers[0];
    if (!target) return;
    const slot = nextPassengerAsk(target);
    const patch = parsePassengerSpeech(text, berths, slot);
    if (!Object.keys(patch).length) {
      speakGuide(`Samajh nahi aaya. ${passengerAskLine(slot)}`);
      return;
    }
    updatePassenger(target.id, patch);
  }

  return (
    <Shell title="Passengers" back>
      <div className="dock-screen">
      <main className="page dock-scroll">
        {state.error && <div className="banner err">{state.error}</div>}
        {state.passengers.map((p, i) => {
          const err = fieldErrors[p.id] ?? {};
          const on = focus.id === p.id ? focus.slot : null;
          const nameOk = nameIsValid(p.name);
          const ageOk = ageIsValid(p.age);
          const genderOk = Boolean(p.gender);
          const berthOk = Boolean(p.berthPreference);
          return (
            <section className="pax-card" key={p.id}>
              <div className="pax-head">
                <h2>Passenger {i + 1}</h2>
                {state.passengers.length > 1 && (
                  <button className="btn sm ghost" onClick={() => removePassenger(p.id)}>
                    Remove
                  </button>
                )}
              </div>
              <div className={`field ${fieldClass(nameOk, on === "name")}`}>
                <label htmlFor={`name-${p.id}`}>Name</label>
                <div className={`control ${err.name ? "bad" : ""} ${fieldClass(nameOk, on === "name")}`}>
                  <input
                    id={`name-${p.id}`}
                    autoComplete="name"
                    inputMode="text"
                    placeholder="As on ID — letters only"
                    value={p.name}
                    onChange={(e) => updatePassenger(p.id, { name: sanitizePassengerName(e.target.value) })}
                  />
                </div>
                {err.name && <div className="err-msg">{err.name}</div>}
              </div>
              <div className="pair">
                <div className={`field ${fieldClass(ageOk, on === "age")}`}>
                  <label htmlFor={`age-${p.id}`}>Age</label>
                  <div className={`control ${err.age ? "bad" : ""} ${fieldClass(ageOk, on === "age")}`}>
                    <input
                      id={`age-${p.id}`}
                      inputMode="numeric"
                      placeholder="Years"
                      value={p.age}
                      onChange={(e) => updatePassenger(p.id, { age: sanitizePassengerAge(e.target.value) })}
                    />
                  </div>
                  {err.age && <div className="err-msg">{err.age}</div>}
                </div>
                <div className={`field ${fieldClass(genderOk, on === "gender")}`}>
                  <label htmlFor={`gender-${p.id}`}>Gender</label>
                  <div className={`control ${err.gender ? "bad" : ""} ${fieldClass(genderOk, on === "gender")}`}>
                    <select
                      id={`gender-${p.id}`}
                      value={p.gender || ""}
                      autoComplete="off"
                      onChange={(e) =>
                        updatePassenger(p.id, { gender: e.target.value as typeof p.gender })
                      }
                    >
                      <option value="">Select</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  {err.gender && <div className="err-msg">{err.gender}</div>}
                </div>
              </div>
              <div className={`field ${fieldClass(berthOk, on === "berth")}`}>
                <label htmlFor={`berth-${p.id}`}>Berth preference</label>
                <div className={`control ${err.berthPreference ? "bad" : ""} ${fieldClass(berthOk, on === "berth")}`}>
                  <select
                    id={`berth-${p.id}`}
                    value={p.berthPreference}
                    onChange={(e) => updatePassenger(p.id, { berthPreference: e.target.value })}
                  >
                    <option value="">Select</option>
                    {berths.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
                {err.berthPreference && <div className="err-msg">{err.berthPreference}</div>}
              </div>
            </section>
          );
        })}
        {state.passengers.length < 6 && (
          <button className="btn ghost" onClick={addPassenger}>
            Add Passenger
          </button>
        )}
      </main>
      <VoiceBar prompt={prompt} onSpeak={onVoice} placeholder="Naam, phir umar, phir gender…" />
      <div className="sticky-cta">
        <button
          className="btn primary"
          disabled={!ready}
          onClick={() => {
            if (!ready) return;
            void goReview();
          }}
        >
          Review fare
        </button>
      </div>
      </div>
    </Shell>
  );
}
