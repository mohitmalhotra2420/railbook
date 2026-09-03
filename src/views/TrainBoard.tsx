import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { understand } from "../ai/nlu";
import { pickFastest } from "../ai/filter";
import { api } from "../api";
import { useBooking } from "../booking/context";
import { VoiceBar, fieldPrompt } from "../components/VoiceBar";
import { RouteTimeline, type RouteSheetData } from "../components/RouteTimeline";
import { addDays, formatShortDate, inr, todayYmd } from "../format";
import { isBookable, type ClassAvailability, type ClassCode, type TrainResult } from "../types";
import { emitUtterance, looksLikeChatQuery } from "../conversation/bus";
import { matchClassBySpeech, matchTrainBySpeech } from "../voice/matchVisible";
import { speakGuide } from "../voice/speakGuide";

const QUOTAS = [
  { id: "GN", label: "General Quota" },
  { id: "LD", label: "Ladies Quota" },
  { id: "TQ", label: "Tatkal Quota" },
] as const;

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function weekdayLetters(runsOn?: number[] | null): string {
  const days = Array.isArray(runsOn) ? runsOn : [];
  return [1, 2, 3, 4, 5, 6, 0]
    .map((d) => (days.includes(d) ? DAY_LETTERS[d] : "—"))
    .join(" ");
}

function avlText(c: ClassAvailability, loading = false): { text: string; tone: "ok" | "wl" | "rac" | "muted" } {
  if (loading && (c.status === "UNKNOWN" || (c.status === "AVAILABLE" && c.seats == null && !c.fare))) {
    return { text: "Loading…", tone: "muted" };
  }
  if (c.status === "AVAILABLE") {
    return { text: c.seats != null ? `AVL ${c.seats}` : "AVL", tone: "ok" };
  }
  if (c.status === "WAITLIST") {
    return { text: c.waitlist != null ? `WL ${c.waitlist}` : "WL", tone: "wl" };
  }
  if (c.status === "RAC") {
    return { text: c.rac != null ? `RAC ${c.rac}` : "RAC", tone: "rac" };
  }
  if (c.status === "NOT_AVAILABLE") return { text: "N/A", tone: "muted" };
  return { text: "↻ Refresh", tone: "muted" };
}

function cellFor(train: TrainResult, code: ClassCode): ClassAvailability | undefined {
  return train.classes.find((c) => c.code === code);
}

type CoachRow = { name: string; classCode: string; positionFromEngine: number | null };

type CoachSheet = {
  trainNumber: string;
  trainName: string;
  stationCode: string | null;
  loading: boolean;
  coaches: CoachRow[];
  counts: { classCode: string; count: number }[];
  error: string | null;
};

function coachClassToken(classCode: string): string {
  const map: Record<string, string> = {
    "1A": "a1",
    "2A": "a2",
    "3A": "a3",
    "3E": "e3",
    EA: "ea",
    EC: "ec",
    CC: "cc",
    SL: "sl",
    "2S": "s2",
    GS: "gen",
    GEN: "gen",
    UR: "gen",
  };
  return map[classCode.toUpperCase()] ?? "other";
}

export function needsSeatRefresh(train: TrainResult): boolean {
  if (!train.classes.length) return true;
  return train.classes.some((c) => c.status === "UNKNOWN" || (c.status === "AVAILABLE" && c.seats == null && !c.fare));
}

export function nextSeatBatch(
  trains: TrainResult[],
  inFlight: Iterable<string>,
  batchSize: number,
  alreadyFetched: Iterable<string> = [],
): TrainResult[] {
  const busy = new Set(inFlight);
  const fetched = new Set(alreadyFetched);
  return trains
    .filter((t) => needsSeatRefresh(t) && !busy.has(t.number) && !fetched.has(t.number))
    .slice(0, batchSize);
}

export function seatListKey(date: string, quota: string, trains: { number: string }[]): string {
  return `${date}|${quota}|${trains.map((t) => t.number).join(",")}`;
}

export function TrainBoard() {
  const { state, go, patchTrain, selectTrainAndClass, setDate, cancelHome } = useBooking();
  const [quota, setQuota] = useState<(typeof QUOTAS)[number]["id"]>("GN");
  const [klass, setKlass] = useState<ClassCode | null>(null);
  const [q, setQ] = useState("");
  const [loadingNos, setLoadingNos] = useState<string[]>([]);
  const [coachSheet, setCoachSheet] = useState<CoachSheet | null>(null);
  const [routeSheet, setRouteSheet] = useState<RouteSheetData | null>(null);
  const [pickedNo, setPickedNo] = useState<string | null>(null);
  const [hint, setHint] = useState<ReactNode>(
    fieldPrompt("TRAIN", "number ya naam boliye, phir class"),
  );
  const fetchedSeats = useRef(new Set<string>());

  const fromName = state.from?.name || state.from?.city || state.from?.code || "From";
  const toName = state.to?.name || state.to?.city || state.to?.code || "To";

  const availableClasses = useMemo(() => {
    const seen = new Set<ClassCode>();
    for (const t of state.trains) {
      for (const c of t.classes) seen.add(c.code);
    }
    const order: ClassCode[] = ["SL", "3E", "3A", "2A", "1A", "CC", "EC", "2S", "EA"];
    return order.filter((c) => seen.has(c));
  }, [state.trains]);

  const trains = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.trains.filter((t) => {
      if (needle && !t.name.toLowerCase().includes(needle) && !t.number.includes(needle)) return false;
      if (klass && t.classes.length && !t.classes.some((c) => c.code === klass)) return false;
      return true;
    });
  }, [state.trains, q, klass]);

  const [loadingAll, setLoadingAll] = useState(false);
  const loadingSet = useRef(new Set<string>());
  const SEAT_BATCH = 16;
  const trainsRef = useRef(state.trains);
  const dateRef = useRef(state.date);
  const quotaRef = useRef(quota);
  const pumpGen = useRef(0);
  trainsRef.current = state.trains;
  dateRef.current = state.date;
  quotaRef.current = quota;
  const trainNosKey = useMemo(() => state.trains.map((t) => t.number).join(","), [state.trains]);
  const pendingSeatCount = useMemo(() => state.trains.filter(needsSeatRefresh).length, [state.trains]);

  function markLoading(number: string, on: boolean) {
    if (on) {
      loadingSet.current.add(number);
      setLoadingNos((cur) => (cur.includes(number) ? cur : [...cur, number]));
    } else {
      loadingSet.current.delete(number);
      setLoadingNos((cur) => cur.filter((n) => n !== number));
    }
  }

  function isLoadingTrain(number: string) {
    return loadingSet.current.has(number) || loadingNos.includes(number);
  }

  async function loadTrain(train: TrainResult, force = false) {
    const date = dateRef.current;
    const qta = quotaRef.current;
    if (!date) return;
    if (!force && (loadingSet.current.has(train.number) || fetchedSeats.current.has(train.number))) return;
    if (force) fetchedSeats.current.delete(train.number);
    markLoading(train.number, true);
    try {
      const hints = train.classes.map((c) => c.code);
      const board = await api.classBoard(train.number, date, train.from.code, train.to.code, qta, hints);
      if (dateRef.current !== date || quotaRef.current !== qta) return;
      if (board.classes?.length) patchTrain(train.number, board.classes);
    } catch {
      /* never invent */
    } finally {
      fetchedSeats.current.add(train.number);
      markLoading(train.number, false);
    }
  }

  async function refreshAllSeats() {
    if (!state.date || !state.trains.length) return;
    setLoadingAll(true);
    pumpGen.current += 1;
    const gen = pumpGen.current;
    fetchedSeats.current.clear();
    try {
      const list = [...trainsRef.current];
      for (let i = 0; i < list.length; i += SEAT_BATCH) {
        if (gen !== pumpGen.current) return;
        await Promise.all(list.slice(i, i + SEAT_BATCH).map((t) => loadTrain(t, true)));
      }
    } finally {
      if (gen === pumpGen.current) setLoadingAll(false);
    }
  }

  useEffect(() => {
    loadingSet.current.clear();
    fetchedSeats.current.clear();
    setLoadingNos([]);
  }, [quota, state.date, trainNosKey]);

  useEffect(() => {
    if (state.searching || !state.date || !trainNosKey) return;
    const gen = ++pumpGen.current;
    void (async () => {
      while (gen === pumpGen.current) {
        const batch = nextSeatBatch(trainsRef.current, loadingSet.current, SEAT_BATCH, fetchedSeats.current);
        if (!batch.length) break;
        await Promise.all(batch.map((t) => loadTrain(t)));
      }
    })();
    return () => {
      pumpGen.current += 1;
    };
  }, [state.searching, state.date, quota, trainNosKey]);

  async function onQuota(id: (typeof QUOTAS)[number]["id"]) {
    setQuota(id);
    for (const t of state.trains) {
      if (t.classes.length) patchTrain(t.number, []);
    }
  }

  async function pickTrain(train: TrainResult, announce = true) {
    const already = pickedNo === train.number;
    setPickedNo(train.number);
    setHint(fieldPrompt("CLASS", `${train.number} ${train.name} — SL, 3A, CC…`));
    if (announce && !already) {
      speakGuide("Train select ho gayi. Ab class select karein.");
    } else if (announce) {
      speakGuide("Train pehle se select hai. Ab aap class select karein.");
    }
    if (needsSeatRefresh(train)) await loadTrain(train, true);
    const el = document.getElementById(`tb-${train.number}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function handleVoice(text: string) {
    // Coach position voice intent — works right on the train list.
    if (/\bcoach|कोच|डिब्बा/i.test(text)) {
      const pool = trains.length ? trains : state.trains;
      const byNum = text.match(/\b(\d{5})\b/)?.[1];
      const spoken =
        (byNum ? pool.find((t) => t.number === byNum) : undefined) || matchTrainBySpeech(text, pool);
      const target =
        spoken ||
        (pickedNo ? pool.find((t) => t.number === pickedNo) : undefined) ||
        (pool.length === 1 ? pool[0] : undefined);
      if (target) {
        setHint(fieldPrompt("COACH", `${target.number} ${target.name} — coach position`));
        speakGuide(`${target.number} ki coach position dikha raha hoon.`);
        void openCoach(target);
        return;
      }
      go("home");
      emitUtterance(text);
      return;
    }
    if (looksLikeChatQuery(text)) {
      go("home");
      emitUtterance(text);
      return;
    }
    const pool = trains.length ? trains : state.trains;
    const byNum = text.match(/\b(\d{5})\b/)?.[1];
    const spokenTrain =
      (byNum ? pool.find((t) => t.number === byNum) : undefined) || matchTrainBySpeech(text, pool);
    let train = spokenTrain || (pickedNo ? pool.find((t) => t.number === pickedNo) : undefined);
    if (!train && /fastest|tez|jaldi/.test(text.toLowerCase())) train = pickFastest(pool);
    if (!train && /pehli|first|isi|yeh wali|this train|yeh train/.test(text.toLowerCase())) {
      train = pool[0];
    }
    const classPool = train?.classes?.length ? train.classes : pool.flatMap((t) => t.classes);
    const klassHit = matchClassBySpeech(text, classPool);
    if (!train && klassHit && pickedNo) train = pool.find((t) => t.number === pickedNo);
    if (!train && klassHit && pool.length === 1) train = pool[0];
    if (spokenTrain && spokenTrain.number !== pickedNo) {
      await pickTrain(spokenTrain);
    }
    const target = spokenTrain || train || pool.find((t) => t.number === pickedNo);
    if (klassHit && target) {
      await onClassTap(target, klassHit.code);
      return;
    }
    if (target && !klassHit) {
      setHint(fieldPrompt("CLASS", `${target.number} ${target.name} — sleeper ya 3AC`));
      return;
    }
    if (!target && !klassHit) {
      setHint(fieldPrompt("TRAIN", "jo screen pe likha hai wahi naam ya number boliye"));
      speakGuide("Train select nahi hui. Screen pe jo train dikh rahi hai uska naam ya number boliye.");
    }
  }

  async function onClassTap(train: TrainResult, code: ClassCode) {
    const cell = cellFor(train, code);
    if (!cell || cell.status === "UNKNOWN") {
      await loadTrain(train, true);
      return;
    }
    if (!isBookable(cell.status)) return;
    speakGuide(`Aapki class select ho gayi hai, ${cell.label}. Ab aap seat preference select karein.`);
    selectTrainAndClass({ ...train, classes: train.classes }, cell);
  }

  async function openRoute(train: TrainResult) {
    setRouteSheet({
      trainNumber: train.number,
      trainName: train.name,
      date: train.date,
      originCode: train.from.code,
      destCode: train.to.code,
      stops: [],
      loading: true,
    });
    try {
      const res = await api.trainSchedule(train.number);
      const stops = Array.isArray(res.schedule.stops) ? res.schedule.stops : [];
      setRouteSheet({
        trainNumber: res.schedule.trainNumber || train.number,
        trainName: res.schedule.trainName || train.name,
        date: train.date,
        originCode: train.from.code,
        destCode: train.to.code,
        stops: stops.map((s) => ({
          code: s.code,
          name: s.name,
          arrival: s.arrival,
          departure: s.departure,
          day: s.day,
        })),
        emptyMessage: stops.length ? undefined : "Route stops provider payload mein nahi aaye.",
      });
    } catch {
      setRouteSheet({
        trainNumber: train.number,
        trainName: train.name,
        date: train.date,
        originCode: train.from.code,
        destCode: train.to.code,
        stops: [],
        emptyMessage: "Route/timetable nahi mili. Main map invent nahi karunga.",
      });
    }
  }

  async function openCoach(train: TrainResult) {
    const station = train.from.code;
    setCoachSheet({
      trainNumber: train.number,
      trainName: train.name,
      stationCode: station,
      loading: true,
      coaches: [],
      counts: [],
      error: null,
    });
    try {
      const res = await api.trainCoachPosition(train.number, station);
      const coaches: CoachRow[] = res.coachPosition.coaches.map((c) => ({
        name: c.name,
        classCode: c.classCode,
        positionFromEngine: c.positionFromEngine,
      }));
      const byClass = new Map<string, number>();
      for (const c of coaches) byClass.set(c.classCode, (byClass.get(c.classCode) ?? 0) + 1);
      setCoachSheet({
        trainNumber: res.coachPosition.trainNumber || train.number,
        trainName: train.name,
        stationCode: res.coachPosition.stationCode || station,
        loading: false,
        coaches,
        counts: [...byClass.entries()]
          .map(([classCode, count]) => ({ classCode, count }))
          .sort((a, b) => b.count - a.count || a.classCode.localeCompare(b.classCode)),
        error: null,
      });
    } catch {
      setCoachSheet({
        trainNumber: train.number,
        trainName: train.name,
        stationCode: station,
        loading: false,
        coaches: [],
        counts: [],
        error: "Coach position provider se nahi aayi. Main fake layout nahi dikhaunga.",
      });
    }
  }

  const nowLabel = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const today = todayYmd();
  const maxDate = addDays(today, 120);
  const dateChips = [
    { id: "aaj", label: "Aaj", date: today },
    { id: "kal", label: "Kal", date: addDays(today, 1) },
    { id: "parso", label: "Parso", date: addDays(today, 2) },
  ];

  return (
    <div className="tb">
      <header className="tb-head">
        <div className="tb-head-row">
          <button className="tb-round" aria-label="Cancel" title="Cancel" onClick={() => cancelHome()}>
            ✕
          </button>
          <div className="tb-title">
            <div className="tb-route">
              {fromName} → {toName}
            </div>
            <div className="tb-sub">{nowLabel.replace(",", " ·")}</div>
          </div>
          <button className="tb-round" aria-label="Menu" onClick={() => go("bookings")}>
            ☰
          </button>
        </div>
        <div className="tb-search-row">
          <label className={`tb-search ${!pickedNo ? "need" : "done"}`}>
            <span aria-hidden>⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search trains"
              aria-label="Search trains"
            />
          </label>
          <button
            type="button"
            className="tb-refresh-head"
            aria-label="Refresh seats"
            title="Refresh seats"
            disabled={loadingAll || state.searching || !state.trains.length}
            onClick={() => void refreshAllSeats()}
          >
            {loadingAll ? "…" : "↻"}
          </button>
        </div>
      </header>

      <div className="tb-body">
        <div className="tb-card tb-tabs">
          {QUOTAS.map((tab) => (
            <button
              key={tab.id}
              className={quota === tab.id ? "on" : ""}
              onClick={() => void onQuota(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="tb-card tb-dates">
          {dateChips.map((chip) => (
            <button
              key={chip.id}
              className={state.date === chip.date ? "on" : ""}
              onClick={() => setDate(chip.date)}
            >
              {chip.label}
            </button>
          ))}
          <label className="tb-date-input">
            <span>Other date</span>
            <input
              type="date"
              min={today}
              max={maxDate}
              value={state.date}
              onChange={(e) => {
                const next = e.target.value;
                if (next) setDate(next);
              }}
              aria-label="Search on other date"
            />
          </label>
        </div>

        <div className="tb-actions">
          <button
            type="button"
            className="tb-refresh-all"
            onClick={() => void refreshAllSeats()}
            disabled={loadingAll || state.searching || !state.trains.length}
          >
            {loadingAll ? "Seats load ho rahi hain…" : "↻ Refresh seats"}
          </button>
          <button type="button" onClick={() => cancelHome()}>
            Other train
          </button>
          <button type="button" className="ghost" onClick={() => cancelHome()}>
            Cancel
          </button>
        </div>

        <p className="lede" style={{ margin: "0 0 10px", fontSize: 12 }}>
          Classes/seats RailCore se aati hain (RailKit fallback). IRCTC counter se alag ho sakti hain. Na aaye to Refresh seats dabao.
        </p>
        {pendingSeatCount > 0 && !state.searching && state.trains.length > 0 && (
          <p className="lede tb-seat-progress" style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>
            Seats load ho rahi hain… {state.trains.length - pendingSeatCount}/{state.trains.length}
          </p>
        )}
        {availableClasses.length > 0 && (
          <div className="tb-card tb-classes">
            {availableClasses.map((c) => (
              <button
                key={c}
                className={klass === c ? "on" : ""}
                onClick={() => setKlass((prev) => (prev === c ? null : c))}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {state.searching && (
          <>
            <div className="skel" />
            <div className="skel" />
          </>
        )}

        {!state.searching && !trains.length && (
          <div className="empty">
            <h2>No trains available</h2>
            <p className="lede">
              {state.emptyMessage || state.error || "Is route/date pe list nahi aayi. Main trains invent nahi karunga."}
            </p>
            <div className="tb-empty-actions">
              <button
                type="button"
                disabled={addDays(state.date, -1) < today}
                onClick={() => setDate(addDays(state.date, -1))}
              >
                1 day earlier
              </button>
              <button type="button" onClick={() => setDate(addDays(state.date, 1))}>
                1 day later
              </button>
              <button type="button" onClick={() => cancelHome()}>
                Other train
              </button>
              <button type="button" className="ghost" onClick={() => cancelHome()}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {!state.searching &&
          trains.map((train) => (
            <article
              key={train.number}
              id={`tb-${train.number}`}
              className={`tb-train ${pickedNo === train.number ? "picked done" : ""} ${!pickedNo ? "need-train" : ""}`}
              onClick={() => void pickTrain(train)}
            >
              <div className="tb-train-top">
                <div>
                  <h2>{train.name}</h2>
                  <div className="tb-num">{train.number}</div>
                </div>
                <div className="tb-icons" aria-hidden>
                  <span>♡</span>
                  <span>▣</span>
                </div>
              </div>

              <div className="tb-times">
                <div>
                  <div className="tb-hh">{train.departure}</div>
                  <div className="tb-st">{train.from.name || train.from.city}</div>
                  <div className="tb-day">
                    {formatShortDate(train.date)}
                  </div>
                </div>
                <div className="tb-mid">
                  <div>{train.durationLabel}</div>
                  <div className="tb-line" />
                  <div className="tb-days">{weekdayLetters(train.runsOn)}</div>
                </div>
                <div className="tb-arr">
                  <div className="tb-hh">{train.arrival}</div>
                  <div className="tb-st">{train.to.name || train.to.city}</div>
                  <div className="tb-day">
                    {formatShortDate(
                      train.arrivalDayOffset ? addDays(train.date, train.arrivalDayOffset) : train.date,
                    )}
                  </div>
                </div>
              </div>

              <div
                className={`tb-grid ${pickedNo === train.number ? "need" : ""}`}
                style={{ gridTemplateColumns: `repeat(${Math.max(train.classes.length, 1)}, 1fr)` }}
              >
                {train.classes.length ? (
                  train.classes.map((cell) => {
                    const av = avlText(cell, isLoadingTrain(train.number));
                    const selected = cell.code === klass;
                    return (
                      <button
                        key={cell.code}
                        className={`tb-cell ${selected ? "sel" : ""} ${av.tone}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onClassTap(train, cell.code);
                        }}
                      >
                        <div className="tb-cc">{cell.code}</div>
                        <div className="tb-fare">{cell.fare > 0 ? inr(cell.fare) : "—"}</div>
                        <div className={`tb-avl ${av.tone}`}>{av.text}</div>
                      </button>
                    );
                  })
                ) : (
                  <button
                    className="tb-cell muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void loadTrain(train, true);
                    }}
                  >
                    <div className="tb-cc">Classes</div>
                    <div className="tb-fare">—</div>
                    <div className="tb-avl muted">{isLoadingTrain(train.number) ? "Loading…" : "↻ Refresh"}</div>
                  </button>
                )}
              </div>

              <div className="tb-foot">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void openRoute(train);
                  }}
                >
                  ▤ Route
                </button>
                <button
                  type="button"
                  className="tb-refresh-card"
                  disabled={isLoadingTrain(train.number)}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void loadTrain(train, true);
                  }}
                >
                  {isLoadingTrain(train.number) ? "… Seats" : "↻ Refresh seats"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void openCoach(train);
                  }}
                >
                  🪑 Coach
                </button>
              </div>
            </article>
          ))}
      </div>

      <VoiceBar prompt={hint} onSpeak={(text) => void handleVoice(text)} />

      {routeSheet && <RouteTimeline data={routeSheet} onClose={() => setRouteSheet(null)} />}

      {coachSheet && (
        <div className="sheet-backdrop" onClick={() => setCoachSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <h2>{coachSheet.trainNumber} coach position</h2>
            <p className="lede" style={{ marginTop: 2 }}>
              {coachSheet.trainName}
              {coachSheet.stationCode ? ` · ${coachSheet.stationCode} par composition` : ""}
            </p>
            {coachSheet.loading && (
              <>
                <div className="skel" style={{ height: 64, marginTop: 12 }} />
                <p className="lede" style={{ marginTop: 8 }}>
                  Coach layout load ho raha hai…
                </p>
              </>
            )}
            {!coachSheet.loading && coachSheet.error && (
              <p className="lede" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                {coachSheet.error}
              </p>
            )}
            {!coachSheet.loading && !coachSheet.error && coachSheet.coaches.length > 0 && (
              <>
                <div
                  className="coach-strip"
                  role="img"
                  aria-label={`Engine ke baad ${coachSheet.coaches.length} coaches`}
                >
                  <div className="coach-box engine">
                    <span className="coach-name">ENGINE</span>
                    <span className="coach-class">🚂</span>
                  </div>
                  {coachSheet.coaches.map((c, i) => (
                    <div
                      key={`${c.name}-${i}`}
                      className={`coach-box cl-${coachClassToken(c.classCode)}`}
                      title={
                        c.positionFromEngine != null ? `Engine se position ${c.positionFromEngine}` : c.name
                      }
                    >
                      <span className="coach-name">{c.name}</span>
                      <span className="coach-class">{c.classCode}</span>
                    </div>
                  ))}
                </div>
                <p className="lede" style={{ marginTop: 10, fontSize: 12 }}>
                  {coachSheet.coaches.length} coaches · engine se order mein ·{" "}
                  {coachSheet.counts.map((x) => `${x.classCode} ×${x.count}`).join(", ")}
                </p>
                <p className="lede" style={{ fontSize: 11, opacity: 0.7 }}>
                  Provider snapshot (RailCore). Platform par actual racking alag ho sakti hai.
                </p>
              </>
            )}
            <button className="btn navy" style={{ marginTop: 16 }} onClick={() => setCoachSheet(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
