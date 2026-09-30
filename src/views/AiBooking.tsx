/* ══ AI BOOKING (ADDITIVE, Round-62) — prominent alag mode, text + voice ═══════════════════════════════
 * User: "RailBook me ek prominent 'AI Booking' option add karo … user text se bhi booking kar sake aur
 * voice se bhi … existing train cards/TrainBoard/Results UI reuse karo … existing booking state machine
 * ko replace mat karo … AI bina user confirmation ke final booking submit nahi karega … final IRCTC
 * action user ke click par."
 *
 * Ye view sirf NAYA hai — purani kisi cheez ko replace nahi karta:
 *   • Search/availability/fare = maujooda booking context ke wahi functions (searchRoute / selectClass /
 *     selectTrain / goReview) → matlab data wahi provider chain (RailCore/RailKit/web scrape) se aata hai.
 *   • Train cards = maujooda TrainBoard/Results screen (asli board) + uska hi `TrainClassBlock` block.
 *   • Passenger form = maujooda Passengers screen; AI sirf uske fields bharta hai (updatePassenger).
 *   • Review + IRCTC handoff = maujooda ReviewStatus screen (Continue to IRCTC wahi card).
 *   • Voice = maujooda voice stack (useVoiceInput) + naya TTS adapter (server provider ya device voice).
 *
 * ── R67 (1 Oct 2026, user) ────────────────────────────────────────────────────────────────────────
 * "kyu na hum edhr bhi AI first rakhein … AI ke pass sabhi existing tools ho jo pehle chat mein the,
 *  AI khud query samjhe aur right tool ka use kare … AI booking fully automate kare … bss AI booking
 *  wala jo banaya hai usmein yeh nayi cheezein implement karna hai."
 * Isliye ab HAR turn par pehle wahi **chat brain** (maujooda `/api/agent` — wahi tools/prompts) chalta
 * hai: wo khud samajhta hai aur sahi tool use karta hai (live status, timings, fare, seat, general
 * sawaal — sab usi ke paas hai). Booking ka **state/validation** waise hi maujooda flow engine ke
 * paas hai: brain se aaya slot canonical jawab ban kar usi `aiBookingTurn` se guzarta hai. Chat wale
 * endpoint/tools/prompts/architecture me kuch nahi chhua.
 *
 * Do shakalein:
 *   1) Full screen (jab koi maujooda screen khuli nahi) — poori conversation + asli train/class cards.
 *   2) Dock (jab maujooda screen khuli ho — results/passengers/review) — neeche chhoti AI bar: wahi
 *      conversation jari rehti hai, form upar khula rehta hai. Koi purani screen band nahi hoti.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBooking } from "../booking/context";
import { api, type AgentContextClient } from "../api";
import { TrainClassBlock, type ClassChipData } from "../components/TrainClassBlock";
import { isBookable } from "../types";
import { newId } from "../format";
import { useVoiceInput } from "../voice/useVoiceInput";
import { aiBookingVoice, voiceLinesFor, type VoiceIssue, type VoiceProviderInfo } from "../voice/aiBookingVoice";
import {
  AI_BOOKING_STAGES,
  AI_BOOKING_STAGE_LABELS,
  aiBookingAskLine,
  aiBookingBlank,
  aiBookingClassSelected,
  aiBookingClassUnavailable,
  aiBookingFinalPrompt,
  aiBookingHandoffTurn,
  aiBookingPassengerScreenOpen,
  aiBookingPassengersReady,
  aiBookingStart,
  aiBookingSummaryLines,
  aiBookingTrainsReady,
  aiBookingTurn,
  type AiBookingAction,
  type AiBookingState,
  type AiBookingTurn,
} from "../ai/aiBookingFlow";

interface Msg {
  id: string;
  role: "ai" | "you";
  text: string;
}

/* ══ R4-fix (user: "jaise pehle chat me kuch bhi poochte the, yeh bhi btayega?") ══════════════════════
 * AI Booking ab koi bhi sawaal bhi jawab देता hai. Design (minimal, additive):
 *   1) Pehle wahi purana deterministic flow engine chalta hai (jaisa tha — kuch badla nahi).
 *   2) Agar wo sawaal handle na kar paaye (wahi jawab/ask-back dohra de, koi slot aage na badhe) aur
 *      user ne sach me kuch POOCHHA ho → MAUJOODA chat brain (`api.agent` = wahi /api/agent jo
 *      Concierge use karta hai) se jawab aata hai. Booking flow state waisa hi rehta hai.
 *   3) Brain fail ho to flow waisa hi chalta rehta hai + ek honest line (kuch toota nahi). */

/** Sawaal jaisa lagta hai? (Hinglish + Hindi + English) */
function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  return /(^|\s)(kya|kyaa|kaise|kaisay|kaun|kaunsa|kaunsi|kab|kahan|kahaan|kitna|kitne|kitni|kyun|kyu|kis|batao|bata\s*do|bataiye|batai|बताओ|बताइए|क्या|कौन|कब|कहाँ|कहां|कितना|कितने|कितनी|क्यों|कैसे|है\s*क्या)(\s|$)/iu.test(t);
}

/* ══ R67 — mic kabhi AI ki APNI awaaz na pakde ═══════════════════════════════════════════════════════
 * User screenshot: mic ne AI ki bola hui line hi transcript me daal di ("20986 … 11906 … ट्रेन लेनी है").
 * Wajah: TTS khatam hone ka sahi pata nahi tha (andaza) → mic playback ke dauran khul jaata tha aur
 * speaker→mic echo pakad leta tha. Teen parat ka hal:
 *   1) app me native "bolna khatam" signal (aiBookingVoice.spokenAgoMs),
 *   2) mic bolne ke turant baad nahi khulta (grace),
 *   3) aaya hua transcript AI ki pichhli lines jaisa lage to chhod diya jaata hai (yahi function). */
function normTokens(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 || /^\d+$/.test(w));
}

/** Transcript AI ki hi line lagta hai? (numbers + token overlap — dono script chalti hain) */
function looksLikeEcho(transcript: string, spoken: string[]): boolean {
  const t = normTokens(transcript);
  if (!t.length || !spoken.length) return false;
  const spokenTokens = new Set(normTokens(spoken.join(" ")));
  const spokenDigits = new Set(normTokens(spoken.join(" ")).filter((w) => /^\d{3,6}$/.test(w)));
  const tDigits = t.filter((w) => /^\d{3,6}$/.test(w));
  /* Train numbers: transcript me wahi numbers jo AI ne abhi bole → saaf echo. */
  if (tDigits.length >= 1 && tDigits.filter((d) => spokenDigits.has(d)).length / tDigits.length >= 0.5) return true;
  /* Latin/Hinglish: aadhe se zyada shabd AI ki hi line ke hain → echo. */
  const hit = t.filter((w) => spokenTokens.has(w)).length;
  if (hit / t.length >= 0.55) return true;
  /* Devanagari transcript vs Latin spoken line: tokens match nahi karte — isliye lamba transcript jo
   * bilkul hi naya hai aur AI ke bolne ke fauran baad aaya hai, use echo maan lo (slot ke jawab
   * chhote hote hain: naam/age/pax/class/train). */
  const deva = t.filter((w) => /[\u0900-\u097F]/.test(w)).length;
  if (deva / t.length >= 0.6 && t.length >= 4) return true;
  return false;
}

/** R67: aisa sawaal jo booking ka slot nahi hai — live status/timing/fare/seat/general. Aise sawaal par
 *  jawab hamesha chat brain se aata hai (wahi tools), flow ki state waisi hi rehti hai. */
function looksFactualQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b\d{4,6}\b/.test(t)) return true; /* train number ke saath kuch poochha */
  return /(status|kahan (hai|pahun)|pahunch|pahunche|kitne baje|kab (chale|chalegi|pahunche|reach)|timing|schedule|delay|late|platform|coach (position|kahan)|live|running|chal rahi|kitna (fare|kiraya|paisa|lag)|fare|kiraya|availability|seat (kahan|kitni|hai)|waitlist|wl\b|rac\b|pantry|khana|catering|wallet|balance|pnr|irctc|payment|paisa|रिफंड|refund|स्थिति|कहाँ|कहां|कितने बजे|कब|किराया|उपलब्ध)/iu.test(
    t,
  );
}

/** R67: chat brain ke context/known se us slot ka canonical jawab (agar brain ne wo slot diya ho). */
function slotFromKnown(
  known: { from: string | null; to: string | null; date: string | null; passengerCount: number | null },
  slot: string,
  nlu: NluSlots,
): NluSlots {
  const out: NluSlots = {};
  if (slot === "from" && known.from) out.from = { code: known.from };
  if (slot === "to" && known.to) out.to = { code: known.to };
  if (slot === "date" && known.date) out.date = known.date;
  if (slot === "pax" && known.passengerCount) out.passengerCount = known.passengerCount;
  return { ...out, ...nlu };
}

/** R66-fix (user: "jaise mera AI chat me samajh jaata tha waise hi edhr bhi samjhe — edhr kya engine
 *  chal raha hai?"): jab local flow engine kisi chhote jawab ko samajh na paaye (jaise "एक पैैसेंजर है"),
 *  to wahi **maujooda chat brain** (`/api/understand` — chat ka apna NLU, koi naya engine nahi) se slot
 *  samjha jaata hai. Model se aaya slot seedha state me nahi jaata — uska ek **canonical jawab** banaya
 *  jaata hai aur wahi purane flow engine ko diya jaata hai, taaki saare validations/route/class logic
 *  bilkul wahi rahein. Samajh na aaye to saaf line (chup-chaap repeat nahi). */
const SLOT_TO_ASK: Record<string, "from" | "to" | "date" | "passengers" | "class" | "train"> = {
  from: "from",
  to: "to",
  date: "date",
  pax: "passengers",
  class: "class",
  train: "train",
};

type NluSlots = {
  from?: { code?: string | null } | null;
  to?: { code?: string | null } | null;
  date?: string | null;
  passengerCount?: number | null;
  classCodes?: string[] | null;
  trainNumber?: string | null;
};

/** Model ke samjhe slot → wahi shabd jo maujooda flow engine khud verify kar sakta hai. */
function canonicalFromNlu(slot: string, nlu: NluSlots): string | null {
  if (slot === "from") return nlu.from?.code ? String(nlu.from.code) : null;
  if (slot === "to") return nlu.to?.code ? String(nlu.to.code) : null;
  if (slot === "date") return nlu.date ? String(nlu.date) : null;
  /* R67: class/train bhi brain se aa sakte hain (wahi maujooda engine unhe verify karega). */
  if (slot === "class") {
    const c = Array.isArray(nlu.classCodes) ? nlu.classCodes[0] : null;
    return c ? String(c).toUpperCase() : null;
  }
  if (slot === "train") return nlu.trainNumber ? String(nlu.trainNumber) : null;
  if (slot === "pax") {
    const n = Number(nlu.passengerCount);
    return Number.isFinite(n) && n >= 1 ? `${n} passengers` : null;
  }
  if (slot === "class") return nlu.classCodes?.[0] ? String(nlu.classCodes[0]) : null;
  if (slot === "train") return nlu.trainNumber ? String(nlu.trainNumber) : null;
  return null;
}

/** Booking + flow state ka compact "fingerprint" — badla ya nahi, yeh dekhne ke liye. */
function flowKey(f: AiBookingState): string {
  return [
    f.stage,
    f.awaiting ?? "",
    f.from?.code ?? "",
    f.to?.code ?? "",
    f.date ?? "",
    f.pax ?? "",
    f.trainNumber ?? "",
    f.classCode ?? "",
    f.drafts?.length ?? 0,
    f.pendingCity?.city ?? "",
  ].join("|");
}

/** R4-fix helper: is turn ke passenger patches app-state me pahunchne tak chhota sa intezaar
 *  (React re-render ke liye). Sirf tab tak rukta hai jab tak sab kuch match na kar jaaye (max ~1.2s). */
async function waitForPaxPatches(
  expectPax: Map<number, Partial<{ name: string; age: string; gender: string; berthPreference: string }>>,
  read: () => { name: string; age: string; gender: string; berthPreference: string }[],
): Promise<void> {
  if (!expectPax.size) return;
  for (let i = 0; i < 24; i += 1) {
    const list = read();
    const ok = [...expectPax.entries()].every(([idx, patch]) => {
      const p = list[idx];
      if (!p) return true;
      const nameOk = !patch.name || p.name === patch.name;
      const ageOk = patch.age == null || String(p.age) === String(patch.age);
      const genderOk = !patch.gender || p.gender === patch.gender;
      const berthOk = !patch.berthPreference || p.berthPreference === patch.berthPreference;
      return nameOk && ageOk && genderOk && berthOk;
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function AiBooking({ open, onClose }: { open: boolean; onClose: () => void }) {
  const booking = useBooking();
  const { state, go, setFrom, setTo, setDate, setPassengerCount, updatePassenger, searchRoute, selectClass, selectTrain, selectTrainAndClassGo, goReview, resetJourney } = booking;
  const live = useRef(booking);
  live.current = booking;
  /* Callbacks ko ref me — effects stale closure par dobara-fire na karein. */
  const cb = useRef({ searchRoute, selectClass, selectTrain, selectTrainAndClassGo, goReview, setFrom, setTo, setDate, setPassengerCount, updatePassenger, resetJourney, go });
  cb.current = { searchRoute, selectClass, selectTrain, selectTrainAndClassGo, goReview, setFrom, setTo, setDate, setPassengerCount, updatePassenger, resetJourney, go };

  const [flow, setFlow] = useState<AiBookingState>(() => aiBookingBlank());
  const bookingKey = () => {
    const b = live.current.state as unknown as {
      from?: { code?: string }; to?: { code?: string }; date?: string; passengerCount?: number;
      selectedTrain?: { number?: string } | null; selectedClass?: { code?: string } | null;
      passengers?: unknown[]; screen?: string;
    };
    return [
      b.from?.code ?? "", b.to?.code ?? "", b.date ?? "", b.passengerCount ?? "",
      b.selectedTrain?.number ?? "", b.selectedClass?.code ?? "", b.passengers?.length ?? 0, b.screen ?? "",
    ].join("|");
  };
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [provider, setProvider] = useState<VoiceProviderInfo | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /* R63-fix: AI ki awaaz kahan se aayegi (server / app ka native TTS / device / kuch nahi). */
  const [voiceSupport, setVoiceSupport] = useState<"server" | "app" | "device" | "none">("device");
  /* R66: voice output me koi dikkat (server fail / playback block / output nahi) → UI imandaari se batata hai. */
  const [voiceIssue, setVoiceIssue] = useState<VoiceIssue>(null);
  /* R67: chat brain ka context (chat ki tarah turn-to-turn yaad rehta hai) + live progress (lamba
   * turn me user ko dikhta hai ki kaam ho raha hai — "answer nahi aaya" jaisa confusion na ho). */
  const agentCtx = useRef<AgentContextClient | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  /* R67: voice-issue line user khud hata sake (screenshot: passenger form par poori jagah kha rahi thi). */
  const [issueDismissed, setIssueDismissed] = useState(false);
  /* R66 (ChatGPT jaisi voice conversation): user ne mic se baat shuru ki → AI bolne ke baad mic khud
   * wapas sunta hai; "Type instead"/"End voice"/mute par loop band. Mic sirf user ke tap se ON hota hai
   * (background listening nahi) — loop usi ON conversation ke andar turn-taking hai. */
  const convActive = useRef(false);
  const lastWasVoice = useRef(false);
  const voiceRef = useRef<ReturnType<typeof useVoiceInput> | null>(null);
  /* R67: aakhri spoken lines (echo filter) + echo-ignore counter (safety: 3 ke baad ignore band). */
  const lastSpoken = useRef<{ lines: string[]; at: number }>({ lines: [], at: 0 });
  const echoStreak = useRef(0);
  /* R62c: us train me catering/food options hain? (maujooda pantry API — read-only). null = pata nahi → food ka sawaal nahi. */
  const [foodExpected, setFoodExpected] = useState<boolean | null>(null);
  const started = useRef(false);
  const trainsHandled = useRef(false);
  const reviewHandled = useRef(false);
  const classSynced = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const push = useCallback((role: Msg["role"], text: string) => {
    if (!text.trim()) return;
    setMsgs((m) => [...m, { id: newId(), role, text }]);
  }, []);

  const speak = useCallback(
    (lines: string[]) => {
      if (!voiceOn || muted) return;
      const say = voiceLinesFor(lines, 2).join(" ");
      if (say) {
        /* R67: jo bola gaya wo yaad rakho — mic ka transcript isse match kare to echo (chhod dena). */
        lastSpoken.current = { lines: voiceLinesFor(lines, 3), at: Date.now() };
        aiBookingVoice.speak(say);
      }
    },
    [voiceOn, muted],
  );

  /* ── Action runner: side effects sirf maujooda booking flow ke through ───────────────────────── */
  const runActions = useCallback(async (actions: AiBookingAction[]) => {
    /* Is turn ke passenger patches (index → patch) — review kholne se pehle inka app-state me
     * pahunchna confirm hota hai (neeche waitForPaxPatches). */
    const expectPax = new Map<number, Partial<{ name: string; age: string; gender: string; berthPreference: string }>>();
    for (const a of actions) {
      if (a.type === "SET_PASSENGER_COUNT") {
        cb.current.setPassengerCount(a.count);
      } else if (a.type === "PATCH_PASSENGER") {
        const pax = live.current.state.passengers[a.index];
        if (pax) cb.current.updatePassenger(pax.id, a.patch as Partial<typeof pax>);
        expectPax.set(a.index, a.patch as Partial<{ name: string; age: string; gender: string; berthPreference: string }>);
      } else if (a.type === "SEARCH") {
        /* Correction ke baad nayi search — natija dobara handle karna hai. */
        trainsHandled.current = false;
        /* Journey slots maujooda booking state me rakho (wahi state baaki purane screens padhte hain). */
        cb.current.setFrom(a.from);
        cb.current.setTo(a.to);
        cb.current.setDate(a.date);
        setBusy(true);
        try {
          await cb.current.searchRoute(a.from, a.to, a.date);
        } finally {
          setBusy(false);
        }
      } else if (a.type === "REVIEW" || a.type === "OPEN_REVIEW") {
        /* R4-fix (asli bug — user: "review/IRCTC aage nahi badhta"): isi turn me upar ek
         * PATCH_PASSENGER bhi aata hai (jaise aakhri passenger ki berth). React ne abhi re-render
         * nahi kiya hota, isliye goReview purana state padh kar validatePassengers par ruk jaata tha
         * ("Please fix the passenger details.") aur review screen khulti hi nahi thi — AI ne kaha
         * "review khol rahi hoon" par kuch khulta nahi. Ab hum sirf ITNA intezaar karte hain ki is
         * turn ke patches app-state me pahunch jayein; phir wahi maujooda goReview() chalta hai
         * (koi validation bypass nahi, kuch skip nahi). */
        await waitForPaxPatches(expectPax, () =>
          live.current.state.passengers.map((p) => ({
            name: p.name,
            age: String(p.age ?? ""),
            gender: String(p.gender ?? ""),
            berthPreference: String(p.berthPreference ?? ""),
          })),
        );
        setBusy(true);
        try {
          await cb.current.goReview();
          /* Safety net: agar phir bhi review nahi khula to saaf batao (chup-chaap nahi) — kyunki
           * AI ne "review khol rahi hoon" kaha hota hai. */
          const errKey = live.current.state.error;
          if (live.current.state.screen !== "review" && errKey) {
            push(
              "ai",
              "Review nahi khul paaya — passenger form me jo field reh gayi ho (jaise kisi ka berth preference) wo bhar dijiye, phir “Review journey” dabaiye.",
            );
          }
        } finally {
          setBusy(false);
        }
      } else if (a.type === "IRCTC_HANDOFF") {
        /* Maujooda "Continue to IRCTC" button khud click — usi ka handoff + autofill layer chalta hai.
         * (Button na mile to saaf fallback line; kuch fake nahi hota.) */
        if (typeof document === "undefined") continue;
        const btn = document.getElementById("irctc-continue") as HTMLButtonElement | null;
        /* IRCTC handoff (asli button) — user ko sach batao: autofill client hua to details bhar gayi,
         * warna is browser me sirf site khul sakti hai. */
        watchHandoff();
        if (btn) {
          btn.click();
        } else {
          push("ai", "IRCTC button abhi screen par nahi hai — Review journey screen par “Continue to IRCTC” dabaiye, details wahin autofill hongi.");
        }
      } else if (a.type === "RESET") {
        cb.current.resetJourney();
        trainsHandled.current = false;
        reviewHandled.current = false;
        classSynced.current = null;
      }
    }
  }, []);

  const applyTurn = useCallback(
    async (turn: AiBookingTurn) => {
      setFlow(turn.state);
      for (const line of turn.say) push("ai", line);
      speak(turn.say);
      if (turn.actions.length) await runActions(turn.actions);
      return turn.state;
    },
    [push, runActions, speak],
  );

  /* ══ R67 — maujooda CHAT BRAIN (wahi endpoint/tools/prompts jo chat ke hain) ═══════════════════════
   * `api.agentStream` = chat ka apna raasta (progress ke saath). Yahan kuch bhi naya nahi banaya ja
   * raha — sirf usi brain ko AI Booking se call kiya ja raha hai, aur uske jawab ko maujooda flow
   * engine ke validation se guzara ja raha hai. Chat ke code/prompts/tools me koi badlaav nahi. */
  const brainTurn = useCallback(
    async (
      text: string,
      f: AiBookingState,
      quiet = false,
    ): Promise<{ reply: string | null; canonical: string | null }> => {
      if (!quiet) setBusy(true);
      const slot = f.awaiting && SLOT_TO_ASK[f.awaiting] ? SLOT_TO_ASK[f.awaiting] : null;
      try {
        const res = await api.agentStream(
          {
            text,
            lastAsked: slot,
            known: {
              from: f.from ?? null,
              to: f.to ?? null,
              date: f.date ?? null,
              passengerCount: f.pax ?? null,
            },
            context: agentCtx.current ?? undefined,
            history: msgs.slice(-8).map((m) => ({
              role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
              content: String(m.text ?? "").slice(0, 500),
            })),
            now: new Date().toISOString(),
            bookingFlow: f.stage,
          },
          (e) => {
            if (!quiet) setProgressText(e.total ? `${e.phase}… ${e.done ?? 0}/${e.total}` : `${e.phase}…`);
          },
        );
        if (res?.context) agentCtx.current = res.context as AgentContextClient;
        const reply = String(res?.reply ?? "").trim() || null;
        /* Slot: (1) jo flow abhi maang raha hai, (2) warna brain ke context/known se next missing. */
        const nlu = (res?.nlu ?? {}) as NluSlots;
        const ctx = res?.context;
        const knownFromCtx = {
          from: ctx?.origin?.code ?? null,
          to: ctx?.destination?.code ?? null,
          date: ctx?.date ?? null,
          passengerCount: ctx?.passengers ?? null,
        };
        let canonical: string | null = null;
        if (slot) canonical = canonicalFromNlu(slot, { ...nlu, ...slotFromKnown(knownFromCtx, slot, nlu) } as NluSlots);
        if (!canonical && ctx) {
          const next = !knownFromCtx.from ? "from" : !knownFromCtx.to ? "to" : !knownFromCtx.date ? "date" : !knownFromCtx.passengerCount ? "pax" : null;
          if (next) canonical = canonicalFromNlu(next, { ...nlu, ...slotFromKnown(knownFromCtx, next, nlu) } as NluSlots);
        }
        return { reply, canonical };
      } catch {
        return { reply: null, canonical: null }; /* brain fail → flow engine waisa hi (kuch toota nahi) */
      } finally {
        if (!quiet) {
          setBusy(false);
          setProgressText(null);
        }
      }
    },
    [msgs],
  );

  const handleInput = useCallback(
    async (text: string, viaVoice = false) => {
      const clean = text.trim();
      if (!clean) return;
      lastWasVoice.current = viaVoice;
      push("you", clean);
      const st = live.current.state;
      const bookingBefore = bookingKey();
      const env = {
        trains: st.trains,
        classes: st.selectedTrain?.classes ?? st.trains.find((t) => t.number === flow.trainNumber)?.classes ?? [],
        foodExpected,
      };
      let turn = aiBookingTurn(flow, clean, env);

      /* ══ R67 — AI-first (user: "edhr bhi AI first rakhein … AI ke pass sabhi existing tools ho jo
       * pehle chat mein the … AI khud query samjhe aur right tool ka use kare"). Har turn par wahi
       * maujooda chat brain (maujooda tools/prompts) chalta hai. Do raste:
       *   (a) flow engine ne kuch samjha (slot aage badha) aur ye sawaal nahi hai → booking turant
       *       aage badhti hai; brain background me chalta hai (sirf is case me jawab user ko dikhta
       *       hai jab brain ke paas flow ko aage badhane wala slot ho — warna chup rehta hai),
       *   (b) engine kuch nahi samjha ya ye sawaal hai (status/timing/fare/general) → brain ka
       *       jawab (asli tools se) user ko dikhta hai; aur brain ka slot mile to canonical jawab
       *       wahi purane engine ko diya jaata hai (validation wahi). */
      const slotAsked = flow.awaiting && SLOT_TO_ASK[flow.awaiting] ? flow.awaiting : null;
      let engineMoved = flowKey(turn.state) !== flowKey(flow);
      const ask = looksLikeQuestion(clean) || looksFactualQuery(clean);
      let brainReply: string | null = null;

      if (engineMoved && !ask) {
        /* Booking turant aage badh gayi (engine ne samajh liya) — brain sirf background me chalta hai
         * (uska jawab user ko dikhta nahi, warna do-ja jawab = confusion). Uske slot se turn DOBARA
         * nahi chalate: engine pehle hi aage nikal chuka hai, dobara chalane se wo peeche chala jaata. */
        /* Chhoti ek-token slot answers ("2", "CC", "12014") par brain ki zaroorat hi nahi — engine ne
         * samajh liya. Lambi/mili-juli baat ho to background me brain bhi sunta hai (quiet). */
        if (clean.split(/\s+/).length >= 3) void brainTurn(clean, flow, true);
      } else {
        const b = await brainTurn(clean, flow);
        brainReply = b?.reply ?? null;
        if (b?.canonical) {
          const retry = aiBookingTurn(flow, b.canonical, env);
          if (flowKey(retry.state) !== flowKey(flow)) {
            turn = retry;
            engineMoved = true;
          }
        }
      }
      let after = await applyTurn(turn);

      /* R67: brain ne jawab diya par engine ne flow aage nahi badhaya → jawab user ko (chat jaisa),
       * aur engine ki wo lines hata do jo "samajh nahi aaya / dobara bata dijiye" wali khali baatein
       * hain (sawaal rehne dete hain — booking ka agla kadam). Engine ka state bilkul waisa hi. */
      if (brainReply && !engineMoved) {
        const asked = turn.say.filter((l) => l.includes("?"));
        for (const l of asked) push("ai", l);
        push("ai", brainReply);
        speak([...asked, brainReply]);
      }

      /* Train chuni gayi → maujooda train-select (isliye asli ClassSelect screen khulti hai). */
      if (after.stage === "CLASS_SELECTION" && after.trainNumber) {
        const train = st.trains.find((t) => t.number === after.trainNumber);
        if (train && st.selectedTrain?.number !== train.number) cb.current.selectTrain(train);
      }

      /* Class chuni gayi → maujooda live availability check (selectClass). */
      if (after.stage === "CLASS_SELECTION" && after.classCode) {
        const klass = env.classes.find((c) => c.code === after.classCode);
        if (klass) {
          /* R67: selectClass apna verified class RETURN karta hai — usi ko mano (state ref par timing
           * ka bharosa nahi; pehle wahi race thi jo yahan sirf extra await se zyada dikhi). */
          const chosen = await cb.current.selectClass(klass);
          const verified = chosen ?? live.current.state.selectedClass;
          if (verified && verified.code === klass.code) {
            const train = st.selectedTrain ?? st.trains.find((t) => t.number === after.trainNumber) ?? null;
            /* Automation: class select hote hi maujooda passenger form khud khulta hai. */
            if (train) cb.current.selectTrainAndClassGo(train, verified);
            const t2 = await applyTurn(aiBookingClassSelected(after, klass, verified, { food: foodExpected === true }));
            void t2;
          }
        }
      }

      void bookingBefore;
    },
    [applyTurn, brainTurn, flow, push, speak],
  );

  /* Voice: maujooda hook (mic permission sirf user ke tap par — background listening nahi). */
  const voice = useVoiceInput(
    (text) => {
      /* R67: AI ki apni awaaz ka echo kabhi input na bane (user screenshot). Sirf bolne ke 10s ke
       * andar lagu; 3 baar lagataar ignore ho jaye to filter chhod do (kahin asli baat na ruk jaye). */
      const sp = lastSpoken.current;
      if (Date.now() - sp.at < 10000 && echoStreak.current < 3 && looksLikeEcho(text, sp.lines)) {
        echoStreak.current += 1;
        return;
      }
      echoStreak.current = 0;
      void handleInput(text, true);
    },
    (msg) => push("ai", msg),
    { manualCommit: true, greet: false },
  );

  voiceRef.current = voice;

  /* R66: voice output issue (server fail / playback block) — UI me imandaari se dikhega. */
  useEffect(() => aiBookingVoice.onIssue((i) => setVoiceIssue(i)), []);

  /* ══ R66 — ChatGPT jaisi voice conversation (turn-taking) ═══════════════════════════════════════
   * User ne mic tap se voice ON kiya → AI ka jawab bol chuka → mic khud wapas sunta hai (bola hua
   * jawab dobara bolne ke liye tap karne ki zaroorat nahi). Mic sirf tab chalta hai jab user ne khud
   * voice ON kiya ho (background listening nahi) aur "Type instead"/"End voice"/mute par loop band. */
  useEffect(() => {
    if (!voiceOn || muted || !convActive.current || !lastWasVoice.current) return;
    /* "thinking" yahan inline (busy || searching) — kyunki wo variable is effect ke neeche banta hai. */
    /* Sirf "busy" (turn chal raha hai) — flow.searching (list dikhane ka flag) loop ko rokna nahi chahiye. */
    if (voice.listening || speaking || busy) return;
    /* R67: bolna sach me khatam hone ka intezaar (app me asli signal aata hai) — warna mic apni hi
     * awaaz ka echo pakad leta tha. */
    const wait = Math.max(900, 1200 - aiBookingVoice.spokenAgoMs());
    const t = window.setTimeout(() => {
      if (!convActive.current || voiceRef.current?.listening) return;
      aiBookingVoice.stop(); /* playback poora band, phir hi sunna */
      void voiceRef.current?.start();
    }, wait);
    return () => window.clearTimeout(t);
  }, [voiceOn, muted, speaking, busy, voice.listening]);

  /* Start (pehli baar khulte hi) + provider info + "Speaking" state subscription */
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    void applyTurn(aiBookingStart(new Date()));
    void aiBookingVoice.loadProvider().then((p) => {
      setProvider(p);
      setVoiceSupport(aiBookingVoice.outputSupport());
    });
    /* Is device par output hi nahi (WebView/purana browser) → saaf batao, chup na raho. */
    window.setTimeout(() => {
      if (aiBookingVoice.outputSupport() === "none") setVoiceSupport("none");
    }, 250);
  }, [applyTurn, open]);

  useEffect(() => {
    if (!open) return;
    return aiBookingVoice.onState((st) => setSpeaking(st === "speaking"));
  }, [open]);

  /* Food ka sawaal sirf tab jab us train me options hon (maujooda pantry API se — koi guess nahi). */
  useEffect(() => {
    if (!open) return;
    const n = state.selectedTrain?.number ?? flow.trainNumber;
    if (!n) {
      setFoodExpected(null);
      return;
    }
    let alive = true;
    api
      .trainPantry(n)
      .then((p) => {
        if (alive) setFoodExpected(p?.foodChoiceExpected === true);
      })
      .catch(() => {
        if (alive) setFoodExpected(null);
      });
    return () => {
      alive = false;
    };
  }, [open, flow.trainNumber, state.selectedTrain?.number]);

  useEffect(() => {
    if (!open) return;
    /* Purane WebView/jsdom me scrollTo na ho to bhi na toote. */
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open]);

  /* Search ke asli natije (maujooda state.trains) — koi data invent nahi. */
  useEffect(() => {
    if (!open || flow.stage !== "SEARCH_TRAINS" || state.searching || busy) return;
    if (trainsHandled.current) return;
    trainsHandled.current = true;
    void applyTurn(aiBookingTrainsReady(flow, state.trains ?? []));
  }, [applyTurn, busy, flow, open, state.searching, state.trains]);

  /* Passenger form ke asli fields se next ask (form hi source of truth hai). */
  useEffect(() => {
    if (!open || flow.stage !== "PASSENGER_COLLECTION" || busy) return;
    if (!state.passengers.length) return;
    void applyTurn(aiBookingPassengersReady(flow, state.passengers, foodExpected === true));
  }, [applyTurn, busy, flow, open, state.passengers, foodExpected]);

  /* User ne maujooda ClassSelect screen par khud class tap ki → flow usi ko follow kare. */
  useEffect(() => {
    if (!open || flow.classCode || !state.selectedClass) return;
    if (flow.stage !== "CLASS_SELECTION" && flow.stage !== "SHOW_TRAIN_OPTIONS" && flow.stage !== "TRAIN_SELECTED") return;
    const klass = state.selectedClass;
    if (classSynced.current === klass.code) return;
    classSynced.current = klass.code;
    const next: AiBookingState = {
      ...flow,
      stage: "PASSENGER_COLLECTION",
      classCode: klass.code,
      trainNumber: flow.trainNumber ?? state.selectedTrain?.number ?? null,
      trainName: flow.trainName ?? state.selectedTrain?.name ?? null,
      awaiting: "paxName",
    };
    /* Maujooda flow: class chip tap (ClassSelect screen) → passenger form khud khul jaata hai. */
    if (state.selectedTrain) cb.current.selectTrainAndClassGo(state.selectedTrain, klass);
    void applyTurn(aiBookingClassSelected(next, klass, klass, { food: foodExpected === true }));
  }, [applyTurn, flow, open, state.selectedClass, state.selectedTrain]);

  /* Review screen khul gaya → IRCTC handoff line (Continue to IRCTC wahi purana card hai). */
  useEffect(() => {
    if (!open || state.screen !== "review" || reviewHandled.current) return;
    if (flow.stage !== "PASSENGER_REVIEW" && flow.stage !== "BOOKING_REVIEW" && flow.stage !== "FINAL_CONFIRMATION") return;
    reviewHandled.current = true;
    void applyTurn(aiBookingFinalPrompt(flow, state.previewFare?.total ?? null));
  }, [applyTurn, flow, open, state.screen, state.previewFare]);

  /* Voice: mic dabane par pehle bolna band, phir sunna (Android Chrome me dono ek saath nahi chalte). */
  const micTap = useCallback(async () => {
    if (voice.listening) {
      voice.commit();
      return;
    }
    /* Barge-in: AI bol rahi ho aur user mic dabaye → AI chup + turant sunna. */
    aiBookingVoice.stop();
    /* R63-fix: ye tap hi user gesture hai — isi mauke par device TTS unlock ho jaata hai
     * (Chrome/Android par pehla speak gesture ke bina chup ho jaata hai). */
    aiBookingVoice.unlock();
    setVoiceOn(true);
    setVoiceSupport(aiBookingVoice.outputSupport());
    convActive.current = true;
    lastWasVoice.current = true;
    const err = await voice.start();
    if (err) push("ai", "Mic nahi chala — aap type bhi kar sakte hain, booking wahi flow chalega.");
  }, [push, voice]);

  const selectedTrainForFlow = useMemo(() => {
    const t = state.selectedTrain;
    if (t && (!flow.trainNumber || t.number === flow.trainNumber)) return t;
    return state.trains.find((x) => x.number === flow.trainNumber) ?? null;
  }, [flow.trainNumber, state.selectedTrain, state.trains]);

  /* “AI Book” — jaise user ne kaha: train+class ke baad passenger screen, aur wahin se AI details. */
  const aiBook = useCallback(async () => {
    const st = live.current.state;
    const train = st.selectedTrain ?? st.trains.find((t) => t.number === flow.trainNumber) ?? null;
    const klass = train?.classes.find((c) => c.code === flow.classCode) ?? st.selectedClass;
    if (!train || !klass) {
      push("ai", "Pehle train aur class chuniye — phir AI Book button aayega.");
      return;
    }
    setBusy(true);
    await cb.current.selectClass(klass); /* maujooda live availability verify */
    setBusy(false);
    const verified = live.current.state.selectedClass;
    if (!verified || verified.code !== klass.code || !isBookable(verified.status)) {
      await applyTurn(aiBookingClassUnavailable(flow, klass.code));
      return;
    }
    cb.current.selectTrainAndClassGo(train, verified);
    await applyTurn({ ...aiBookingPassengerScreenOpen(flow), state: { ...flow, stage: "PASSENGER_COLLECTION", classCode: klass.code } });
  }, [applyTurn, flow, push]);

  /* R4-fix: IRCTC handoff. Detect karte hain ki autofill (app bridge/extension) ne payload utha liya
   * ya nahi — utha liya ho to IRCTC khud khul chuka hai (aur details bhar chuki hain), warna koi
   * ASLI gadget maujood nahi (sirf browser) → jhoothi umeed nahi: saaf line + ek button jise user khud
   * dabaye (asli user gesture — browser popup block/popup-gesture ki wajah se AI ke async turn se window
   * khulna bharosemand nahi hota). */
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [handoffFallback, setHandoffFallback] = useState(false);
  const handoffTimer = useRef<number | null>(null);

  /** Handoff ke thodi der baad dekho: autofill client ne payload utha liya (asli autofill) ya nahi. */
  const watchHandoff = useCallback(() => {
    handoffTimer.current = window.setTimeout(() => {
      let claimed = false;
      try {
        claimed = Boolean((window as unknown as { __railbookHandoffClaim?: { at?: number } }).__railbookHandoffClaim?.at);
      } catch {
        claimed = false;
      }
      if (claimed) {
        setHandoffNotice("IRCTC khul gaya — journey + passenger details wahan khud bhar di gayi hain. Login/OTP/payment aap hi karenge.");
        setHandoffFallback(false);
      } else {
        setHandoffNotice(
          "IRCTC continue ke liye RailBook app (ya autofill client) chahiye — is browser me details khud bharne ka rasta maujood nahi. Neeche button se IRCTC khol sakte ho (summary clipboard me hai).",
        );
        setHandoffFallback(true);
      }
    }, 1600);
  }, []);

  const openReviewAndHandoff = useCallback(async () => {
    await cb.current.goReview();
    setHandoffNotice(null);
    setHandoffFallback(false);
    watchHandoff();
  }, [watchHandoff]);

  const openHandoffNow = useCallback(() => {
    const btn = document.getElementById("irctc-continue") as HTMLButtonElement | null;
    /* Asli user gesture → maujooda IrctcHandoff ka hi rasta (duplicate logic nahi). */
    btn?.click();
    if (btn) setHandoffNotice("IRCTC khol diya — login/OTP/CAPTCHA/payment aur final booking IRCTC par aap hi karenge.");
  }, []);

  const continueBooking = useCallback(async () => {
    /* User ka explicit "haan" (click/voice/text) = confirmation → AI khud IRCTC continue karta hai. */
    const turn = aiBookingHandoffTurn(flow);
    /* Handoff = review (details bhare hue) → IRCTC, sirf explicit user confirmation par. */
    if (turn.actions.some((a) => a.type === "IRCTC_HANDOFF")) await openReviewAndHandoff();
    await applyTurn(turn);
  }, [applyTurn, flow, openReviewAndHandoff]);

  const changeDetails = useCallback(() => {
    cb.current.go("passengers");
    classSynced.current = null;
    void applyTurn(aiBookingTurn(flow, "nahi"));
  }, [applyTurn, flow]);

  if (!open) return null;

  const dock = state.screen !== "home";

  /* R67 (user: "passenger form pe mic layout sahi nahi hai"): dock fixed hai — isliye jab dock khula ho
   * to screen ke neeche utni jagah chhod do ki form ka aakhri field/CTA uske peeche na chhupe. */
  useEffect(() => {
    if (!open || !dock) return;
    document.body.classList.add("aib-docked");
    return () => document.body.classList.remove("aib-docked");
  }, [open, dock]);
  const lastAi = [...msgs].reverse().find((m) => m.role === "ai")?.text ?? "";
  const stageIndex = AI_BOOKING_STAGES.indexOf(flow.stage);
  const thinking = busy || flow.searching;
  const formOpen = state.screen === "passengers";
  const summaryLines = aiBookingSummaryLines({
    from: state.from,
    to: state.to,
    date: state.date,
    trainNumber: state.selectedTrain?.number ?? flow.trainNumber,
    trainName: state.selectedTrain?.name ?? flow.trainName,
    classCode: state.selectedClass?.code ?? flow.classCode,
    passengers: state.passengers.map((p) => ({ name: p.name, age: p.age, gender: p.gender, berthPreference: p.berthPreference, foodChoice: (p as { foodChoice?: string }).foodChoice })),
    fareTotal: state.previewFare?.total ?? null,
  });
  const showBook = Boolean(flow.classCode) && !formOpen && state.screen !== "review";
  const reviewStages = ["PASSENGER_REVIEW", "BOOKING_REVIEW", "FINAL_CONFIRMATION"];
  const showReviewCta = reviewStages.includes(flow.stage) && state.screen === "review";
  const statusLine = voice.listening ? "🎙️ Listening…" : thinking ? "⏳ Thinking…" : speaking ? "🔊 Speaking…" : lastAi;
  const vform = (
    <form
      className="aib-form"
      onSubmit={(e) => {
        e.preventDefault();
        const t = draft.trim();
        setDraft("");
        if (voice.listening) {
          voice.commit();
          return;
        }
        void handleInput(t);
      }}
    >
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={voice.listening ? "Listening… (✓ dabao bhejne ke liye)" : "Type kariye ya 🎙️ dabaiye"}
        aria-label="AI Booking me type karo"
        autoComplete="off"
      />
      <button type="button" className={`aib-mic${voice.listening ? " live" : ""}`} onClick={() => void micTap()} aria-label="🎙️ Talk to RailBook" title="🎙️ Talk to RailBook">
        {voice.listening ? "✓" : "🎙️"}
      </button>
      <button type="submit" className="aib-send" aria-label="Send">➤</button>
    </form>
  );
  const voiceControls = (
    <div className="aib-voice-actions" data-testid="aib-voice-actions">
      <button type="button" className="aib-btn-ghost" onClick={() => setMuted((m) => { const n = !m; aiBookingVoice.setMuted(n); if (n) aiBookingVoice.stop(); return n; })}>
        {muted ? "🔇 Unmute" : "🔊 Mute"}
      </button>
      <button type="button" className="aib-btn-ghost" onClick={() => aiBookingVoice.stop()}>⏹ Stop</button>
      {/* R63-fix: user khud check kar sake ki awaaz aa rahi hai ya nahi (screenshot: "voice nahi aati"). */}
      <button
        type="button"
        className="aib-btn-ghost"
        data-testid="aib-voice-test"
        onClick={() => {
          aiBookingVoice.unlock();
          setVoiceOn(true);
          setMuted(false);
          aiBookingVoice.setMuted(false);
          aiBookingVoice.speak("Namaste! Main RailBook ki AI Booking hoon. Aapki awaaz sun rahi hoon.");
          setVoiceSupport(aiBookingVoice.outputSupport());
        }}
      >
        🔊 Test voice
      </button>
      <button type="button" className="aib-btn-ghost" onClick={() => { convActive.current = false; setVoiceOn(false); aiBookingVoice.stop(); voice.cancel(); }}>⌨️ Type instead</button>
      <button type="button" className="aib-btn-ghost" onClick={() => { convActive.current = false; setVoiceOn(false); aiBookingVoice.stop(); voice.cancel(); }}>✕ End voice</button>
    </div>
  );

  /* ── Dock: maujooda screen (results / passengers / review) ke upar chhoti AI bar ─────────────── */
  if (dock) {
    return (
      <div className="aib-dock" role="region" aria-label="AI Booking">
        {/* Dock me bhi aakhri 2-3 lines dikhti hain — user ko context milta rehta hai. */}
        <div className="aib-dock-log" data-testid="aib-dock-log">
          {msgs.slice(-3).map((m) => (
            <div key={m.id} className={`aib-dock-msg ${m.role}`}>{m.text}</div>
          ))}
        </div>
        <div className="aib-dock-head">
          <b>🎫 AI Booking</b>
          <span className="aib-stage now">{AI_BOOKING_STAGE_LABELS[flow.stage]}</span>
          <span className="aib-dock-text" data-testid="aib-dock-status">
            {progressText ?? statusLine}
          </span>
          {/* R4-fix (user: "jaise pehle chat me kuch bhi poochte the — yeh bhi btayega?"): haan —
              koi bhi sawaal model ke paas jaata hai. Chhota ishara + tap par input focus. */}
          <button
            type="button"
            className="aib-btn-ghost"
            data-testid="aib-ask-anything"
            onClick={() => {
              push("ai", "Haan — kuch bhi poochhiye: “Delhi se Jaipur kal ki trains”, “3A ka fare”, “wallet balance”, ya IRCTC/booking ka koi sawaal. Main jawab deti hoon.");
              inputRef.current?.focus();
            }}
          >
            💬 Kuch bhi poochho
          </button>
          <button type="button" className="aib-btn-ghost" onClick={onClose} aria-label="AI Booking band karo">✕</button>
        </div>

        {handoffNotice && (
          <div className="aib-handoff-line" data-testid="aib-handoff-line">
            <span>{handoffNotice}</span>
            {handoffFallback && (
              <button type="button" className="aib-btn" data-testid="aib-open-irctc" onClick={openHandoffNow}>
                ➡️ Continue to IRCTC
              </button>
            )}
          </div>
        )}

        {voiceIssue && !issueDismissed && (voice.listening || thinking || voiceOn) && (
          <div className="aib-voice-issue" data-testid="aib-voice-issue">
            <span>
              {voiceIssue === "playback-blocked"
                ? "🔇 Server ki awaaz play nahi ho payi — device voice chala di. (🔊 Test voice se dobara try)"
                : voiceIssue === "server-failed"
                  ? "Server voice abhi nahi aayi — device voice chala di. Booking text waise hi chalti hai."
                  : "Is device par voice output nahi mila — text me aage badh rahi hoon."}
            </span>
            <button type="button" className="aib-btn-ghost" aria-label="Notice hatao" onClick={() => setIssueDismissed(true)}>
              ✕
            </button>
          </div>
        )}

        {/* R66: dock me bhi wahi voice panel (mute/stop/Type instead/End voice) — ChatGPT jaisi
            conversation me user ke paas har waqt control rehta hai, sirf listening ke lamhe me nahi. */}
        {(voice.listening || thinking || voiceOn) && (
          <div className={`aib-voice${voice.listening ? " live" : ""}`} data-testid="aib-voice">
            <span className="aib-voice-state">
              {voice.listening ? "🎙️ Listening…" : speaking ? "🔊 Speaking…" : muted ? "🔇 Muted" : "Voice on"}
            </span>
            <span className="aib-voice-text">{voice.interim || voice.status}</span>
            {voiceControls}
          </div>
        )}

        {showReviewCta && (
          <div className="aib-summary" data-testid="aib-summary">
            <b>Booking summary</b>
            <pre>{summaryLines.join("\n")}</pre>
            <div className="aib-actions">
              <button type="button" className="aib-btn" data-testid="aib-change" onClick={changeDetails}>Change Details</button>
              <button type="button" className="aib-primary" data-testid="aib-continue" onClick={() => void continueBooking()}>Continue Booking</button>
            </div>
          </div>
        )}

        <div className="aib-dock-row">
          {showBook && (
            <button type="button" className="aib-primary aib-book-sm" data-testid="aib-book" onClick={() => void aiBook()}>
              🎫 AI Book
            </button>
          )}
          {vform}
        </div>
      </div>
    );
  }

  /* ── Full screen: AI Booking hi primary surface hai ───────────────────────────────────────────── */
  return (
    <div className="aib" role="dialog" aria-label="AI Booking">
      <header className="aib-head">
        <div className="aib-title">
          <span className="aib-mark">🎫</span> AI Booking
          <span className="aib-stage">{AI_BOOKING_STAGE_LABELS[flow.stage]}</span>
        </div>
        <div className="aib-head-right">
          <span className="aib-provider" title="Voice provider (server keys kabhi client par nahi aati)">
            {provider?.kind === "server"
              ? `voice: ${provider.provider}`
              : voiceSupport === "app"
                ? "voice: app"
                : voiceSupport === "none"
                  ? "voice: output nahi"
                  : "voice: device"}
          </span>
          <button type="button" className="aib-btn-ghost" onClick={onClose} aria-label="AI Booking band karo">✕</button>
        </div>
      </header>

      <div className="aib-stages" aria-label="Booking steps">
        {AI_BOOKING_STAGES.map((s, i) => (
          <span key={s} className={`aib-stage-chip${i === stageIndex ? " now" : ""}${i < stageIndex ? " done" : ""}`}>
            {AI_BOOKING_STAGE_LABELS[s]}
          </span>
        ))}
      </div>

      <div className="aib-thread" ref={scroller}>
        {msgs.map((m) => (
          <div key={m.id} className={`aib-msg ${m.role}`}>{m.text}</div>
        ))}

        {/* Train options — maujooda TrainClassBlock (asli board/search data) */}
        {flow.stage === "SHOW_TRAIN_OPTIONS" && state.trains.length > 0 && (
          <div className="aib-trains" data-testid="aib-trains">
            {state.trains.slice(0, 6).map((t) => (
              <TrainClassBlock
                key={t.number}
                number={t.number}
                name={t.name}
                timeText={`${t.departure} → ${t.arrival}`}
                countText={`${t.classes.length} classes`}
                tone={t.classes.some((c) => isBookable(c.status)) ? "seat" : "nodata"}
                rows={t.classes.map<ClassChipData>((c) => ({
                  code: c.code,
                  status: c.status,
                  seats: c.seats ?? null,
                  rac: c.rac ?? null,
                  waitlist: c.waitlist ?? null,
                  fare: c.fare ?? null,
                  seat: isBookable(c.status),
                  raw: c,
                }))}
                onHead={() => void handleInput(t.number)}
                onChip={(c) => void handleInput(c.code)}
                chipTitle={(c) => `${c.code} chuno`}
              />
            ))}
          </div>
        )}

        {/* Class chips (asli classes) */}
        {flow.stage === "CLASS_SELECTION" && selectedTrainForFlow && (
          <div className="aib-classes" data-testid="aib-classes">
            {selectedTrainForFlow.classes.map((c) => (
              <button
                key={c.code}
                type="button"
                className={`aib-class${flow.classCode === c.code ? " on" : ""}`}
                onClick={() => void handleInput(c.code)}
              >
                <b>{c.code}</b>
                <span>{c.label || ""}</span>
                <em>{c.status}{c.fare ? ` · ₹${c.fare}` : ""}</em>
              </button>
            ))}
          </div>
        )}

        {flow.stage === "PASSENGER_COLLECTION" && state.screen === "home" && (
          <div className="aib-passenger-note" data-testid="aib-paxnote">
            Passenger form abhi band hai — “AI Book” dabane par khulega aur main wahin details bharoongi.
          </div>
        )}

        {showReviewCta && (
          <div className="aib-summary" data-testid="aib-summary">
            <b>Booking summary</b>
            <pre>{summaryLines.join("\n")}</pre>
          </div>
        )}
      </div>

      {voiceIssue && !issueDismissed && (voice.listening || thinking || voiceOn) && (
        <div className="aib-voice-issue" data-testid="aib-voice-issue">
          <span>
            {voiceIssue === "playback-blocked"
              ? "🔇 Server ki awaaz play nahi ho payi — device voice chala di. (🔊 Test voice se dobara try)"
              : voiceIssue === "server-failed"
                ? "Server voice abhi nahi aayi — device voice chala di. Booking text waise hi chalti hai."
                : "Is device par voice output nahi mila — text me aage badh rahi hoon."}
          </span>
          <button type="button" className="aib-btn-ghost" aria-label="Notice hatao" onClick={() => setIssueDismissed(true)}>
            ✕
          </button>
        </div>
      )}

      {(voice.listening || thinking || voiceOn) && (
        <div className={`aib-voice${voice.listening ? " live" : ""}`} data-testid="aib-voice">
          <span className="aib-voice-state">
            {voice.listening
              ? "🎙️ Listening…"
              : thinking
                ? "⏳ Thinking…"
                : speaking
                  ? "🔊 Speaking…"
                  : muted
                    ? "🔇 Muted"
                    : voiceSupport === "none"
                      ? "Voice on · is device par output nahi"
                      : "Voice on"}
          </span>
          <span className="aib-voice-text">{voice.interim || voice.status}</span>
          {voiceControls}
        </div>
      )}

      <div className="aib-actions">
        {showBook && (
          <button type="button" className="aib-primary" data-testid="aib-book" onClick={() => void aiBook()}>
            🎫 AI Book — passenger form kholo
          </button>
        )}
        {showReviewCta && (
          <>
            <button type="button" className="aib-btn" data-testid="aib-change" onClick={changeDetails}>Change Details</button>
            <button type="button" className="aib-primary" data-testid="aib-continue" onClick={() => void continueBooking()}>Continue Booking</button>
          </>
        )}
      </div>

      {vform}
    </div>
  );
}
