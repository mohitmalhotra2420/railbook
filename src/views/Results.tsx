import { useBooking } from "../booking/context";
import { Shell } from "../components/Shell";
import { DatePicker } from "../components/Pickers";
import { IconStar } from "../components/Icons";
import { availabilityLabel, formatShortDate } from "../format";
import type { Recommendation, TrainResult } from "../types";
import { isBookable } from "../types";

function chipClass(status: string): string {
  if (status === "AVAILABLE") return "ok";
  if (status === "RAC") return "rac";
  if (status === "WAITLIST") return "wl";
  return "no";
}

function TrainCard({
  train,
  rec,
  onSelect,
}: {
  train: TrainResult;
  rec?: Recommendation;
  onSelect: () => void;
}) {
  return (
    <button className={`train-card ${rec?.kind === "best" ? "rec" : ""}`} onClick={onSelect}>
      {rec && (
        <>
          <div className="rec-pill">
            <IconStar /> {rec.label}
          </div>
          <p className="rec-reason">{rec.reason}</p>
        </>
      )}
      <div className="train-head">
        <span className="tnum">{train.number}</span>
        <span className="ttype">{train.type}</span>
      </div>
      <div className="tname">{train.name}</div>
      <div className="times">
        <div>
          <div className="dep">{train.departure}</div>
          <div className="st">{train.from.code} · {train.from.city}</div>
        </div>
        <div className="mid">
          <div>{train.durationLabel}</div>
          <div className="rail" />
        </div>
        <div>
          <div className="arr">
            {train.arrival}
            {train.arrivalDayOffset > 0 && <span className="plus1">+{train.arrivalDayOffset}</span>}
          </div>
          <div className="st">{train.to.code} · {train.to.city}</div>
        </div>
      </div>
      <div className="classes">
        {train.classes.map((c) => (
          <span key={c.code} className={`chip ${chipClass(c.status)}`}>
            {c.code} · {isBookable(c.status) ? `₹${c.fare}` : availabilityLabel(c.status)}
          </span>
        ))}
      </div>
    </button>
  );
}

export function Results() {
  const { state, selectTrain, setDate, go } = useBooking();
  const recMap = new Map(state.recommendations.map((r) => [r.trainNumber, r]));
  const best = state.recommendations.find((r) => r.kind === "best");
  const ordered = [...state.trains].sort((a, b) => {
    if (best && a.number === best.trainNumber) return -1;
    if (best && b.number === best.trainNumber) return 1;
    return 0;
  });

  return (
    <Shell title="Select train" back>
      <main className="page">
        <div className="widget" style={{ marginBottom: 14, padding: 12 }}>
          <div className="muted">
            {state.from?.code} → {state.to?.code} · {state.passengerCount} pax
          </div>
          <DatePicker value={state.date} onChange={setDate} />
        </div>

        {state.notice && <div className="banner warn">{state.notice}</div>}
        {state.error && <div className="banner err">{state.error}</div>}

        {state.searching && (
          <>
            <div className="skel" />
            <div className="skel" />
          </>
        )}

        {!state.searching && state.emptyMessage && (
          <div className="empty">
            <img src="/empty-trains.png" alt="" />
            <h2>No trains available for {formatShortDate(state.date)}</h2>
            <p className="lede">Try another date</p>
            <div style={{ marginTop: 16 }}>
              <button className="btn ghost" onClick={() => go("home")}>Change search</button>
            </div>
          </div>
        )}

        {!state.searching &&
          ordered.map((t) => (
            <TrainCard
              key={t.number}
              train={t}
              rec={recMap.get(t.number)}
              onSelect={() => selectTrain(t)}
            />
          ))}
      </main>
    </Shell>
  );
}
