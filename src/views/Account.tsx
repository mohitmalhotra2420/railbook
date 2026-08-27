import { useEffect, useState } from "react";
import { useBooking } from "../booking/context";
import { Shell } from "../components/Shell";
import { formatLongDate, inr } from "../format";
import type { Passenger } from "../types";
import { blankPassenger } from "../booking/state";
import { loadTravellers, saveTravellers } from "../data/travellers";

export function Bookings() {
  const { bookings, refreshBookings, go, retrieve } = useBooking();
  useEffect(() => {
    void refreshBookings();
  }, [refreshBookings]);

  return (
    <Shell title="My Bookings" back>
      <main className="page">
        <form
          className="widget"
          style={{ marginBottom: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            const id = String(new FormData(e.currentTarget).get("q") ?? "");
            if (id) void retrieve(id);
          }}
        >
          <div className="field">
            <label htmlFor="q">Retrieve booking</label>
            <div className="control">
              <input id="q" name="q" placeholder="Booking ID or MOCK PNR" />
            </div>
          </div>
          <button className="btn navy" type="submit">Find</button>
        </form>
        {!bookings.length && <p className="lede">No bookings on this device yet.</p>}
        {bookings.map((b) => (
          <button
            key={b.id}
            className="list-card"
            style={{ width: "100%", textAlign: "left" }}
            onClick={() => void retrieve(b.id)}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{b.trainNumber} {b.trainName}</strong>
              <span className="muted">{b.status}</span>
            </div>
            <div className="muted">
              {b.from.code} → {b.to.code} · {formatLongDate(b.date)}
            </div>
            {b.mock && <div className="mock-tag" style={{ marginTop: 8 }}>Demo</div>}
            {b.pnr && <div className="muted">PNR {b.pnr}</div>}
          </button>
        ))}
        <button className="btn ghost" onClick={() => go("home")}>Back to search</button>
      </main>
    </Shell>
  );
}

export function Wallet() {
  const { wallet, refreshWallet, addMoney, state, go } = useBooking();
  const [amount, setAmount] = useState("1000");
  useEffect(() => {
    void refreshWallet();
  }, [refreshWallet]);

  return (
    <Shell title="Wallet" back>
      <main className="page">
        <section className="widget">
          <div className="muted">Current balance</div>
          <div className="amount">{inr(wallet?.balance ?? 0)}</div>
          {state.previewFare && (
            <p className="lede">
              Booking amount {inr(state.previewFare.total)} · remaining{" "}
              {inr((wallet?.balance ?? 0) - state.previewFare.total)}
            </p>
          )}
          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="amt">Add money</label>
            <div className="control">
              <input
                id="amt"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
          <button className="btn primary" onClick={() => void addMoney(Number(amount) || 0)}>
            Add Money
          </button>
          {state.flow === "FARE_REVIEW" && (
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => go("review")}>
              Return to booking
            </button>
          )}
        </section>
        <h2 style={{ margin: "18px 0 8px" }}>Activity</h2>
        {(wallet?.transactions ?? []).map((t) => (
          <div className="list-card" key={t.id}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{t.note}</span>
              <strong>{t.type === "CREDIT" ? "+" : "−"}{inr(t.amount)}</strong>
            </div>
            <div className="muted">{new Date(t.at).toLocaleString("en-IN")}</div>
          </div>
        ))}
      </main>
    </Shell>
  );
}

export function Travellers() {
  const [list, setList] = useState<Passenger[]>(loadTravellers);
  const [draft, setDraft] = useState<Passenger>(blankPassenger());

  function add() {
    if (draft.name.trim().length < 3) return;
    const next = [...list, draft];
    setList(next);
    saveTravellers(next);
    setDraft(blankPassenger());
  }

  function remove(id: string) {
    const next = list.filter((p) => p.id !== id);
    setList(next);
    saveTravellers(next);
  }

  return (
    <Shell title="Travellers" back>
      <main className="page">
        <section className="widget">
          <div className="field">
            <label>Name</label>
            <div className="control">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
          </div>
          <div className="pair">
            <div className="field">
              <label>Age</label>
              <div className="control">
                <input value={draft.age} inputMode="numeric" onChange={(e) => setDraft({ ...draft, age: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>Gender</label>
              <div className="control">
                <select
                  value={draft.gender}
                  onChange={(e) => setDraft({ ...draft, gender: e.target.value as Passenger["gender"] })}
                >
                  <option value="">Select</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
          </div>
          <button className="btn navy" onClick={add}>Save traveller</button>
        </section>
        <h2 style={{ margin: "18px 0 8px" }}>Saved</h2>
        {list.map((p) => (
          <div className="list-card" key={p.id}>
            <strong>{p.name}</strong>
            <div className="muted">{p.age} · {p.gender || "—"}</div>
            <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => remove(p.id)}>Remove</button>
          </div>
        ))}
      </main>
    </Shell>
  );
}
