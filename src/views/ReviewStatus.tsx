import { useBooking } from "../booking/context";
import { IrctcHandoff } from "../components/IrctcHandoff";
import { Shell } from "../components/Shell";
import { formatLongDate, inr } from "../format";
import { CLASS_LABELS, type Passenger } from "../types";

/* Round-23 (26 Sep, user): "es page pe bas Continue to IRCTC show hona chahiye — booking summary
 * aur wallet hata do; copy journey+passenger summary user ko nahi dikhna chahiye; neeche jo Confirm
 * Booking aata hai wo bhi hata do."
 *
 * Round-24 (26 Sep, user screenshot 2): "Review fare ki jagah Review journey aana chahiye ... uski page
 * pe journey summary (jo bhi user ne details fill ki hongi wo) show ho aur uske NEECHE Continue to
 * IRCTC — uske elawa us page pe kuch mat rakhna."
 *
 * Isliye is page par sirf do cheezein hain, isi order me:
 *   1. Journey receipt — screenshot-2 wale rows (Train / Date / From → To / Class / Seat / Passengers /
 *      Base fare / Service fee / Total) + user ke bhare hue passenger + contact details.
 *   2. Uske neeche IRCTC handoff card (sirf "Continue to IRCTC").
 * Wallet, sticky Confirm Booking, copy buttons aur "Nothing is confirmed…" note yahan nahi hain.
 * RailBook ka apna booking flow (Passengers → confirm) jaisa tha waisa hi maujood hai — sirf is
 * review screen se wo buttons/blocks hataye gaye (user ka flow: journey RailBook me chunna, booking
 * IRCTC par).
 */
export function FareReview() {
  const { state } = useBooking();
  const train = state.selectedTrain;
  const klass = state.selectedClass;
  if (!train || !klass) return null;

  const fare = state.previewFare ?? {
    baseFare: klass.fare * state.passengers.length,
    serviceFee: 0,
    total: klass.fare * state.passengers.length,
  };
  const fareUnknown = "railwayAvailable" in fare && fare.railwayAvailable === false;
  const contact = state.contact;

  return (
    <Shell title="Review journey" back>
      <main className="page tight">
        {/* 1 ── Journey receipt: jo user ne bhara, wahi (koi naya/fake data nahi). */}
        <section className="summary" id="rv-journey">
          <div className="row"><span className="k">Train</span><span>{train.number} {train.name}</span></div>
          <div className="row"><span className="k">Date</span><span>{formatLongDate(train.date)}</span></div>
          <div className="row"><span className="k">From → To</span><span>{train.from.code} → {train.to.code}</span></div>
          <div className="row"><span className="k">Class</span><span>{CLASS_LABELS[klass.code]}</span></div>
          {state.seatPreference && (
            <div className="row"><span className="k">Seat</span><span>{state.seatPreference}</span></div>
          )}
          <div className="row">
            <span className="k">Passengers</span>
            <span>{state.passengers.map((p) => p.name.trim()).filter(Boolean).join(", ") || `${state.passengers.length}`}</span>
          </div>
          <div className="row"><span className="k">Base fare</span><span>{fareUnknown ? "Fare unavailable" : inr(fare.baseFare)}</span></div>
          <div className="row"><span className="k">Service fee</span><span>{fareUnknown ? "—" : inr(fare.serviceFee)}</span></div>
          <div className="row total">
            <span>Total</span>
            <span>{fareUnknown ? "—" : inr(fare.total)}</span>
          </div>
        </section>

        {/* 2 ── Passenger + contact details: jo form me bhara gaya, wahi yahan dikhta hai. */}
        <section className="summary" id="rv-passengers" style={{ marginTop: 12 }}>
          {state.passengers.map((p, i) => (
            <div className="row" key={p.id}>
              <span className="k">Passenger {i + 1}</span>
              <span className="rv-v">{passengerLine(p)}</span>
            </div>
          ))}
          <div className="row"><span className="k">Mobile</span><span>{contact?.mobile || "—"}</span></div>
          <div className="row"><span className="k">Email</span><span>{contact?.email || "—"}</span></div>
          {contact?.whatsappOptIn && (
            <div className="row"><span className="k">WhatsApp updates</span><span>Haan</span></div>
          )}
        </section>

        {/* 3 ── Uske neeche sirf Continue to IRCTC (Round-21: food/catering + IRCTC ke dono checkbox +
            contact bhi autofill ke liye jaate hain). */}
        <IrctcHandoff
          train={train}
          date={state.date}
          classCode={klass.code}
          passengers={state.passengers}
          contact={state.contact}
        />
      </main>
    </Shell>
  );
}

/* Passenger ki poori line — naam · umar · gender · berth · khaana (jo bhara) + IRCTC checkbox. */
const FOOD_TEXT: Record<string, string> = { VEG: "Veg meal", NON_VEG: "Non-veg meal", NO_FOOD: "No food" };
const GENDER_TEXT: Record<string, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };

function passengerLine(p: Passenger): string {
  const bits = [
    p.name.trim(),
    p.age ? `${p.age} yrs` : "",
    p.gender ? GENDER_TEXT[p.gender] ?? "" : "",
    p.berthPreference,
    p.foodChoice ? FOOD_TEXT[p.foodChoice] ?? "" : "",
    p.idType ? `ID: ${p.idType}${p.idNumber ? ` ${p.idNumber}` : ""}` : "",
    p.bookOnlyIfConfirm ? "Book only if confirm berth" : "",
    p.autoUpgrade ? "Auto up-gradation" : "",
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "—";
}

export function Status() {
  const { state, newBooking, go, retrieve } = useBooking();
  const b = state.booking;

  if (!b) {
    return (
      <Shell title="Booking status" back>
        <main className="page">
          <h2>Find a booking</h2>
          <RetrieveForm onGo={retrieve} />
        </main>
      </Shell>
    );
  }

  const ok = b.status === "CONFIRMED";
  const failed = b.status === "FAILED" || b.status === "CANCELLED";

  return (
    <Shell title="Booking status" back>
      <main className="page tight">
        <div className="status-hero">
          <div className={`mark ${ok ? "ok" : failed ? "bad" : "wait"}`}>
            {ok ? "✓" : failed ? "!" : "…"}
          </div>
          <h1>
            {b.status === "CONFIRMED" && "Booking confirmed"}
            {b.status === "FAILED" && "Booking failed"}
            {b.status === "CANCELLED" && "Booking cancelled"}
            {b.status === "BOOKING_PENDING" && "Waiting for provider"}
            {b.status === "DRAFT" && "Awaiting confirmation"}
            {b.status === "PAYMENT_PENDING" && "Payment pending"}
          </h1>
          {b.mock && <div className="mock-tag">Mock / demo booking</div>}
          {ok && b.pnr && <div className="pnr">{b.pnr}</div>}
          {ok && b.pnr && <div className="muted">PNR issued by mock provider</div>}
          {b.failureReason && <p className="lede">{b.failureReason}</p>}
        </div>

        <section className="summary" style={{ marginTop: 16 }}>
          <div className="row"><span className="k">Train</span><span>{b.trainNumber} {b.trainName}</span></div>
          <div className="row"><span className="k">Date</span><span>{formatLongDate(b.date)}</span></div>
          <div className="row"><span className="k">From → To</span><span>{b.from.code} → {b.to.code}</span></div>
          <div className="row"><span className="k">Class</span><span>{CLASS_LABELS[b.classCode]}</span></div>
          <div className="row"><span className="k">Passengers</span><span>{b.passengers.map((p) => p.name).join(", ")}</span></div>
          <div className="row total"><span>Total</span><span>{inr(b.fare.total)}</span></div>
        </section>

        <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
          <button className="btn primary" onClick={newBooking}>Book another</button>
          <button className="btn ghost" onClick={() => go("bookings")}>My Bookings</button>
        </div>
      </main>
    </Shell>
  );
}

function RetrieveForm({ onGo }: { onGo: (id: string) => Promise<void> }) {
  const { state } = useBooking();
  return (
    <form
      className="widget"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        void onGo(String(fd.get("id") ?? ""));
      }}
    >
      <div className="field">
        <label htmlFor="pnr">Booking ID or PNR</label>
        <div className="control">
          <input id="pnr" name="id" placeholder="RB-… or MOCK…" />
        </div>
      </div>
      {state.error && <div className="banner err">{state.error}</div>}
      <button className="btn navy" type="submit">Retrieve</button>
    </form>
  );
}
