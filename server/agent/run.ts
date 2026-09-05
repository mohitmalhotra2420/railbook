import { runUnderstand } from "../understand/index.js";
import { understand as deterministicUnderstand, type DialogSlot, type KnownSlots, type NluResult } from "../understand/legacy-nlu.js";
import {
  GENERAL_FACT_RE,
  TRAIN_NAME_SUFFIX_RE,
  TRAIN_TYPE_KEYWORD_RE,
  bookingInProgress,
  classifyFollowUp,
  isQuestionPhraseNotTrainName,
  matchTrainNameInList,
  mentionsTrainName,
  trainNamePhrase,
  decideTool,
  emptyAgentContext,
  factReplyUnavailable,
  mergeAgentContext,
  neverAutoBook,
  resolveTrainNumber,
  type AgentContext,
  type AgentToolName,
} from "./context.js";
import { executeTool, type ToolName } from "./tools.js";
import {
  agenticConfigured,
  runAgenticTurn,
  type AgentTrainRow,
  type AgentTrainTable,
  type AgenticHistoryTurn,
  type SearchCapture,
  type ToolTraceStep,
} from "./agentic.js";
import { routedClassBoard, routedSchedule, routedStationSearch, routedTrainInfo, searchTrainsRouted } from "../railway/router.js";
import { webSearch } from "./websearch.js";
import { searchRailcoreTrainsByName } from "../railway/railcore.js";

/** Atlas analyse intents — decideTool inhe map nahi karta (model ki zimmedari hai),
 *  par agentic engine fail ho to deterministic fallback bhi inka honest answer deta hai. */
const ATLAS_PREF: Record<string, "fastest" | "cheapest" | "best"> = {
  SELECT_FASTEST: "fastest",
  SELECT_CHEAPEST: "cheapest",
  SELECT_BEST: "best",
  /* 2026-09-06: "12014 vs 12054 kon si better" — deterministic compare
   * (atlasFallback ke andar compareTrainsDeterministic). */
  COMPARE_TRAINS: "best",
};

/**
 * Deterministic Atlas fallback — SELECT_FASTEST / SELECT_CHEAPEST / SELECT_BEST.
 * Contract wahi: ya REAL provider evidence se grounded answer, ya honest
 * clarification (ambiguous city / missing slot). Kabhi guess nahi, kabhi
 * empty reply nahi (pehle yeh intents fallback mein chup ho jaate the).
 */
/* ── Deterministic train compare (2026-09-06): "12014 and 12054 mein se kon
 * si better hai" — dono ka REAL timetable lekar honest comparison. Ek ka data
 * na mile to doosre ka data + saaf batana kaunsa nahi mila (poora cancel nahi). */
async function compareTrainsDeterministic(numbers: string[]): Promise<{
  reply: string;
  ok: boolean;
  trace: ToolTraceStep;
}> {
  const uniq = numbers.filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
  const rows: {
    num: string;
    name: string;
    stops: { code: string; name: string; arrival?: string | null; departure?: string | null }[];
    durationMinutes: number | null;
    classes: string[];
  }[] = [];
  const missing: string[] = [];
  for (const num of uniq) {
    const sched = await routedSchedule(num);
    const schedule = sched.schedule;
    if (!schedule || !("stops" in schedule) || !schedule.stops?.length) {
      missing.push(num);
      continue;
    }
    const stops = schedule.stops;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const dep = first?.departure ?? first?.arrival ?? null;
    const arr = last?.arrival ?? last?.departure ?? null;
    let dur: number | null = "durationMinutes" in schedule && typeof schedule.durationMinutes === "number" ? schedule.durationMinutes : null;
    if (dur == null && dep && arr) {
      const toMin = (x: string) => {
        const m = x.match(/(\d{1,2}):(\d{2})/);
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
      };
      const a = toMin(dep);
      const b = toMin(arr);
      if (a != null && b != null) dur = b >= a ? b - a : b + 1440 - a;
    }
    rows.push({
      num,
      name: "trainName" in schedule ? String(schedule.trainName || num) : num,
      stops,
      durationMinutes: dur,
      classes: "classes" in schedule ? (schedule.classes ?? []).filter((c) => c && c !== "UNKNOWN") : [],
    });
  }
  const trace = (ok: boolean, summary: string): ToolTraceStep => ({
    step: 1,
    tool: "getTimetable",
    args: { compare: uniq.join(","), trains: rows.map((r) => r.num) },
    ok,
    source: "railcore",
    summary,
    latencyMs: 0,
  });
  if (!rows.length) {
    return {
      reply: `${uniq.join(", ")} — kisi ki bhi timetable nahi mil paayi. Main guess nahi karunga.`,
      ok: false,
      trace: trace(false, "compare: timetables unavailable"),
    };
  }
  const line = (r: (typeof rows)[number]) => {
    const first = r.stops[0];
    const last = r.stops[r.stops.length - 1];
    const dep = first?.departure ?? first?.arrival ?? "??:??";
    const arr = last?.arrival ?? last?.departure ?? "??:??";
    const durLabel =
      r.durationMinutes != null
        ? `${Math.floor(r.durationMinutes / 60)}h ${String(r.durationMinutes % 60).padStart(2, "0")}m`
        : "duration nahi pata";
    return `${r.num} ${r.name} — ${r.stops.length} stops, ${first?.code ?? "?"} ${dep} → ${last?.code ?? "?"} ${arr} (${durLabel})${r.classes.length ? `, classes ${r.classes.join("/")}` : ""}`;
  };
  let reply: string;
  if (rows.length >= 2) {
    const [a, b] = rows;
    const routeNote =
      a.stops[a.stops.length - 1]?.code !== b.stops[b.stops.length - 1]?.code
        ? ` Dhyan: route alag hai — ${a.num} ${a.stops[a.stops.length - 1]?.code} tak, ${b.num} ${b.stops[b.stops.length - 1]?.code} tak.`
        : "";
    let verdict = "Dono ka data upar hai; apni zaroorat (time/class/stops) ke hisaab se chuno.";
    if (a.durationMinutes != null && b.durationMinutes != null && a.durationMinutes !== b.durationMinutes) {
      const faster = a.durationMinutes < b.durationMinutes ? a : b;
      const slower = faster === a ? b : a;
      verdict = `Time mein ${faster.num} better hai (${Math.abs(a.durationMinutes - b.durationMinutes)} min kam)${a.stops.length !== b.stops.length ? `, ${faster.stops.length} stops vs ${slower.num} ki ${slower.stops.length}` : ""}.`;
    } else if (a.stops.length !== b.stops.length) {
      const fewer = a.stops.length < b.stops.length ? a : b;
      verdict = `Kam stops wali ${fewer.num} hai (${fewer.stops.length} stops).`;
    }
    reply = `${rows.map(line).join("\n")}${routeNote ? "\n" + routeNote.trim() : ""}\n${verdict}`;
  } else {
    reply = `${line(rows[0])}${missing.length ? `\n${missing.join(", ")} ki timetable nahi mil paayi — jo mila wo upar hai.` : ""}`;
  }
  return {
    reply,
    ok: true,
    trace: trace(true, `compare: ${rows.map((r) => r.num).join(" vs ")}${missing.length ? ` (${missing.join(",")} missing)` : ""}`),
  };
}

async function atlasFallback(
  pref: "fastest" | "cheapest" | "best",
  ctx: AgentContext,
  nlu: NluResult,
): Promise<{ reply: string; ok: boolean; trace: ToolTraceStep; grounded: boolean; trains: AgentTrainTable | null }> {
  /* 2026-09-06: "12014 vs 12054 kon si better" — deterministic compare pehle. */
  if (nlu.intent === "COMPARE_TRAINS" && (nlu.compareNumbers?.length ?? 0) >= 2) {
    const cmp = await compareTrainsDeterministic(nlu.compareNumbers!);
    return { reply: cmp.reply, ok: cmp.ok, trace: cmp.trace, grounded: true, trains: null };
  }
  const trace = (ok: boolean, source: string | null, summary: string, dataPreview?: string): ToolTraceStep => ({
    step: 1,
    tool: "JOURNEY_ANALYZE",
    args: {
      origin: ctx.origin?.code ?? nlu.unresolvedFrom ?? null,
      destination: ctx.destination?.code ?? nlu.unresolvedTo ?? null,
      date: ctx.date ?? null,
      preference: pref,
    },
    ok,
    source,
    summary,
    latencyMs: 0,
    ...(dataPreview ? { dataPreview } : {}),
  });

  /* 1) Ambiguous city → REAL station options ke saath clarification. */
  const unresolved = nlu.unresolvedTo ?? nlu.unresolvedFrom ?? null;
  if (unresolved) {
    const res = await routedStationSearch(unresolved);
    const list = res.stations.slice(0, 6).map((s, i) => `${i + 1}. ${s.code} – ${s.name}`).join(", ");
    const question = list
      ? `${res.city ?? unresolved} mein kaun sa station chahiye? Options: ${list}`
      : `"${unresolved}" ke liye exact station chahiye — station ka naam ya code bataiye.`;
    return {
      reply: question,
      ok: false,
      trace: trace(
        false,
        res.provider,
        `${unresolved} ambiguous — station clarification`,
        JSON.stringify({ needs_choice: true, city: res.city ?? unresolved }).slice(0, 400),
      ),
      grounded: true, // sirf sawaal — koi factual claim nahi
      trains: null,
    };
  }

  /* 2) Missing slots → honest ask, koi silent assumption nahi. */
  const missingAsk = !ctx.origin
    ? "Kahan se jaana hai? Departure station bataiye."
    : !ctx.destination
      ? "Kahan jaana hai? Station bataiye."
      : !ctx.date
        ? "Kis date ko jaana hai?"
        : null;
  if (missingAsk) {
    return { reply: missingAsk, ok: false, trace: trace(false, null, "slot missing — clarification"), grounded: true, trains: null };
  }

  /* 3) REAL search + bounded fare probe — numbers sirf provider evidence se. */
  const search = await searchTrainsRouted({ from: ctx.origin!.code, to: ctx.destination!.code, date: ctx.date! });
  const trains = search.trains;
  if (!trains.length) {
    return {
      reply: `${ctx.origin!.code} → ${ctx.destination!.code} (${ctx.date!}) ke liye koi train nahi mili — main andaza nahi lagaunga.`,
      ok: false,
      trace: trace(
        false,
        search.provider,
        "0 trains — honest unavailable",
        JSON.stringify({ trains: 0, provider: search.provider }).slice(0, 400),
      ),
      grounded: true, // "0 trains" claim provider evidence se hi aaya
      trains: null,
    };
  }

  // Bounded REAL fare probe (agentic journeyAnalyze jaisa): top-3 shortest
  // candidates ko ek class-board each — searched class codes hi hint, koi
  // extra schedule round-trip nahi.
  const probe = new Map<string, { fare: number; classCode: string; status: string; seats: number | null } | null>();
  await Promise.all(
    [...trains]
      .sort((a, b) => a.durationMinutes - b.durationMinutes)
      .slice(0, 3)
      .map(async (t) => {
        try {
          const board = await routedClassBoard(
            t.number,
            ctx.date!,
            ctx.origin!.code,
            ctx.destination!.code,
            "GN",
            t.classes.map((c) => c.code),
          );
          const available = board.classes.filter((c) => c.status === "AVAILABLE" && c.fare > 0);
          const usable = [...available].sort((a, b) => a.fare - b.fare)[0];
          probe.set(
            t.number,
            usable ? { fare: usable.fare, classCode: usable.code, status: usable.status, seats: usable.seats ?? null } : null,
          );
        } catch {
          probe.set(t.number, null);
        }
      }),
  );

  const fareOf = (n: string) => probe.get(n)?.fare ?? Number.MAX_SAFE_INTEGER;
  const ranked =
    pref === "fastest"
      ? [...trains].sort((a, b) => a.durationMinutes - b.durationMinutes || a.departure.localeCompare(b.departure))
      : [...trains].sort((a, b) => fareOf(a.number) - fareOf(b.number) || a.durationMinutes - b.durationMinutes);
  const train = ranked[0];
  const pr = probe.get(train.number) ?? null;
  const label = pref === "cheapest" ? "Sabse sasti train" : pref === "fastest" ? "Sabse fast train" : "Best option";
  const fareLine = pr
    ? `Cheapest available class: ${pr.classCode} ₹${pr.fare.toLocaleString("en-IN")}${pr.seats != null ? ` (${pr.seats} seats)` : ""}.`
    : `Is train ka live fare/availability abhi confirm nahi ho paya — bol do to fresh check karta hoon.`;
  const others = ranked
    .slice(1, 3)
    .map((t) => {
      const c = probe.get(t.number) ?? null;
      return `${t.number} ${t.name} (${c ? `${c.classCode} ₹${c.fare.toLocaleString("en-IN")}` : `dur. ${t.durationLabel}`})`;
    });
  // Sabse fast UPFRONT (user feedback 2026-09-05): lead train fast se different
  // ho to bhi fastest line reply mein top ke paas rahe — table mein bhi highlight hai.
  const fastestAll = [...trains].sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
  const fastestLine =
    fastestAll && fastestAll.number !== train.number
      ? `Sabse fast: ${fastestAll.number} ${fastestAll.name} (${fastestAll.durationLabel}).`
      : "";
  const reply = [
    `${label} ${ctx.origin!.code} → ${ctx.destination!.code} (${ctx.date!}): ${train.number} ${train.name} — ${train.departure} → ${train.arrival} (${train.durationLabel}).`,
    fareLine,
    fastestLine,
    others.length ? `Aur options: ${others.join("; ")}.` : "",
    `Poora comparison neeche table mein hai.`,
    `(Real ${search.provider} data — guess nahi.)`,
  ]
    .filter(Boolean)
    .join("\n");
  const fares = new Map<string, { classCode: string; amount: number } | null>(
    [...probe.entries()].map(([n, f]) => [n, f ? { classCode: f.classCode, amount: f.fare } : null]),
  );
  return {
    reply,
    ok: true,
    trains: tableFromSearch(ctx.origin!.code, ctx.destination!.code, ctx.date!, ranked.slice(0, 12), fares),
    trace: trace(
      true,
      search.provider,
      `${train.number} ${train.name} — ${train.durationLabel}${pr ? `, ${pr.classCode} ₹${pr.fare.toLocaleString("en-IN")}` : ""}`.slice(0, 300),
      JSON.stringify({
        top: train.number,
        trains: trains.length,
        provider: search.provider,
        probed: [...probe.entries()].map(([n, f]) => `${n}:${f ? f.classCode + "@" + f.fare : "null"}`),
      }).slice(0, 400),
    ),
    grounded: true,
  };
}

export type AgentRequest = {
  text: string;
  lastAsked?: DialogSlot | null;
  known?: {
    from?: { code: string; name: string; city: string } | null;
    to?: { code: string; name: string; city: string } | null;
    date?: string | null;
    passengerCount?: number | null;
  };
  context?: AgentContext;
  now?: string;
  bookingFlow?: string;
  /** Prior conversation turns — multi-turn state for the AI tool-calling layer. */
  history?: AgenticHistoryTurn[];
};

export type AgentResponse = {
  nlu: NluResult;
  source: "ai" | "nlu";
  context: AgentContext;
  tool: AgentToolName;
  toolOk: boolean | null;
  reply: string | null;
  interrupt: boolean;
  resumeAsk: DialogSlot | null;
  resumeText: string | null;
  confirmBook: false;
  missingFields: string[];
  modelUsed: string | null;
  latencyMs: number;
  failureReason: string | null;
  engine?: "agentic_tool_calling" | "deterministic";
  toolTrace?: ToolTraceStep[];
  /** Structured search results — client isse organized TABLE banata hai (2026-09-05 feedback). */
  trains?: AgentTrainTable | null;
  grounded?: boolean;
  /** Agentic turn chala par model/provider fail hua to wajah (observability; success par null). */
  agenticFailureReason?: string | null;
};

/**
 * ARCHITECTURE (AI-first tool calling):
 *
 *   USER → NVIDIA GPT-OSS-20B (understands request, SELECTS approved tools)
 *        → SERVER executes each tool call securely (keys never reach the model)
 *        → RailCore PRIMARY → RailKit FALLBACK (every result carries `source`)
 *        → tool result returned to the model → model may chain the next tool
 *        → final grounded response (numbers must exist in tool evidence)
 *
 * Koi deterministic classifier pehle se tool calls decide NAHI karta — jo
 * tool chahiye, kitne chahiye, kis order mein chahiye, yeh MODEL decide
 * karta hai (multi-step). Deterministic NLU/tool-routing sirf FALLBACK hai:
 * model missing/timeout/error/ungrounded ho tab chalta hai. Booking mutations
 * (payment/confirm/passengers) hamesha deterministic booking engine ke paas
 * rehte hain — model ke paas booking tool hai hi nahi, confirmBook kabhi true
 * nahi hota.
 */

/** Booking stages where the deterministic booking engine must own the turn. */
const BOOKING_MUTATION_STAGES = new Set([
  "PASSENGERS_PENDING",
  "FARE_REVIEW",
  "PAYMENT_PENDING",
  "BOOKING_PENDING",
  "PASSENGERS",
  "REVIEW",
  "PAYMENT",
  "CONFIRM",
]);

/** Hard booking-action phrases — never routed to the model (defense in depth). */
const BOOKING_MUTATION_TEXT =
  /\b(book\s*kar(?:\s*do)?|book\s*kardo|confirm(?:\s*karo|\s*kar\s*do|\s*kar)?|pay(?:ment)?\s*(?:kar|karo|kardo|kar\s*do)?|paise\s*(?:de|do)|payment|confirm\s*&\s*book|haan\s*book|yes\s*book|book\s*it)\b/i;

/** Station-options content detector — numbered list, "Options:" list, ya
 *  bare paren codes "(DLI, DEC, NDLS…)" — model ka format vary karta hai. */
function mentionsStationOptions(content: string | null | undefined): boolean {
  const c = String(content ?? "");
  return (
    /options?\s*:/i.test(c) ||
    /kaunse?\s+station|kaun\s*sa\s+station|kis\s+station|kis\s+delhi\s+station|station chahiye/i.test(c) ||
    /\(\s*[A-Z]{2,5}(?:\s*,\s*[A-Z]{2,5}){2,}\s*\)/.test(c)
  );
}

/** Reply khud koi sawaal pooch raha ho (station options ya koi bhi "?") to
 *  booking-resume bubble (doosra conflicting sawaal — "Kahan jaana hai?")
 *  suppress karo — ek turn mein AI ka EK hi sawaal user tak jaata hai. */
function asksStationChoice(reply: string | null | undefined): boolean {
  const r = String(reply ?? "");
  return mentionsStationOptions(r) || /\?/.test(r);
}

function isBookingMutation(req: AgentRequest): boolean {
  if (req.bookingFlow && BOOKING_MUTATION_STAGES.has(String(req.bookingFlow).toUpperCase())) return true;
  return BOOKING_MUTATION_TEXT.test(String(req.text ?? "").trim());
}

/* ── Station-choice reply resolution ────────────────────────────────
 * Jab pichhla AI turn station OPTIONS pooch raha tha ("kaunsa Delhi
 * station? 1. DLI – DELHI …") aur user sirf "4" / "NDLS" / "New Delhi"
 * bolta hai — dono engines ke liye slot pre-fill karo. Model history
 * se map na kar paye ya agentic fail ho jaye, tab bhi flow aage badhta
 * hai aur DETERMINISTIC path kabhi khali reply nahi deta. */

export type StationPick = { code: string; name: string; city: string; side: "to" | "from" } | null;

/** Words jo station pick KABHI nahi ho sakte (dates/affirmations). */
const NON_STATION_WORDS =
  /^(kal|aaj|parson|haan|nahi|na|no|yes|ok|okay|done|thik|theek|accha|acha|sahi|aur|kitne|ek|do|teen|char|paanch)$/i;

function parseNumberedOptions(content: string): { n: number; code: string; label: string }[] {
  const re = /(\d{1,2})[.)]\s*([A-Za-z]{2,5})\s*[–—-]\s*/g;
  const items: { n: number; code: string; label: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const start = re.lastIndex;
    const rest = content.slice(start);
    const next = rest.search(/\d{1,2}[.)]\s*[A-Za-z]{2,5}\s*[–—-]/);
    const label = (next >= 0 ? rest.slice(0, next) : rest.slice(0, 60)).replace(/[\n\r].*$/s, "").trim();
    items.push({ n: Number(m[1]), code: m[2].toUpperCase(), label: label.slice(0, 40) });
  }
  return items;
}

function parseCodePairs(content: string): { code: string; label: string }[] {
  return [...content.matchAll(/\b([A-Za-z]{2,5})\s*[–—-]\s*([A-Za-z][A-Za-z .'&]{1,40}?)(?=\s*,|\s*\n|$)/g)].map((m) => ({
    code: m[1].toUpperCase(),
    label: m[2].trim(),
  }));
}

/** Compact format: "(Options: DLI, DEC, DEE, NDLS, NZM, ANVT, DAZ, DE)" —
 *  model kabhi numbered list deta hai, kabhi sirf ordered comma codes. */
function parseCompactCodes(content: string): string[] {
  // "Options: DLI, DEC…" YA bare "(DLI, DEC, …)" — dono; par codes SIRF
  // uppercase aur keyword/paren zaroori (random "(CC, EC)" class-lists nahi).
  const m = content.match(/(?:[Oo]ptions?\s*[:\-]?\s*\(?|\(\s*)([A-Z]{2,5}(?:\s*,\s*[A-Z]{2,5}){1,11})/);
  if (!m) return [];
  return m[1]
    .split(/\s*,\s*/)
    .map((c) => c.toUpperCase())
    .filter((c) => /^[A-Z]{2,5}$/.test(c));
}

/** Paren-per-code format: "New Delhi (NDLS), Delhi Junction (DLI), …" —
 *  unnumbered, par ORDER se numeric pick map ho jata hai. */
function parseParenCodes(content: string): string[] {
  return [...content.matchAll(/\(([A-Z]{2,5})\)/g)].map((m) => m[1]).filter((c, i, arr) => arr.indexOf(c) === i);
}

async function verifyStationCode(code: string, label: string, side: "to" | "from", fromHistory: boolean): Promise<StationPick> {
  let apiAnswered = false;
  try {
    const res = await routedStationSearch(code);
    // "none" = koi provider jawab nahi de paya; railcore/railkit/kb = real jawab mila.
    apiAnswered = res.provider !== "none";
    const st = res.stations?.[0];
    if (st && st.code.toUpperCase() === code.toUpperCase()) {
      return { code: st.code, name: st.name, city: st.city ?? st.name, side };
    }
    if (st && res.stations.length === 1 && res.needChoice === false) {
      return { code: st.code, name: st.name, city: st.city ?? st.name, side };
    }
  } catch {
    /* network fail — history evidence fallback (neeche) */
  }
  // API UP hai aur code confirm NAHI hua → model ka invented/garbage code reject.
  // History fallback SIRF tab jab API hi answer na de sake (provider none / throw).
  if (!apiAnswered && fromHistory && /^[A-Za-z]{2,5}$/.test(code)) {
    return { code: code.toUpperCase(), name: label && label !== code.toUpperCase() ? label : code.toUpperCase(), city: label || code.toUpperCase(), side };
  }
  return null;
}

export async function resolveStationPick(
  text: string,
  history: AgenticHistoryTurn[] | undefined,
  ctx: AgentContext,
): Promise<StationPick> {
  const t = String(text ?? "").trim();
  if (!t || t.length > 40) return null;
  if (/\d{5}/.test(t)) return null; // train number
  if (NON_STATION_WORDS.test(t)) return null;
  if (/\bse\b|\bfrom\b/i.test(t)) return null; // "NDLS se ASR" jaisa direction-wala text pick nahi
  if (t.split(/\s+/).length > 4) return null; // lambi baat normal NLU handle karegi
  // Sirf tab jab exactly ek side pending ho
  const side: "to" | "from" | null = !ctx.destination && ctx.origin ? "to" : !ctx.origin && ctx.destination ? "from" : null;
  if (!side) return null;

  // History (latest-first) mein station-options waala aakhri assistant message
  let numbered: { n: number; code: string; label: string }[] = [];
  let pairs: { code: string; label: string }[] = [];
  let compact: string[] = [];
  for (const h of [...(history ?? [])].reverse()) {
    if (h.role !== "assistant" || !h.content) continue;
    const c = String(h.content);
    if (!mentionsStationOptions(c)) continue;
    numbered = parseNumberedOptions(c);
    pairs = parseCodePairs(c);
    compact = parseCompactCodes(c);
    if (compact.length < 2) compact = parseParenCodes(c); // "(NDLS), (DLI), …" ordered
    if (numbered.length >= 2 || pairs.length >= 2 || compact.length >= 2) break;
  }

  // 1) Numeric pick: "4", "option 4", "4 chuniye" — numbered list ya compact
  //    comma-list (position se) dono se map hota hai.
  const numMatch = t.match(/^(?:option\s*)?(\d{1,2})\s*(?:number|chuniye|lijiye|vala|wala)?[.!]?$/i);
  const n = Number(numMatch?.[1]);
  if (Number.isFinite(n) && n >= 1) {
    if (numbered.length && n <= numbered.length) {
      const chosen = numbered[n - 1];
      return verifyStationCode(chosen.code, chosen.label, side, true);
    }
    if (compact.length && n <= compact.length) {
      return verifyStationCode(compact[n - 1], compact[n - 1], side, true);
    }
    // "DLI – DELHI, DEC – DELHI CANTT, …" ordered pairs list — position se map.
    if (pairs.length && n <= pairs.length) {
      return verifyStationCode(pairs[n - 1].code, pairs[n - 1].label, side, true);
    }
  }
  // 2) Bare station code: "NDLS"
  if (/^[A-Za-z]{2,5}[.!]?$/.test(t)) {
    const code = t.replace(/[.!]$/, "").toUpperCase();
    const inHistory = numbered.some((o) => o.code === code) || pairs.some((o) => o.code === code) || compact.includes(code);
    return verifyStationCode(code, code, side, inHistory);
  }
  // 3) Naam jo history options se match ho: "new delhi", "nizamuddin"
  const lower = t.toLowerCase().replace(/[.!]$/, "");
  if (pairs.length) {
    const hit =
      pairs.find((o) => o.code.toLowerCase() === lower) ??
      pairs.find((o) => o.label.toLowerCase().includes(lower) || lower.includes(o.label.toLowerCase()));
    if (hit) return verifyStationCode(hit.code, hit.label, side, true);
  }
  return null;
}

/** Train NAAM se resolve (user feedback 2026-09-05: "kisi aur train ka naam
 * se poocha, vande bharat hi bata diya"). (1) pichhli search list mein se naam
 * match, (2) nahi to RailCore /trains/search API se. Ek solid match → number;
 * multiple/zero → honest clarify (galat train ka data KABHI nahi). */
/** Phrase user ke apne origin/destination station se match karti hai? ("amritsar ka
 * time" = station context, train-name search NAHI chalana). */
function phraseMatchesStation(phrase: string, ctx: AgentContext): boolean {
  if (!phrase) return true;
  const ptoks = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  for (const st of [ctx.origin, ctx.destination]) {
    if (!st) continue;
    const stoks = `${st.city} ${st.name} ${st.code}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (ptoks.length && ptoks.every((t) => stoks.includes(t))) return true;
  }
  return false;
}

async function resolveTrainByName(
  text: string,
  ctx: AgentContext,
): Promise<{ trainNumber: string; trainName: string } | { clarify: string } | null> {
  if (/\b\d{4,6}\b/.test(text)) return null; // number already diya
  const list = ctx.lastTrains ?? [];

  const listHit = list.length ? matchTrainNameInList(text, list) : null;
  if (listHit && !("ambiguous" in listHit)) {
    return { trainNumber: listHit.number, trainName: listHit.name };
  }
  if (listHit && "ambiguous" in listHit) {
    const lines = listHit.ambiguous.slice(0, 4).map((t) => `${t.number} ${t.name}`).join("; ");
    return { clarify: `Kaunsi train — ${lines}? Train number bata dijiye.` };
  }

  /* Gate (user feedback: "AI ko khud samjhna chahiye"): train-NAME jaisi phrase
   * + train-info follow-up — aur phrase koi STATION nahi (route query se bachne
   * ke liye). Keyword (shatabdi/rajdhani/…) ho to follow-up ki zaroorat nahi. */
  const hasNameKeyword = TRAIN_TYPE_KEYWORD_RE.test(text) || TRAIN_NAME_SUFFIX_RE.test(text);
  const phrase = trainNamePhrase(text) ?? "";
  /* 2026-09-06: "kon kon se stops hai" jaise follow-up question-phrases train
   * naam nahi — fuzzy search se hijack MAT ("kon kon" → KONKAN KANYA thi). */
  if (!hasNameKeyword && !/\d{4,6}/.test(text) && isQuestionPhraseNotTrainName(text)) return null;
  /* 2026-09-06 (screenshot): "vande bharat ki top speed" GENERAL-FACT sawaal
   * hai — train-number resolve karke "kaunsi?" poochna hi nahi. Fact words +
   * no number → naam-resolution skip, general-fact web path jawab dega. */
  if (GENERAL_FACT_RE.test(text) && !/\b\d{5}\b/.test(text)) return null;
  if (!hasNameKeyword) {
    const followish =
      /^(timetable|live|fare|availability|coach|train_pick)$/.test(classifyFollowUp(text) ?? "") ||
      /\btrains?\b/i.test(text);
    const phraseIsStation = phraseMatchesStation(phrase, ctx);
    if (!followish || phrase.length < 4 || phraseIsStation) return null;
  }
  if (!phrase || phrase.length < 3) return null;
  /* Phrase koi STATION to nahi? ("amritsar ka time" jaisi journey query ko
   * train-search se hijack mat karo — live station API se verify karo.) */
  try {
    const stRes = await routedStationSearch(phrase);
    const p = phrase.toLowerCase();
    const isStation = stRes.stations.some(
      (st) => st.city.toLowerCase() === p || st.name.toLowerCase().includes(p),
    );
    if (isStation) return null;
  } catch {
    /* station check fail — train search chalne do */
  }
  let results: { number: string; name: string; from: string; to: string }[] = [];
  try {
    results = await searchRailcoreTrainsByName(phrase);
  } catch {
    return null; // API fail — engine seedha jaane de (deterministic honest ask)
  }
  /* 0 results → KUCH mat karo (hijack nahi) — normal model/deterministic flow.
   * Phrase generic ho sakta hai; honest clarify sirf real train-name conflict par. */
  if (!results.length) return null;
  // Route context se relevance: user ke EXACT origin→destination direction wali
  // train pehle (up/down pair "SHANE PUNJAB" 12498/12497 mein sahi direction).
  const o = ctx.origin?.code?.toUpperCase();
  const d = ctx.destination?.code?.toUpperCase();
  const exact = o && d ? results.filter((t) => t.from === o && t.to === d) : [];
  const pool = exact.length === 1 ? exact : exact.length > 1 ? exact : results;
  if (pool.length === 1) return { trainNumber: pool[0].number, trainName: pool[0].name };
  const lines = pool.slice(0, 4).map((t) => `${t.number} ${t.name} (${t.from}→${t.to})`).join("; ");
  return { clarify: `\"${phrase}\" se ${pool.length} trains mili — kaunsi? ${lines}. Train number bata dijiye.` };
}

/** Search memory (2026-09-05 user feedback: "memory yaad nahi rehti"):
 * successful search ke baad ctx mein trains yaad rakho — agle turn par
 * "yeh wali / dusri wali / sabse fast wali" resolve ho sake, aur known
 * context model tak pahunchta rahe. */
function rememberSearch(ctx: AgentContext, table: AgentTrainTable | null | undefined): void {
  if (!table?.rows?.length) return;
  ctx.lastTrainNumbers = table.rows.map((r) => r.number);
  ctx.lastTrains = table.rows.map((r) => ({ number: r.number, name: r.name }));
  ctx.fastestTrainNumber = table.fastest;
  // Highlighted (fastest) train hi reply mein sabse prominent thi — "us wali" default wahi.
  if (!ctx.selectedTrainNumber) {
    ctx.selectedTrainNumber = table.fastest ?? table.rows[0].number ?? null;
    ctx.selectedTrainName = table.rows.find((r) => r.number === ctx.selectedTrainNumber)?.name ?? null;
  }
  ctx.bookingStage = "results";
}

/** TrainResult[] → AgentTrainTable (deterministic paths ke liye). */
function tableFromSearch(
  from: string,
  to: string,
  date: string,
  trains: { number: string; name: string; departure: string; arrival: string; arrivalDayOffset: number; durationMinutes: number; durationLabel: string; classes: { code: string }[] }[],
  fares?: Map<string, { classCode: string; amount: number } | null>,
): AgentTrainTable {
  const rows: AgentTrainRow[] = trains.map((t) => ({
    number: t.number,
    name: t.name,
    departure: t.departure,
    arrival: t.arrival,
    arrivalDayOffset: t.arrivalDayOffset,
    durationMinutes: t.durationMinutes,
    durationLabel: t.durationLabel,
    classes: t.classes.map((c) => c.code),
    fare: fares?.get(t.number) ?? null,
  }));
  const withDur = rows.filter((r) => r.durationMinutes != null);
  const fastest = withDur.length
    ? withDur.reduce((best, r) => ((r.durationMinutes ?? Infinity) < (best.durationMinutes ?? Infinity) ? r : best))
    : null;
  return { from, to, date, fastest: fastest?.number ?? null, rows };
}

function seedContext(req: AgentRequest): AgentContext {
  const base = req.context ? { ...req.context } : emptyAgentContext();
  if (req.known?.from) base.origin = req.known.from;
  if (req.known?.to) base.destination = req.known.to;
  if (req.known?.date) {
    base.date = req.known.date;
    base.dateProvided = true;
  }
  if (req.known?.passengerCount) {
    base.passengers = req.known.passengerCount;
    base.paxProvided = true;
  }
  return base;
}

function missingOf(known: KnownSlots): string[] {
  const missing: string[] = [];
  if (!known.from) missing.push("from");
  if (!known.to) missing.push("to");
  if (!known.date) missing.push("date");
  if (!known.passengerCount) missing.push("passengers");
  return missing;
}

export async function runAgent(req: AgentRequest): Promise<AgentResponse> {
  const seeded = seedContext(req);

  /* ── 1) AI-DRIVEN TOOL CALLING (primary engine) ────────────────────
   * Model request + multi-turn state dekh kar KHUD decide karta hai kaunse
   * approved tools call karne hain (multi-step chaining allowed). Sirf
   * booking mutations model tak nahi pahunchte (booking tool hai hi nahi).
   * Cheap deterministic slot-merge (no network) context compile karta hai. */
  let agenticFailureReason: string | null = null;

  /* Station-choice reply ("4" / "NDLS" / "New Delhi") — pichhle turn mein
   * station options puche gaye the to slot yahin resolve karo. Dono engines
   * (agentic known + deterministic ctx) ko milta hai; model/history-parse
   * fail ho tab bhi flow aage badhta hai. */
  let stationPick: StationPick = null;
  try {
    stationPick = await resolveStationPick(req.text, req.history, seeded);
  } catch {
    /* pick optional hai — normal flow continue */
  }
  if (stationPick) {
    if (stationPick.side === "to" && !seeded.destination) {
      seeded.destination = { code: stationPick.code, name: stationPick.name, city: stationPick.city };
    } else if (stationPick.side === "from" && !seeded.origin) {
      seeded.origin = { code: stationPick.code, name: stationPick.name, city: stationPick.city };
    }
  }

  /* Train NAAM se resolve (2026-09-05): "swarn shatabdi ka time batao" jaisi
   * queries pichhli selected train par galti se na chal jayein. Ek solid match
   * → dono engines ke liye selectedTrain set; ambiguous/zero → honest clarify
   * (model ko galat train answer karne ka mauka hi nahi). */
  let nameClarify: string | null = null;
  let nameResolvedTrain: { number: string; name: string } | null = null;
  if (!isBookingMutation(req)) {
    try {
      const resolved = await resolveTrainByName(req.text, seeded);
      if (resolved && "trainNumber" in resolved) {
        nameResolvedTrain = { number: resolved.trainNumber, name: resolved.trainName };
        seeded.selectedTrainNumber = resolved.trainNumber;
        seeded.selectedTrainName = resolved.trainName;
      } else if (resolved && "clarify" in resolved) {
        nameClarify = resolved.clarify;
      }
    } catch {
      /* optional hai — normal flow continue */
    }
  }

  if (!nameClarify && !isBookingMutation(req) && agenticConfigured()) {
    const det = deterministicUnderstand(req.text, {
      now: req.now ? new Date(req.now) : undefined,
      lastAsked: req.lastAsked ?? null,
      known: {
        from: seeded.origin,
        to: seeded.destination,
        date: seeded.date,
        passengerCount: seeded.passengers,
      },
    });
    const ctx = mergeAgentContext(seeded, det, req.text);
    const follow = classifyFollowUp(req.text);
    const trainNo = resolveTrainNumber(req.text, ctx) ?? det.trainNumber;
    if (trainNo) ctx.selectedTrainNumber = trainNo;

    const capture: SearchCapture = { table: null };
    try {
      const turn = await runAgenticTurn({
        text: req.text,
        now: req.now,
        history: req.history,
        capture,
        known: {
          origin: ctx.origin?.code ?? null,
          destination: ctx.destination?.code ?? null,
          date: ctx.date ?? det.date ?? null,
          trainNumber: trainNo ?? null,
          classCode: ctx.classCode ?? det.classCodes?.[0] ?? null,
          passengers: ctx.passengers ?? det.passengerCount ?? null,
          stationPicked: stationPick ? (stationPick.side === "to" ? "destination" : "origin") : null,
          destinationAmbiguous: !ctx.destination && det.unresolvedTo ? det.unresolvedTo : null,
        },
      });
      // Station-pick already resolve ho chuka hai (server-verified) par model
      // wahi station-options sawaal DOBARA pooch raha hai → model ka reply
      // discard, deterministic path real search ke saath jawab dega.
      const pickReasked = Boolean(stationPick && turn.reply && asksStationChoice(turn.reply));
      if (pickReasked) agenticFailureReason = "station_pick_reask";
      // Station ambiguity PENDING hai (det.unresolvedTo) par model ne koi tool
      // succeed nahi kiya aur be-jaawab "provider se nahi mil" summary de di —
      // deterministic path real station options poochega (useful reply).
      const unhelpfulNoData =
        Boolean(det.unresolvedTo) &&
        turn.steps.every((st) => !st.ok) &&
        /provider se nahi mil|gadh ke nahi bataunga|unavailable/i.test(String(turn.reply ?? ""));
      if (unhelpfulNoData) agenticFailureReason = "unhelpful_summary_with_pending_choice";
      if (turn.reply && !pickReasked && !unhelpfulNoData) {
        // Memory (2026-09-05): search hui to trains ctx mein yaad rakho.
        rememberSearch(ctx, capture.table);
        // User instruction (2026-09-05): "waise hum continue kar sakte hain"
        // jaisi proactive lines KABHI nahi — user poochhe tabhi aayengi.
        // interrupt/resume mechanism band; slot-filling sawaal reply ke andar hi aate hain.
        void neverAutoBook(det.intent, req.bookingFlow);
        return {
          nlu: det,
          source: "nlu",
          context: ctx,
          tool: null,
          toolOk: turn.ok ? true : false,
          reply: turn.reply,
          interrupt: false,
          resumeAsk: null,
          resumeText: null,
          trains: capture.table,
          confirmBook: false,
          missingFields: missingOf({
            from: det.from,
            to: det.to,
            date: det.date,
            passengerCount: det.passengerCount,
          }),
          modelUsed: turn.modelUsed,
          latencyMs: turn.latencyMs,
          failureReason: null,
          engine: "agentic_tool_calling",
          toolTrace: turn.steps,
          agenticFailureReason: turn.ok ? null : (turn.failureReason ?? null),
          grounded: turn.grounded,
        };
      }
      // Agentic chala par reply nahi bana — wajah record karo, fallback chalo.
      if (!turn.ok || !turn.reply) agenticFailureReason = turn.failureReason ?? "no_reply";
    } catch (err) {
      // Deterministic fallback chalega par wajah record hogi.
      agenticFailureReason = `throw:${err instanceof Error ? err.message : "unknown"}`;
    }
  }

  /* ── 2) DETERMINISTIC FALLBACK (existing architecture, preserved) ── */
  const understood = await runUnderstand({
    text: req.text,
    lastAsked: req.lastAsked ?? null,
    known: req.known ?? {},
    now: req.now,
  });
  const seeded2 = seedContext(req);
  /* Naam-se-resolve (upar hua) deterministic ctx par bhi apply ho — warna
   * fallback pichhli selected train (galat) ka jawab de deta tha. */
  if (nameResolvedTrain) {
    seeded2.selectedTrainNumber = nameResolvedTrain.number;
    seeded2.selectedTrainName = nameResolvedTrain.name;
  }
  /* Station-pick deterministic path mein bhi apply ho (seedContext req se
   * padta hai, pick upar resolve hua tha). */
  if (stationPick) {
    if (stationPick.side === "to" && !seeded2.destination) {
      seeded2.destination = { code: stationPick.code, name: stationPick.name, city: stationPick.city };
    } else if (stationPick.side === "from" && !seeded2.origin) {
      seeded2.origin = { code: stationPick.code, name: stationPick.name, city: stationPick.city };
    }
  }
  const ctx = mergeAgentContext(seeded2, understood.nlu, req.text);
  const follow = classifyFollowUp(req.text);
  const trainNo = resolveTrainNumber(req.text, ctx) ?? understood.nlu.trainNumber;
  if (trainNo) ctx.selectedTrainNumber = trainNo;

  let tool = decideTool(follow, ctx, understood.nlu.intent);
  /* General-fact sawaal (2026-09-06 screenshot bug 1): "12014 ki top speed"
   * par TRAIN_SCHEDULE/getTimetable chal jaata tha — user ko timetable milta
   * tha, speed ka jawab nahi. Fact-sawal par railway tool mat chalao —
   * deterministic web fallback (neeche) labeled fact jawab dega. */
  if (tool && GENERAL_FACT_RE.test(String(req.text ?? ""))) tool = null;
  ctx.lastTool = tool;

  /* Naam ambiguous/zero tha — model skip ho chuka hai; yahan honest clarify
   * hi final reply hai (koi tool call NAHI, koi galat train ka data NAHI). */
  if (nameClarify) {
    void neverAutoBook(understood.nlu.intent, req.bookingFlow);
    return {
      nlu: understood.nlu,
      source: understood.source,
      context: ctx,
      tool: null,
      toolOk: null,
      reply: nameClarify,
      interrupt: false,
      resumeAsk: null,
      resumeText: null,
      trains: null,
      confirmBook: false,
      missingFields: understood.missingFields,
      modelUsed: understood.modelUsed,
      latencyMs: understood.latencyMs,
      failureReason: understood.failureReason,
      engine: "deterministic",
      agenticFailureReason: "train_name_clarify",
      grounded: true,
    };
  }

  let reply: string | null = null;
  let toolOk: boolean | null = null;

  /* Atlas/search/booking intents ka deterministic answer — pehle yahan
   * empty reply jaata tha (SELECT_* bhi aur "amritsar se delhi jaana hai"
   * jaise SEARCH/BOOK intents bhi). Ya station clarification, ya missing-slot
   * ask, ya real search — kabhi khali nahi. */
  let atlasTrace: ToolTraceStep | null = null;
  let atlasGrounded: boolean | undefined;
  const atlasPref = ATLAS_PREF[understood.nlu.intent];
  const searchishIntent = Boolean(atlasPref) || understood.nlu.intent === "SEARCH_TRAIN" || understood.nlu.intent === "BOOK_TRAIN";
  let detTrains: AgentTrainTable | null = null;
  // tool === "searchTrains" ka deterministic executor hai hi nahi (agentic
  // engine ka tool hai) — searchish intent + complete slots par atlasFallback
  // hi real search + table + memory dega. Warna agentic timeout par EMPTY reply.
  if ((!tool || tool === "searchTrains") && searchishIntent) {
    const outcome = await atlasFallback(atlasPref ?? "best", ctx, understood.nlu);
    reply = outcome.reply;
    toolOk = outcome.ok;
    atlasTrace = outcome.trace;
    atlasGrounded = outcome.grounded;
    detTrains = outcome.trains;
    rememberSearch(ctx, detTrains);
  }

  /* Station-choice reply ("4"/"NDLS") ka deterministic answer — slot context
   * mein already filled hai. Slots complete → REAL search + grounded top
   * trains (client bhi intent-carry se TrainBoard kholta hai); missing →
   * honest agla sawaal. Kabhi khali nahi. */
  if (!tool && !reply && stationPick) {
    const other = stationPick.side === "to" ? ctx.origin : ctx.destination;
    if (other && ctx.date) {
      try {
        const search = await searchTrainsRouted({ from: ctx.origin!.code, to: ctx.destination!.code, date: ctx.date });
        const top = search.trains
          .slice(0, 3)
          .map((t) => `${t.number} ${t.name} (${t.departure}→${t.arrival})`)
          .join(", ");
        // User feedback (2026-09-05): list ke saath SABSE FAST upfront — dobara poochhna na pade.
        const withDur = search.trains.filter((t) => t.durationMinutes != null);
        const fastest = withDur.length
          ? withDur.reduce((b, t) => (t.durationMinutes < (b.durationMinutes ?? Infinity) ? t : b))
          : null;
        const fastestLine = fastest ? ` Sabse fast: ${fastest.number} ${fastest.name} (${fastest.durationLabel}).` : "";
        reply = search.trains.length
          ? `Theek hai — ${ctx.origin!.code} → ${ctx.destination!.code} (${ctx.date}): ${search.trains.length} trains mili.${fastestLine} Poori list neeche table mein hai.`
          : `${ctx.origin!.code} → ${ctx.destination!.code} (${ctx.date}) ke liye koi train nahi mili — main andaza nahi lagaunga.`;
        toolOk = search.trains.length > 0;
        detTrains = tableFromSearch(ctx.origin!.code, ctx.destination!.code, ctx.date!, search.trains.slice(0, 12));
        rememberSearch(ctx, detTrains);
        atlasTrace = {
          step: 1,
          tool: "SEARCH_TRAINS",
          args: { origin: ctx.origin!.code, destination: ctx.destination!.code, date: ctx.date },
          ok: search.trains.length > 0,
          source: search.provider,
          summary: `${search.trains.length} trains (${search.provider})`,
          latencyMs: 0,
        };
        atlasGrounded = true;
      } catch {
        reply = `Theek hai — ${other.code} → ${stationPick.code} (${ctx.date}). Trains check kar raha hoon — list turant aa rahi hai.`;
      }
    } else if (other) {
      reply = `Theek hai — ${other.code} → ${stationPick.code}. Kis date ko jaana hai?`;
    } else {
      reply = `Theek hai — ${stationPick.code} (${stationPick.name}). Kahan se jaana hai?`;
    }
  }

  /* Station choice PENDING hai (pichhla AI turn options pooch raha tha) par
   * number map nahi ho paya (model ne partial examples diye the) — honest
   * re-ask, kabhi khali/confusing nahi. */
  const lastAssistant = [...(req.history ?? [])].reverse().find((h) => h.role === "assistant")?.content;
  const stationChoicePending = Boolean(lastAssistant && mentionsStationOptions(lastAssistant));
  if (!tool && !reply && stationChoicePending && /^\d{1,2}[.!]?$/.test(String(req.text ?? "").trim())) {
    reply = "Number se station confirm nahi kar paya — station ka naam ya 4-letter code bataiye (jaise NDLS, DLI).";
  }

  if (tool === "getCoachPosition" && !trainNo) {
    reply = "Kaunsi train ki coach position? 5-digit train number boliye.";
  } else if (tool && tool !== "searchTrains") {
    const result = await executeTool(tool as ToolName, {
      query: req.text,
      origin: ctx.origin?.code,
      destination: ctx.destination?.code,
      date: ctx.date ?? undefined,
      trainNumber: trainNo,
      classCode: ctx.classCode ?? undefined,
      passengers: ctx.passengers ?? 1,
      pnr: understood.nlu.pnr,
    });
    toolOk = result.ok;
    ctx.lastToolOk = result.ok;
    reply = result.ok ? result.summary : factReplyUnavailable(follow ?? tool);
    if (result.ok && tool === "getLiveStatus") {
      reply = `${result.summary}\n(Live railway data — gadh ke nahi.)`;
    }
  } else if (follow === "live" && !trainNo) {
    reply = "Train number kya hai? 5-digit number boliye.";
  } else if (follow === "coach" && !trainNo) {
    reply = "Kaunsi train ki coach position? 5-digit train number boliye.";
  } else if (follow === "fare" && (!ctx.selectedTrainNumber || !ctx.classCode || !ctx.date || !ctx.origin || !ctx.destination)) {
    reply = "Fare ke liye train, class aur date chahiye. Jo missing hai woh batao — main figure invent nahi karunga.";
  } else if (follow === "availability" && (!ctx.selectedTrainNumber || !ctx.classCode || !ctx.date)) {
    reply = "Availability ke liye train, class aur date chahiye.";
  }

  // User instruction (2026-09-05): proactive "waise hum continue kar sakte hain"
  /* GENERAL-FACT WEB FALLBACK (user 2026-09-06: "agar data API se na mile to
   * verified sites se le aaye"): "top speed / kitni tez / kab chalu hui" jaise
   * sawaal API/KB se aate hi nahi. Model timeout par bhi jawab mile —
   * deterministic web lookup (Wikipedia/DDG), SAAPH label ke saath. */
  if (!reply && !tool && GENERAL_FACT_RE.test(String(req.text ?? ""))) {
    let factQuery = String(req.text ?? "").slice(0, 120);
    const factNum = factQuery.match(/\b(\d{5})\b/)?.[1];
    if (factNum) {
      try {
        const info = await routedTrainInfo(factNum);
        if (info.info?.trainName) factQuery = `${info.info.trainName} ${factQuery}`.slice(0, 140);
      } catch {
        /* naam nahi mila — seedha text se search */
      }
    }
    const webResults = await webSearch(factQuery, 3);
    if (webResults.length) {
      const best = webResults[0];
      reply = `Web se mila: ${best.snippet}\n(Source: ${best.title} — ${best.url})\n(Ye railway API ka live data nahi, web-search ka jawab hai.)`;
      toolOk = true;
    }
  }

  // lines KABHI nahi bhejna — resume mechanism band.
  void neverAutoBook(understood.nlu.intent, req.bookingFlow);

  return {
    nlu: understood.nlu,
    source: understood.source,
    context: ctx,
    tool,
    toolOk,
    reply,
    interrupt: false,
    resumeAsk: null,
    resumeText: null,
    trains: detTrains,
    confirmBook: false,
    missingFields: understood.missingFields,
    modelUsed: understood.modelUsed,
    latencyMs: understood.latencyMs,
    failureReason: understood.failureReason,
    engine: "deterministic",
    toolTrace: atlasTrace ? [atlasTrace] : undefined,
    agenticFailureReason,
    grounded: atlasGrounded,
  };
}
