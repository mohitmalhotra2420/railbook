import { useBooking } from "../booking/context";
import { Shell } from "../components/Shell";
import { formatLongDate, inr } from "../format";
import { CLASS_LABELS } from "../types";

export function FareReview() {
  const { state, wallet, confirm, go } = useBooking();
  const train = state.selectedTrain;
  const klass = state.selectedClass;
  if (!train || !klass) return null;

  const fare = state.previewFare ?? {
    baseFare: klass.fare * state.passengers.length,
    serviceFee: 0,
    total: klass.fare * state.passengers.length,
  };
  const short = wallet && wallet.balance < fare.total;

  return (
    <Shell title="Booking summary" back>
      <main className="page">
        {state.error && (
          <div className="banner err">
            {state.error}
            {short && (
              <div style={{ marginTop: 8 }}>
                <button className="btn sm navy" onClick={() => go("wallet")}>Add Money</button>
              </div>
            )}
          </div>
        )}
        <section className="summary">
          <div className="row"><span className="k">Train</span><span>{train.number} {train.name}</span></div>
          <div className="row"><span className="k">Date</span><span>{formatLongDate(train.date)}</span></div>
          <div className="row"><span className="k">From → To</span><span>{train.from.code} → {train.to.code}</span></div>
          <div className="row"><span className="k">Class</span><span>{CLASS_LABELS[klass.code]}</span></div>
          <div className="row"><span className="k">Seat</span><span>{state.seatPreference}</span></div>
          <div className="row">
            <span className="k">Passengers</span>
            <span>{state.passengers.map((p) => p.name).join(", ")}</span>
          </div>
          <div className="row">
            <span className="k">Base fare</span>
            <span>
              {"railwayAvailable" in fare && fare.railwayAvailable === false
                ? "Fare unavailable"
                : inr(fare.baseFare)}
            </span>
          </div>
          <div className="row"><span className="k">Service fee</span><span>{inr(fare.serviceFee)}</span></div>
          <div className="row total">
            <span>Total</span>
            <span>
              {"railwayAvailable" in fare && fare.railwayAvailable === false
                ? "—"
                : inr(fare.total)}
            </span>
          </div>
        </section>

        {wallet && (
          <section className="list-card" style={{ marginTop: 12 }}>
            <div className="muted">Wallet</div>
            <div>Current balance {inr(wallet.balance)}</div>
            <div className="muted">Remaining after booking {inr(wallet.balance - fare.total)}</div>
          </section>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Nothing is confirmed until the railway provider accepts this booking.
        </p>
      </main>
      <div className="sticky-cta">
        {short ? (
          <button className="btn primary" onClick={() => go("wallet")}>Add Money</button>
        ) : (
          <button
            className="btn primary"
            disabled={state.flow === "BOOKING_PENDING" || state.flow === "PAYMENT_PENDING"}
            onClick={() => void confirm()}
          >
            {state.flow === "BOOKING_PENDING" ? "Booking…" : "Confirm Booking"}
          </button>
        )}
      </div>
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
