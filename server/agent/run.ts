import { runUnderstand } from "../understand/index.js";
import type { DialogSlot } from "../understand/legacy-nlu.js";
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
import { agenticConfigured, runAgenticTurn, type ToolTraceStep } from "./agentic.js";

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
};

export type AgentResponse = {
  nlu: Awaited<ReturnType<typeof runUnderstand>>["nlu"];
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

/** Fact/journey sawaal → AI-driven tool calling; booking flow deterministic rehta hai. */
const AGENTIC_INTENTS = new Set([
  "LIVE_TRAIN_STATUS",
  "TRAIN_SCHEDULE",
  "CHECK_FARE",
  "CHECK_AVAILABILITY",
  "CHECK_PNR",
  "CANCELLED_TRAINS",
  "COMPARE_TRAINS",
]);
const AGENTIC_FOLLOWS = new Set(["live", "timetable", "fare", "availability", "cancelled", "pnr"]);
const JOURNEY_PHRASE =
  /\b(sabse\s*(?:tez|fast|sasti|sasta|pehle)|fastest|cheapest|earliest|best\s*(?:value|train|option)|compare|tulna|alternative(?:\s*dates?)?|vikalp|connecting|via\s+\w+|route\s*(?:optimis|suggest))/i;

function agenticEligible(
  follow: ReturnType<typeof classifyFollowUp>,
  intent: string | null | undefined,
  text: string,
  bookingInProg: boolean,
): boolean {
  if (!agenticConfigured()) return false;
  const journeyHit = JOURNEY_PHRASE.test(text);
  // Journey/optimisation questions sirf tab jab booking pick-flow active na ho.
  if (journeyHit && !bookingInProg) return true;
  if (follow && AGENTIC_FOLLOWS.has(follow)) return true;
  if (intent && AGENTIC_INTENTS.has(intent)) return true;
  return false;
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

export async function runAgent(req: AgentRequest): Promise<AgentResponse> {
  const understood = await runUnderstand({
    text: req.text,
    lastAsked: req.lastAsked ?? null,
    known: req.known ?? {},
    now: req.now,
  });
  const seeded = seedContext(req);
  const ctx = mergeAgentContext(seeded, understood.nlu, req.text);
  const follow = classifyFollowUp(req.text);
  const trainNo = resolveTrainNumber(req.text, ctx) ?? understood.nlu.trainNumber;
  if (trainNo) ctx.selectedTrainNumber = trainNo;

  const tool = decideTool(follow, ctx, understood.nlu.intent);
  ctx.lastTool = tool;

  let reply: string | null = null;
  let toolOk: boolean | null = null;
  let engine: "agentic_tool_calling" | "deterministic" = "deterministic";
  let toolTrace: ToolTraceStep[] | undefined;
  let grounded: boolean | undefined;
  let agenticFailureReason: string | null = null;

  // ── AI-driven multi-step tool calling (facts + Atlas/journey) ──
  // "Slots" (origin/destination/date) ka hona booking-flow NAHI hai — agentic layer
  // unhe khud use karti hai. Sirf STRUCTURED booking stage hijack se bachti hai.
  // Sirf GENUINE pick-flow hijack se bachta hai: train list have hai jisme se user
  // "sabse tez wali" bol raha hai, ya pick ho chuka. Khali collecting-stage (fresh
  // journey query) agentic layer ko jaati hai — slots waise bhi ctx mein hain.
  const inProg =
    Boolean(ctx.selectedTrainNumber) ||
    (ctx.bookingStage === "collecting" && ctx.lastTrainNumbers.length > 0);
  if (agenticEligible(follow, understood.nlu.intent, req.text, inProg)) {
    try {
      const turn = await runAgenticTurn({
        text: req.text,
        now: req.now,
        known: {
          origin: ctx.origin?.code ?? null,
          destination: ctx.destination?.code ?? null,
          date: ctx.date ?? understood.nlu.date ?? null,
          trainNumber: trainNo ?? null,
        },
      });
      if (turn.reply) {
        reply = turn.reply;
        toolOk = turn.ok ? true : false;
        engine = "agentic_tool_calling";
        toolTrace = turn.steps;
        grounded = turn.grounded;
      }
      if (!turn.ok || !turn.reply) agenticFailureReason = turn.failureReason ?? "no_reply";
    } catch (err) {
      // Ab chup nahi rahenge — deterministic fallback chalega par wajah record hogi.
      agenticFailureReason = `throw:${err instanceof Error ? err.message : "unknown"}`;
    }
  }

  // NOTE: agentic jawab mil chuka ho to koi deterministic guard use overwrite NAHI karta.
  if (tool === "getCoachPosition" && !trainNo && reply == null) {
    reply = "Kaunsi train ki coach position? 5-digit train number boliye.";
  } else if (tool && tool !== "searchTrains" && reply == null) {
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
  } else if (follow === "live" && !trainNo && reply == null) {
    reply = "Train number kya hai? 5-digit number boliye.";
  } else if (follow === "coach" && !trainNo && reply == null) {
    reply = "Kaunsi train ki coach position? 5-digit train number boliye.";
  } else if (follow === "fare" && reply == null && (!ctx.selectedTrainNumber || !ctx.classCode || !ctx.date || !ctx.origin || !ctx.destination)) {
    reply = "Fare ke liye train, class aur date chahiye. Jo missing hai woh batao — main figure invent nahi karunga.";
  } else if (follow === "availability" && reply == null && (!ctx.selectedTrainNumber || !ctx.classCode || !ctx.date)) {
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
    engine,
    toolTrace,
    agenticFailureReason,
    grounded,
  };
}
