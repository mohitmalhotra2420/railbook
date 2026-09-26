import { useEffect, useRef, useState, type MouseEvent } from "react";
import { planTurn, type AssistantTurn, type Block } from "../ai/orchestrate";
import type { DialogSlot, NluResult } from "../ai/nlu";
import type { Prefs } from "../ai/filter";
import { matchingClasses } from "../ai/filter";
import { api, pickTrainsApi } from "../api";
import { useBooking } from "../booking/context";
import { validatePassengers } from "../booking/state";
import { loadTravellers } from "../data/travellers";
import { addDays, availabilityLabel, formatShortDate, inr, newId, todayYmd } from "../format";
import { BERTH_BY_CLASS, CLASS_LABELS, isBookable, type ClassAvailability, type ClassCode, type Passenger, type Station, type TrainResult } from "../types";
import type { AgentTrainTable } from "../ai/agent";
import { JourneyOptions } from "../components/JourneyOptions";
import { bookingFromChipPayload, bookingFromSeatRow, stationOf } from "../booking/fromOption";
/* Round-29: booking intent par seedha passenger form (pure resolution logic — test ke liye alag). */
import { buildAutoBookSeat, isBookingIntent, isOpenableStatus, pickRowForBooking } from "../booking/autobook";
import { detectSeatIntent, type SeatIntent, type SeatRow } from "../seatfinder";
import { focusSeatRows, seatListGroups, stripSeatCardPointer, trainNumbersInText } from "../chatText";
/* Round-31: jawab ke baad agla kadam (verified data se — kuch invent nahi). */
import { VoiceSheet, type VoiceSuggestion } from "../components/VoiceSheet";
import { AlternativesCard } from "../components/AlternativesCard";
import { TrainPicker } from "../components/TrainPicker";
import { ReplyText, type ReplyRow } from "../components/ReplyText";
import { TrainClassBlock } from "../components/TrainClassBlock";

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
import { isStationPickInterrupt, classifyFollowUp } from "../ai/agent";
import { formatGoesToAnswer, formatScheduleCompare, type CompareSchedule } from "../ai/compare";
import { matchOfferedStation } from "../ai/stationPick";
import { onUtterance } from "../conversation/bus";

const PROBE_CLASSES: ClassCode[] = ["SL", "3A", "2A", "1A", "CC", "2S"];

/* 24 Sep 2026 (user: "kabhi jawab KHAALI aa jaata hai — theek karo"): chat me BLANK bubble kabhi na aaye.
 * AI kabhi aisa text deta hai jo scrub ke baad khaali bachta hai, aur legacy path me bhi text khaali
 * ho sakta hai. Aise waqt par saaf Hinglish line (guess bilkul nahi). —— sirf display hygiene,
 * AI logic / seat-search logic / aaj ke fixes ko chhua nahi gaya. */
const EMPTY_REPLY_LINE = "Jawab is baar khaali aa gaya (live data ya AI se kuch nahi mila) — main andaza nahi lagaunga. Dobara bhejo ya thodi der baad try karo.";
const CARDS_ONLY_LINE = "Data neeche hai (real provider se) — AI ki line is baar nahi aa payi.";

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

/* ══ ROUND-8 (2026-09-06): MEMORY PERSISTENCE ════════════════════
 * User feedback: refresh/app-band ke baad agent sab bhool jaata tha —
 * kaunsi train chal rahi thi, kya baat ho rahi thi. Ab chat history +
 * agent context localStorage mein save hote hain (7 din) aur app khulte
 * hi restore — refresh ke baad bhi "hum 18310 ki baat kar rahe the"
 * yaad rehta hai. Blocks (train-tables) persist nahi hote — sirf text. */
const MEMORY_KEY = "railbook.memory.v1";
/* Round-16f (user 2026-09-08: "Render open karta hoon to old chat wala page
 * khulta hai"): app open par HAMESHA fresh home screen. Purani chat sirf
 * SHORT-TERM agent context ke liye (1 ghanta) — refresh/tab-switch par
 * "18310 ki baat kar rahe the" yaad rahe, par screen par purani chat nahi.
 * User apni marzi se "Nayi chat" 🗑️ se sab clear kar sakta hai. */
const MEMORY_MAX_AGE_MS = 60 * 60 * 1000;
const MEMORY_MAX_MESSAGES = 40;
/* Screen par sirf is session ki chat — page-load par thread khaali. */
const SESSION_KEY = "railbook.session.v1";
function currentPageSession(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = String(Date.now());
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "nosession";
  }
}

type PersistedMemory = {
  savedAt: number;
  pageSession?: string;
  messages: ChatMessage[];
  agentCtx: import("../api").AgentContextClient | null;
};


function readPersistedMemory(): PersistedMemory | null {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedMemory | null;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MEMORY_MAX_AGE_MS) {
      localStorage.removeItem(MEMORY_KEY);
      return null;
    }
    const msgs = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
          .map((m) => ({ id: String(m.id ?? Math.random()), role: m.role, text: m.text }))
      : [];
    return { savedAt: parsed.savedAt, pageSession: parsed.pageSession, messages: msgs.slice(-MEMORY_MAX_MESSAGES), agentCtx: parsed.agentCtx ?? null };
  } catch {
    return null;
  }
}

let memoryCache: PersistedMemory | null | undefined;
export function clearPersistedMemory(): void {
  try {
    localStorage.removeItem(MEMORY_KEY);
  } catch {
    /* ignore */
  }
  memoryCache = null;
}

function persistedMemory(): PersistedMemory | null {
  if (memoryCache === undefined) memoryCache = readPersistedMemory();
  return memoryCache;
}

function writePersistedMemory(msgs: ChatMessage[], agentCtx: import("../api").AgentContextClient | null): void {
  try {
    const slim: PersistedMemory = {
      savedAt: Date.now(),
      pageSession: currentPageSession(),
      messages: msgs
        .filter((m) => !m.pending)
        .slice(-MEMORY_MAX_MESSAGES)
        .map((m) => ({ id: m.id, role: m.role, text: m.text })),
      agentCtx,
    };
    localStorage.setItem(MEMORY_KEY, JSON.stringify(slim));
  } catch {
    /* private-mode/quota — chat in-memory hi chalta rahega */
  }
}

export function Concierge() {
  const booking = useBooking();
  const { state, wallet, go, setFrom, setTo, setDate, setPassengerCount, clearPassengerCount, clearDateProvided, resetJourney, searchRoute, selectTrain, selectClass, selectTrainAndClassGo, selectSeat, updatePassenger, goReview, confirm, retrieve } = booking;
  const [prefs, setPrefs] = useState<Prefs>({});
  const [lastAsked, setLastAsked] = useState<DialogSlot>(null);
  /* Round-8: refresh ke baad bhi conversation + agent-context yaad —
   * localStorage se restore (7 din tak). */
  /* Round-16f: screen par purani chat sirf tab jab SAME tab mein reload hua
   * ho (sessionStorage id match) — naya open/new tab = fresh home. */
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const mem = persistedMemory();
    if (!mem) return [];
    return mem.pageSession && mem.pageSession === currentPageSession() ? mem.messages : [];
  });
  const [seenSession, setSeenSession] = useState(state.sessionId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  /* Round-18m-29: live progress line from /api/agent/stream (real phases + N/M checks). */
  const [progressText, setProgressText] = useState<string | null>(null);
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
  /* 24 Sep 2026 (user: "2A mein seats hai?" → ConfirmTkt jaisa filter + "bolke poochhe to?"):
   * seat/class intent CLIENT-side pakadte hain; us turn ke train table par Seat Finder card lagta hai.
   * Voice se aaya turn ho to jawab ek line me bol bhi dete hain. AI/server/provider ko chhua nahi gaya. */
  const viaVoiceRef = useRef(false);
  const [seatFind, setSeatFind] = useState<{ intent: SeatIntent; viaVoice: boolean } | null>(null);
  /* 24 Sep 2026 (user: ConfirmTkt jaisa "bolne wala" screen): mic dabate hi sheet khulta hai —
   * jo bola wo live likha jata hai, chips se ek tap me sawaal, OK par bhejta hai. */
  const [voiceSheet, setVoiceSheet] = useState(false);
  const VOICE_CHIPS: VoiceSuggestion[] = [
    { id: "confirmed", label: "Get Confirmed Ticket", text: "sirf confirmed seat wali trains dikhao" },
    { id: "ac", label: "AC Trains", text: "AC trains dikhao" },
    { id: "seat2a", label: "2A me seat?", text: "2A me seat hai?" },
    { id: "alt", label: "Best Alternatives", text: "best alternatives dikhao" },
  ];
  const lastFactTrainRef = useRef<string | null>(null);
  /* Round-34 (user screenshot: seat list pehle dikh chuki thi, phir "Book 12380" par AI ne dobara
   * poochh liya): jo seat rows ek baar screen par aa chuki hain wo YAAD rehti hain — booking intent
   * par form usi asli data se bharta hai (naya check karne ka bahana nahi). Kuch invent nahi hota. */
  const lastSeatRowsRef = useRef<{
    from: string;
    to: string;
    date: string;
    rows: { number: string; name: string; classCode: string; status: string; seats: number | null; rac: number | null; waitlist: number | null; fare: number | null; departure: string | null; durationMinutes: number | null }[];
  } | null>(null);
  /** Last server-side AI agent context — sent back each turn so multi-turn state survives.
   * Round-8: persisted memory se initialize — refresh par bhi train/topic yaad. */
  /* Round-18m-30w (user screenshot 00:27: fresh open, "ludhiana se mathura" → seedha 138 seat checks, na date na
   * pax): screen par purani chat NAHI thi (naya open) par agent context 7-din wali memory se aa gaya → server
   * ne "wahi journey" maan kar purani date/pax reuse kar li. Rule: jo user ko dikh raha hai wahi context —
   * fresh screen = fresh journey context. Purani chat sirf same-tab reload par restore hoti hai (upar), to
   * agent context bhi sirf tabhi. */
  const agentCtxRef = useRef<import("../api").AgentContextClient | null>((() => {
    const mem = persistedMemory();
    if (!mem) return null;
    return mem.pageSession && mem.pageSession === currentPageSession() ? mem.agentCtx ?? null : null;
  })());
  const saved = loadTravellers();

  /* Round-18m-32: manual-commit voice — bolo → screen par live dikhe → OK dabao tab bheje (auto-send band). */
  const voice = useVoiceInput(
    (text) => {
      viaVoiceRef.current = true; /* Seat Finder ko pata chale ki sawaal bola gaya */
      handleTextRef.current(text);
    },
    (msg) => {
      setMessages((m) => [...m, { id: newId(), role: "assistant", text: msg }]);
    },
    { manualCommit: true, greet: true },
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, thinking]);

  /* Round-8: har turn ke baad chat + context localStorage mein save. */
  useEffect(() => {
    if (!messages.length) return; // fresh open — purani memory ko khaali se overwrite mat karo
    writePersistedMemory(messages, agentCtxRef.current);
  }, [messages]);

  /* Round-16f: "Nayi chat" — screen + memory + agent context + journey sab fresh. */
  function startNewChat() {
    clearPersistedMemory();
    agentCtxRef.current = null;
    lastFactTrainRef.current = null;
    stationPickRef.current = null;
    journeyRef.current = { from: null, to: null, date: "", dateProvided: false };
    resetJourney();
    setLastAsked(null);
    setPrefs({});
    setMessages([]);
  }

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
            text: `${res.history.trainNumber} ${res.history.trainName}\nRun start date: ${res.history.date}${res.history.runState === "completed" ? " (journey complete)" : res.history.runState === "running" ? " (abhi bhi chal rahi)" : ""}\n${stops || "No history record."}\n(Provider data — gadh ke nahi.)`,
          },
        ]);
      } catch {
        /* Round-16p-2: station-wise history na mile to us run ka overall
         * live/completed status (RailCore/RailRadar date= run). */
        try {
          const res = await api.liveTrain(turn.trainHistory, turn.historyDate);
          const live = res.live;
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: `${live.trainNumber} ${live.trainName || ""}\nRun start date: ${live.journeyDate ?? turn.historyDate ?? "—"}${live.runState === "completed" ? " (journey complete)" : ""}\nStatus: ${live.status}${live.delayMinutes != null ? ` · delay ${live.delayMinutes} min` : ""}${live.currentStation ? ` · ${live.runState === "completed" ? "reached" : "current"}: ${live.currentStation}` : ""}${live.nextStation && live.runState !== "completed" ? ` · next: ${live.nextStation}` : ""}\n(Live railway data — gadh ke nahi.)`,
            },
          ]);
        } catch {
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: `Train ${turn.trainHistory} ka ${turn.historyDate ?? "kal"} wala run kisi provider se nahi mila. Main pichhle din ka status invent nahi karunga.`,
            },
          ]);
        }
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
            text: `${live.trainNumber} ${live.trainName || ""}${live.journeyDate && live.journeyDate !== todayYmd() ? `\nRun start date: ${live.journeyDate}` : ""}\nStatus: ${live.status}${live.delayMinutes != null ? ` · delay ${live.delayMinutes} min` : ""}${live.currentStation ? ` · current: ${live.currentStation}` : ""}${live.nextStation && live.runState !== "completed" ? ` · next: ${live.nextStation}` : ""}\n(Live railway data — gadh ke nahi.)`,
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

  /* Round-18e: BEST FOR YOU card ka explicit CTA — tabhi TrainBoard khulta hai. */
  async function openBoardFor(fromCode: string, toCode: string, date: string) {
    const c = agentCtxRef.current;
    const from: Station | null = state.from?.code === fromCode ? state.from : c?.origin?.code === fromCode ? (c.origin as Station) : null;
    const to: Station | null = state.to?.code === toCode ? state.to : c?.destination?.code === toCode ? (c.destination as Station) : null;
    if (!from || !to || from.code === to.code) {
      await handleText(`${fromCode} se ${toCode} ${date} ki trains book karni hai`);
      return;
    }
    setBusy(true);
    try {
      await searchRoute(from, to, date);
    } catch {
      /* TrainBoard surfaces search errors */
    } finally {
      setBusy(false);
    }
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
    /* Seat Finder: 24 Sep 2026 (user: "hamesha dikhe jab bhi trains ki list aaye") — intent
     * har turn par set hota hai (seat sawaal ho ya na ho); jo bhi class/time/sort user ne
     * bola wahi card ke chips ka default ban jata hai. AI/server ko chhua nahi. */
    {
      const si = detectSeatIntent(trimmed);
      const viaVoiceTurn = viaVoiceRef.current;
      viaVoiceRef.current = false;
      setSeatFind({ intent: si, viaVoice: viaVoiceTurn });
    }
    const userDateKnown = Boolean(state.trains.length || state.selectedTrain || state.previewFare);
    let extraction: NluResult | undefined;
    setThinking(true);

    /* ── Round-18 SMART TRAIN PICKER (instant) ──────────────────────────
     * Bare train number ("12014") ya chhota naam ("Shatabdi", "Amritsar
     * Shatabdi") → turant SELECT TRAIN cards (real validated matches,
     * /api/trains/pick). Agent round-trip (20-60s) ka wait nahi. Sawaal
     * saath ho ("12014 ka status") to agent hi handle karega + picker bhi. */
    const bareNumber = /^\s*\d{5}\s*$/.test(trimmed);
    const bareName = !/\d/.test(trimmed) && /\b(shatabdi|rajdhani|vande|duronto|garib|tejas|humsafar|jan\s*shatabdi|intercity|express|exp|mail|superfast|sampark|kranti|double\s*decker|amrit)\b/i.test(trimmed) && trimmed.split(/\s+/).length <= 4 && !/\b(se|to|from|tak|kab|kaha|kahan|status|time|fare|seat|book)\b/i.test(trimmed);
    if (bareNumber || bareName) {
      try {
        const picker = await pickTrainsApi(trimmed, { from: state.from?.code ?? null, to: state.to?.code ?? null });
        if (picker.matches.length) {
          setThinking(false);
          const one = picker.matches.length === 1 ? picker.matches[0] : null;
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: one
                ? `${one.number} ${one.name}${one.from && one.to ? ` (${one.from} → ${one.to}${one.departure ? `, ${one.departure} → ${one.arrival ?? "—"}` : ""})` : ""} mili. Select karo — phir batao kya chahiye: status, timetable, seat ya fare.`
                : `"${trimmed}" ke ${picker.matches.length} real matches mile — neeche se apni train select karo.`,
              blocks: [{ type: "trainpicker", picker }],
            },
          ]);
          return;
        }
      } catch {
        /* picker best-effort — agent flow continue */
      }
    }

  /* ── AI-FIRST TOOL CALLING ─────────────────────────────────────────
     * USER → NVIDIA GPT-OSS-20B → model selects approved tools → server
     * executes them on RailCore (primary) → RailKit (fallback) → results
     * go back to the model → it may chain more tools → grounded reply.
     * The deterministic flow further below is the FALLBACK only. */
    const follow = classifyFollowUp(trimmed);
    /* Round-34 (user ka standing rule: "har query PEHLE model ke paas jaani chahiye" + probe me dikha:
     * passenger form khula hone par "12013 ki seat availability batao" jaisa naya sawaal bhi local
     * rasta pakad leta tha): booking-flow ka local rasta sirf BOOKING ki baaton ke liye rahe —
     * confirm/back/class-pick/details. Naya sawaal (train number ya seat/fare/time/status jaise shabd)
     * hamesha model ke paas jaata hai, chahe form khula ho. */
    const freshQuestionDuringBooking =
      /\b\d{4,5}\b|\b(seat|seats|availability|avl|rac|waitlist|fare|kiraya|timing|time|schedule|status|platform|stops|route|kahan|kaha|kab|kitni)\b/i.test(trimmed) &&
      !/\b(confirm|book\s*kar|krdo|kardo|continue|aage|back|wapas|haan|ok|theek|details|passenger|naam|age|gender|berth)\b/i.test(trimmed);
    const criticalBookingFlow =
      !freshQuestionDuringBooking &&
      (state.flow === "PASSENGERS_PENDING" ||
        state.flow === "FARE_REVIEW" ||
        state.flow === "PAYMENT_PENDING" ||
        state.flow === "BOOKING_PENDING");
    const classPickWhileSelected =
      Boolean(state.selectedTrain) && /\b(cc|ec|1a|2a|3a|sl|2s|ea)\b/i.test(trimmed) && trimmed.length <= 28;
    const localUiQuery =
      follow === "bookings" ||
      follow === "wallet" ||
      follow === "guide" ||
      follow === "train_pick" ||
      follow === "more_trains" ||
      /\b(station\s*(?:par|pe|pr|on)\b[^?]*\b(kya|kaun|kitni|board|trains?)|station board|board dikhao)\b/i.test(trimmed);
    if (!criticalBookingFlow && !classPickWhileSelected && !localUiQuery) {
      try {
        setProgressText(null);
        const agentRes = await api.agentStream({
          text: trimmed,
          lastAsked,
          known: {
            from: state.from,
            to: state.to,
            date: state.dateProvided ? state.date || null : null,
            passengerCount: state.paxProvided ? state.passengerCount : null,
          },
          context: agentCtxRef.current ?? undefined,
          history: (messages.length ? messages : persistedMemory()?.messages ?? [])
            .slice(-8)
            .map((m) => ({ role: m.role, content: String(m.text ?? "").slice(0, 500) })),
          now: new Date().toISOString(),
          bookingFlow: state.flow ?? undefined,
        }, (e) => {
          /* Round-18m-29: REAL backend milestones only (no fake percentages). */
          setProgressText(e.total ? `${e.phase}… ${e.done ?? 0}/${e.total} checks completed` : `${e.phase}…`);
        });
        setProgressText(null);
        if (agentRes.reply) {
          if (agentRes.context) agentCtxRef.current = agentRes.context;
          const c = agentRes.context;
          /* Round-8: "nayi baat/reset" — server ne context fresh kiya, client
           * apne journey slots/selection bhi clear kare (warna known.from
           * agle turn mein stale slots wapas seed kar deta). */
          if (c?.justReset) {
            resetJourney();
            journeyRef.current = { from: null, to: null, date: "", dateProvided: false };
            lastFactTrainRef.current = null;
            agentCtxRef.current = { ...c, justReset: false };
          }
          if (c?.selectedTrainNumber) lastFactTrainRef.current = c.selectedTrainNumber;
          // Multi-turn slots flow into the deterministic booking engine.
          if (c?.origin && c.origin.code !== state.from?.code) setFrom(c.origin);
          if (c?.destination && c.destination.code !== state.to?.code) setTo(c.destination);
          if (c?.date && c.dateProvided && c.date !== state.date) setDate(c.date);
          if (c?.passengers && c.paxProvided && c.passengers !== state.passengerCount) setPassengerCount(c.passengers);
          /* Round-18m-15: agent ne nayi journey par pax reset kiya → client bhi
           * "provided" bhoole, warna known.passengerCount se phir 1 assume hota. */
          if (c && !c.paxProvided && state.paxProvided) clearPassengerCount();
          if (c && !c.dateProvided && state.dateProvided) clearDateProvided();
          const trace = agentRes.toolTrace ?? [];
          const sources = [...new Set(trace.map((t) => t.source).filter(Boolean))].join("+");
          const engineLabel = agentRes.engine === "agentic_tool_calling" ? "AI tool-calling" : "Agent fallback";
          setLastDbg(
            `${engineLabel} · ${agentRes.modelUsed ?? "gpt-oss-20b"} · ${trace.length} tool call${trace.length === 1 ? "" : "s"}${
              sources ? ` · ${sources}` : ""
            } · ${((agentRes.latencyMs ?? 0) / 1000).toFixed(1)}s`,
          );
          /* 24 Sep 2026 (user: "chat UI confusing hai — har cheez easily samajh aaye"):
           * pehle yahan raw tool naam dikhte the ("SEARCH_STATIONS → RANK_JOURNEY_OPTIONS
           * (web_erail)") — user ke liye bematlab jargon. Ab wahi kaam friendly Hinglish
           * me, aur technical naam chhote "details" me (tap = khul jaye). */
          const traceLine = trace.length ? `\n\n⚙️ ${friendlyToolLine(trace.map((t) => t.tool))}` : "";
          setThinking(false);
          // User feedback (2026-09-05): train list chat-text nahi — proper organized TABLE.
          // Round-17: RANK_JOURNEY_OPTIONS → BEST OPTION card (table ki jagah); warna table.
          const blocks: Block[] = [];
          /* Round-31: is turn me user ne jo train number likha (dikhane aur agle kadam, dono ke liye). */
          const askedTrains = trainNumbersInText(trimmed);
          // Round-18: SELECT TRAIN picker (number/name → real matches, user taps).
          if (agentRes.trainPicker && agentRes.trainPicker.matches.length) blocks.push({ type: "trainpicker", picker: agentRes.trainPicker });
          /* Round-18m-33: choice (station / run-day) → dropdown block; reply text mein "1. X 2. Y" bhi ho to dropdown hi primary. */
          if (agentRes.choice && agentRes.choice.options.length) blocks.push({ type: "choice", choice: agentRes.choice });
          /* Round-18m: live-status run-date chips — sirf un dates ke, jinke liye
           * provider ke paas data hai. Tap → "<train> <date> ka live status". */
          if (agentRes.liveDates && agentRes.liveDates.options.length) {
            const tn = agentRes.liveDates.trainNumber;
            blocks.push({
              type: "dates",
              options: agentRes.liveDates.options.map((o) => ({
                date: `${tn} ${o.date} ka live status`,
                label: `${o.label}${o.runState === "running" ? " · chal rahi" : o.runState === "completed" ? " · poori" : o.runState === "not_started" ? " · abhi nahi chali" : ""}`,
              })),
            });
          }
          if (agentRes.journey && (agentRes.journey.routeOptions.length || agentRes.journey.directUnavailable)) {
            blocks.push({ type: "journey", plan: agentRes.journey });
          } else if (agentRes.trains && agentRes.trains.rows.length) {
            blocks.push({ type: "traintable", table: agentRes.trains });
          }
          // Round-18: YOU MAY ALSO CONSIDER (only when server found verified alternatives).
          if (agentRes.alternatives && agentRes.alternatives.reason !== "fine") blocks.push({ type: "alternatives", alt: agentRes.alternatives });
          /* Round-27 (user: "ek hi class dikha raha … aur class pe tap kare to seedha passenger form"):
           * live board ki rows se train-wise block — har train ki saari classes, har chip tappable.
           * Chips alag se nahi dikhte (dono jagah same data) — chat me sirf ye block. */
          {
            const sf = agentRes.seatFilter;
            const all = [...(sf?.rows ?? []), ...(sf?.wlRows ?? [])];
            /* Round-30 (user: "12013 ki seat availability btana … yeh question pe board kyu le aata,
             * maine to maanga hi nahi"): user ne kisi khaas train ki baat ki ho to block SIRF usi
             * train ka — poori 21-train ki board nahi. Generic sawaal ("seat wali trains batao") par
             * pehle jaisa poora board hi rehta hai. Rows server ke payload se hi — kuch invent nahi,
             * sirf dikhaya kam jaata hai (aur maangi train list me na ho to block hi nahi banta). */
            const focus = askedTrains;
            const rows = focusSeatRows(all, focus);
            if (sf && rows.length) {
              blocks.push({
                type: "seatlist",
                from: agentRes.nlu?.from?.code ?? state.from?.code ?? "",
                to: agentRes.nlu?.to?.code ?? state.to?.code ?? "",
                toName: agentRes.nlu?.to?.name ?? state.to?.name ?? null,
                date: agentRes.nlu?.date ?? state.date,
                source: sf.source,
                focus: focus.length ? focus : undefined,
                rows,
              });
            }
          }
          /* Round-31 (user: "AI ko answer ke baad next step pe leke jaana chahiye… AI khud dimaag kyu
           * nahi lagata"): jawab ke neeche "Agla kadam" — usi turn ke verified data se. Booking wala
           * chip tap karne par Round-29 ka auto-advance seedha passenger form kholta hai. Kuch na ho to
           * koi chip nahi (jhoothi suggestion se behtar kuch na kehna). */
          {
            /* Round-32 (user: "har query pehle model ke pass jaani chahiye and wo decide kare kya karna
             * hai"): PEHLE model ka chuna hua agla kadam (reply ki [NEXT] lines se; server ne tool-evidence
             * se validate kiya). Model ne na diya ho to verified data se bana fallback (Round-31) — taaki
             * agla kadam phir bhi mile, par kabhi jhootha na mile. */
            /* Round-34: is turn ke seat rows yaad rakho (agli baar form bharne ke liye). */
          if (agentRes.seatFilter && ((agentRes.seatFilter.rows?.length ?? 0) || (agentRes.seatFilter.wlRows?.length ?? 0))) {
            const sf0 = agentRes.seatFilter as typeof agentRes.seatFilter & { from?: string | null; to?: string | null; date?: string | null };
            lastSeatRowsRef.current = {
              from: String(sf0.from ?? c?.origin?.code ?? ""),
              to: String(sf0.to ?? c?.destination?.code ?? ""),
              date: String(sf0.date ?? c?.date ?? ""),
              rows: [...(sf0.rows ?? []), ...(sf0.wlRows ?? [])],
            };
          }
          /* Round-36 (user: "agla kadam AI se aaye, wo khud ka dimaag lagaye jaise ChatGPT/Gemini lagata
           * hai — fallback pe verified data se na aaye, AI har baar apna brain use kare"): "Agla kadam"
           * ab SIRF model ke chune hue steps se banta hai (server ne tool-evidence par validate kiye hue).
           * Model na de to ye card dikhta hi nahi — data se banaya hua jhootha/nakli next step nahi. */
          const modelActions = agentRes.nextActions ?? [];
          if (modelActions.length) {
            blocks.push({
              type: "nextstep",
              source: "model",
              options: modelActions.map((a, i) => ({ id: `m${i}`, label: a.label, utterance: a.utterance, primary: a.primary ?? i === 0 })),
              hint: null,
            });
          }
          }
          const tableBlock: Block[] | undefined = blocks.length ? blocks : undefined;
          setMessages((m) => [
            ...m,
            {
              id: newId(),
              role: "assistant",
              text: String(agentRes.reply ?? "").trim() ? `${agentRes.reply}${traceLine}` : CARDS_ONLY_LINE,
              blocks: tableBlock,
            },
          ]);
          if (agentRes.interrupt && agentRes.resumeText) {
            if (agentRes.resumeAsk) setLastAsked(agentRes.resumeAsk);
            setMessages((m) => [...m, { id: newId(), role: "assistant", text: agentRes.resumeText! }]);
          } else if (agentRes.resumeAsk) {
            /* Round-18m-9: passenger-gate jaise deterministic sawaal bhi
             * lastAsked set karein — warna agla "2" server par pax nahi banta. */
            setLastAsked(agentRes.resumeAsk);
          }
          /* Round-29 (26 Sep, user: "22432 mein 3A book krdo" — AI khud passenger form pe shift kare,
           * details pehle se bhari hon; "Check hui?" dobara na poochhna pade — seat-check flow atka na
           * rahe). Booking intent + train (+ class) tay ho to jawab ka intezaar nahi: turant passenger
           * form. Jo data verified hai wahi bhejte hain (row ka status/fare/timing, warna list ka
           * naam/timing) — kuch invent nahi; status pata na ho to honest note ke saath form. */
          if (isBookingIntent(trimmed, c?.intent)) {
            /* Round-30: number nikaalne ke liye wahi helper — "2026" (saal) ko train nahi samajhta. */
            const tno = (trainNumbersInText(trimmed)[0] ?? c?.selectedTrainNumber ?? lastFactTrainRef.current ?? "").trim();
            const clsWanted = (/\b(1A|2A|3A|3E|2S|SL|CC|EC|EA|FC|GN)\b/i.exec(trimmed)?.[1] ?? "").toUpperCase();
            const routeFrom = state.from ?? c?.origin ?? null;
            const routeTo = state.to ?? c?.destination ?? null;
            /* Date: is turn me server ne jo batayi (ya user ne pehle di) wahi — form ka default
             * (aaj) use nahi karte, warna galat date ka form khul jaata. Date hi na ho to advance
             * nahi hota (wahan "kis date ko?" poochhna theek hai). */
            const routeDate = (c?.dateProvided && c?.date ? c.date : "") || (state.dateProvided ? state.date : "") || (state.date && c?.dateProvided ? c.date : "");
            /* Wahi train+class pehle se form me khuli hai to dobara kuch nahi karte. */
            const already = state.selectedTrain?.number === tno && (!clsWanted || state.selectedClass?.code === clsWanted);
            if (tno && !already && routeFrom && routeTo && routeDate) {
              const sf = agentRes.seatFilter;
              /* Round-34: is turn ki rows pehle; na hon to wahi rows jo user ko pehle DIKHAYI gayi thi —
               * aur wahi route/date ho (warna purane turn ka fare/status nayi journey par nahi lagta). */
              const remembered = lastSeatRowsRef.current;
              const rememberedOk =
                remembered && remembered.from === routeFrom.code && remembered.to === routeTo.code && remembered.date === routeDate
                  ? remembered.rows
                  : [];
              const live = [...(sf?.rows ?? []), ...(sf?.wlRows ?? []), ...rememberedOk];
              /* Round-35 (user: "19028 mein book krdo" — AI ne class nahi poochhi, seedha ek class ka
               * form khol diya, jabki us train me kai classes khuli thi; "AI khud kyu nhi soch rha,
               * har cheez thodi btani padegi"): class boli hi na ho aur us train me EK SE ZYADA class
               * khuli ho (AVL/RAC) → pehle us se poochho, uski marzi ke bina form mat kholo. */
              const thisTrain = live.filter((r) => String(r.number) === tno);
              const withSeat = thisTrain.filter((r) => /^(AVAILABLE|RAC)$/i.test(String(r.status ?? "")));
              const classKey = (r: (typeof withSeat)[number]) => String(r.classCode ?? "").toUpperCase();
              const uniqClasses = withSeat.filter((r, i) => withSeat.findIndex((x) => classKey(x) === classKey(r)) === i);
              if (!clsWanted && uniqClasses.length >= 2) {
                const nm = uniqClasses[0]?.name ?? agentRes.trains?.rows?.find((t) => String(t.number) === tno)?.name ?? null;
                setMessages((m) => [
                  ...m,
                  {
                    id: newId(),
                    role: "assistant",
                    text: `${tno}${nm ? ` ${nm}` : ""} me ${uniqClasses.length} classes khuli hain — ${uniqClasses
                      .map((r) => `${r.classCode}${r.seats != null ? ` (${r.status} ${r.seats})` : ""}`)
                      .join(", ")}. Kaunsi class me book karun? Neeche chip par tap karo.`,
                    blocks: [
                      {
                        type: "classchoice",
                        trainNumber: tno,
                        trainName: nm,
                        from: routeFrom.code,
                        to: routeTo.code,
                        date: routeDate,
                        options: uniqClasses.map((r, i) => ({
                          id: `c${i}`,
                          classCode: String(r.classCode ?? "").toUpperCase(),
                          label: `${String(r.classCode ?? "").toUpperCase()} · ${r.status}${r.seats != null ? ` ${r.seats}` : ""}${r.fare != null ? ` · ₹${r.fare}` : ""}`,
                          utterance: `${tno} mein ${String(r.classCode ?? "").toUpperCase()} book krdo`,
                          status: String(r.status ?? ""),
                          seats: r.seats ?? null,
                          fare: r.fare ?? null,
                        })),
                        hint: "Class chip par tap → seedha passenger form (jo data dikha wahi jayega)",
                      },
                    ],
                  },
                ]);
                return;
              }
              const pickRow = pickRowForBooking(live, tno, clsWanted || null);
              const seat = buildAutoBookSeat({
                trainNumber: tno,
                classWanted: clsWanted || null,
                row: pickRow,
                trainRow: agentRes.trains?.rows?.find((t) => String(t.number) === tno) ?? null,
                source: sf?.source ?? null,
              });
              openBookingFromSeatRow(seat, { from: routeFrom.code, to: routeTo.code, toName: routeTo.name ?? null, date: routeDate });
            }
          }
          // Booking continuity: AI gathered all slots + booking intent → open the bookable TrainBoard.
          const wantBooking =
            c?.intent === "BOOK_TRAIN" ||
            c?.intent === "SEARCH_TRAIN" ||
            /jana hai|jaana hai|book kar|ticket chahiye/i.test(trimmed);
          const sameSearch =
            state.trains.length > 0 &&
            state.from?.code === c?.origin?.code &&
            state.to?.code === c?.destination?.code &&
            state.date === c?.date;
          /* Round-18e (user bug): agar server ne BEST FOR YOU / YOU MAY ALSO
           * CONSIDER / SELECT TRAIN block diya hai to TrainBoard AUTO mat kholo —
           * warna full-screen board chat ke Round-18 cards ko chhupa deta tha
           * ("sidha card open"). Board ab card ke "Sabhi trains · Book →" CTA
           * ya explicit train pick se khulta hai. */
          const hasSmartBlock = blocks.some((b) => b.type === "journey" || b.type === "alternatives" || b.type === "trainpicker");
          /* Round-16g: from == to par kabhi card mat kholo (server guard bhi hai). */
          /* Round-18m-7 (user: "14 ko bola, sidha train card khul gaya — journey planner
           * khulna chahiye"): full-screen TrainBoard KABHI auto nahi — sirf card ke
           * "Sabhi trains · Book →" ya train pick se. Server ka journey card / table chat
           * mein hi dikhta hai; passengers server poochta hai. */
          const AUTO_BOARD = false;
          if (AUTO_BOARD && !hasSmartBlock && wantBooking && c?.origin && c?.destination && c.origin.code !== c.destination.code && c?.date && !sameSearch) {
            setBusy(true);
            try {
              await searchRoute(c.origin, c.destination, c.date);
            } catch {
              /* TrainBoard surfaces search errors */
            } finally {
              setBusy(false);
            }
          }
          return;
        }
      } catch (err) {
        /* Round-18m-35 (user screenshot: "Aaj" → "Kahan se jana hai?"): AI turn fail/timeout hua to client ka
         * purana deterministic planner chal padta tha — wo journey-slot machine hai, live/general sawaal nahi
         * samajhta. User rule: HAR request AI ke paas — AI down ho to SAAF bolo, code se guess mat karo. */
        setThinking(false);
        setProgressText(null);
        setMessages((m) => [...m, { id: newId(), role: "assistant", text: `AI se jawab abhi nahi aa paya (${err instanceof Error && err.message ? err.message.slice(0, 80) : "timeout"}) — main andaza nahi lagaunga. Dobara bhejo ya thodi der baad try karo.` }]);
        setBusy(false);
        return;
      }
    }
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
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: "assistant",
        text: String(turn.text ?? "").trim() ? turn.text : turn.blocks?.length ? CARDS_ONLY_LINE : EMPTY_REPLY_LINE,
        blocks: turn.blocks,
      },
    ]);
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
    if (from && to && from.code === to.code) {
      setMessages((m) => [
        ...m,
        { id: newId(), role: "assistant", text: `${st.name} (${st.code}) — from aur to same nahi ho sakte. ${slot === "to" ? "Kahan se" : "Kahan"} jaana hai?` },
      ]);
      return;
    }
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
    if (voice.listening) {
      /* doosra tap = OK (aur sheet band) */
      voice.commit();
      setVoiceSheet(false);
      return;
    }
    setVoiceSheet(true); /* ConfirmTkt jaisa "bolne wala" screen — bolo, live likha jaye */
    await voice.start();
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

  /* ── Round-20 (25 Sep, user: "kisi bhi class pe tap krnе pe seedha passenger form khulna chahiye,
   * upar automatically train number, date, from, to station aaye") ────────────────────────────────
   * Chip tap → class bookable hai (AVL/RAC/WL) to SEEDHA passenger form (train no · date · from → to ·
   * class · fare pehle se bhare hue). Warna (N/A / data nahi) purana fresh seat check wala chat flow.
   * Sirf mapping: chip me jo real provider row hai wahi booking me jaati hai — koi number invent nahi,
   * koi naya API call nahi, AI/tools/planner ko chhua nahi. */
  function openBookingFromChip(q: {
    trainNumber: string;
    classCode: string;
    from: string;
    to: string;
    date?: string | null;
    row?: { status?: string | null; seats?: number | null; rac?: number | null; waitlist?: number | null; fare?: number | null; source?: string | null; asOf?: string | null } | null;
    trainName?: string | null;
    departure?: string | null;
    arrival?: string | null;
    arrivalDayOffset?: number | null;
    durationLabel?: string | null;
    fromName?: string | null;
    toName?: string | null;
  }) {
    const status = String(q.row?.status ?? "UNKNOWN").toUpperCase();
    /* Round-29: UNKNOWN (status hi nahi mila) par bhi passenger form — fresh AI query ke loop me
     * ya user ko "check hui?" poochne me time barbaad nahi; live check "Review journey" par. */
    if (status !== "AVAILABLE" && status !== "RAC" && status !== "WAITLIST" && status !== "UNKNOWN") {
      void handleText(
        `${q.trainNumber} ki fresh seat availability${q.classCode ? ` ${q.classCode}` : ""} ${q.date ?? state.date} ko ${q.from} se ${q.to}`,
      );
      return;
    }
    const { train, klass } = bookingFromChipPayload({ ...q, requestDate: q.date ?? state.date });
    selectTrainAndClassGo(train, klass);
    speakGuide(`${klass.code} select ho gayi. Ab passenger details bhariye.`);
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: "assistant",
        text: `✅ ${klass.code} select — passenger form khul gaya: ${train.number} ${train.name ? `${train.name} · ` : ""}${train.date} · ${train.from.code} → ${train.to.code}. Passenger details IRCTC style me bhar do; payment IRCTC handoff par hi hoga.`,
      },
    ]);
  }

  /** Seat Finder ke chip tap par bhi wahi — row me jo hai wahi. */
  function openBookingFromSeatRow(r: SeatRow, ctx: { from: string; to: string; toName?: string | null; date: string }, note?: string | null) {
    /* Round-29 (user screenshot: "Check hui?" ke baad wahi "check kar raha hoon" ghuma-ghuma ke —
     * User: "seat-check flow atka na rahe"). Status pata na ho (UNKNOWN) to ab fresh AI query ka
     * chakkar nahi — seedha passenger form khulta hai; asli availability + fare "Review journey"
     * par provider se aati hai (goReview). Sirf jab train/class chal hi nahi rahi (N/A/REGRET/
     * CANCELLED) tab fresh check maanga jata hai. */
    const openable = r.status === "AVAILABLE" || r.status === "RAC" || r.status === "WAITLIST" || r.status === "UNKNOWN";
    if (!openable) {
      void handleText(
        `${r.number} ki fresh seat availability ${r.classCode !== "—" ? `${r.classCode} ` : ""}${ctx.date} ko ${ctx.from} se ${ctx.to}`,
      );
      return;
    }
    const { train, klass } = bookingFromSeatRow(r, {
      from: stationOf(ctx.from),
      to: stationOf(ctx.to, ctx.toName ?? null),
      date: ctx.date,
    });
    selectTrainAndClassGo(train, klass);
    speakGuide(`${klass.code} select ho gayi. Ab passenger details bhariye.`);
    const unknown = klass.status === "UNKNOWN";
    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: "assistant",
        text: `✅ ${klass.code} select — passenger form khul gaya: ${train.number} ${train.name ? `${train.name} · ` : ""}${train.date} · ${train.from.code} → ${train.to.code}.${
          unknown ? " Seat status yeh data me nahi tha — asli availability aur fare \"Review journey\" par provider se check honge." : ""
        }${note ? ` ${note}` : ""}`,
      },
    ]);
  }

  /** Round-29: chat ke train-card me class par tap → usi train+class ka passenger form (jo dikha wahi). */
  function openBookingFromReplyRow(r: ReplyRow, group?: { number: string; name: string }) {
    const from = state.from;
    const to = state.to;
    const date = state.date;
    if (!from || !to || !date) {
      void handleText(`${r.train} ${r.cls} ki seat availability — ${from?.code ?? ""} se ${to?.code ?? ""}`.trim());
      return;
    }
    const count = typeof r.count === "number" ? r.count : null;
    const seat = buildAutoBookSeat({
      trainNumber: r.train,
      classWanted: r.cls || null,
      row: {
        number: r.train,
        name: group?.name || r.name,
        classCode: r.cls,
        status: r.status,
        /* Chat me jo count dikha wahi — status ke hisaab se seats/RAC/WL me jaata hai. */
        seats: count,
        fare: r.fare ? Number(String(r.fare).replace(/[^\d]/g, "")) || null : null,
        departure: r.dep,
      },
      source: "chat",
    });
    openBookingFromSeatRow(seat, { from: from.code, to: to.code, toName: to.name, date });
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
        <div className="brand" title={`Build ${__BUILD_TAG__}`}>
          <img src="/logo.png" alt="" />
          RailBook
          <span className="build-tag" aria-label="build">{__BUILD_TAG__.split(" ")[0]}</span>
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
        {!showHome && (
          <button className="icon-btn" title="Nayi chat" aria-label="Nayi chat" onClick={startNewChat}>✚</button>
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
            {/* Round-18m-8 (layout): journey planner card ke saath lamba AI text "chat" jaisa
              * lagta tha — card hi result hai; text ek collapsed note mein (tap → padho). */}
            {(() => {
              /* 24 Sep 2026 (user: "2A seat bta esne phir direct trains bta di" — seat ka jawab
               * card ke andar chhup gaya tha). Seat line (💺 …) ab card ke UPAR hamesha dikhti hai;
               * baaki lamba text pehle jaisa collapsed note me. */
              /* Round-25: "…Seat Finder card mein hain" jaisa jhootha pointer screen par na aaye
               * (wo card Round-21c me chat se hat chuka hai). Server ab saari trains isi jawab me
               * likhta hai; ye sirf safety net hai. */
              const hasSeatBlock = Boolean(msg.blocks?.some((b) => b.type === "seatlist"));
              const text = stripSeatCardPointer(String(msg.text ?? ""), hasSeatBlock);
              const seatLines = text.split("\n").filter((l) => l.trim().startsWith("💺"));
              const rest = seatLines.length ? text.split("\n").filter((l) => !l.trim().startsWith("💺")).join("\n").trim() : text;
              const hasJourney = Boolean(msg.blocks?.some((b) => b.type === "journey"));
              if (!text) return null;
              return (
                <>
                  {seatLines.map((l, i) => (
                    <p key={i} className="msg-seatline">
                      {l.trim()}
                    </p>
                  ))}
                  {rest &&
                    (hasJourney ? (
                      <details className="msg-note">
                        <summary>
                          AI note <span className="msg-note-hint">tap karo</span>
                        </summary>
                        <p className="msg-text">{rest}</p>
                      </details>
                    ) : (
                      /* Round-20: lamba jawab (screenshot 3) attractive rows me — ReplyText sirf
                       * render karta hai, text waisa hi rehta hai. */
                      <ReplyText text={rest} onBook={(r, g) => openBookingFromReplyRow(r, g)} />
                    ))}
                </>
              );
            })()}
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
                onOpenBoard={(from, to, date) => void openBoardFor(from, to, date)}
                onBookClass={(q) => openBookingFromChip(q)}
                onBookSeat={(r, ctx) => openBookingFromSeatRow(r, ctx)}
                seatFinder={seatFind}
              />
            ))}
          </article>
        ))}

        {(thinking || busy || state.searching) && (
          <article className="msg assistant">
            <div className="msg-kicker">RailBook</div>
            <p className="msg-text thinking">
              {progressText
                ? progressText
                : state.searching
                ? "Main aapke liye available trains check kar raha hoon…"
                : thinking
                  ? "Samajh raha hoon…"
                  : "Kaam ho raha hai…"}
            </p>
          </article>
        )}
      </div>

      {/* 24 Sep 2026 (user: "hum bhi esa kuch bolne wala show karein?") — ConfirmTkt jaisa sheet:
          live transcript + quick chips + bada mic + ✍️ Type + ✕. Bhejna OK par (auto-send nahi). */}
      <VoiceSheet
        open={voiceSheet}
        listening={voice.listening}
        interim={voice.interim}
        level={voice.level}
        status={voice.status}
        suggestions={VOICE_CHIPS}
        onOk={() => {
          voice.commit();
          setVoiceSheet(false);
        }}
        onCancel={() => {
          voice.cancel();
          setVoiceSheet(false);
        }}
        onType={() => {
          setVoiceSheet(false);
          voice.cancel();
          setTimeout(() => document.querySelector<HTMLInputElement>(".composer input")?.focus(), 60);
        }}
        onPick={(t) => {
          setVoiceSheet(false);
          voice.cancel();
          void handleText(t);
        }}
      />
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (voice.listening) { voice.commit(); return; }
          const t = draft.trim();
          setDraft("");
          void handleText(t);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={voice.listening ? "Mic chal raha hai — upar dekho…" : "Kahan se kahan jaana hai?"}
          aria-label="Type your journey"
          autoComplete="off"
        />
        <button
          type="button"
          className={`mic ${voice.listening ? "live" : ""}`}
          onClick={onMicTap}
          title={voice.listening ? "OK — bhejo" : "Tap to speak"}
          aria-label={voice.listening ? "OK — send what I said" : "Tap to speak"}
          aria-pressed={voice.listening}
        >
          <span className="mic-icon" aria-hidden>
            {voice.listening ? (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" />
              </svg>
            )}
          </span>
          {voice.listening && <span className="mic-rings" aria-hidden />}
        </button>
        <button type="submit" className="send" aria-label="Send" disabled={voice.listening && !voice.interim.trim()}>➤</button>
      </form>
      <div className={`composer-hint ${voice.listening ? "live" : ""}`} role="status" aria-live="polite">
        {voice.listening ? "Sun raha hoon — khatam ho to OK ✓ dabao (mic auto-send nahi karega)" : voice.status === "Tap to speak" ? "🎙️ बोलकर बताएं  ·  ✍️ Type करें" : voice.status}
      </div>
    </div>
  );
}

/* 24 Sep 2026: tool-trace ko user ki bhasha me — "SEARCH_STATIONS → RANK_JOURNEY_OPTIONS
 * (web_erail)" ki jagah "Stations dhoondhe → Trains + seats check kiye". */
const TOOL_FRIENDLY: Record<string, string> = {
  SEARCH_STATIONS: "Stations dhoondhe",
  SEARCH_TRAINS: "Trains dhoondhe",
  SEARCH_TRAIN_BY_NUMBER: "Train dekhi",
  SEARCH_TRAIN_BY_NAME: "Train naam se dhoondhi",
  TRAIN_NAME_SEARCH: "Train naam se dhoondhi",
  RANK_JOURNEY_OPTIONS: "Trains + seats check kiye",
  JOURNEY_ANALYZE: "Journey plan banaya",
  CHECK_AVAILABILITY: "Seat check kiya",
  GET_FARE: "Fare check kiya",
  TRACK_TRAIN: "Live position dekhi",
  GET_TIMETABLE: "Route/schedule dekha",
  CHECK_PNR: "PNR check kiya",
  GET_CANCELLED_TRAINS: "Cancelled list dekhi",
  GET_COACH_POSITION: "Coach position dekhi",
  GET_STATION_BOARD: "Station board dekha",
  GET_TRAIN_INFO: "Train info dekhi",
  GET_TRAIN_HISTORY: "Train history dekhi",
  FIND_PARTIAL_ROUTE_SEATS: "Ticket-trick options dhoondhe",
  FIND_CONNECTIONS: "Connecting trains dhoondhe",
  FIND_ALTERNATIVE_TRAINS: "Alternative trains dhoondhe",
  FIND_VACANT_SEATS: "Khaali seats dhoondhe",
  WEB_SEARCH: "Web se verify kiya",
  GENERAL_RAILWAY_ANSWER: "Railway rule check kiya",
};

/** Tool chain → ek friendly line (duplicates hata kar, order bachaa kar). */
export function friendlyToolLine(tools: string[]): string {
  const out: string[] = [];
  for (const t of tools) {
    const label = TOOL_FRIENDLY[t] ?? t.toLowerCase().replace(/_/g, " ");
    if (out[out.length - 1] !== label) out.push(label);
  }
  return out.join(" → ");
}

/* Round-18m-33 (user: "choose karna ho to dropdown — run-day bhi, stations bhi"): native <select> (mobile par
 * OS picker khulta hai) + "Chuno" — select karte hi bhej deta hai. */
export function ChoiceDropdown({ choice, onPick }: { choice: { kind: string; title: string; options: { label: string; value: string; sub?: string | null }[]; sendTemplate: string }; onPick: (value: string) => void }) {
  /* 24 Sep 2026 (user: "chat UI confusing hai — har cheez easily samajh aaye"):
   * pehle native <select> + "Chuno" button tha (2 step, chhota dropdown). Ab har
   * option EK TAP ka row hai — code badge + naam, tap = bhej diya. Option ke label
   * "MTJ – Mathura Jn" ko code/naam me baant kar dikhate hain (scan karna asaan). */
  const [sent, setSent] = useState<string | null>(null);
  const icon = choice.kind === "station" ? "📍" : choice.kind === "run_date" ? "📅" : "🚆";
  const hint = choice.kind === "station" ? "Ek baar tap karo — baaki main sambhal lunga." : "Ek baar tap karo.";
  return (
    <div className={`choice-card ${sent ? "sent" : ""}`}>
      <div className="choice-title">{icon} {choice.title}</div>
      <div className="choice-opts" role="list">
        {choice.options.map((o) => {
          const m = /^([A-Z0-9]{2,6})\s*[–-]\s*(.+)$/.exec(o.label.trim());
          const code = m ? m[1] : null;
          const name = m ? m[2] : o.label;
          const isSent = sent === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="listitem"
              className={`choice-opt${isSent ? " picked" : ""}`}
              disabled={Boolean(sent)}
              onClick={() => { setSent(o.value); onPick(o.value); }}
            >
              {code ? <span className="choice-code">{code}</span> : null}
              <span className="choice-name">{name}{o.sub ? <span className="choice-sub"> · {o.sub}</span> : null}</span>
              <span className="choice-go-ic">{isSent ? "✓" : "›"}</span>
            </button>
          );
        })}
      </div>
      {!sent && <div className="choice-hint">{hint}</div>}
    </div>
  );
}

/* Round-18m-32: simple bar waveform driven by mic RMS level (0..1); idle = low ripple. */
function VoiceWave({ level, live }: { level: number; live: boolean }) {
  const bars = 24;
  return (
    <div className={`voice-wave ${live ? "live" : ""}`} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const centre = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const h = live ? Math.max(0.12, Math.min(1, level * (0.55 + centre * 0.9) + (Math.sin(i * 1.7 + level * 20) + 1) * 0.04)) : 0.12;
        return <span key={i} style={{ height: `${Math.round(h * 100)}%` }} />;
      })}
    </div>
  );
}

/* Round-27 (26 Sep, user screenshot): chat me seat ka jawab train-wise — har train ki SAARI classes
 * ek saath (jo live board me hain), aur har class chip tappable: tap → seedha passenger form (wahi
 * bookingFromSeatRow flow jo Seat Finder/direct card ke chips par lagta hai). Data server ke
 * seatFilter payload se — kuch invent nahi; WL/N-A chips halki (purana rule). */
/* Round-31: "Agla kadam" card — jawab ke baad ka natural next step (Book → passenger form, doosri
 * classes, baaki trains, ya seat availability). Chips sirf verified data se bante hain (nextstep.ts). */
export function NextStepCard({
  block,
  onChip,
}: {
  block: Extract<Block, { type: "nextstep" }>;
  onChip: (u: string) => void;
}) {
  return (
    <div className="ns-card" id="next-step">
      <div className="ns-label">
        <span className="ns-dot" aria-hidden>➡️</span> Agla kadam
        {block.source ? (
          <span className={`ns-tag ${block.source}`} title={block.source === "model" ? "AI ne khud ye agla kadam chuna" : "AI ne nahi diya — verified data se banaya"}>
            {block.source === "model" ? "AI ne chuna" : "verified data se"}
          </span>
        ) : null}
      </div>
      <div className="ns-chips">
        {block.options.map((o) => (
          <button key={o.id} className={`ns-chip${o.primary ? " primary" : ""}`} onClick={() => onChip(o.utterance)}>
            {o.label}
          </button>
        ))}
      </div>
      {block.hint && <div className="ns-hint muted">{block.hint}</div>}
    </div>
  );
}

/* Round-35: "19028 mein book krdo" par class ambiguous → pehle USER se class poochho.
 * Chips sirf un classes ke jo board par sach me khuli thi (AVL/RAC) — fare/status wahi, kuch invent nahi. */
export function ClassChoiceCard({
  block,
  onChip,
}: {
  block: Extract<Block, { type: "classchoice" }>;
  onChip: (u: string) => void;
}) {
  return (
    <div className="ns-card" id="class-choice">
      <div className="ns-label">
        <span className="ns-dot" aria-hidden>🪑</span> {block.trainNumber} — kaunsi class me book karun?
      </div>
      <div className="ns-chips">
        {block.options.map((o, i) => (
          <button key={o.id} className={`ns-chip${i === 0 ? " primary" : ""}`} onClick={() => onChip(o.utterance)}>
            {o.label}
          </button>
        ))}
      </div>
      {block.hint && <div className="ns-hint muted">{block.hint}</div>}
    </div>
  );
}

export function SeatListBlock({
  block,
  onPick,
}: {
  block: Extract<Block, { type: "seatlist" }>;
  onPick: (row: SeatRow) => void;
}) {
  /* Grouping pure helper me (src/chatText.ts → seatListGroups) taaki test ho sake. */
  const groups = seatListGroups(block.rows);
  const seatCount = groups.filter((g) => g.seatCount > 0).length;
  const focus = block.focus ?? [];
  return (
    <div className={`sf-card jx-sb${focus.length ? " sf-focused" : ""}`} id="chat-seatlist">
      <div className="sf-head">
        <strong>
          {focus.length
            ? `Aapki maangi train${focus.length > 1 ? "s" : ""} (live board)`
            : "Seat wali trains (live board)"}
        </strong>
        <span className="muted">
          {focus.length ? `${groups.map((g) => g.number).join(", ")} · ` : ""}
          {groups.length} train{groups.length === 1 ? "" : "s"} · {seatCount} me seat
          {block.source ? ` · ${block.source.replace("web_", "")}` : ""}
        </span>
      </div>
      <div className="sf-groups">
        {groups.map((g) => {
          const anySeat = g.rows.some((r) => r.status === "AVAILABLE" || r.status === "RAC");
          return (
            <TrainClassBlock
              key={g.number}
              number={g.number}
              name={g.name}
              /* Board rows me schedule time nahi hota — jhootha time nahi likhte, "live board" hi. */
              timeText={(() => {
                /* Round-33: timings har card par (dep + duration) — jo provider ne diya wahi, warna honest "live board". */
                const dep = g.rows.find((r) => r.departure)?.departure;
                const dur = g.rows.find((r) => r.durationMinutes != null)?.durationMinutes ?? null;
                if (!dep) return "🕑 live board";
                const durLabel = dur != null ? `${Math.floor(dur / 60)}h ${String(dur % 60).padStart(2, "0")}m` : null;
                return durLabel ? `🕑 ${dep} · ${durLabel}` : `🕑 ${dep}`;
              })()}
              countText={`${g.rows.length} class${g.rows.length === 1 ? "" : "es"} (${g.seatCount} me seat)`}
              rows={g.rows.map((r) => ({
                code: r.classCode,
                status: r.status,
                seats: r.seats,
                rac: r.rac,
                waitlist: r.waitlist,
                fare: r.fare,
                seat: r.status === "AVAILABLE" || r.status === "RAC",
                raw: r,
              }))}
              tone={anySeat ? "seat" : "wl"}
              chipTitle={(c) => `${g.number} ${c.code} — passenger form kholo`}
              onChip={(c) => onPick((c.raw as typeof block.rows[number]) as unknown as SeatRow)}
            />
          );
        })}
      </div>
      <div className="sf-note muted">Class chip par tap karo → usi train/class ka passenger form (IRCTC jaisa) khul jaayega.</div>
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
  onOpenBoard,
  onBookClass,
  onBookSeat,
  seatFinder,
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
  /** Round-18e: explicit "Sabhi trains · Book" CTA from BEST FOR YOU card → TrainBoard. */
  onOpenBoard?: (from: string, to: string, date: string, trainNumber: string | null) => void;
  /* Round-20: card/Seat Finder ke class chip tap → seedha passenger form (train no/date/from→to bhare hue). */
  onBookClass?: (q: {
    trainNumber: string;
    classCode: string;
    from: string;
    to: string;
    date?: string | null;
    row?: { status?: string | null; seats?: number | null; rac?: number | null; waitlist?: number | null; fare?: number | null; source?: string | null; asOf?: string | null } | null;
    trainName?: string | null;
    departure?: string | null;
    arrival?: string | null;
    arrivalDayOffset?: number | null;
    durationLabel?: string | null;
    fromName?: string | null;
    toName?: string | null;
  }) => void;
  onBookSeat?: (r: SeatRow, ctx: { from: string; to: string; toName?: string | null; date: string }) => void;
  /* Seat Finder: us turn ka seat/class intent (Concierge state se aata hai — AI/server untouched). */
  seatFinder?: { intent: SeatIntent; viaVoice: boolean } | null;
}) {
  const { updatePassenger } = useBooking();
  if (block.type === "seatlist") {
    return (
      <SeatListBlock
        block={block}
        onPick={(row) =>
          onBookSeat?.(row, { from: block.from, to: block.to, toName: block.toName ?? null, date: block.date })
        }
      />
    );
  }
  if (block.type === "classchoice") {
    return <ClassChoiceCard block={block} onChip={onChip} />;
  }
  if (block.type === "traintable") {
    /* Round-21c: chat se Seat Finder card hata (user: "seat finder aur direct trains ab same hi hain").
     * Train list table jaisa tha waisa hi rehta hai. */
    return <TrainTableView table={block.table} />;
  }
  if (block.type === "choice") {
    return <ChoiceDropdown choice={block.choice} onPick={(value) => onChip(block.choice.sendTemplate.replace("{value}", value))} />;
  }
  if (block.type === "trainpicker") {
    return (
      <TrainPicker
        picker={block.picker}
        onSelect={(t) => onChip(`${t.number} ${t.name}${t.from && t.to ? ` (${t.from} → ${t.to})` : ""} select ki — iska kya chahiye: status, timetable, seat ya fare?`)}
      />
    );
  }
  if (block.type === "alternatives") {
    return (
      <AlternativesCard
        alt={block.alt}
        onPickTrain={(n) => onChip(`${n} ki seat availability ${block.alt.selected.classCode ? block.alt.selected.classCode + " " : ""}${block.alt.date} ko ${block.alt.origin} se ${block.alt.destination}`)}
        onPickDate={(d) => onChip(`${block.alt.origin} se ${block.alt.destination} ${d} ki trains dikhao`)}
      />
    );
  }
  if (block.type === "journey") {
    /* Round-21c (25 Sep, user: "seat finder aur direct trains ab same hi hain — seat finder ka UI
     * sirf chat section se hata do"): plan card ke chips pehle se hi wahi shakal hain (shared
     * TrainClassBlock), isliye alag Seat Finder card chat me nahi dikhaya jaata. Component
     * (SeatFinder.tsx), filters (src/seatfinder/*) aur AI/server ka seat intent — sab jaisa tha
     * waisa hi hai; sirf chat se ye ek card hata hai. */
    return (
      <JourneyOptions
        plan={block.plan}
        onPickTrain={(n) => onChip(`${n} ki seat availability ${block.plan.query.travelClass ? block.plan.query.travelClass + " " : ""}${block.plan.query.date} ko ${block.plan.query.from} se ${block.plan.query.to}`)}
        /* Round-18m-3: connecting leg → SIRF us leg ka segment + us leg ki date. */
        onPickLeg={(l) => onChip(`${l.trainNumber} ki seat availability ${l.classCode ? l.classCode + " " : block.plan.query.travelClass ? block.plan.query.travelClass + " " : ""}${l.date} ko ${l.ticketFrom ?? l.from} se ${l.ticketUpto ?? l.to}${l.ticketFrom && l.ticketFrom !== l.from ? ` (boarding ${l.from} se)` : ""}`)}
        /* Round-18m-6: ticket bookFrom→destination (boarding origin par) — query usi segment ki. */
        onPickBoardEarlier={(o) => onChip(`${o.trainNumber} ki seat availability ${o.classCode} ${block.plan.query.date} ko ${o.bookFrom} se ${o.destination} (boarding ${o.boardAt} se)`)}
        /* Round-20: class chip tap → seedha passenger form (bookable class par); warna purana fresh check. */
        onPickClass={(q) => {
          if (onBookClass) {
            onBookClass({
              ...q,
              row: (q.row as { status?: string | null } | null) ?? null,
              from: q.from,
              to: q.to,
              date: q.date ?? block.plan.query.date,
            });
            return;
          }
          onChip(`${q.trainNumber} ki fresh seat availability${q.classCode ? ` ${q.classCode}` : ""} ${q.date ?? block.plan.query.date} ko ${q.from} se ${q.to}${q.boardAt && q.boardAt !== q.from ? ` (boarding ${q.boardAt} se)` : ""}`);
        }}
        onPickDate={(d) => onChip(`${block.plan.query.from} se ${block.plan.query.to} ${d} ki trains dikhao`)}
        onPickStations={(f, t) => onChip(`${f} se ${t} ${block.plan.query.date} ki trains dikhao`)}
        onOpenBoard={onOpenBoard ? () => onOpenBoard(block.plan.query.from, block.plan.query.to, block.plan.query.date, block.plan.best?.trainNumbers[0] ?? null) : undefined}
        /* Round-19d (user: "Card filter karo lekin connecting/alternatives mein change na aayein"):
         * user ne time window bola ho ("kal subah") to card ki DIRECT list usi window ki — connecting,
         * alternatives, dates ka data/logic waisa hi rehta hai. Filter client-side hai (plan untouched). */
        window={
          seatFinder && (seatFinder.intent.afterMin != null || seatFinder.intent.beforeMin != null)
            ? { afterMin: seatFinder.intent.afterMin, beforeMin: seatFinder.intent.beforeMin, label: seatFinder.intent.windowLabel }
            : null
        }
      />
    );
  }
  if (block.type === "nextstep") {
    return <NextStepCard block={block} onChip={onChip} />;
  }
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
      <div className="inline-chips station-chips">
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

/* ── Organized train table (user feedback 2026-09-05) ─────────────────
 * Chat-text bullet list confusing thi — ab search results proper <table>
 * mein aate hain: train, nikalne/pahunchne ka time, duration, classes.
 * Sabse fast row ⚡ ke saath highlight. Data 100% server tool evidence se. */
/* Round-21c: yahan pehle Seat Finder card bhi mount hota tha — user ne kaha ki direct trains aur
 * Seat Finder ki UI ab same hai, isliye chat se wo card hata diya (component/AI/backend jaisa tha
 * waisa hi hai). */
function TrainTableView({ table }: { table: AgentTrainTable }) {
  const rows = table.rows ?? [];
  const day = (n: number) => (n > 0 ? `+${n}d` : "");
  return (
    <div className="traintable-wrap">
      <div className="traintable-head">
        <strong>{table.from} → {table.to}</strong>
        <span className="muted"> · {formatShortDate(table.date)} · {rows.length} trains</span>
      </div>
      <div className="traintable-scroll">
        <table className="traintable">
          <thead>
            <tr>
              <th>Train</th>
              <th>Nikal</th>
              <th>Pahunche</th>
              <th>Time</th>
              <th>Class</th>
              <th>Fare</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const isFastest = table.fastest != null && t.number === table.fastest;
              return (
                <tr key={t.number} className={isFastest ? "fastest" : undefined}>
                  <td className="tt-name">
                    <strong>{t.number}</strong> {t.name}
                    {isFastest && <span className="tt-fast">⚡ Sabse fast</span>}
                  </td>
                  <td>{t.departure}</td>
                  <td>
                    {t.arrival}
                    {t.arrivalDayOffset > 0 && <span className="muted"> +{t.arrivalDayOffset}d</span>}
                  </td>
                  <td>{t.durationLabel ?? (t.durationMinutes != null ? `${Math.floor(t.durationMinutes / 60)}h ${String(t.durationMinutes % 60).padStart(2, "0")}m` : "—")}</td>
                  <td className="tt-classes">{t.classes.join(", ") || "—"}</td>
                  <td>{t.fare ? `${t.fare.classCode} ₹${t.fare.amount.toLocaleString("en-IN")}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="traintable-foot muted">Real railway data · koi guess nahi</div>
    </div>
  );
}
