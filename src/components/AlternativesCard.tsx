/**
 * Round-18 — "YOU MAY ALSO CONSIDER" card.
 * Selected train ki seat WL/RAC/kam/not-available → server ke
 * FIND_ALTERNATIVE_TRAINS result se SIRF provider-verified options.
 * Har card ke andar source/provenance hai (tooltip + footer). Koi client-side
 * guess nahi — jo data mein nahi, wo card nahi.
 */
import type { AgentAlternatives, AgentRouteOption } from "../ai/agent";
import { formatShortDate, inr } from "../format";

function dayTag(n: number): string {
  return n > 0 ? ` +${n}d` : "";
}
function reasonLine(a: AgentAlternatives): string {
  const s = a.selected;
  const cls = s.classCode ? ` ${s.classCode}` : "";
  switch (a.reason) {
    case "waitlist":
      return `${s.trainNumber}${cls} mein WL${s.waitlist ?? ""} hai — availability kam hai.`;
    case "rac":
      return `${s.trainNumber}${cls} mein sirf RAC hai.`;
    case "low_availability":
      return `${s.trainNumber}${cls} mein sirf ${s.seats} seats bachi hain.`;
    case "not_available":
      return `${s.trainNumber}${cls} mein seat available nahi.`;
    case "class_unavailable":
      return `${s.trainNumber} mein${cls} class ka seat data nahi mila.`;
    case "fine":
      return `${s.trainNumber}${cls} AVAILABLE hai.`;
    default:
      return `${s.trainNumber} ki availability provider se nahi aayi.`;
  }
}

function AltCard({ o, onPick }: { o: AgentRouteOption; onPick?: (n: string) => void }) {
  const a = o.availability;
  const tone = a?.status === "AVAILABLE" || a?.status === "RAC" ? "ok" : "muted";
  return (
    <button type="button" className="alt-card" title={`Source: ${o.source}${a ? ` · availability: ${a.source}` : ""}`} onClick={onPick ? () => onPick(o.trainNumbers[0]) : undefined}>
      <div className="alt-card-top">
        <span className="jo-no">{o.trainNumbers[0]}</span>
        <span className="alt-name">{o.trainNames[0]}</span>
      </div>
      <div className="alt-times">
        <strong>{o.departure}</strong> → <strong>{o.arrival}</strong>
        <span className="jo-day">{dayTag(o.arrivalDayOffset)}</span>
        <span className="jo-dot">·</span>
        <span>{o.durationLabel ?? "—"}</span>
      </div>
      <div className="alt-meta">
        <span className={`jo-avl jo-avl-${tone}`}>{a ? `${a.classCode} ${a.status === "AVAILABLE" ? "AVL" : a.status}${a.seats != null ? ` ${a.seats}` : ""}${a.rac != null && a.status === "RAC" ? ` ${a.rac}` : ""}` : "—"}</span>
        {a?.fare != null && <span className="jo-fare">{inr(a.fare)}</span>}
      </div>
      <div className="alt-src">via {a?.source ?? o.source}</div>
    </button>
  );
}

export function AlternativesCard({ alt, onPickTrain, onPickDate }: { alt: AgentAlternatives; onPickTrain?: (n: string) => void; onPickDate?: (ymd: string) => void }) {
  const splitPlans = alt.partialRoute?.plans.filter((p) => p.fullyAvailable) ?? [];
  const altDates = alt.alternativeDates.filter((d) => d.count > 0);
  const any = alt.alternatives.length || alt.otherClasses.length || splitPlans.length || alt.connecting.length || altDates.length;
  return (
    <div className="alt-wrap">
      <div className="alt-head">
        <div className="jo-kicker">RailBook Atlas</div>
        <div className="alt-reason">{reasonLine(alt)}</div>
      </div>
      {alt.reason === "fine" ? null : any ? (
        <>
          <div className="alt-label">YOU MAY ALSO CONSIDER</div>
          {alt.alternatives.length > 0 && (
            <div className="alt-scroll">
              {alt.alternatives.map((o) => <AltCard key={o.trainNumbers.join("+")} o={o} onPick={onPickTrain} />)}
            </div>
          )}
          {alt.otherClasses.length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">🎫 Usi train mein doosri class</div>
              <div className="jo-chips">
                {alt.otherClasses.map((c) => (
                  <span key={c.classCode} className="jo-chip" title={`Source: ${c.source}`}>
                    {c.classCode} · AVL{c.seats != null ? ` ${c.seats}` : ""}{c.fare != null ? ` · ${inr(c.fare)}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          {splitPlans.length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">✂️ Same train, split booking</div>
              {splitPlans.slice(0, 2).map((p) => (
                <div key={p.switchStation} className="jo-split">
                  {p.segments.map((s) => (
                    <div key={`${s.from}-${s.to}`} className="jo-split-seg">
                      <span>{s.from} → {s.to}</span>
                      <span className="jo-avl jo-avl-ok">{s.classCode} AVL{s.seats != null ? ` ${s.seats}` : ""}</span>
                    </div>
                  ))}
                  <div className="jo-split-note">Seat change @ {p.switchStationName ?? p.switchStation} · berth no. chart ke baad</div>
                </div>
              ))}
            </div>
          )}
          {alt.connecting.length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">🔁 Connecting journey</div>
              {alt.connecting.slice(0, 2).map((c, i) => (
                <div key={i} className="jo-conn">
                  <div className="jo-conn-leg"><span className="jo-no">{c.legs[0].trainNumber}</span> {c.legs[0].departure} {c.legs[0].from} → {c.legs[0].arrival} {c.station}</div>
                  <div className="jo-conn-wait">⏳ {c.layoverMinutes} min layover @ {c.stationName ?? c.station}</div>
                  <div className="jo-conn-leg"><span className="jo-no">{c.legs[1].trainNumber}</span> {c.legs[1].departure} {c.station} → {c.legs[1].arrival} {c.legs[1].to}</div>
                </div>
              ))}
            </div>
          )}
          {altDates.length > 0 && (
            <div className="jo-sec">
              <div className="jo-sec-title">📅 Alternative date (aapki date badli nahi)</div>
              <div className="jo-chips">
                {altDates.map((d) => (
                  <button key={d.date} type="button" className="jo-chip" onClick={onPickDate ? () => onPickDate(d.date) : undefined}>
                    {formatShortDate(d.date)} · {d.count} trains
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="jo-alert">Koi verified alternative nahi mila — provider data ke bina hum option nahi banate.</div>
      )}
      <div className="jo-foot">
        Real data · {alt.sources.join(", ") || "—"} · {alt.provenance.freshness === "stale" ? "⚠ stale — dobara check karein" : `as of ${new Date(alt.provenance.retrievedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`} · berth-level data unavailable
      </div>
    </div>
  );
}
