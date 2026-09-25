/* Seat Finder card — chat ke andar (ConfirmTkt ke AI Seat Finder jaisa).
 *
 * 24 Sep 2026 (user):
 *  - "Seat Finder to hai hi nahi" → card sirf `traintable` block par mount hota tha; ab
 *    journey plan card par bhi lagta hai, aur hamesha jab bhi trains ki list aaye.
 *  - "Confirm button ko replace karke Available kro — Available pe click kre to Available + RAC
 *    dono dikhao, aur 'Sabhi trains' pe click kre to sabhi dikhao including all classes jo bhi us
 *    particular train me hain. Bas kuch bhi fake na ho — sab data real ho."
 *  - "Seat wali upar, WL neeche", "bolke poochhe to bhi jawab", Hindi/English/Hinglish.
 *
 * Sab kuch client-side: live route board (/api/availability — pehle se maujood endpoint) ka data,
 * search list ke times ke saath. AI logic, server tools, API, architecture — kuch touch nahi.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortDate, inr } from "../format";
import type { ClassCode } from "../types";
import { speakGuide } from "../voice/speakGuide";
import { TrainClassBlock } from "./TrainClassBlock";
import { SeatFilterBar } from "./SeatFilterBar";
import {
  buildAllClassRows,
  clearRouteBoardCache,
  fetchRouteBoard,
  fetchTrainClasses,
  filterSeatRows,
  mergeBoardsPreferCard,
  mergeClassBoards,
  mergeClassBoardsVerified,
  seatSummaryLine,
  trainsNeedingClasses,
  trainsUnverifiedForSeats,
  uniqueTrainCount,
  type BoardClassRow,
  type BoardTrainRow,
  type SeatIntent,
  type SeatMode,
  type SeatRow,
  type SeatSearchRow,
} from "../seatfinder";


/** Rows ko train-wise group karo (order wahi rehta hai jo filter/sort ne diya). */
function groupByTrain(rows: SeatRow[]): SeatRow[][] {
  const map = new Map<string, SeatRow[]>();
  for (const r of rows) {
    const k = `${r.number}|${r.departure ?? ""}`;
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return [...map.values()];
}

function statusBadge(r: SeatRow) {
  if (r.status === "AVAILABLE") return <span className="sf-badge avl">AVL {r.seats ?? "—"}</span>;
  if (r.status === "RAC") return <span className="sf-badge rac">RAC {r.rac ?? "—"}</span>;
  if (r.status === "WAITLIST") return <span className="sf-badge wl">WL {r.waitlist ?? "—"}</span>;
  if (r.status === "UNKNOWN") return <span className="sf-badge na">status nahi mila</span>;
  if (r.status === "NO_DATA") return <span className="sf-badge na">data nahi aayi</span>;
  return <span className="sf-badge na">N/A (Regret)</span>;
}


/** Round-19e (24 Sep, user screenshot: "upar card mein classes available mein sabhi dikh nhi rhi jabki
 *  neeche classes zyada hai"): pehle har class ki apni row thi aur pehli 6 rows ke baad "aur rows dekho"
 *  chhupa deta tha — isliye ek train ki kuch classes dikhti hi nahi thi. Ab har train ka ek block hai
 *  jisme uski SAARI classes (AVL/RAC ya WL/N-A, jaisa section) chips me ek saath — bilkul upar wale
 *  card jaisa. Data wahi (per-train board), koi naya source nahi. */
function TrainGroup({ rows, onPick }: { rows: SeatRow[]; onPick?: (r: SeatRow) => void }) {
  const g = rows[0];
  const fares = rows.filter((r) => r.seat).map((r) => r.fare).filter((f): f is number => typeof f === "number");
  const seats = rows.filter((r) => r.seat).length;
  /* Round-20: chip/header ka markup ab shared TrainClassBlock se — journey card ke direct trains bhi
   * bilkul yahi block use karte hain (user: "same to same"). Data wahi SeatRow. */
  return (
    <TrainClassBlock
      number={g.number}
      name={g.name}
      timeText={g.departure && g.arrival ? `${g.departure} → ${g.arrival}` : "time list me nahi"}
      countText={rows.length > 1 ? `${rows.length} classes${seats ? ` (${seats} me seat)` : ""}` : null}
      rows={rows.map((r) => ({
        code: r.classCode,
        status: r.status,
        seats: r.seats,
        rac: r.rac,
        waitlist: r.waitlist,
        fare: r.fare,
        seat: r.seat,
        raw: r,
      }))}
      fromText={fares.length > 1 ? `from ${inr(Math.min(...fares))}` : null}
      onChip={onPick ? (c) => onPick(c.raw as SeatRow) : undefined}
      chipTitle={(c) =>
        c.seat
          ? `${c.code}${c.fare ? ` · ${inr(c.fare)}` : ""} — tap karke fresh check`
          : `${c.code} abhi bookable nahi (WL/N-A) — tap karke fresh check`
      }
    />
  );
}

function Row({ r, onPick }: { r: SeatRow; onPick?: (r: SeatRow) => void }) {
  const cls = r.seat ? "seat" : r.status === "NO_DATA" || r.status === "UNKNOWN" ? "nodata" : "wl";
  return (
    <button className={`sf-row ${cls}`} onClick={() => onPick?.(r)} type="button">
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
        <span className="sf-go">{r.status === "NO_DATA" ? "↻ check karo" : "Book ›"}</span>
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
  cardBoard = null,
  speak = false,
  onChip,
  onBook,
}: {
  from: string;
  to: string;
  toName?: string | null;
  date: string;
  rows: SeatSearchRow[];
  intent: SeatIntent;
  /** Round-19: upar wale journey card ke per-train class rows (wahi data jo card me dikh raha hai). */
  cardBoard?: BoardTrainRow[] | null;
  /** Voice se poochha gaya → jawab ek line me bol bhi do (screen par poora card). */
  speak?: boolean;
  onChip: (text: string) => void;
  /** Round-20: bookable class (AVL/RAC/WL) chip tap → seedha passenger form (caller handle karta hai). */
  onBook?: (r: SeatRow) => void;
}) {
  /* Round-20: tap — bookable (AVL/RAC/WL) ho to seedha passenger form, warna purana fresh-check message. */
  const tap = (r: SeatRow) => {
    if (onBook && (r.status === "AVAILABLE" || r.status === "RAC" || r.status === "WAITLIST")) {
      onBook(r);
      return;
    }
    onChip(pickUtter(r));
  };
  const [board, setBoard] = useState<BoardTrainRow[] | null>(null);
  /* "Sabhi trains" default hai (seat upar / WL neeche — jaisa user ne pehle kaha).
   * User ne "sirf confirmed" bola ho to seedha "Available" mode. */
  const [mode, setMode] = useState<SeatMode>(intent.confirmedOnly ? "avail" : "all");
  const [cls, setCls] = useState<ClassCode | null>(intent.classCode);
  /* 24 Sep 2026: "AC trains dikhao" → AC group (1A/2A/3A/3E/CC/EC), 2S/SL nahi. */
  const [acOnly, setAcOnly] = useState(intent.acOnly);
  const [afterMin, setAfterMin] = useState<number | null>(intent.afterMin);
  /* Round-19: "subah ki trains" → window ka upper bound bhi (user screenshot ka fix). */
  const [beforeMin, setBeforeMin] = useState<number | null>(intent.beforeMin);
  const [earliest, setEarliest] = useState(intent.earliest);
  const [cheapest, setCheapest] = useState(intent.cheapest);
  const [showAllSeat, setShowAllSeat] = useState(false);
  /* Round-19f: Available tab me "seat hi nahi" wali trains ka apna cap (koi train/class na chhupe). */
  const [showAllOff, setShowAllOff] = useState(false);
  const [showAllWl, setShowAllWl] = useState(false);
  const [showAllNoData, setShowAllNoData] = useState(false);
  const spokenRef = useRef(false);
  /* Card ka data maujood hai (plan card ke per-train rows) → fresh hai, dobara probe ki zaroorat nahi. */
  const cardBase = Boolean(cardBoard && cardBoard.length);

  /* ↻ dobara try (user screenshot: board khaali aayi thi aur card me 28 trains "data nahi aayi") */
  const [reload, setReload] = useState(0);
  const [boardNote, setBoardNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setBoardNote(null);
    clearRouteBoardCache(from, to, date);
    fetchRouteBoard(from, to, date).then((b) => {
      if (live) setBoard(b);
    });
    return () => {
      live = false;
    };
  }, [from, to, date, reload]);

  /* Board poori khaali aayi (provider busy) → pehle 6 trains ka per-train board try karo, taaki
   * kuch asli data dikhe. Sab fail ho to honest banner + ↻ button (28 rows "data nahi aayi" nahi). */
  useEffect(() => {
    if (!board || board.length || (cardBoard && cardBoard.length)) return;
    let live = true;
    void (async () => {
      const targets = rows.slice(0, 6).map((r) => String(r.number).trim());
      const got = await Promise.all(targets.map((n) => fetchTrainClasses(n, date, from, to)));
      if (!live) return;
      const built = targets
        .map((n, i) => ({ trainNumber: n, trainName: rows.find((r) => String(r.number).trim() === n)?.name ?? "", classes: got[i] ?? [] }))
        .filter((b) => b.classes.length > 0);
      if (built.length) {
        setBoard(built);
        setBoardNote("Route board nahi aayi thi — har train ka apna board laaya gaya (asli data).");
      }
    })();
    return () => {
      live = false;
    };
  }, [board, rows, date, from, to, cardBoard]);

  /* ── 24 Sep 2026 (user: "card sirf single class hi show kar rha" — Swarn Shatabdi ke CC aur EC
   * dono available the, card me sirf ek dikhi): route board kuch classes "UNKNOWN" ya missing deta
   * hai. Jo trains adhoori hain unka POORA class board per-train endpoint se laate hain — wahi
   * /api/availability?trainNumber=… jo TrainBoard "Refresh seats" pehle se use karta hai.
   * Sirf asli rows; koi naya endpoint/tool nahi. Max 10 trains, 3 ek saath. */
  const [extraBoards, setExtraBoards] = useState<Record<string, BoardClassRow[]>>({});
  /* Round-19c: "Available" tab ke liye per-train VERIFY kiye gaye boards (fresh probe jeetta hai). */
  const [verifiedBoards, setVerifiedBoards] = useState<Record<string, BoardClassRow[]>>({});
  const enrichKey = useRef("");
  const enrichRun = useRef(0);
  useEffect(() => {
    if (!board) return;
    const key = `${from}>${to}>${date}|${cls ?? ""}|${acOnly ? "ac" : ""}|${mode}|${board.length}|${cardBase ? "card" : "board"}`;
    if (enrichKey.current === key) return;
    enrichKey.current = key;
    const run = ++enrichRun.current;
    const needList = trainsNeedingClasses(board, cls, acOnly);
    /* Card ka data (plan card) pehle se usi turn ke per-train probe se aata hai — tab dobara probe nahi.
     * Warna "Available" tab par un trains ko per-train verify karo jinki route board me koi seat row nahi
     * dikh rahi (purana WL data asli AVAILABLE chhupa deta hai). */
    const staleList = mode === "avail" && !cardBase ? trainsUnverifiedForSeats(board, cls, acOnly) : [];
    const targets = [...new Set([...staleList, ...needList])].slice(0, 10);
    const staleSet = new Set(staleList);
    void (async () => {
      const add: Record<string, BoardClassRow[]> = {};
      const fresh: Record<string, BoardClassRow[]> = {};
      for (let i = 0; i < targets.length; i += 3) {
        const batch = targets.slice(i, i + 3);
        const got = await Promise.all(batch.map((n) => fetchTrainClasses(n, date, from, to)));
        if (run !== enrichRun.current) return;
        batch.forEach((n, idx) => {
          if (!got[idx].length) return;
          if (staleSet.has(n)) fresh[n] = got[idx];
          else add[n] = got[idx];
        });
      }
      if (run !== enrichRun.current) return;
      if (Object.keys(add).length) setExtraBoards((cur) => ({ ...cur, ...add }));
      if (Object.keys(fresh).length) setVerifiedBoards((cur) => ({ ...cur, ...fresh }));
    })();
  }, [board, from, to, date, cls, acOnly, mode, cardBase]);

  /* Route board + per-train board (jahan class missing/UNKNOWN thi) — sab real rows. */
  const boardFull = useMemo(() => {
    /* Round-19: pehle upar wale card ka apna data (numbers bilkul wahi jo user card me dekh raha
     * hai), phir route board ki wo classes jo card me nahi thi, phir per-train extra rows. */
    const base = cardBoard && cardBoard.length ? mergeBoardsPreferCard(cardBoard, board ?? []) : board ?? [];
    return base.map((b) => {
      const n = String(b.trainNumber ?? "").trim();
      let classes = b.classes ?? [];
      const more = extraBoards[n];
      if (more) classes = mergeClassBoards(classes, more);
      /* Round-19c: "Available" tab par jo train per-train verify hui, usme fresh probe hi sach hai. */
      const fresh = verifiedBoards[n];
      if (fresh) classes = mergeClassBoardsVerified(classes, fresh);
      return classes === b.classes ? b : { ...b, classes };
    });
  }, [board, cardBoard, extraBoards, verifiedBoards]);

  /* Round-19f: build hamesha "all" mode me — WL/N-A rows bhi banti hain (Available tab ke block me
   * halki chips ke liye). Section-level gating UI me hai: WL section sirf "Sabhi trains" me dikhta hai. */
  const merged = useMemo(
    () => (board ? buildAllClassRows(rows, boardFull, cls, "all", acOnly) : null),
    [board, boardFull, rows, cls, acOnly],
  );
  const sortOpts = { earliest: earliest && !cheapest, cheapest };
  const seat = useMemo(
    () => (merged ? filterSeatRows(merged.seat, { afterMin, beforeMin, ...sortOpts }) : []),
    [merged, afterMin, beforeMin, earliest, cheapest],
  );
  const wlAll = useMemo(
    () => (merged ? filterSeatRows(merged.wl, { afterMin, beforeMin, ...sortOpts }) : []),
    [merged, afterMin, beforeMin, earliest, cheapest],
  );
  /* "Available" tab me bhi har train ki SAARI classes dikhti hain (WL/N-A halki chips me), isliye wl
   * rows yahan hamesha banti hain — WL SECTION ka render phir bhi sirf "Sabhi trains" me hota hai. */
  const wl = mode === "all" ? wlAll : [];
  const noData = useMemo(() => (merged && mode === "all" ? merged.noData : []), [merged, mode]);
  const seatIgnoringTime = useMemo(
    () => (merged ? filterSeatRows(merged.seat, sortOpts) : []),
    [merged, earliest, cheapest],
  );
  /* cardBoard ho to data pehle se hai — route board ka intezaar nahi. */
  const hasCard = cardBase;
  const loading = board === null && !hasCard;

  useEffect(() => {
    if (!speak || spokenRef.current || !merged) return;
    spokenRef.current = true;
    speakGuide(seatSummaryLine(seat, cls, to, toName ?? to));
  }, [speak, merged, seat, cls, to, toName]);

  const pickUtter = (r: SeatRow) =>
    `${r.number} ki seat availability ${r.classCode !== "—" ? r.classCode + " " : ""}${date} ko ${from} se ${to}`;
  const seatGroupsRaw = groupByTrain(seat);
  /* Round-19f: seat wali train ke block me uski SAARI classes (WL/N-A bhi, halki) — bilkul upar
   * wale card jaisa. Isliye "upar kam, neeche zyada" wali shikayat khatam. */
  const rowsOfTrainAll = (number: string) => [
    ...(merged?.seat ?? []).filter((r) => r.number === number),
    ...(merged?.wl ?? []).filter((r) => r.number === number),
  ];
  const seatGroups = seatGroupsRaw.map((g) => rowsOfTrainAll(g[0].number));
  const wlGroups = groupByTrain(wl);
  /* Available tab me: seat wali trains ke baad baaki trains bhi (unki saari classes halki) —
   * taaki upar wale card se train/class count match kare aur kuch bhi chhupa na lage. */
  const seatTrainNumbers = new Set(seatGroupsRaw.map((g) => g[0].number));
  const noSeatGroups = groupByTrain(wlAll.filter((r) => !seatTrainNumbers.has(r.number)));
  /* Round-19e: pehle 6 rows ke baad chhupte the (ek train ki kuch classes gayab). Ab TRAIN-wise cap. */
  const seatShown = showAllSeat ? seatGroups : seatGroups.slice(0, 8);
  const wlShown = showAllWl ? wlGroups : wlGroups.slice(0, 4);
  const noSeatShown = showAllOff ? noSeatGroups : noSeatGroups.slice(0, 8);
  const noDataShown = showAllNoData ? noData : noData.slice(0, 3);
  const seatTrains = uniqueTrainCount(seat);
  const wlTrains = uniqueTrainCount(wl);

  return (
    <div className="sf">
      <div className="sf-top">
        <span className="sf-ic">💺</span>
        <div>
          <strong>Seat Finder</strong>
          <span className="sf-sub">
            {from} → {to} · {formatShortDate(date)} · {cls ?? (acOnly ? "AC classes" : "sab class")}
            {intent.windowLabel ? ` · ${intent.windowLabel}` : ""} ·{" "}
            {loading ? "live board aa raha hai…" : `${mode === "avail" ? "Available (AVL + RAC)" : "sabhi trains"}`}
          </span>
        </div>
      </div>

      {/* Round-22: chips ab shared SeatFilterBar se — journey card ke direct block me bhi bilkul
       * yahi row lagti hai (single source, dono jagah same shakal). */}
      <SeatFilterBar
        mode={mode}
        setMode={setMode}
        cls={cls}
        setCls={setCls}
        acOnly={acOnly}
        setAcOnly={setAcOnly}
        afterMin={afterMin}
        beforeMin={beforeMin}
        setTime={(a, b) => {
          setAfterMin(a);
          setBeforeMin(b);
        }}
        earliest={earliest}
        setEarliest={setEarliest}
        cheapest={cheapest}
        setCheapest={setCheapest}
        label="Seat Finder filters"
      />

      {loading && <div className="sf-loading">Live seat data aa raha hai…</div>}

      {/* Board poori tarah khaali = provider busy. Saaf batao + ↻ (28 trains "data nahi aayi" nahi). */}
      {!loading && board !== null && board.length === 0 && !hasCard && (
        <div className="sf-empty">
          <b>Live board abhi nahi aa payi (provider busy).</b> Har train ka data alag se check kar sakte ho —
          <span className="sf-empty-chips">
            <button className="sf-chip" onClick={() => setReload((v) => v + 1)}>↻ Dobara try karo</button>
          </span>
        </div>
      )}
      {boardNote && <div className="sf-foot muted" style={{ background: "none", border: 0 }}>{boardNote}</div>}

      {!loading && (hasCard || (board?.length ?? 0) > 0) && (
        <>
          <div className="sf-sec">
            <p className="sf-head">
              <span className="sf-tag seat">SEAT</span> Seat mil jayegi (AVL / RAC){" "}
              <span className="sf-count">· {seatTrains} trains · {seat.length} classes me seat
                {(() => {
                  const total = seatGroups.reduce((n, g) => n + g.length, 0);
                  return total > seat.length ? ` + ${total - seat.length} WL/N-A classes halki dikh rahi hain (tap = fresh check)` : "";
                })()}</span>
            </p>
            {seat.length === 0 && (
              <div className="sf-empty">
                {seatIgnoringTime.length > 0 ? (
                  <>
                    <b>Is time ke baad koi train me seat nahi.</b> Jo {uniqueTrainCount(seatIgnoringTime)} trains me seat hai wo is time se pehle ki hain.
                    <span className="sf-empty-chips">
                      <button
                        className="sf-chip"
                        onClick={() => {
                          setAfterMin(null);
                          setBeforeMin(null);
                        }}
                      >
                        Time filter hatao
                      </button>
                      <button className="sf-chip" onClick={() => setCls(cls === "3A" ? null : "3A")}>
                        3A me dekho
                      </button>
                    </span>
                  </>
                ) : mode === "avail" ? (
                  <>
                    <b>
                      {cls ?? (acOnly ? "AC classes" : "Kisi bhi class")} me aaj koi AVAILABLE / RAC train nahi mili.
                    </b>{" "}
                    <span className="sf-empty-chips">
                      <button className="sf-chip" onClick={() => setMode("all")}>
                        🚆 Sabhi trains dekho (WL list)
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <b>
                      {cls ?? "Kisi bhi class"} me seat wali train nahi mili.
                    </b>{" "}
                    WL wali list neeche hai — ya doosri class try karo.
                  </>
                )}
              </div>
            )}
            {seatShown.map((g) => (
              <TrainGroup key={`${g[0].number}-${g[0].departure ?? ""}`} rows={g} onPick={tap} />
            ))}
            {seatGroups.length > 8 && (
              <button className="sf-more" onClick={() => setShowAllSeat((v) => !v)}>
                {showAllSeat ? "Kam dikhao ‹" : `aur ${seatGroups.length - 8} trains dekho ›`}
              </button>
            )}
            {/* Round-19f (user baar-baar: "upar card me classes available me sabhi dikh nhi rhi jabki
                neeche zyada hai"): Available tab me bhi poora sach — jin trains me koi available class
                nahi, wo bhi apni SAARI classes ke saath (halki chips) neeche dikhti hain. */}
            {mode === "avail" && noSeatGroups.length > 0 && (
              <>
                <p className="sf-head" style={{ marginTop: 14 }}>
                  <span className="sf-tag wl">SEAT NAHI</span> in trains me koi AVAILABLE / RAC class nahi{" "}
                  <span className="sf-count">· {uniqueTrainCount(wlAll)} trains · {wlAll.length} classes — poori list, kuch chhupa nahi</span>
                </p>
                {noSeatShown.map((g) => (
                  <TrainGroup key={`off-${g[0].number}-${g[0].departure ?? ""}`} rows={g} onPick={tap} />
                ))}
                {noSeatGroups.length > 8 && (
                  <button className="sf-more" onClick={() => setShowAllOff((v) => !v)}>
                    {showAllOff ? "Kam dikhao ‹" : `aur ${noSeatGroups.length - 8} trains dekho ›`}
                  </button>
                )}
              </>
            )}
          </div>

          {mode === "all" && (
            <div className="sf-sec wl-sec">
              <p className="sf-head">
                <span className="sf-tag wl">WAITLIST / N-A</span> Seat pakki nahi{" "}
                <span className="sf-count">· {wlTrains} trains · {wl.length} classes</span>
              </p>
              {wl.length === 0 && <div className="sf-empty">Is filter me WL wali bhi koi nahi.</div>}
              {wlShown.map((g) => (
                <TrainGroup key={`${g[0].number}-${g[0].departure ?? ""}-wl`} rows={g} onPick={tap} />
              ))}
              {wlGroups.length > 4 && (
                <button className="sf-more" onClick={() => setShowAllWl((v) => !v)}>
                  {showAllWl ? "Kam dikhao ‹" : `aur ${wlGroups.length - 4} WL trains dekho ›`}
                </button>
              )}
            </div>
          )}

          {mode === "all" && noData.length > 0 && (
            <div className="sf-sec nodata-sec">
              <p className="sf-head">
                <span className="sf-tag nodata">DATA NAHI</span> Seat data provider se nahi aayi{" "}
                <span className="sf-count">· {noData.length} trains</span>
              </p>
              <div className="sf-foot muted" style={{ border: 0, padding: "0 0 8px", background: "none" }}>
                Inhe “seat nahi” <b>nahi</b> maana gaya — check karo (↻).
              </div>
              {noDataShown.map((r) => (
                <Row key={`nd-${r.number}`} r={r} onPick={tap} />
              ))}
              {noData.length > 3 && (
                <button className="sf-more" onClick={() => setShowAllNoData((v) => !v)}>
                  {showAllNoData ? "Kam dikhao ‹" : `aur ${noData.length - 3} trains dekho ›`}
                </button>
              )}
            </div>
          )}

          {merged && merged.missingClass > 0 && (
            <div className="sf-foot muted">
              {merged.missingClass} trains me {cls} class hi nahi hai — wo is list me nahi.
            </div>
          )}
          <div className="sf-foot">
            <b>Real data:</b> {hasCard ? "upar wale card ka hi per-train board + live route board" : "live route board"} · {seatTrains + wlTrains + noData.length} trains ka jawab ·
            Available = AVL + RAC · Sabhi trains = WL / N-A bhi, <b>har class apni real status ke saath</b> ·{" "}
            <b>AC</b> = 1A/2A/3A/3E/CC/EC (2S/SL nahi) ·
            WL ka <b>confirm % hum nahi dete</b> (sirf WL number, koi andaza nahi).
            {(earliest || cheapest) && (
              <> Sort: <b>{cheapest ? "sabse sasta (fare ↑)" : "sabse jaldi (kam time)"}</b>.</>
            )}
            {seat.some((s) => !s.timesKnown) && '  Times "—" wali trains board par hain par search list me nahi thi.'}
          </div>
        </>
      )}
    </div>
  );
}
