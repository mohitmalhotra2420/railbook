import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { addDays, formatLongDate, pad, todayYmd } from "../format";
import type { Station } from "../types";
import { IconCal, IconChevron, IconClose } from "./Icons";

export function StationPicker({
  label,
  value,
  onChange,
  exclude,
}: {
  label: string;
  value: Station | null;
  onChange: (s: Station) => void;
  exclude?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Station[]>([]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api.stations(q).then((r) => setList(r.stations)).catch(() => setList([]));
    }, 80);
    return () => clearTimeout(t);
  }, [q, open]);

  return (
    <div className="field">
      <label>{label}</label>
      <button type="button" className="control" onClick={() => { setOpen(true); setQ(""); }}>
        {value ? (
          <>
            <span className="code">{value.code}</span>
            <span>{value.name}</span>
          </>
        ) : (
          <span className="placeholder">Select station</span>
        )}
        <span className="spacer" />
        <IconChevron />
      </button>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="cal-head">
              <h2>Select {label.toLowerCase()}</h2>
              <button className="icon-btn ghost" aria-label="Close" onClick={() => setOpen(false)}>
                <IconClose />
              </button>
            </div>
            <div className="control search-box">
              <input
                autoFocus
                placeholder="Search city or code"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {list
              .filter((s) => s.code !== exclude)
              .map((s) => (
                <button
                  key={s.code}
                  className="station-row"
                  onClick={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                >
                  <span className="code">{s.code}</span>
                  <span>
                    <strong>{s.name}</strong>
                    <div className="muted">{s.city}</div>
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (d: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = todayYmd();
  const max = addDays(today, 120);
  const [cursor, setCursor] = useState(value.slice(0, 7));

  const grid = useMemo(() => {
    const [y, m] = cursor.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const start = first.getDay();
    const days = new Date(y, m, 0).getDate();
    const cells: { ymd: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < start; i++) cells.push({ ymd: "", day: 0, inMonth: false });
    for (let d = 1; d <= days; d++) {
      cells.push({ ymd: `${y}-${pad(m)}-${pad(d)}`, day: d, inMonth: true });
    }
    return cells;
  }, [cursor]);

  const label = new Date(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)) - 1, 1)
    .toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  function shift(n: number) {
    const [y, m] = cursor.split("-").map(Number);
    const dt = new Date(y, m - 1 + n, 1);
    setCursor(`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`);
  }

  return (
    <div className="field">
      <label>Date</label>
      <button type="button" className="control" onClick={() => setOpen(true)}>
        <IconCal />
        <span>{formatLongDate(value)}</span>
      </button>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="cal-head">
              <button className="btn sm ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
              <h2>{label}</h2>
              <button className="btn sm ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
            </div>
            <div className="cal-grid">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i} className="dow">{d}</div>
              ))}
              {grid.map((c, i) => {
                const disabled = !c.inMonth || c.ymd < today || c.ymd > max;
                return (
                  <button
                    key={i}
                    className={`day ${c.ymd === value ? "on" : ""} ${disabled ? "off" : ""}`}
                    disabled={disabled}
                    onClick={() => {
                      onChange(c.ymd);
                      setOpen(false);
                    }}
                  >
                    {c.inMonth ? c.day : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
