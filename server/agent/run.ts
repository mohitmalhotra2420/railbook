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
};

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
  if (tool && tool !== "searchTrains") {
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
  };
}
