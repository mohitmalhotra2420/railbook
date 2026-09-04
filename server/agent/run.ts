import { runUnderstand } from "../understand/index.js";
import { understand as deterministicUnderstand, type DialogSlot, type KnownSlots, type NluResult } from "../understand/legacy-nlu.js";
import {
  bookingInProgress,
  classifyFollowUp,
  decideTool,
  emptyAgentContext,
  factReplyUnavailable,
  mergeAgentContext,
  neverAutoBook,
  resolveTrainNumber,
  resumeBookingLine,
  type AgentContext,
  type AgentToolName,
} from "./context.js";
import { executeTool, type ToolName } from "./tools.js";
import { agenticConfigured, runAgenticTurn, type AgenticHistoryTurn, type ToolTraceStep } from "./agentic.js";
import { routedClassBoard, routedStationSearch, searchTrainsRouted } from "../railway/router.js";

/** Atlas analyse intents — decideTool inhe map nahi karta (model ki zimmedari hai),
 *  par agentic engine fail ho to deterministic fallback bhi inka honest answer deta hai. */
const ATLAS_PREF: Record<string, "fastest" | "cheapest" | "best"> = {
  SELECT_FASTEST: "fastest",
  SELECT_CHEAPEST: "cheapest",
  SELECT_BEST: "best",
};

/**
 * Deterministic Atlas fallback — SELECT_FASTEST / SELECT_CHEAPEST / SELECT_BEST.
 * Contract wahi: ya REAL provider evidence se grounded answer, ya honest
 * clarification (ambiguous city / missing slot). Kabhi guess nahi, kabhi
 * empty reply nahi (pehle yeh intents fallback mein chup ho jaate the).
 */
async function atlasFallback(
  pref: "fastest" | "cheapest" | "best",
  ctx: AgentContext,
  nlu: NluResult,
): Promise<{ reply: string; ok: boolean; trace: ToolTraceStep; grounded: boolean }> {
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
    const list = res.stations.slice(0, 6).map((s) => `${s.code} – ${s.name}`).join(", ");
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
    return { reply: missingAsk, ok: false, trace: trace(false, null, "slot missing — clarification"), grounded: true };
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
  const reply = [
    `${label} ${ctx.origin!.code} → ${ctx.destination!.code} (${ctx.date!}): ${train.number} ${train.name} — ${train.departure} → ${train.arrival} (${train.durationLabel}).`,
    fareLine,
    others.length ? `Aur options: ${others.join("; ")}.` : "",
    `(Real ${search.provider} data — guess nahi.)`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    reply,
    ok: true,
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

function isBookingMutation(req: AgentRequest): boolean {
  if (req.bookingFlow && BOOKING_MUTATION_STAGES.has(String(req.bookingFlow).toUpperCase())) return true;
  return BOOKING_MUTATION_TEXT.test(String(req.text ?? "").trim());
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
  if (!isBookingMutation(req) && agenticConfigured()) {
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

    try {
      const turn = await runAgenticTurn({
        text: req.text,
        now: req.now,
        history: req.history,
        known: {
          origin: ctx.origin?.code ?? null,
          destination: ctx.destination?.code ?? null,
          date: ctx.date ?? det.date ?? null,
          trainNumber: trainNo ?? null,
          classCode: ctx.classCode ?? det.classCodes?.[0] ?? null,
          passengers: ctx.passengers ?? det.passengerCount ?? null,
        },
      });
      if (turn.reply) {
        const interrupt = bookingInProgress(ctx) && follow !== "more_trains" && follow !== "train_pick";
        if (interrupt) ctx.bookingStage = "paused";
        const resume = interrupt ? resumeBookingLine({ ...ctx, bookingStage: "collecting" }) : null;
        void neverAutoBook(det.intent, req.bookingFlow);
        return {
          nlu: det,
          source: "nlu",
          context: ctx,
          tool: null,
          toolOk: turn.ok ? true : false,
          reply: turn.reply,
          interrupt,
          resumeAsk: resume?.ask ?? null,
          resumeText: resume?.text ?? null,
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
  const ctx = mergeAgentContext(seeded2, understood.nlu, req.text);
  const follow = classifyFollowUp(req.text);
  const trainNo = resolveTrainNumber(req.text, ctx) ?? understood.nlu.trainNumber;
  if (trainNo) ctx.selectedTrainNumber = trainNo;

  const tool = decideTool(follow, ctx, understood.nlu.intent);
  ctx.lastTool = tool;

  let reply: string | null = null;
  let toolOk: boolean | null = null;

  /* Atlas intents ka deterministic answer — pehle yahan empty reply jaata tha. */
  let atlasTrace: ToolTraceStep | null = null;
  let atlasGrounded: boolean | undefined;
  const atlasPref = ATLAS_PREF[understood.nlu.intent];
  if (!tool && atlasPref) {
    const outcome = await atlasFallback(atlasPref, ctx, understood.nlu);
    reply = outcome.reply;
    toolOk = outcome.ok;
    atlasTrace = outcome.trace;
    atlasGrounded = outcome.grounded;
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

  const interrupt = Boolean(reply) && bookingInProgress(ctx) && follow !== "more_trains" && follow !== "train_pick";
  if (interrupt) ctx.bookingStage = "paused";
  const resume = interrupt ? resumeBookingLine({ ...ctx, bookingStage: "collecting" }) : null;

  void neverAutoBook(understood.nlu.intent, req.bookingFlow);

  return {
    nlu: understood.nlu,
    source: understood.source,
    context: ctx,
    tool,
    toolOk,
    reply,
    interrupt,
    resumeAsk: resume?.ask ?? null,
    resumeText: resume?.text ?? null,
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
