import { formatShortDate } from "../format";

export type RouteStop = {
  code: string;
  name: string;
  arrival?: string | null;
  departure?: string | null;
  day?: string | number | null;
};

export type RouteSheetData = {
  trainNumber: string;
  trainName: string;
  date?: string;
  originCode?: string;
  destCode?: string;
  stops: RouteStop[];
  emptyMessage?: string;
  loading?: boolean;
};

function clock(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t || t === "--" || t === "—") return "—";
  return t;
}

function sameCode(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toUpperCase() === b.toUpperCase());
}

export function RouteTimeline({
  data,
  onClose,
}: {
  data: RouteSheetData;
  onClose: () => void;
}) {
  const stops = data.stops ?? [];
  const originCode = data.originCode || stops[0]?.code;
  const destCode = data.destCode || stops[stops.length - 1]?.code;
  const originName = stops.find((s) => sameCode(s.code, originCode))?.name || originCode || "Origin";
  const destName = stops.find((s) => sameCode(s.code, destCode))?.name || destCode || "Destination";

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="route-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Train route">
        <div className="grab" />
        <header className="route-head">
          <div className="route-kicker">Route</div>
          <div className="route-num">{data.trainNumber}</div>
          <div className="route-name">{data.trainName}</div>
          <div className="route-pair">
            {originName} → {destName}
          </div>
          {data.date ? <div className="route-date">{formatShortDate(data.date)} · Timetable</div> : <div className="route-date">Timetable</div>}
        </header>

        <div className="route-scroll">
          {data.emptyMessage && <p className="route-empty">{data.emptyMessage}</p>}
          {!data.emptyMessage && stops.length === 0 && (
            <p className="route-empty">Route stops provider payload mein nahi aaye.</p>
          )}
          {stops.length > 0 && (
            <ol className="route-tl">
              {stops.map((stop, i) => {
                const origin = sameCode(stop.code, originCode);
                const dest = sameCode(stop.code, destCode);
                const role = origin ? "origin" : dest ? "dest" : "via";
                return (
                  <li key={`${stop.code}-${i}`} className={`route-stop ${role}`}>
                    <div className="route-rail" aria-hidden>
                      {i > 0 && <span className="route-line-top" />}
                      <span className={`route-dot ${role}`}>
                        {origin || dest ? (
                          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
                            <path d="M4 15V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v7H4zm2-5h12V8a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2zm-2 7h16v2H4v-2z" />
                          </svg>
                        ) : null}
                      </span>
                      {i < stops.length - 1 && <span className="route-line-bot" />}
                    </div>
                    <div className="route-body">
                      <div className="route-row">
                        <div className="route-code">{stop.code}</div>
                        {origin && <span className="route-badge origin">Origin</span>}
                        {dest && !origin && <span className="route-badge dest">Destination</span>}
                      </div>
                      <div className="route-stname">{stop.name}</div>
                      <div className="route-times">
                        <span className="route-chip">
                          <em>Arr</em> {clock(stop.arrival)}
                        </span>
                        <span className="route-chip">
                          <em>Dep</em> {clock(stop.departure)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="route-foot">
          <button type="button" className="btn navy" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
