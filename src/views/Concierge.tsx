import { useEffect, useRef, useState, type MouseEvent } from "react";
import { planTurn, type AssistantTurn, type Block } from "../ai/orchestrate";
import type { DialogSlot, NluResult } from "../ai/nlu";
import type { Prefs } from "../ai/filter";
import { matchingClasses } from "../ai/filter";
import { api } from "../api";
import { useBooking } from "../booking/context";
import { validatePassengers } from "../booking/state";
import { loadTravellers } from "../data/travellers";
import { availabilityLabel, formatShortDate, inr, newId, todayYmd } from "../format";
import { BERTH_BY_CLASS, CLASS_LABELS, isBookable, type ClassAvailability, type ClassCode, type Passenger, type Station, type TrainResult } from "../types";

import type { ChatMessage } from "../conversation/types";
import { useVoiceInput } from "../voice/useVoiceInput";
import {
  ageIsValid,
  nameIsValid,
  nextPassengerAsk,
  sanitizePassengerAge,
  sanitizePassengerName,
} from "../voice/passengerSpeech";
import { speakGuide } from "../voice/speakGuide";
import { isStationPickInterrupt } from "../ai/agent";
import { formatGoesToAnswer, formatScheduleCompare, type CompareSchedule } from "../ai/compare";
import { matchOfferedStation } from "../ai/stationPick";
import { looksLikeChatQuery, onUtterance } from "../conversation/bus";

const PROBE_CLASSES: ClassCode[] = ["SL", "3A", "2A", "1A", "CC", "2S"];

function probeClassRows(): ClassAvailability[] {
  return PROBE_CLASSES.map((code) => ({
    code,
    label: CLASS_LABELS[code],
    status: "UNKNOWN" as const,
    fare: 0,
  }));
}

const STARTERS = [
  "Mujhe Amritsar se Dehradun jana hai",
  "Kal Amritsar se Delhi 2 logon ke liye.",
  "Delhi jaana hai",
  "Amritsar → Dehradun",
  "Confirmed seat chahiye",
];

function progressStep(flow: string): number {
  if (flow === "CONFIRMED" || flow === "FAILED") return 4;
  if (flow === "FARE_REVIEW" || flow === "PAYMENT_PENDING" || flow === "BOOKING_PENDING") return 3;
  if (flow === "PASSENGERS_PENDING" || flow === "CLASS_SELECTED") return 2;
  if (flow === "RESULTS_FOUND" || flow === "TRAIN_SELECTED") return 1;
  return 0;
}

export function Concierge() {
  const booking = useBooking();
  const { state, wallet, go, setFrom, setTo, setDate, setPassengerCount, searchRoute, showResults, selectTrain, selectClass, selectSeat, updatePassenger, goReview, confirm, retrieve } = booking;
  const [prefs, setPrefs] = useState<Prefs>({});
  const [lastAsked, setLastAsked] = useState<DialogSlot>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [seenSession, setSeenSession] = useState(state.sessionId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [debugOn, setDebugOn] = useState(() => {
    try {
      return localStorage.getItem("railbookDebug") === "1";
    } catch {
      return false;
    }
  });
  const [lastDbg, setLastDbg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validatePassengers>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const pendingResults = useRef<Prefs | null>(null);
  const pendingFare = useRef(false);
  const pendingTicket = useRef(false);
  const stationPickRef = useRef<{ slot: "from" | "to"; stations: Station[] } | null>(null);
  const journeyRef = useRef<{ from: Station | null; to: Station | null; date: string; dateProvided: boolean }>({
    from: state.from,
    to: state.to,
    date: state.date,
    dateProvided: state.dateProvided,
  });
  const handleTextRef = useRef<(text: string) => void>(() => undefined);
  const lastFactTrainRef = useRef<string | null>(null);
  /** Autonomous agent memory: compact server-side state + last few chat turns. */
  const agentStateRef = useRef<unknown>(null);
  const agentHistoryRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const agentDisabledRef = useRef<boolean>(
    (() => {
      try {
        return localStorage.getItem("railbookAgentAuto") === "0";
      } catch {
        return false;
      }
    })(),
  );
  const saved = loadTravellers();

  const voice = useVoiceInput(
    (text) => {
      handleTextRef.current(text);
    },
    (msg) => {
      setMessages((m) => [...m, { id: newId(), role: "assistant", text: msg }]);
    },
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, thinking]);

  async function applyTurn(turn: AssistantTurn, userText = "") {
    setPrefs(turn.prefs);
    const stationBlock = turn.blocks?.find((b) => b.type === "stations");
    if (stationBlock && stationBlock.type === "stations") {
      stationPickRef.current = { slot: stationBlock.slot, stations: stationBlock.options };
    }
    if (turn.apply?.from) setFrom(turn.apply.from);
    if (turn.apply?.to) setTo(turn.apply.to);
    if (turn.apply?.passengerCount) setPassengerCount(turn.apply.passengerCount);
    if (turn.apply?.date && turn.apply.date !== state.date && !turn.probeSeats && !turn.lookupAvailability) {
      setDate(turn.apply.date);
    }

    const from = turn.apply?.from ?? state.from;
    const to = turn.apply?.to ?? state.to;
    const date = turn.apply?.date ?? state.date;
    // Keep the picker's journey snapshot in sync with the latest spoken slots —
    // a stale date here used to search old dates after a station pick.
    journeyRef.current = {
      from,
      to,
      date: date || journeyRef.current.date,
      dateProvided: Boolean(date) || journeyRef.current.dateProvided,
    };

    if (turn.cancelled) {
      setBusy(true);
      try {
        const res = await api.cancelled();
        const full = (res.cancelled.fully ?? []).slice(0, 8).map((t) => `${t.trainNo ?? ""} ${t.trainName ?? ""}`.trim());
        const part = (res.cancelled.partial ?? []).slice(0, 8).map((t) => `${t.trainNo ?? ""} ${t.trainName ?? ""}`.trim());
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `Fully cancelled: ${res.cancelled.fully?.length ?? 0}\n${full.join("\n") || "—"}\n\nPartial: ${res.cancelled.partial?.length ?? 0}\n${part.join("\n") || "—"}\n\n(RailKit cancelList — invent nahi.)`,
          },
        ]);
      } catch {
        setMessages((m) => [...m, { id: newId(), role: "assistant", text: "Cancelled list nahi mili. Main trains invent nahi karunga." }]);
      }
      setBusy(false);
    }
    if (turn.liveStation) {
      setBusy(true);
      try {
        const res = await api.stationBoard(turn.liveStation, 2);
        const lines = res.board.trains.slice(0, 12).map((t) => `${t.trainNo} ${t.trainName} · PF ${t.platform ?? "—"}`);
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `${res.board.summary ?? turn.liveStation}\n${lines.join("\n") || "No trains in this window."}`,
          },
        ]);
      } catch {
        setMessages((m) => [...m, { id: newId(), role: "assistant", text: `${turn.liveStation} board nahi mila.` }]);
      }
      setBusy(false);
    }
    if (turn.trainHistory) {
      setBusy(true);
      try {
        const ymd = turn.historyDate ?? (() => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })();
        const res = await api.trainHistory(turn.trainHistory, ymd);
        const stops = res.history.stops.slice(0, 14).map((s) => {
          const delay = s.delay != null ? ` (${s.delay > 0 ? "+" : ""}${s.delay}m)` : "";
          return `${s.code} ${s.name}  ${s.arrival ?? "—"} / ${s.departure ?? "—"}${delay}`;
        }).join("\n");
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `${res.history.trainNumber} ${res.history.trainName}\nDate: ${res.history.date} (completed run — aaj ki live nahi)\n${stops || "No history record."}\n(Provider history — gadh ke nahi.)`,
          },
        ]);
      } catch {
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `Train ${turn.trainHistory} ka ${turn.historyDate ?? "kal"} ka completed run nahi mila. Main yesterday ka live invent nahi karunga.`,
          },
        ]);
      }
      setBusy(false);
    }
    if (turn.liveTrain) {
      lastFactTrainRef.current = turn.liveTrain;
      setBusy(true);
      try {
        const res = await api.liveTrain(turn.liveTrain, turn.liveDate);
        const live = res.live;
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `${live.trainNumber} ${live.trainName || ""}\nStatus: ${live.status}${live.delayMinutes != null ? ` · delay ${live.delayMinutes} min` : ""}${live.currentStation ? ` · last: ${live.currentStation}` : ""}${live.nextStation ? ` · next: ${live.nextStation}` : ""}\n(Live railway data — gadh ke nahi.)`,
          },
        ]);
      } catch {
        setMessages((m) => [
          ...m,
          { id: newId(), role: "assistant", text: `Train ${turn.liveTrain} ka live status nahi mila. Main location invent nahi karunga.` },
        ]);
      }
      setBusy(false);
    }
    if (turn.compareTrains?.length) {
      lastFactTrainRef.current = turn.compareTrains[0] ?? lastFactTrainRef.current;
      setBusy(true);
      try {
        const rows = await Promise.all(
          turn.compareTrains.slice(0, 2).map(async (num) => {
            try {
              const res = await api.trainSchedule(num);
              const s = res.schedule;
              const snap: CompareSchedule = {
                trainNumber: s.trainNumber || num,
                trainName: s.trainName,
                stops: (s.stops ?? []).map((st) => ({
                  code: st.code,
                  name: st.name,
                  arrival: st.arrival,
                  departure: st.departure,
                })),
              };
              return snap;
            } catch {
              return null;
            }
          }),
        );
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: formatScheduleCompare(rows[0] ?? null, rows[1] ?? null, turn.compareTrains!, turn.compareDestCodes ?? []),
          },
        ]);
      } catch {
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `${turn.compareTrains.join(" aur ")} ka timetable nahi mila. Main trains invent nahi karunga.`,
          },
        ]);
      }
      setBusy(false);
    }
    if (turn.trainSchedule) {
      lastFactTrainRef.current = turn.trainSchedule;
      setBusy(true);
      try {
        const res = await api.trainSchedule(turn.trainSchedule);
        const snap: CompareSchedule = {
          trainNumber: res.schedule.trainNumber || turn.trainSchedule,
          trainName: res.schedule.trainName,
          stops: (res.schedule.stops ?? []).map((s) => ({
            code: s.code,
            name: s.name,
            arrival: s.arrival,
            departure: s.departure,
          })),
        };
        const destCodes = turn.compareDestCodes ?? [];
        const text =
          destCodes.length || turn.goesToCity
            ? formatGoesToAnswer(snap, turn.trainSchedule, turn.goesToCity || destCodes[0] || "", destCodes)
            : `${snap.trainNumber} ${snap.trainName || ""}\n${
                (snap.stops ?? [])
                  .slice(0, 18)
                  .map((s) => `${s.code} ${s.name}  ${s.arrival ?? "—"} / ${s.departure ?? "—"}`)
                  .join("\n") || "Stops payload mein nahi aaye."
              }`;
        setMessages((m) => [...m, { id: newId(), role: "assistant", text }]);
      } catch {
        setMessages((m) => [
          ...m,
          { id: newId(), role: "assistant", text: `Train ${turn.trainSchedule} ka timetable nahi mila.` },
        ]);
      }
      setBusy(false);
    }
    if (turn.search && from && to && date) {
      pendingResults.current = turn.prefs;
      setBusy(true);
      try {
        const fromSt = await resolveStation(from, userText);
        if (fromSt && "ask" in fromSt) {
          stationPickRef.current = { slot: "from", stations: fromSt.ask.stations };
          setLastAsked("from");
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: `${fromSt.ask.city} mein kaunsa station?`,
              blocks: [{ type: "stations", options: fromSt.ask.stations, slot: "from" }],
            },
          ]);
          setBusy(false);
          return { searched: false, prefs: turn.prefs };
        }
        const toSt = await resolveStation(to, userText);
        if (toSt && "ask" in toSt) {
          stationPickRef.current = { slot: "to", stations: toSt.ask.stations };
          setLastAsked("to");
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: `${toSt.ask.city} mein kaunsa station?`,
              blocks: [{ type: "stations", options: toSt.ask.stations, slot: "to" }],
            },
          ]);
          setBusy(false);
          return { searched: false, prefs: turn.prefs };
        }
        if (!fromSt || !toSt) {
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: !fromSt
                ? `${from.city || from.name} station resolve nahi hua. Main train invent nahi karunga.`
                : `${to.city || to.name} station resolve nahi hua. Main train invent nahi karunga.`,
            },
          ]);
        } else if (fromSt.code === toSt.code) {
          setMessages((m) => [
            ...m,
            { id: newId(), role: "assistant", text: "From aur To same nahi ho sakte. Kahan se kahan jaana hai?" },
          ]);
        } else {
          if (fromSt.code !== from.code) setFrom(fromSt);
          if (toSt.code !== to.code) setTo(toSt);
          await searchRoute(fromSt, toSt, date);
        }
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: err instanceof Error ? err.message : "Trains nahi milin. Main list invent nahi karunga.",
          },
        ]);
      }
      setBusy(false);
      return { searched: true, prefs: turn.prefs };
    }
    if (turn.selectTrain) selectTrain(turn.selectTrain);
    if (turn.selectClass) await selectClass(turn.selectClass);
    if (turn.selectSeat) selectSeat(turn.selectSeat);
    if (turn.openWallet) go("wallet");
    if (turn.openBookings) go("bookings");
    if (turn.retrievePnr) {
      setBusy(true);
      try {
        const looked = await api.pnrLookup(turn.retrievePnr);
        const data = looked.pnr as { pnr?: string; data?: unknown; booking?: { status?: string; trainNumber?: string } };
        if (data?.booking) {
          void retrieve(turn.retrievePnr);
        } else {
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: `PNR ${data?.pnr ?? turn.retrievePnr} provider se mila. Main status invent nahi karta.`,
            },
          ]);
        }
      } catch {
        void retrieve(turn.retrievePnr);
      }
      setBusy(false);
    }
    if (turn.ask !== undefined) setLastAsked(turn.ask);
    if (turn.goReview) {
      setBusy(true);
      await goReview();
      setBusy(false);
    }
    if (turn.probeSeats) {
      setBusy(true);
      if (state.screen !== "home") go("home");
      const date = turn.probeSeatsDate || state.date;
      let from = state.from;
      let to = state.to;
      const pending = stationPickRef.current;
      try {
        const sched = await api.trainSchedule(turn.probeSeats).catch(() => null);
        const stops = sched?.schedule.stops ?? [];
        if (pending && stops.length) {
          const hits = pending.stations.filter((s) =>
            stops.some((st) => st.code.toUpperCase() === s.code.toUpperCase()),
          );
          if (hits.length === 1) {
            if (pending.slot === "from") from = hits[0];
            else to = hits[0];
            stationPickRef.current = null;
            if (pending.slot === "from") setFrom(hits[0]);
            else setTo(hits[0]);
            setMessages((m) => [
              ...m,
              {
                id: newId(),
                role: "assistant",
                text: `Train ${turn.probeSeats} ${hits[0].name} (${hits[0].code}) pe rukti hai — yeh station chips se match hua, gadh ke nahi. Seats check karta hoon.`,
              },
            ]);
          } else if (hits.length > 1) {
            stationPickRef.current = { slot: pending.slot, stations: hits };
            setLastAsked(pending.slot);
            setMessages((m) => [
              ...m,
              {
                id: newId(),
                role: "assistant",
                text: `Train ${turn.probeSeats} ki seats dekh raha hoon. Timetable ke mutabik yeh stations pe rukti hai — ek chuno:`,
                blocks: [{ type: "stations", options: hits, slot: pending.slot }],
              },
            ]);
            setBusy(false);
            return { searched: false, prefs: turn.prefs };
          } else {
            setMessages((m) => [
              ...m,
              {
                id: newId(),
                role: "assistant",
                text: `Train ${turn.probeSeats} ki seats ke liye pehle station chuniye. Timetable in chips se match nahi hua — main station ya seats invent nahi karunga.`,
                blocks: [{ type: "stations", options: pending.stations, slot: pending.slot }],
              },
            ]);
            setBusy(false);
            return { searched: false, prefs: turn.prefs };
          }
        }
        if (stops.length) {
          const codes = new Set(stops.map((st) => st.code.toUpperCase()));
          const onTrain = from && to && codes.has(from.code.toUpperCase()) && codes.has(to.code.toUpperCase());
          if (!onTrain) {
            const first = stops[0];
            const last = stops[stops.length - 1];
            from = { code: first.code, name: first.name, city: first.name };
            to = { code: last.code, name: last.name, city: last.name };
          }
        }
        if (from && to && date) {
          const board = await api.classBoard(turn.probeSeats, date, from.code, to.code);
          const rows = board.classes ?? [];
          if (!rows.length) {
            setMessages((m) => [
              ...m,
              {
                id: newId(),
                role: "assistant",
                text: `Train ${turn.probeSeats} ${from.code} → ${to.code} (${formatShortDate(date)}) ki seat list provider se nahi mili. Main seats invent nahi karunga.`,
              },
            ]);
          } else {
            setMessages((m) => [
              ...m,
              {
                id: newId(),
                role: "assistant",
                text: [
                  `Train ${turn.probeSeats} · ${from.code} → ${to.code} · ${formatShortDate(date)} (GN)`,
                  ...rows.map((c) => `${c.code} · ${availabilityLabel(c.status, c)}${c.fare > 0 ? ` · ₹${c.fare}` : ""}`),
                  "(Provider seats — gadh ke nahi.)",
                ].join("\n"),
              },
            ]);
          }
        } else {
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: `Train ${turn.probeSeats} ki seats ke liye origin, destination aur date chahiye. Main seats invent nahi karunga.`,
            },
          ]);
        }
      } catch {
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `Train ${turn.probeSeats} ki seats abhi provider se nahi mili. Main seats invent nahi karunga.`,
            blocks: pending
              ? [{ type: "stations", options: pending.stations, slot: pending.slot }]
              : undefined,
          },
        ]);
      }
      setBusy(false);
    }
    if (turn.lookupFare && state.selectedTrain && state.selectedClass && state.from && state.to && state.date) {
      setBusy(true);
      try {
        const fareRes = await api.fare(
          state.selectedTrain.number,
          state.date,
          state.from.code,
          state.to.code,
          state.selectedClass.code,
          state.passengers.length,
        );
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `${state.selectedTrain.number} ${state.selectedClass.code}: ticket ₹${fareRes.fare.baseFare}, service ₹${fareRes.fare.serviceFee}, total ₹${fareRes.fare.total}.`,
          },
        ]);
      } catch {
        setMessages((m) => [
          ...m,
          { id: newId(), role: "assistant", text: "Fare abhi available nahi hai. Main approx figure invent nahi karunga." },
        ]);
      }
      setBusy(false);
    }
    if (turn.lookupAvailability && state.selectedTrain && state.selectedClass && state.from && state.to && state.date) {
      setBusy(true);
      try {
        const live = await api.availability(
          state.selectedTrain.number,
          state.date,
          state.from.code,
          state.to.code,
          state.selectedClass.code,
        );
        const av = live.availability;
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `${state.selectedTrain.number} ${av.code}: ${av.status}${av.seats != null ? ` · ${av.seats} seats` : ""}${av.fare > 0 ? ` · ₹${av.fare}` : ""}.`,
          },
        ]);
      } catch {
        setMessages((m) => [
          ...m,
          { id: newId(), role: "assistant", text: "Availability abhi provider se nahi mili. Main seats invent nahi karunga." },
        ]);
      }
      setBusy(false);
    }
    if (turn.resumeText) {
      setMessages((m) => [...m, { id: newId(), role: "assistant", text: turn.resumeText! }]);
      if (turn.resumeAsk) setLastAsked(turn.resumeAsk);
    }
    return { searched: false, prefs: turn.prefs };
  }

  /**
   * Which turns go to the autonomous agent. Mid-booking form steps (passenger details, fare review,
   * payment) and bare "haan/nahi" answers to a pending class/seat prompt stay with the deterministic
   * flow, which owns those screens; anything that reads like a question still goes to the agent.
   */
  function shouldUseAgent(text: string): boolean {
    if (agentDisabledRef.current) return false;
    const t = text.toLowerCase();
    const formStep =
      state.flow === "PASSENGERS_PENDING" || state.flow === "FARE_REVIEW" || state.flow === "PAYMENT_PENDING" || state.flow === "BOOKING_PENDING";
    if (formStep && !looksLikeChatQuery(text)) return false;
    const bareYesNo = /^(haan|han|ha|yes|ok|okay|theek|thik|nahi|no|na|hmm|hm)\b[\s.!]*$/.test(t) || t.split(/\s+/).length <= 2 && /^(haan|yes|ok|theek)\s+(hai|ji|bhai)$/.test(t);
    if (bareYesNo && (state.selectedTrain || state.selectedClass || lastAsked === "class" || lastAsked === "seat")) return false;
    return true;
  }

  /**
   * One turn of the autonomous agent. Returns true when the turn was fully handled.
   * Returns false (→ legacy deterministic flow) when the server says `fallback:true`
   * or the request itself failed. Nothing here books or charges.
   */
  async function runAutonomousTurn(text: string): Promise<boolean> {
    // Seed = live booking state (what the user sees) merged over the agent's memory from earlier turns,
    // so chips/TrainBoard taps and agent turns never drift apart.
    const prev = (agentStateRef.current ?? {}) as {
      origin?: Station | null;
      destination?: Station | null;
      date?: string | null;
      passengers?: number | null;
      classCode?: string | null;
      selectedTrain?: { number: string; name: string } | null;
      lastTrains?: unknown[];
      lastSearch?: unknown;
      turn?: number;
    };
    const liveFrom = journeyRef.current.from ?? state.from;
    const liveTo = journeyRef.current.to ?? state.to;
    const liveDate = journeyRef.current.dateProvided || state.dateProvided ? journeyRef.current.date || state.date || null : null;
    const seedState = {
      origin: liveFrom ?? prev.origin ?? null,
      destination: liveTo ?? prev.destination ?? null,
      date: liveDate ?? prev.date ?? null,
      passengers: state.paxProvided ? state.passengerCount : prev.passengers ?? null,
      classCode: state.selectedClass?.code ?? prev.classCode ?? null,
      selectedTrain: state.selectedTrain ? { number: state.selectedTrain.number, name: state.selectedTrain.name } : prev.selectedTrain ?? null,
      lastTrains: state.trains.length
        ? state.trains.slice(0, 15).map((t) => ({
            number: t.number,
            name: t.name,
            dep: t.departure,
            arr: t.arrival,
            classes: t.classes.map((c) => c.code),
          }))
        : prev.lastTrains ?? [],
      lastSearch:
        state.trains.length && state.from && state.to && state.date
          ? { from: state.from.code, to: state.to.code, date: state.date }
          : prev.lastSearch ?? null,
      turn: prev.turn ?? 0,
    };
    setThinking(true);
    let res: Awaited<ReturnType<typeof api.agentAuto>>;
    try {
      res = await api.agentAuto({
        text,
        history: agentHistoryRef.current.slice(-10),
        state: seedState,
        now: new Date().toISOString(),
        today: todayYmd(),
      });
    } catch {
      setThinking(false);
      return false;
    }
    setThinking(false);
    if (!res || res.fallback || !res.ok || !res.reply) {
      setLastDbg(`Agent fallback · ${res?.failureReason ?? "request_failed"} → deterministic flow`);
      return false;
    }
    agentStateRef.current = res.state;
    agentHistoryRef.current = [
      ...agentHistoryRef.current,
      { role: "user" as const, content: text },
      { role: "assistant" as const, content: res.reply },
    ].slice(-12);
    const tools = res.toolsUsed.map((t) => `${t.name}${t.ok ? "" : "✗"}${t.provider ? `@${t.provider}` : ""}`).join(", ");
    setLastDbg(
      `Agent · ${res.source === "ai" ? res.modelUsed ?? "nvidia" : `evidence-summary (${res.failureReason ?? "model"})`} · ${res.protocol ?? "-"} · ${res.rounds}r · ${(res.latencyMs / 1000).toFixed(1)}s · llm ${(res.llmMs ?? []).map((ms) => (ms / 1000).toFixed(1)).join("+")}s${tools ? ` · tools: ${tools}` : ""}`,
    );

    // Mirror real tool output into the booking state so TrainBoard / class / fare screens stay in sync.
    const ui = res.ui ?? {};
    if (ui.from) {
      setFrom(ui.from);
      journeyRef.current.from = ui.from;
    }
    if (ui.to) {
      setTo(ui.to);
      journeyRef.current.to = ui.to;
    }
    if (ui.date && ui.date !== state.date) {
      setDate(ui.date);
      journeyRef.current.date = ui.date;
      journeyRef.current.dateProvided = true;
    }
    const st = (res.state ?? {}) as { passengers?: number | null; origin?: Station | null; destination?: Station | null; date?: string | null };
    if (st.passengers && st.passengers !== state.passengerCount) setPassengerCount(st.passengers);
    if (!ui.from && st.origin && st.origin.code !== state.from?.code) {
      setFrom(st.origin);
      journeyRef.current.from = st.origin;
    }
    if (!ui.to && st.destination && st.destination.code !== state.to?.code) {
      setTo(st.destination);
      journeyRef.current.to = st.destination;
    }
    if (!ui.date && st.date && st.date !== state.date) {
      setDate(st.date);
      journeyRef.current.date = st.date;
      journeyRef.current.dateProvided = true;
    }

    const blocks: Block[] = [];
    if (ui.stationChoice?.stations?.length) {
      const slot: "from" | "to" = ui.stationChoice.slot ?? (!journeyRef.current.from && !state.from ? "from" : "to");
      stationPickRef.current = { slot, stations: ui.stationChoice.stations };
      setLastAsked(slot);
      blocks.push({ type: "stations", options: ui.stationChoice.stations, slot });
    }
    setMessages((m) => [...m, { id: newId(), role: "assistant", text: res.reply!, blocks: blocks.length ? blocks : undefined }]);

    if (ui.trains && ui.from && ui.to && ui.date) {
      // Real provider trains from the agent's own tool call: open the TrainBoard with exactly this list (no second search).
      lastFactTrainRef.current = ui.trains[0]?.number ?? lastFactTrainRef.current;
      pendingResults.current = prefs;
      setLastAsked("train");
      showResults(ui.from, ui.to, ui.date, ui.trains, ui.recommendations ?? []);
    }
    if (ui.selectTrain) {
      const pick = (ui.trains ?? state.trains).find((t) => t.number === ui.selectTrain);
      if (pick) await onChooseTrain(pick);
    }
    if (ui.openWallet) go("wallet");
    if (ui.openBookings) go("bookings");
    return true;
  }

  async function handleText(text: string, asUser = true) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const pendingPick = stationPickRef.current;
    if (pendingPick) {
      const hit = matchOfferedStation(trimmed, pendingPick.stations);
      if (hit) {
        if (asUser) {
          setMessages((m) => [...m, { id: newId(), role: "user", text: `${hit.name} (${hit.code})` }]);
        }
        await onChooseStation(pendingPick.slot, hit);
        return;
      }
      if (!isStationPickInterrupt(trimmed)) {
        if (asUser) {
          setMessages((m) => [...m, { id: newId(), role: "user", text: trimmed }]);
        }
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: "Jo chips screen pe hain unme se station chuno — naam, code, ya Hindi jaise दिल्ली कैंट / न्यू दिल्ली.",
            blocks: [{ type: "stations", options: pendingPick.stations, slot: pendingPick.slot }],
          },
        ]);
        return;
      }
    }
    if (asUser) {
      setMessages((m) => [...m, { id: newId(), role: "user", text: trimmed }]);
    }
    // ── Autonomous agent first: NVIDIA picks the railway tools, server runs them, reply is evidence-checked.
    if (shouldUseAgent(trimmed)) {
      const handled = await runAutonomousTurn(trimmed);
      if (handled) return;
    }
    const userDateKnown = Boolean(state.trains.length || state.selectedTrain || state.previewFare);
    let extraction: NluResult | undefined;
    setThinking(true);
    try {
      const understood = await api.understand({
        text: trimmed,
        lastAsked,
        known: {
          from: state.from,
          to: state.to,
          date: state.dateProvided ? state.date || null : null,
          passengerCount: state.paxProvided ? state.passengerCount : null,
        },
        now: new Date().toISOString(),
        lastFactTrain: lastFactTrainRef.current ?? undefined,
      });
      extraction = understood.nlu;
      const ms = understood.latencyMs ?? 0;
      if (understood.groundedReply) {
        if (understood.groundedTrain) lastFactTrainRef.current = understood.groundedTrain;
        setLastDbg(`AI · RailCore evidence · ${(ms / 1000).toFixed(1)}s`);
        setThinking(false);
        setMessages((m) => [...m, { id: newId(), role: "assistant", text: understood.groundedReply! }]);
        return;
      }
      if (understood.source === "ai") {
        setLastDbg(`AI · NVIDIA · ${understood.modelUsed ?? "gpt-oss-20b"} · ${(ms / 1000).toFixed(1)}s`);
      } else {
        setLastDbg(`NLU Fast Path · ${(ms / 1000).toFixed(1)}s${understood.failureReason ? ` · ${understood.failureReason}` : ""}`);
      }
    } catch {
      extraction = undefined;
    } finally {
      setThinking(false);
    }
    const turn = planTurn({
      text: trimmed,
      now: new Date(),
      booking: {
        ...state,
        from: state.from,
        to: state.to,
        date: state.date,
      },
      prefs,
      saved,
      walletBalance: wallet?.balance,
      lastAsked,
      extraction,
      lastFactTrain: lastFactTrainRef.current ?? undefined,
    });
    setMessages((m) => [...m, { id: newId(), role: "assistant", text: turn.text, blocks: turn.blocks }]);
    await applyTurn(turn, trimmed);
    if (turn.goReview) pendingFare.current = true;
    const stillPick = stationPickRef.current;
    const turnHadStations = Boolean(turn.blocks?.some((b) => b.type === "stations"));
    if (stillPick && pendingPick && !turnHadStations && !turn.probeSeats && !turn.search) {
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          text: `Booking continue — ${stillPick.slot === "from" ? "origin" : "destination"} station chips se chuno.`,
          blocks: [{ type: "stations", options: stillPick.stations, slot: stillPick.slot }],
        },
      ]);
    }
  }
  handleTextRef.current = (text: string) => {
    void handleText(text, true);
  };

  useEffect(() => {
    if (pendingResults.current && !state.searching) {
      pendingResults.current = null;
      // TrainBoard is the results UI. Do not dump the old chat cards underneath.
    }
  }, [state.searching, state.trains, state.emptyMessage]);

  useEffect(() => {
    if (seenSession === state.sessionId) return;
    setMessages([]);
    setLastAsked(null);
    setPrefs({});
    setDraft("");
    setSeenSession(state.sessionId);
    agentStateRef.current = null;
    agentHistoryRef.current = [];
  }, [state.sessionId, seenSession]);

  useEffect(() => {
    if (pendingFare.current && state.previewFare) {
      pendingFare.current = false;
      const fare = state.previewFare;
      const t = state.selectedTrain;
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          text: `Sab details ready hain.\n₹${fare.total.toLocaleString("en-IN")} mein booking confirm karun?`,
          blocks: [{ type: "fare" }],
        },
      ]);
      void t;
    }
  }, [state.previewFare]);

  useEffect(() => {
    if (pendingTicket.current && (state.booking?.status === "CONFIRMED" || state.booking?.status === "FAILED")) {
      pendingTicket.current = false;
      const b = state.booking;
      if (b.status === "CONFIRMED") {
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: "🎉 Booking Confirmed!\nYour ticket is booked successfully.",
            blocks: [{ type: "ticket" }],
          },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: `Booking could not be completed${b.failureReason ? ` — ${b.failureReason}` : ""}. Koi fake PNR nahi banaya.`,
          },
        ]);
      }
    }
  }, [state.booking]);

  async function onChooseStation(slot: "from" | "to", st: Station) {
    stationPickRef.current = null;
    if (slot === "from") {
      setFrom(st);
      journeyRef.current.from = st;
    } else {
      setTo(st);
      journeyRef.current.to = st;
    }
    const from = slot === "from" ? st : journeyRef.current.from ?? state.from;
    const to = slot === "to" ? st : journeyRef.current.to ?? state.to;
    const date = journeyRef.current.dateProvided || state.dateProvided ? (journeyRef.current.date || state.date) : "";
    if (from && to && date) {
      setLastAsked("train");
      setMessages((m) => [
        ...m,
        { id: newId(), role: "assistant", text: `Theek hai — ${st.name} (${st.code}). Trains check karta hoon.` },
      ]);
      setBusy(true);
      try {
        await searchRoute(from, to, date);
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            id: newId(),
            role: "assistant",
            text: err instanceof Error ? err.message : "Trains nahi milin. Main list invent nahi karunga.",
          },
        ]);
      }
      setBusy(false);
      return;
    }
    if (!from) {
      setLastAsked("from");
      setMessages((m) => [
        ...m,
        { id: newId(), role: "assistant", text: `Theek hai — ${st.name} (${st.code}). Ab kahan se jaana hai?` },
      ]);
      return;
    }
    if (!to) {
      setLastAsked("to");
      setMessages((m) => [
        ...m,
        { id: newId(), role: "assistant", text: `Theek hai — ${st.name} (${st.code}). Ab kahan jaana hai?` },
      ]);
      return;
    }
    setLastAsked("date");
    const today = todayYmd();
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: "assistant",
        text: `Theek hai — ${st.name} (${st.code}). Kab jaana hai?`,
        blocks: [{
          type: "dates",
          options: [
            { date: today, label: "Aaj" },
            { date: addDays(today, 1), label: "Kal" },
            { date: addDays(today, 2), label: "Parso" },
          ],
        }],
      },
    ]);
  }

  function stationQuery(s: Station, userText: string): string {
    const text = userText || "";
    if (/^[A-Za-z0-9]{2,5}$/.test(text.trim())) return text.trim().toUpperCase();
    const codeRe = new RegExp(`\\b${s.code}\\b`, "i");
    if (codeRe.test(text)) return s.code;
    if (matchOfferedStation(text, [s])) return s.code;
    const name = (s.name || "").trim();
    if (name && name.toLowerCase() !== (s.city || "").toLowerCase() && text.toLowerCase().includes(name.toLowerCase())) {
      return name;
    }
    return (s.city || s.name || s.code).trim();
  }

  async function resolveStation(
    s: Station,
    userText = "",
  ): Promise<Station | { ask: { city: string; stations: Station[] } } | null> {
    const q = stationQuery(s, userText);
    if (/[A-Za-z]{3,}\d|\d[A-Za-z]{3,}/.test(q) && !/^[A-Z0-9]{2,5}$/i.test(q)) return null;
    const res = await api.stations(q);
    if (res.needChoice && res.stations.length > 1) {
      return { ask: { city: res.city || q, stations: res.stations } };
    }
    if (!res.stations?.length) return null;
    const needle = q.toLowerCase();
    const exact = res.stations.find(
      (x) =>
        x.city.toLowerCase() === needle ||
        x.name.toLowerCase() === needle ||
        x.code.toLowerCase() === needle,
    );
    if (exact) return exact;
    const prefix = res.stations.find(
      (x) =>
        needle.length >= 4 &&
        (x.city.toLowerCase().startsWith(needle) ||
          x.name.toLowerCase().startsWith(needle) ||
          x.code.toLowerCase() === needle),
    );
    return prefix ?? res.stations[0] ?? null;
  }

  async function onMicTap(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    await voice.toggle();
  }

  async function onChooseTrain(train: TrainResult) {
    const changed = state.selectedTrain && state.selectedTrain.number !== train.number;
    let liveTrain = train;
    if (!train.classes.length && state.date) {
      setBusy(true);
      try {
        const board = await api.classBoard(train.number, state.date, train.from.code, train.to.code);
        if (board.classes?.length) {
          liveTrain = { ...train, classes: board.classes };
        }
      } catch {
        /* keep empty — never invent */
      }
      setBusy(false);
    }
    speakGuide(`Aapki train select ho gayi hai, ${liveTrain.number} ${liveTrain.name}. Ab aap class select karein.`);
    selectTrain(liveTrain);
    const classes = liveTrain.classes.length ? matchingClasses(liveTrain, prefs) : probeClassRows();
    const heading = `${liveTrain.number} ${liveTrain.name}`;
    const notice = changed
      ? `Train change: ab ${heading} ki class/seat selection ho rahi hai.\n(ट्रेन बदल गई है — इसी ट्रेन की सीट चुनें।)\n\n`
      : "";
    if (!liveTrain.classes.length) {
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          text: `${notice}${heading} — Is train ki class list nahi mili. Invent nahi karunga. Class choose karke dubara check kar sakte ho.`,
          blocks: [{ type: "classes", train: liveTrain, classes }],
        },
      ]);
      return;
    }
    if (classes.length === 1) {
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          text: `${notice}${heading} — ${classes[0].label} · ${availabilityLabel(classes[0].status, classes[0])} (live seats). Main isi ko select karun?`,
          blocks: [
            { type: "classes", train: liveTrain, classes: liveTrain.classes },
            {
              type: "chips",
              options: [
                { id: "y", label: "Haan, select karo", utterance: "Haan, select karo" },
                { id: "n", label: "Other options", utterance: "Aur options dikhao" },
              ],
            },
          ],
        },
      ]);
    } else {
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          text: `${notice}${heading} — Live seats (GN quota):\n${liveTrain.classes.map((c) => `${c.code} · ${availabilityLabel(c.status, c)}`).join("\n")}`,
          blocks: [{ type: "classes", train: liveTrain, classes: liveTrain.classes }],
        },
      ]);
    }
  }

  async function onChooseClass(klass: ClassAvailability) {
    if (klass.status !== "UNKNOWN" && !isBookable(klass.status)) {
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          text: "Is train mein yeh class available nahi hai. Alternate dekhun?",
          blocks: [
            {
              type: "chips",
              options: [{ id: "alt", label: "Find another train", utterance: "Find another train" }],
            },
          ],
        },
      ]);
      return;
    }
    speakGuide(`Aapki class select ho gayi hai, ${klass.label}. Ab aap seat preference select karein.`);
    const live = await selectClass(klass);
    const shown = live ?? klass;
    if (live && !isBookable(live.status) && live.status !== "UNKNOWN") {
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          text: `${shown.code} · ${availabilityLabel(shown.status, shown)} — Provider ke mutabik bookable nahi.`,
        },
      ]);
      return;
    }
    if (!live) {
      setMessages((m) => [
        ...m,
        { id: newId(), role: "assistant", text: "Is class ki live availability nahi mili. Main seats invent nahi karunga." },
      ]);
      return;
    }
    const opts = BERTH_BY_CLASS[shown.code] ?? ["No Preference"];
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: "assistant",
        text: `${shown.code} · ${availabilityLabel(shown.status, shown)} (live). Berth/seat preference choose karo.`,
        blocks: [{ type: "berths", options: [...opts, "No Preference"] }],
      },
    ]);
  }

  function onChooseSeat(seat: string) {
    speakGuide("Aapki seat select ho gayi hai. Ab passenger ka naam bhariye.");
    selectSeat(seat === "No Preference" ? "No Preference" : seat);
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: "assistant",
        text: saved.length
          ? "Aapke saved passengers mil gaye."
          : "Ticket ke liye passenger details chahiye.",
        blocks: saved.length
          ? [{ type: "saved", list: saved }, { type: "passengers" }]
          : [{ type: "passengers" }],
      },
    ]);
  }

  function useSaved(list: Passenger[]) {
    const need = state.passengerCount;
    const picked = list.slice(0, need).map((p, i) => ({
      ...p,
      id: state.passengers[i]?.id ?? p.id,
      berthPreference: p.berthPreference || state.seatPreference || "No Preference",
    }));
    picked.forEach((p) => updatePassenger(p.id, p));
    setMessages((m) => [
      ...m,
      { id: newId(), role: "assistant", text: "Saved passengers laga diye. Check karke Continue dabao.", blocks: [{ type: "passengers" }] },
    ]);
  }

  async function onContinuePassengers() {
    const errors = validatePassengers(state.passengers);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setMessages((m) => [
        ...m,
        { id: newId(), role: "assistant", text: "Jo fields khali hain unhe bhar do — comma-separated text nahi chalega." },
      ]);
      return;
    }
    pendingFare.current = true;
    await goReview();
  }

  async function onPay() {
    pendingTicket.current = true;
    setBusy(true);
    try {
      await confirm();
    } finally {
      setBusy(false);
    }
  }

  const step = progressStep(state.flow);
  const thread = seenSession === state.sessionId ? messages : [];
  const showHome = thread.length === 0;

  return (
    <div className="concierge">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="" />
          RailBook
        </div>
        <div className="spacer" />
        {booking.meta?.provider.mock && (
          <span
            className="demo-chip"
            role="button"
            title="Toggle AI debug"
            onClick={() => {
              setDebugOn((v) => {
                const next = !v;
                try {
                  localStorage.setItem("railbookDebug", next ? "1" : "0");
                } catch {
                  /* ignore */
                }
                return next;
              });
            }}
          >
            Demo
          </span>
        )}
        <button className="icon-btn" title="RailKit tools" onClick={() => go("tools")}>▦</button>
        <button className="icon-btn" title="Wallet" onClick={() => go("wallet")}>₹</button>
        <button className="icon-btn" title="Bookings" onClick={() => go("bookings")}>☰</button>
      </header>
      {debugOn && lastDbg && (
        <div className="muted" style={{ padding: "6px 16px", fontSize: 12 }}>{lastDbg}</div>
      )}
      <div className="ai-progress" aria-hidden>
        {["Journey", "Train", "Passengers", "Payment"].map((l, i) => (
          <span key={l} className={i <= step ? "on" : ""}>{l}</span>
        ))}
      </div>

      <div className="thread" ref={scroller}>
        {showHome && (
          <section className="hero">
            <div className="hero-mark">🚆</div>
            <h1>RailBook</h1>
            <p>Railway booking assistant. Journey, live status, PNR, fare — bolo. Ticket sirf Confirm & Book se.</p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s} className="starter" onClick={() => void handleText(s)}>
                  {s}
                </button>
              ))}
            </div>
          </section>
        )}

        {thread.map((msg) => (
          <article key={msg.id} className={`msg ${msg.role}`}>
            {msg.role === "assistant" && <div className="msg-kicker">RailBook</div>}
            {msg.text && <p className="msg-text">{msg.text}</p>}
            {msg.blocks?.map((b, i) => (
              <BlockView
                key={i}
                block={b}
                state={state}
                wallet={wallet?.balance ?? 0}
                fieldErrors={fieldErrors}
                onTrain={onChooseTrain}
                onClass={onChooseClass}
                onSeat={onChooseSeat}
                onChip={(u) => void handleText(u)}
                onStation={(slot, st) => void onChooseStation(slot, st)}
                onDate={(d) => void handleText(d)}
                onUseSaved={useSaved}
                onContinue={onContinuePassengers}
                onPay={() => void onPay()}
                onWallet={() => go("wallet")}
                onBookings={() => go("bookings")}
              />
            ))}
          </article>
        ))}

        {(thinking || busy || state.searching) && (
          <article className="msg assistant">
            <div className="msg-kicker">RailBook</div>
            <p className="msg-text thinking">
              {state.searching
                ? "Main aapke liye available trains check kar raha hoon…"
                : thinking
                  ? "Samajh raha hoon…"
                  : "Kaam ho raha hai…"}
            </p>
          </article>
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (voice.listening) return;
          const t = draft.trim();
          setDraft("");
          void handleText(t);
        }}
      >
        <input
          value={voice.listening && voice.interim ? voice.interim : draft}
          onChange={(e) => {
            if (voice.listening) return;
            setDraft(e.target.value);
          }}
          placeholder={voice.listening ? "Sun raha hoon…" : "Kahan se kahan jaana hai?"}
          aria-label="Type your journey"
          autoComplete="off"
        />
        <button
          type="button"
          className={`mic ${voice.listening ? "live" : ""}`}
          onClick={onMicTap}
          title={voice.listening ? "Sun raha hoon…" : "Tap to speak"}
          aria-label={voice.listening ? "Stop listening" : "Tap to speak"}
          aria-pressed={voice.listening}
        >
          <span className="mic-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" />
            </svg>
          </span>
          {voice.listening && <span className="mic-rings" aria-hidden />}
        </button>
        <button type="submit" className="send" aria-label="Send" disabled={voice.listening}>➤</button>
      </form>
      <div className={`composer-hint ${voice.listening ? "live" : ""}`} role="status" aria-live="polite">
        {voice.listening ? "Sun raha hoon…" : voice.status === "Tap to speak" ? "🎙️ बोलकर बताएं  ·  ✍️ Type करें" : voice.status}
      </div>
    </div>
  );
}

function BlockView({
  block,
  state,
  wallet,
  fieldErrors,
  onTrain,
  onClass,
  onSeat,
  onChip,
  onStation,
  onDate,
  onUseSaved,
  onContinue,
  onPay,
  onWallet,
  onBookings,
}: {
  block: Block;
  state: ReturnType<typeof useBooking>["state"];
  wallet: number;
  fieldErrors: ReturnType<typeof validatePassengers>;
  onTrain: (t: TrainResult) => void;
  onClass: (c: ClassAvailability) => void;
  onSeat: (s: string) => void;
  onChip: (u: string) => void;
  onStation?: (slot: "from" | "to", st: Station) => void;
  onDate: (utterance: string) => void;
  onUseSaved: (list: Passenger[]) => void;
  onContinue: () => void;
  onPay: () => void;
  onWallet: () => void;
  onBookings: () => void;
}) {
  const { updatePassenger } = useBooking();
  if (block.type === "chips") {
    return (
      <div className="inline-chips">
        {block.options.map((o) => (
          <button key={o.id} onClick={() => onChip(o.utterance ?? o.label)}>{o.label}</button>
        ))}
      </div>
    );
  }
  if (block.type === "stations") {
    return (
      <div className="inline-chips">
        {block.options.map((o) => (
          <button key={o.code} onClick={() => onStation?.(block.slot, o)}>
            {o.name} ({o.code})
          </button>
        ))}
      </div>
    );
  }
  if (block.type === "dates") {
    return (
      <div className="inline-chips">
        {block.options.map((o) => (
          <button key={o.date} onClick={() => onDate(o.date)}>{o.label}</button>
        ))}
      </div>
    );
  }
  if (block.type === "train") {
    return <TrainMini train={block.train} badge={block.badge} reason={block.reason} onPick={() => onTrain(block.train)} primary={block.primary} />;
  }
  if (block.type === "more") {
    return (
      <div>
        <div className="more-label">Aur options dekhein</div>
        {block.trains.map((t) => (
          <TrainMini key={t.number} train={t} onPick={() => onTrain(t)} />
        ))}
      </div>
    );
  }
  if (block.type === "classes") {
    return (
      <div className="class-inline">
        {block.train && (
          <div className="train-seat-head">
            <strong>{block.train.number}</strong> {block.train.name}
            <div className="muted">Is train ki class / seat selection</div>
          </div>
        )}
        {(block.classes.length ? block.classes : probeClassRows()).map((c) => {
          const unknown = c.status === "UNKNOWN";
          const ok = unknown || isBookable(c.status);
          return (
            <button key={c.code} className={`class-pill ${ok ? "" : "off"}`} disabled={!ok} onClick={() => onClass(c)}>
              <strong>{c.label}</strong>
              <span>{unknown ? "Check availability" : ok ? `${inr(c.fare)} · ${availabilityLabel(c.status, c)}` : "❌ Not available"}</span>
            </button>
          );
        })}
      </div>
    );
  }
  if (block.type === "berths") {
    const t = state.selectedTrain;
    return (
      <div>
        {t && (
          <div className="train-seat-head">
            <strong>{t.number}</strong> {t.name}
            <div className="muted">Is train ki seat / berth selection</div>
          </div>
        )}
        <div className="inline-chips">
          {block.options.map((o) => (
            <button key={o} onClick={() => onSeat(o)}>{o}</button>
          ))}
        </div>
      </div>
    );
  }
  if (block.type === "saved") {
    return (
      <div>
        <div className="inline-chips">
          {block.list.map((p) => (
            <span key={p.id} className="tag">{p.name || "Traveller"}</span>
          ))}
        </div>
        <button className="btn primary" style={{ marginTop: 8 }} onClick={() => onUseSaved(block.list)}>
          Use these passengers
        </button>
      </div>
    );
  }
  if (block.type === "passengers") {
    const focus = (() => {
      for (const p of state.passengers) {
        const slot = nextPassengerAsk(p);
        if (slot) return { id: p.id, slot };
      }
      return { id: "", slot: null as ReturnType<typeof nextPassengerAsk> };
    })();
    const ready = !focus.slot;
    return (
      <div className="pax-inline">
        {state.passengers.map((p, i) => {
          const err = fieldErrors[p.id] ?? {};
          const on = focus.id === p.id ? focus.slot : null;
          const nameOk = nameIsValid(p.name);
          const ageOk = ageIsValid(p.age);
          const genderOk = Boolean(p.gender);
          const berthOk = Boolean(p.berthPreference);
          const mark = (ok: boolean, active: boolean) => (ok ? "done" : active || !ok ? "need" : "");
          return (
            <div className="pax-card" key={p.id}>
              <h3>Passenger {i + 1}</h3>
              <div className={`field ${mark(nameOk, on === "name")}`}>
                <label>Name</label>
                <div className={`control ${err.name ? "bad" : ""} ${mark(nameOk, on === "name")}`}>
                  <input
                    value={p.name}
                    placeholder="Letters only"
                    onChange={(e) => updatePassenger(p.id, { name: sanitizePassengerName(e.target.value) })}
                  />
                </div>
              </div>
              <div className="pair">
                <div className={`field ${mark(ageOk, on === "age")}`}>
                  <label>Age</label>
                  <div className={`control ${err.age ? "bad" : ""} ${mark(ageOk, on === "age")}`}>
                    <input
                      inputMode="numeric"
                      value={p.age}
                      onChange={(e) => updatePassenger(p.id, { age: sanitizePassengerAge(e.target.value) })}
                    />
                  </div>
                </div>
                <div className={`field ${mark(genderOk, on === "gender")}`}>
                  <label>Gender</label>
                  <div className={`control ${err.gender ? "bad" : ""} ${mark(genderOk, on === "gender")}`}>
                    <select value={p.gender || ""} autoComplete="off" onChange={(e) => updatePassenger(p.id, { gender: e.target.value as Passenger["gender"] })}>
                      <option value="">Select</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className={`field ${mark(berthOk, on === "berth")}`}>
                <label>Berth Preference</label>
                <div className={`control ${err.berthPreference ? "bad" : ""} ${mark(berthOk, on === "berth")}`}>
                  <select value={p.berthPreference} onChange={(e) => updatePassenger(p.id, { berthPreference: e.target.value })}>
                    <option value="">Select</option>
                    {(state.selectedClass ? BERTH_BY_CLASS[state.selectedClass.code] : ["No Preference"]).concat("No Preference").filter((v, i, a) => a.indexOf(v) === i).map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
        <button
          className="btn primary"
          disabled={!ready}
          onClick={() => {
            if (!ready) return;
            onContinue();
          }}
        >
          Continue
        </button>
      </div>
    );
  }
  if (block.type === "fare" && state.selectedTrain && state.selectedClass && state.previewFare) {
    const t = state.selectedTrain;
    const fare = state.previewFare;
    const short = wallet < fare.total;
    return (
      <div>
        <div className="summary">
          <div className="row"><span className="k">Route</span><span>{t.from.city} → {t.to.city}</span></div>
          <div className="row"><span className="k">Date</span><span>{formatShortDate(t.date)}</span></div>
          <div className="row"><span className="k">Train</span><span>{t.number} {t.name}</span></div>
          <div className="row"><span className="k">Class</span><span>{state.selectedClass.label}</span></div>
          <div className="row"><span className="k">Passengers</span><span>{state.passengers.length}</span></div>
          <div className="row"><span className="k">Ticket fare</span><span>{inr(fare.baseFare)}</span></div>
          <div className="row"><span className="k">Service fee</span><span>{inr(fare.serviceFee)}</span></div>
          <div className="row total"><span>Total</span><span>{inr(fare.total)}</span></div>
        </div>
        <p className="muted" style={{ margin: "8px 0" }}>Wallet balance: {inr(wallet)}</p>
        {short ? (
          <button className="btn primary" onClick={onWallet}>Add Money</button>
        ) : (
          <div className="inline-chips">
            <button className="btn primary" style={{ width: "auto" }} onClick={onPay}>Yes, Book It</button>
            <button className="btn ghost" style={{ width: "auto" }} onClick={() => onChip("Change details")}>Change Details</button>
          </div>
        )}
      </div>
    );
  }
  if (block.type === "wallet") {
    return <button className="btn primary" onClick={onWallet}>Add Money</button>;
  }
  if (block.type === "ticket" && state.booking) {
    const b = state.booking;
    return (
      <div className="summary">
        {b.mock && <div className="mock-tag" style={{ margin: 12 }}>Mock / demo booking</div>}
        {b.pnr && <div className="pnr" style={{ padding: "0 12px" }}>{b.pnr}</div>}
        <div className="row"><span className="k">Train</span><span>{b.trainNumber} {b.trainName}</span></div>
        <div className="row"><span className="k">Route</span><span>{b.from.city} → {b.to.city}</span></div>
        <div className="row"><span className="k">Date</span><span>{formatShortDate(b.date)}</span></div>
        <div className="row"><span className="k">Class</span><span>{b.classCode}</span></div>
        <div style={{ padding: 12 }}>
          <button className="btn navy" onClick={onBookings}>My Bookings</button>
        </div>
      </div>
    );
  }
  if (block.type === "empty") {
    return (
      <div className="inline-chips">
        <button onClick={() => onChip("1 day earlier")}>1 day earlier</button>
        <button onClick={() => onChip("1 day later")}>1 day later</button>
        <button onClick={() => onChip("Find another train")}>Find another train</button>
      </div>
    );
  }
  return null;
}

function TrainMini({
  train,
  badge,
  reason,
  onPick,
  primary,
}: {
  train: TrainResult;
  badge?: string;
  reason?: string;
  onPick: () => void;
  primary?: boolean;
}) {
  const avail = train.classes.find((c) => c.status === "AVAILABLE") ?? train.classes.find((c) => isBookable(c.status));
  return (
    <button className={`train-mini ${primary ? "rec" : ""}`} onClick={onPick}>
      {badge && <div className="rec-pill">{badge}</div>}
      <div className="tnum">{train.number}</div>
      <div className="tname">{train.name}</div>
      <div className="times">
        <div><div className="dep">{train.departure}</div><div className="st">{train.from.code}</div></div>
        <div className="mid"><div>{train.durationLabel}</div><div className="rail" /></div>
        <div><div className="arr">{train.arrival}</div><div className="st">{train.to.code}</div></div>
      </div>
      {reason && <p className="rec-reason">{reason}</p>}
      {avail && (
        <div className="muted">{avail.label} — {avail.status === "AVAILABLE" ? "✅ Available" : availabilityLabel(avail.status)}</div>
      )}
      {primary && <div className="choose">Choose this train</div>}
    </button>
  );
}
