/**
 * Round-18 — SELECT TRAIN smart picker.
 * User "12014" / "Shatabdi" bole → server (SEARCH_TRAIN_BY_NUMBER / _BY_NAME)
 * ke REAL validated matches yahan cards mein; user tap karke chunta hai.
 * Route/time sirf tab dikhta hai jab provider ne diya (warna "route verify
 * nahi hua" — koi placeholder nahi).
 */
import type { AgentTrainPick, AgentTrainPicker } from "../ai/agent";

export function TrainPicker({ picker, onSelect }: { picker: AgentTrainPicker; onSelect: (t: AgentTrainPick) => void }) {
  const list = picker.matches;
  if (!list.length) return null;
  return (
    <div className="tp-wrap">
      <div className="tp-head">
        <span className="tp-label">SELECT TRAIN</span>
        <span className="tp-count">{list.length} real match{list.length === 1 ? "" : "es"}{picker.kind === "name" ? ` · "${picker.query}"` : ""}</span>
      </div>
      <div className={`tp-list${list.length > 1 ? " tp-scroll" : ""}`}>
        {list.map((t) => (
          <button key={t.number} type="button" className="tp-card" onClick={() => onSelect(t)} title={`Source: ${t.source}`}>
            <div className="tp-title">
              <span className="jo-no">{t.number}</span>
              <span className="tp-name">{t.name}</span>
            </div>
            {t.from && t.to ? (
              <div className="tp-route">
                {t.from} → {t.to}
                {t.departure ? <span className="tp-time"> · {t.departure} → {t.arrival ?? "—"}</span> : null}
              </div>
            ) : (
              <div className="tp-route muted">Route abhi verify nahi hua — select karke dekho</div>
            )}
            <div className="tp-cta">Select →</div>
          </button>
        ))}
      </div>
      {picker.note && <div className="jo-foot">{picker.note}</div>}
    </div>
  );
}
