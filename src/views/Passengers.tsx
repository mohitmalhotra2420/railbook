/* Round-20 (25 Sep 2026) — Passenger form, IRCTC ke passenger-details jaisa.
 * User: "passenger form na IRCTC ke according rakho same to same except that insurance, payment part
 *        — passenger details same to same IRCTC jaisa rakho details, jis train mein catering hai
 *        usmein catering rakho, and train class real train data ke according ho, jis train mein jo
 *        class hai wahi show ho."
 *
 * Isliye yahan: booking summary (train number · date · from → to · class · fare — apne aap, kyunki
 * class chip se hi aaye ho), phir har passenger ke IRCTC wale fields (naam, umar, gender, berth,
 * khaana (sirf jab pantry ho — server probe se real), ID proof optional, dono IRCTC checkbox),
 * aur Contact Details (mobile/email). Insurance aur payment ka koi hissa nahi (user ne chhoda).
 * Voice flow (VoiceBar) pehle jaisa hi chalta hai — koi logic nahi badla.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useBooking } from "../booking/context";
import { VoiceBar, fieldPrompt } from "../components/VoiceBar";
import { Shell } from "../components/Shell";
import { BERTH_BY_CLASS } from "../types";
import { inr } from "../format";
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
import { api } from "../api";

/* IRCTC ke ID proof options (wahi list jo reservation form me hoti hai). */
const ID_TYPES = [
  "Aadhaar (आधार)",
  "PAN Card",
  "Passport",
  "Voter ID",
  "Driving Licence",
  "Ration Card",
  "Student ID",
  "Bank Passbook",
];

/* IRCTC food choice (jab train me catering/pantry ho). Menu train-specific nahi invent kar rahe —
 * sirf Veg / Non-Veg / No Food, aur note: exact menu IRCTC booking par. */
const FOOD_CHOICES: { value: "" | "VEG" | "NON_VEG" | "NO_FOOD"; label: string }[] = [
  { value: "", label: "Select" },
  { value: "VEG", label: "Veg meal" },
  { value: "NON_VEG", label: "Non-veg meal" },
  { value: "NO_FOOD", label: "No food (mujhe nahi chahiye)" },
];

function fieldClass(filled: boolean): string {
  return filled ? "done" : "need";
}

/* Round-21b (25 Sep, user: "kuch bhi fake mat rakho — jis train me food choice hai hi nahi to kyu dikha rahe"):
 * pehle hum sirf merged `pantry` dekh kar Food choice dikha dete the; 12716/12926 par erail "available"
 * kehta tha jabki confirmtkt false — aur IRCTC ke booking page par wo option hi nahi aata. Ab:
 *   • foodChoiceExpected === true → tabhi Food choice dropdown (server ka honest gate)
 *   • conflict / "nahi hai" → dropdown nahi, neeche honest line (sources ke saath) */
type Pantry = {
  pantry: boolean | null;
  providers: string[];
  note: string | null;
  conflict?: boolean;
  premiumCatering?: boolean;
  foodChoiceExpected?: boolean;
  evidence?: string[];
};

export function Passengers() {
  const {
    state,
    fieldErrors,
    updatePassenger,
    updateContact,
    addPassenger,
    removePassenger,
    goReview,
  } = useBooking();
  const berths = state.selectedClass
    ? BERTH_BY_CLASS[state.selectedClass.code]
    : [];

  /* ── Catering: train ka REAL pantry data (README: wahi endpoint jo AI ka TRAIN_FACTS tool use
   * karta hai). Sirf tab dikhate hain jab data aa jaye — warna "info nahi mili" (jhooth nahi). */
  const trainNumber = state.selectedTrain?.number ?? "";
  const [pantry, setPantry] = useState<Pantry | null>(null);
  useEffect(() => {
    if (!trainNumber) return;
    let alive = true;
    setPantry(null);
    void api
      .trainPantry(trainNumber)
      .then((p) => {
        if (alive) setPantry(p);
      })
      .catch(() => {
        if (alive) setPantry({ pantry: null, providers: [], note: "pantry info provider se nahi aayi" });
      });
    return () => {
      alive = false;
    };
  }, [trainNumber]);

  const focus = useMemo(() => {
    for (const p of state.passengers) {
      const slot = nextPassengerAsk(p);
      if (slot) return { id: p.id, slot };
    }
    return { id: state.passengers[0]?.id ?? "", slot: null as PaxAsk };
  }, [state.passengers]);

  const ready = !focus.slot;
  const contactOk = /^\d{10}$/.test(state.contact?.mobile ?? "");
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
        <span className="vb-rest"> — Review journey dabaiye.</span>
      </>
    );
  }, [focus.slot]);

  /* Round-24 (user screenshot 1): device par page khaali (bas background) dikh raha tha —
   * (a) agar passengers list khaali ho gayi ho to ek blank card khud bana do (warna "SAB READY"
   *     dikhta hai par bharne ke liye kuch nahi hota), aur
   * (b) keyboard/IME ya rotate ke baad scroll ko content ke andar clamp karo — warna scroller
   *     khaali hisse par atak jaata hai. Screen khulte hi scroll top par. */
  const scrollRef = useRef<HTMLElement | null>(null);
  const ensuredPax = useRef(false);
  useEffect(() => {
    if (ensuredPax.current) return;
    if (state.passengers.length === 0) {
      ensuredPax.current = true;
      addPassenger();
    }
  }, [state.passengers.length, addPassenger]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const clamp = () => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (el.scrollTop > max) el.scrollTop = max;
    };
    const vv = window.visualViewport;
    window.addEventListener("resize", clamp);
    vv?.addEventListener?.("resize", clamp);
    const t = window.setTimeout(clamp, 400);
    return () => {
      window.removeEventListener("resize", clamp);
      vv?.removeEventListener?.("resize", clamp);
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!focus.id || !focus.slot) return;
    const el = document.getElementById(`${focus.slot}-${focus.id}`);
    /* jsdom/older webview me scrollIntoView na ho to bhi form chalta rahe. */
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
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

  const train = state.selectedTrain;
  const klass = state.selectedClass;

  return (
    <Shell title="Passengers" back>
      <div className="dock-screen">
      <main className="page dock-scroll" ref={scrollRef}>
        {state.error && <div className="banner err">{state.error}</div>}

        {/* ── Booking summary: train number · date · from → to — apne aap, chip tap se aaya data ── */}
        {train && (
          <section className="pax-trip">
            <div className="pax-trip-top">
              <span className="pax-trip-no">{train.number}</span> <strong>{train.name}</strong>
              {klass && <span className="pax-trip-class">{klass.code}</span>}
            </div>
            <div className="pax-trip-route">
              <span><b>{train.from.code}</b> {train.from.name !== train.from.code ? train.from.name : ""}</span>
              <span className="jra-arrow">→</span>
              <span><b>{train.to.code}</b> {train.to.name !== train.to.code ? train.to.name : ""}</span>
            </div>
            <div className="pax-trip-meta">
              <span>📅 {train.date}</span>
              <span>🕑 {train.departure} → {train.arrival}{train.arrivalDayOffset > 0 ? ` (+${train.arrivalDayOffset}d)` : ""}</span>
              {klass && <span>💰 {inr(klass.fare)} <span className="muted">per passenger</span></span>}
            </div>
            {klass?.source && (
              <div className="pax-trip-src muted">
                Seat: {klass.status === "AVAILABLE" ? `AVL ${klass.seats ?? "—"}` : klass.status === "RAC" ? `RAC ${klass.rac ?? "—"}` : klass.status === "WAITLIST" ? `WL ${klass.waitlist ?? "—"}` : "N/A"} · source {klass.source.includes("web_") ? klass.source.replace("web_", "") : klass.source}
              </div>
            )}
          </section>
        )}

        {/* ── Catering (IRCTC jaisa food choice) — sirf REAL + saaf data par. Jo provider kehta hai wahi. ── */}
        {pantry && (
          <div className={`pax-catering ${pantry.foodChoiceExpected ? "yes" : pantry.conflict ? "warn" : "no"}`}>
            {pantry.foodChoiceExpected
              ? `🍽️ Is train me catering hai — har passenger ke khaane ka option neeche hai (IRCTC "Food choice" me wahi jaayega).`
              : pantry.conflict
                ? `⚠️ Catering data me sources aapas me alag hain — isliye RailBook yahan Food choice nahi dikha raha (guess nahi karte).`
                : pantry.pantry === false
                  ? `🍽️ Is train me pantry/catering nahi mili — khaana IRCTC eCatering (ecatering.irctc.co.in) se en-route station par order kar sakte ho.`
                  : `🍽️ Catering info provider se nahi aayi — IRCTC booking page par jo dikhe wahi final.`}
            {pantry.providers.length > 0 && <span className="muted"> · {pantry.providers.join("+")}</span>}
            {!!pantry.evidence?.length && (
              <div className="pax-catering-ev muted">{pantry.evidence.join(" · ")}</div>
            )}
            {!pantry.foodChoiceExpected && pantry.pantry !== false && !pantry.conflict && (
              <div className="pax-catering-ev muted">IRCTC booking page par food option dikhe to wahan se chun lena — hum sirf wahi autofill karte hain jo IRCTC me hota hai.</div>
            )}
          </div>
        )}

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
              <div className={`field ${fieldClass(nameOk)}`}>
                <label htmlFor={`name-${p.id}`}>Name</label>
                <div className={`control ${err.name ? "bad" : ""} ${fieldClass(nameOk)}`}>
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
                <div className={`field ${fieldClass(ageOk)}`}>
                  <label htmlFor={`age-${p.id}`}>Age</label>
                  <div className={`control ${err.age ? "bad" : ""} ${fieldClass(ageOk)}`}>
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
                <div className={`field ${fieldClass(genderOk)}`}>
                  <label htmlFor={`gender-${p.id}`}>Gender</label>
                  <div className={`control ${err.gender ? "bad" : ""} ${fieldClass(genderOk)}`}>
                    <select
                      id={`gender-${p.id}`}
                      value={p.gender || ""}
                      autoComplete="off"
                      onChange={(e) => updatePassenger(p.id, { gender: e.target.value as typeof p.gender })}
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
              <div className="pair">
                <div className={`field ${fieldClass(berthOk)}`}>
                  <label htmlFor={`berth-${p.id}`}>Berth preference</label>
                  <div className={`control ${err.berthPreference ? "bad" : ""} ${fieldClass(berthOk)}`}>
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
                {/* IRCTC food choice — sirf jab catering ka REAL + saaf signal ho (warna IRCTC me bhi nahi hota). */}
                {pantry?.foodChoiceExpected === true && (
                  <div className="field">
                    <label htmlFor={`food-${p.id}`}>Food choice</label>
                    <div className="control">
                      <select
                        id={`food-${p.id}`}
                        value={p.foodChoice ?? ""}
                        onChange={(e) => updatePassenger(p.id, { foodChoice: e.target.value as typeof p.foodChoice })}
                      >
                        {FOOD_CHOICES.map((f) => (
                          <option key={f.value || "none"} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
              {/* IRCTC jaisa optional ID proof. */}
              <div className="pair">
                <div className="field">
                  <label htmlFor={`idtype-${p.id}`}>ID proof <span className="muted">(optional)</span></label>
                  <div className="control">
                    <select
                      id={`idtype-${p.id}`}
                      value={p.idType ?? ""}
                      onChange={(e) => updatePassenger(p.id, { idType: e.target.value })}
                    >
                      <option value="">Select</option>
                      {ID_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor={`idnum-${p.id}`}>ID number <span className="muted">(optional)</span></label>
                  <div className="control">
                    <input
                      id={`idnum-${p.id}`}
                      inputMode="text"
                      placeholder="ID number"
                      value={p.idNumber ?? ""}
                      onChange={(e) => updatePassenger(p.id, { idNumber: e.target.value.slice(0, 24) })}
                    />
                  </div>
                </div>
              </div>
              {/* IRCTC ke do checkbox (insurance/payment nahi — user ne wahi chhoda). */}
              <label className="pax-check">
                <input
                  type="checkbox"
                  checked={Boolean(p.bookOnlyIfConfirm)}
                  onChange={(e) => updatePassenger(p.id, { bookOnlyIfConfirm: e.target.checked })}
                />
                <span>Book only if confirm berths are allotted <span className="muted">(IRCTC jaisa)</span></span>
              </label>
              <label className="pax-check">
                <input
                  type="checkbox"
                  checked={Boolean(p.autoUpgrade)}
                  onChange={(e) => updatePassenger(p.id, { autoUpgrade: e.target.checked })}
                />
                <span>Consider for auto up-gradation <span className="muted">(IRCTC jaisa)</span></span>
              </label>
            </section>
          );
        })}
        {state.passengers.length < 6 && (
          <button className="btn ghost" onClick={addPassenger}>
            + Add passenger (max 6)
          </button>
        )}

        {/* ── Contact details (IRCTC: booking confirmation isi number/mail par jaati hai) ── */}
        <section className="pax-card">
          <div className="pax-head">
            <h2>Contact details</h2>
          </div>
          <div className="pair">
            <div className="field">
              <label htmlFor="contact-mobile">Mobile number</label>
              <div className={`control ${state.contact?.mobile && !contactOk ? "bad" : ""}`}>
                <input
                  id="contact-mobile"
                  inputMode="numeric"
                  placeholder="10 digit mobile"
                  value={state.contact?.mobile ?? ""}
                  onChange={(e) => updateContact({ mobile: e.target.value })}
                />
              </div>
              {state.contact?.mobile && !contactOk && <div className="err-msg">10 digit number daalo (jaise 98xxxxxxxx)</div>}
            </div>
            <div className="field">
              <label htmlFor="contact-email">Email <span className="muted">(optional)</span></label>
              <div className="control">
                <input
                  id="contact-email"
                  inputMode="email"
                  placeholder="ticket@example.com"
                  value={state.contact?.email ?? ""}
                  onChange={(e) => updateContact({ email: e.target.value.slice(0, 60) })}
                />
              </div>
            </div>
          </div>
          <label className="pax-check">
            <input
              type="checkbox"
              checked={state.contact?.whatsappOptIn ?? false}
              onChange={(e) => updateContact({ whatsappOptIn: e.target.checked })}
            />
            <span>Journey updates WhatsApp par bhi bhejo</span>
          </label>
          <div className="pax-skip muted">
            Insurance aur payment yahan nahi hai — wo IRCTC handoff (jaise pehle se) par.
          </div>
        </section>
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
          Review journey
        </button>
      </div>
      </div>
    </Shell>
  );
}
