import { useBooking } from "../booking/context";
import { IrctcHandoff } from "../components/IrctcHandoff";
import { Shell } from "../components/Shell";
import { formatLongDate, inr } from "../format";
import { CLASS_LABELS } from "../types";

/* Round-23 (26 Sep 2026, user screenshot): "es page pe bas Continue to IRCTC show hona chahiye —
 * booking summary aur wallet hata do; copy journey+passenger summary user ko nahi dikhna chahiye;
 * neeche jo Confirm Booking aata hai wo bhi hata do."
 *
 * Isliye is page par SIRF IRCTC handoff card hai. RailBook ke andar ka booking/payment flow
 * (Passengers → confirm) waise hi maujood hai — usse chhua nahi gaya, bas review screen se wo
 * buttons/wallet block hata diye (user ka flow: RailBook me journey chunna, booking IRCTC par). */
export function FareReview() {
  const { state } = useBooking();
  const train = state.selectedTrain;
  const klass = state.selectedClass;
  if (!train || !klass) return null;

  return (
    <Shell title="Continue to IRCTC" back>
      <main className="page">
        {/* Round-21: food/catering + IRCTC ke dono checkbox + contact (mobile/email) bhi autofill ke liye jaate hain. */}
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
