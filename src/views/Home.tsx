import { Shell } from "../components/Shell";
import { DatePicker, StationPicker } from "../components/Pickers";
import { IconSwap, IconTicket, IconUser, IconWallet } from "../components/Icons";
import { useBooking } from "../booking/context";

export function Home() {
  const { state, setFrom, setTo, swap, setDate, setPassengerCount, search, go } = useBooking();

  return (
    <Shell>
      <main className="page">
        <section className="widget">
          <div className="widget-title">Where are you travelling?</div>
          <StationPicker label="From" value={state.from} onChange={setFrom} exclude={state.to?.code} />
          <div className="swap-wrap">
            <button className="swap" aria-label="Swap stations" onClick={swap}>
              <IconSwap />
            </button>
          </div>
          <StationPicker label="To" value={state.to} onChange={setTo} exclude={state.from?.code} />
          <DatePicker value={state.date} onChange={setDate} />
          <div className="field">
            <label>Passengers</label>
            <div className="control">
              <select
                value={state.passengerCount}
                onChange={(e) => setPassengerCount(Number(e.target.value))}
                aria-label="Passengers"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
          {state.error && <div className="banner err">{state.error}</div>}
          <button className="btn primary" onClick={() => void search()}>
            Search Trains
          </button>
        </section>

        <nav className="shortcuts">
          <button className="shortcut" onClick={() => go("bookings")}>
            <span><IconTicket /></span>
            My Bookings
          </button>
          <button className="shortcut" onClick={() => go("wallet")}>
            <span><IconWallet /></span>
            Wallet
          </button>
          <button className="shortcut" onClick={() => go("travellers")}>
            <span><IconUser /></span>
            Travellers
          </button>
        </nav>
      </main>
    </Shell>
  );
}
