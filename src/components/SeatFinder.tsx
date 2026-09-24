/* Seat Finder card — chat ke andar (ConfirmTkt ke AI Seat Finder jaisa).
 * Chat list me jo trains aati hain (times), unke upar LIVE route board ka status merge karke
 * "seat wali upar / WL neeche" do sections dikhata hai + chips (class / confirmed-only / time).
 * Sab kuch client-side; server/AI/tools/API ko chhua nahi gaya.
 * 24 Sep 2026 (user): "seat wali upar, WL neeche", "bolke poochhe to bhi kaam kare", Hindi/Eng/Hinglish.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortDate, inr } from "../format";
import type { ClassCode } from "../types";
import { speakGuide } from "../voice/speakGuide";
import {
  buildSeatRows,
  fetchRouteBoard,
  filterSeatRows,
  seatSummaryLine,
  type BoardTrainRow,
  type SeatIntent,
  type SeatRow,
  type SeatSearchRow,
} from "../seatfinder";

const CLASS_CHIPS: (ClassCode | "ALL")[] = ["ALL", "1A", "2A", "3A", "3E", "SL", "CC"];
const TIME_OPTIONS: { min: number | null; label: string }[] = [
  { min: null, label: "Sab" },
  { min: 6 * 60, label: "Subah 6 ke baad" },
  { min: 12 * 60, label: "12 baje ke baad" },
  { min: 17 * 60, label: "5 baje ke baad" },
  { min: 21 * 60, label: "9 baje ke baad" },
];

function statusBadge(r: SeatRow) {
  if (r.status === "AVAILABLE") return <span className="sf-badge avl">AVL {r.seats ?? "—"}</span>;
  if (r.status === "RAC") return <span className="sf-badge rac">RAC {r.rac ?? "—"}</span>;
  if (r.status === "WAITLIST") return <span className="sf-badge wl">WL {r.waitlist ?? "—"}</span>;
  return <span className="sf-badge na">N/A</span>;
}

function Row({ r, onPick }: { r: SeatRow; onPick?: (r: SeatRow) => void }) {
  return (
    <button className={`sf-row ${r.seat ? "seat" : "wl"}`} onClick={() => onPick?.(r)} type="button">
      <span className="sf-l1">
        <span>
          <strong>{r.number}</strong> <span className="sf-tname">{r.name}</span>
        </span>
        <span className="sf-fare">{r.fare ? inr(r.fare) : "—"}</span>
      </span>
      <span className="sf-l2">
        <span className="sf-time">{r.departure && r.arrival ? `${r.departure} → ${r.arrival}` : "time list me nahi"}</span>
        {r.durationLabel && <span>{r.durationLabel}</span>}
        <span className="sf-cls">{r.classCode}</span>
        {statusBadge(r)}
        <span className="sf-go">Book ›</span>
      </span>
    </button>
  );
}

export function SeatFinder({
  from,
  to,
  toName,
  date,
  rows,
  intent,
  speak = false,
  onChip,
}: {
  from: string;
  to: string;
  toName?: string | null;
  date: string;
  rows: SeatSearchRow[];
  intent: SeatIntent;
  /** Voice se poochha gaya → jawab ek line me bol bhi do (screen par poora card). */
  speak?: boolean;
  onChip: (text: string) => void;
}) {
  const [board, setBoard] = useState<BoardTrainRow[] | null>(null);
  const [cls, setCls] = useState<ClassCode | null>(intent.classCode);
  const [confirmedOnly, setConfirmedOnly] = useState(intent.confirmedOnly);
  const [afterMin, setAfterMin] = useState<number | null>(intent.afterMin);
  const [earliest, setEarliest] = useState(intent.earliest);
  const [cheapest, setCheapest] = useState(intent.cheapest);
  const [showAllSeat, setShowAllSeat] = useState(false);
  const [showAllWl, setShowAllWl] = useState(false);
  const spokenRef = useRef(false);

  useEffect(() => {
    let live = true;
    fetchRouteBoard(from, to, date).then((b) => {
      if (live) setBoard(b);
    });
    return () => {
      live = false;
    };
  }, [from, to, date]);

  const merged = useMemo(() => (board ? buildSeatRows(rows, board, cls) : null), [board, rows, cls]);
  const seat = useMemo(
    () => (merged ? filterSeatRows(merged.seat, { afterMin, earliest: earliest && !cheapest, cheapest }) : []),
    [merged, afterMin, earliest, cheapest],
  );
  const wl = useMemo(() => (merged ? filterSeatRows(merged.wl, { afterMin }) : []), [merged, afterMin]);
  const seatIgnoringTime = useMemo(
    () => (merged ? filterSeatRows(merged.seat, { earliest: earliest && !cheapest, cheapest }) : []),
    [merged, earliest, cheapest],
  );
  const loading = board === null;

  useEffect(() => {
    if (!speak || spokenRef.current || !merged) return;
    spokenRef.current = true;
    speakGuide(seatSummaryLine(seat, cls, to, toName ?? to));
  }, [speak, merged, seat, cls, to, toName]);

  const pickUtter = (r: SeatRow) =>
    `${r.number} ki seat availability ${r.classCode !== "—" ? r.classCode + " " : ""}${date} ko ${from} se ${to}`;
  const seatShown = showAllSeat ? seat : seat.slice(0, 6);
  const wlShown = showAllWl ? wl : wl.slice(0, 4);

  return (
    <div className="sf">
      <div className="sf-top">
        <span className="sf-ic">💺</span>
        <div>
          <strong>Seat Finder</strong>
          <span className="sf-sub">
            {from} → {to} · {formatShortDate(date)} · {cls ?? "sab class"} · {loading ? "live board aa raha hai…" : "live board"}
          </span>
        </div>
      </div>

      <div className="sf-chips">
        <button className={`sf-chip ${confirmedOnly ? "on" : ""}`} onClick={() => setConfirmedOnly((v) => !v)}>
          ✅ Confirmed only
        </button>
        {CLASS_CHIPS.map((c) => (
          <button
            key={c}
            className={`sf-chip ${(c === "ALL" ? cls === null : cls === c) ? "sel" : ""}`}
            onClick={() => setCls(c === "ALL" ? null : (c as ClassCode))}
          >
            {c === "ALL" ? "Sab class" : c}
          </button>
        ))}
        <select
          className={`sf-chip sf-select ${afterMin != null ? "on-time" : ""}`}
          value={afterMin ?? ""}
          onChange={(e) => setAfterMin(e.target.value === "" ? null : Number(e.target.value))}
          aria-label="Time filter"
        >
          {TIME_OPTIONS.map((o) => (
            <option key={String(o.min)} value={o.min ?? ""}>
              Time: {o.label}
            </option>
          ))}
        </select>
        <button
          className={`sf-chip ${earliest ? "sel" : ""}`}
          onClick={() => {
            setEarliest((v) => !v);
            setCheapest(false);
          }}
        >
          ⚡ Sabse jaldi
        </button>
        <button
          className={`sf-chip ${cheapest ? "sel" : ""}`}
          onClick={() => {
            setCheapest((v) => !v);
            setEarliest(false);
          }}
        >
          💰 Sabse sasta
        </button>
      </div>

      {loading && <div className="sf-loading">Live seat data aa raha hai…</div>}

      {!loading && (
        <>
          <div className="sf-sec">
            <p className="sf-head">
              <span className="sf-tag seat">SEAT</span> Seat mil jayegi <span className="sf-count">· {seat.length} trains</span>
            </p>
            {seat.length === 0 && (
              <div className="sf-empty">
                {seatIgnoringTime.length > 0 ? (
                  <>
                    <b>Is time ke baad koi train me seat nahi.</b> Jo {seatIgnoringTime.length} trains me seat hai wo is time se pehle ki hain.
                    <span className="sf-empty-chips">
                      <button className="sf-chip" onClick={() => setAfterMin(null)}>
                        Subah ki wali dikhao
                      </button>
                      <button className="sf-chip" onClick={() => setCls(cls === "3A" ? null : "3A")}>
                        3A me dekho
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <b>
                      {cls ?? "Kisi bhi class"} me {confirmedOnly ? "confirmed seat" : "seat"} wali train nahi mili.
                    </b>{" "}
                    WL wali list neeche hai — ya doosri class try karo.
                  </>
                )}
              </div>
            )}
            {seatShown.map((r) => (
              <Row key={`${r.number}-${r.classCode}`} r={r} onPick={(x) => onChip(pickUtter(x))} />
            ))}
            {seat.length > 6 && (
              <button className="sf-more" onClick={() => setShowAllSeat((v) => !v)}>
                {showAllSeat ? "Kam dikhao ‹" : `${seat.length - 6} aur seat wali trains dekho ›`}
              </button>
            )}
          </div>

          <div className="sf-sec wl-sec">
            <p className="sf-head">
              <span className="sf-tag wl">WAITLIST</span> Seat pakki nahi (WL) <span className="sf-count">· {wl.length} trains</span>
            </p>
            {wl.length === 0 && <div className="sf-empty">Is filter me WL wali bhi koi nahi.</div>}
            {wlShown.map((r) => (
              <Row key={`${r.number}-${r.classCode}`} r={r} onPick={(x) => onChip(pickUtter(x))} />
            ))}
            {wl.length > 4 && (
              <button className="sf-more" onClick={() => setShowAllWl((v) => !v)}>
                {showAllWl ? "Kam dikhao ‹" : `aur ${wl.length - 4} WL trains dekho ›`}
              </button>
            )}
          </div>

          {merged && merged.missingClass > 0 && (
            <div className="sf-foot muted">
              {merged.missingClass} trains me {cls} class hi nahi hai — wo is list me nahi.
            </div>
          )}
          <div className="sf-foot">
            <b>Real data:</b> live route board · {seat.length + wl.length} trains ka status mila · WL ka{" "}
            <b>confirm % hum nahi dete</b> — sirf WL number, koi andaza nahi.{(earliest || cheapest) && (
              <> Sort: <b>{cheapest ? "sabse sasta (fare ↑)" : "sabse jaldi (kam time)"}</b>.</>
            )}
            {seat.some((s) => !s.timesKnown) && '  Times "—" wali trains board par hain par search list me nahi thi.'}
          </div>
        </>
      )}
    </div>
  );
}
