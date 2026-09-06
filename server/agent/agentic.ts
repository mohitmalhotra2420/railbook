/**
 * AI-driven tool calling (Atlas/Journey intelligence layer).
 *
 * NVIDIA GPT-OSS-20B decides WHICH approved tools to call and with what
 * arguments; the server executes them securely (provider keys never leave
 * the server) and feeds results back so the model can chain multiple steps.
 *
 * Hard rules enforced here:
 *  - Allowlist: only the 10 approved tools; anything else is rejected.
 *  - No arbitrary URLs / no raw fetch by the model — ever.
 *  - RailCore primary -> RailKit fallback routing stays server-side
 *    (reuses the existing router) and every tool result carries `source`.
 *  - Grounded answers only: the final reply's numbers must exist in tool
 *    results, otherwise the reply is replaced with deterministic summaries.
 */
import { z } from "zod";
import { env } from "../env.js";
import { getProvider } from "../providers/index.js";
import { todayYmd } from "../util.js";
import {
  routedCoachPosition,
  routedCancelled,
  routedClassBoard,
  routedLiveStatus,
  routedPnr,
  routedSchedule,
  routedStationSearch,
  routedTrainInfo,
  getLastRailwayLog,
  searchTrainsRouted,
} from "../railway/router.js";
import { webSourceLabel } from "../railway/webscrape.js";
import { parseDatePhrase } from "../understand/legacy-dates.js";
import { RailKitProvider } from "../railway/railkit.js";
import type { ClassCode } from "../providers/types.js";
import { executeTool } from "./tools.js";
import {
  GENERAL_FACT_RE, isQuestionPhraseNotTrainName, segmentOfStops } from "./context.js";
import { searchRailcoreTrainsByName } from "../railway/railcore.js";
import { webSearch } from "./websearch.js";
import { stationBoard, trainHistory } from "../railway/railkit.js";

export type AgenticToolName =
  | "WEB_SEARCH"
  | "SEARCH_TRAINS"
  | "TRAIN_NAME_SEARCH"
  | "SEARCH_STATIONS"
  | "GET_COACH_POSITION"
  | "GET_STATION_BOARD"
  | "GET_TRAIN_HISTORY"
  | "GET_TRAIN_INFO"
  | "GET_TIMETABLE"
  | "TRACK_TRAIN"
  | "CHECK_AVAILABILITY"
  | "GET_FARE"
  | "CHECK_PNR"
  | "GET_CANCELLED_TRAINS"
  | "GENERAL_RAILWAY_ANSWER"
  | "JOURNEY_ANALYZE";

const APPROVED: readonly AgenticToolName[] = [
  "WEB_SEARCH",
  "SEARCH_TRAINS",
  "TRAIN_NAME_SEARCH",
  "SEARCH_STATIONS",
  "GET_COACH_POSITION",
  "GET_STATION_BOARD",
  "GET_TRAIN_HISTORY",
  "GET_TRAIN_INFO",
  "GET_TIMETABLE",
  "TRACK_TRAIN",
  "CHECK_AVAILABILITY",
  "GET_FARE",
  "CHECK_PNR",
  "GET_CANCELLED_TRAINS",
  "GENERAL_RAILWAY_ANSWER",
  "JOURNEY_ANALYZE",
];

export type ToolTraceStep = {
  step: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  source: string | null;
  summary: string;
  latencyMs: number;
  /** Redacted JSON preview of the tool result data (evidence trail, max ~400 chars). */
  dataPreview?: string;
};

export type AgenticTurn = {
  ok: boolean;
  reply: string | null;
  grounded: boolean;
  steps: ToolTraceStep[];
  modelUsed: string | null;
  latencyMs: number;
  failureReason: string | null;
};

/* ── Structured train table (user feedback 2026-09-05: chat-text list
 * instead of an organized table) — search tools ka structured output,
 * response ke saath client tak jaata hai aur wahan proper <table> banta hai. */
export type AgentTrainRow = {
  number: string;
  name: string;
  departure: string;
  arrival: string;
  arrivalDayOffset: number;
  durationMinutes: number | null;
  durationLabel: string | null;
  classes: string[];
  fare?: { classCode: string; amount: number } | null;
};

export type AgentTrainTable = {
  from: string;
  to: string;
  date: string;
  fastest: string | null;
  rows: AgentTrainRow[];
};

export type SearchCapture = { table: AgentTrainTable | null };

/* ── Injectable NVIDIA fetch (tests) ─────────────────────────────── */

let nvidiaFetchImpl: typeof fetch | null = null;

export function setAgenticNvidiaFetch(fn: typeof fetch | null): void {
  nvidiaFetchImpl = fn ?? null;
}

function fetchImpl(): typeof fetch {
  return nvidiaFetchImpl ?? globalThis.fetch.bind(globalThis);
}

/* ── Tool schemas (the model only sees these) ────────────────────── */

const StationRef = z.string().trim().min(2).max(40);
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ArgSchemas = {
  WEB_SEARCH: z.object({ query: z.string().trim().min(2).max(120) }),
  TRAIN_NAME_SEARCH: z.object({ query: z.string().trim().min(2).max(60) }),
  SEARCH_STATIONS: z.object({ query: z.string().trim().min(2).max(40) }),
  GET_COACH_POSITION: z.object({
    train_number: z.string().regex(/^\d{4,6}$/),
    station: z.string().trim().min(2).max(20).nullish(),
  }),
  GET_STATION_BOARD: z.object({
    station_code: z.string().trim().min(2).max(10),
    hours: z.number().int().min(2).max(8).nullish(),
  }),
  GET_TRAIN_HISTORY: z.object({
    train_number: z.string().regex(/^\d{4,6}$/),
    date: Ymd,
  }),
  SEARCH_TRAINS: z.object({
    origin: StationRef,
    destination: StationRef,
    date: Ymd,
  }),
  GET_TRAIN_INFO: z.object({ train_number: z.string().regex(/^\d{4,6}$/) }),
  GET_TIMETABLE: z.object({
    train_number: z.string().regex(/^\d{4,6}$/),
    origin: z.string().trim().min(2).max(20).nullish(),
    destination: z.string().trim().min(2).max(20).nullish(),
  }),
  TRACK_TRAIN: z.object({ train_number: z.string().regex(/^\d{4,6}$/), date: Ymd.nullish() }),
  CHECK_AVAILABILITY: z.object({
    train_number: z.string().regex(/^\d{4,6}$/),
    date: Ymd.nullish(),
    origin: StationRef.nullish(),
    destination: StationRef.nullish(),
    class_code: z.string().regex(/^[A-Z0-9]{1,3}$/).nullish(),
    quota: z.string().regex(/^[A-Z]{2}$/).nullish(),
  }),
  GET_FARE: z.object({
    train_number: z.string().regex(/^\d{4,6}$/),
    date: Ymd.nullish(),
    origin: StationRef.nullish(),
    destination: StationRef.nullish(),
    class_code: z.string().regex(/^[A-Z0-9]{1,3}$/),
    passengers: z.number().int().min(1).max(6).nullish(),
  }),
  CHECK_PNR: z.object({ pnr: z.string().regex(/^\d{10}$/) }),
  GET_CANCELLED_TRAINS: z.object({}),
  GENERAL_RAILWAY_ANSWER: z.object({
    topic: z.enum([
      "tatkal",
      "rac",
      "waitlist",
      "cancellation",
      "refund",
      "id_proof",
      "upgrade",
      "senior_citizen",
      "child_fare",
      "live_tracking",
    ]),
  }),
  JOURNEY_ANALYZE: z.object({
    origin: StationRef,
    destination: StationRef,
    date: Ymd,
    preference: z.enum(["fastest", "cheapest", "earliest", "earliest_arrival", "best_value"]),
    include_alternative_dates: z.boolean().nullish(),
    include_connections: z.boolean().nullish(),
    max_fare_inr: z.number().int().min(1).max(100000).nullish(),
    preferred_class: z.string().regex(/^[A-Z0-9]{1,3}$/).nullish(),
    depart_after: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
    depart_before: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish(),
  }),
} as const;

/* ── OpenAI-style tools spec (what the model is told about) ──────── */

export const AGENTIC_TOOLS = [
  {
    type: "function",
    function: {
      name: "WEB_SEARCH",
      description:
        "LAST-RESORT web lookup (Wikipedia + DuckDuckGo) — SIRF tab use karo jab (a) railway tools/KB se jawab na mile, ya (b) sawaal GENERAL/current railway info ka ho jo live API/KB mein nahi hota (train services ka background, railway history, naye trains ka news, aise rules jo KB mein nahi). Results ko 'web search se mila' kehkar do — live time/fare/seats/availability/booking par web data KABHI use mat karo. Ek reply mein max 1 call.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Search query (train/railway topic)" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "TRAIN_NAME_SEARCH",
      description:
        "Train ka NAAM se number resolve karo (jaise 'swarn shatabdi', 'saryu yamuna express', 'vande bharat'). Real railway API se matching trains laata hai: number, naam, source→destination. Jab user kisi train ka naam le kar pooche aur known context mein trainNumber nahi hai (ya naam alag train ka lag raha hai) to PEHLE yeh call karo, phir jo poocha uska data doosre tool se lao.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "User ne bola train naam/phrase jaise 'swarn shatabdi'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "SEARCH_STATIONS",
      description: "City/station naam se official railway station codes search karo (jaise 'Delhi' → NDLS, DLI, NZM...). Station options dikhane ke liye.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "City ya station naam" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_COACH_POSITION",
      description: "Train ka coach layout/position (engine se coach kram). Station de to us station ke hisaab se.",
      parameters: {
        type: "object",
        properties: {
          train_number: { type: "string", description: "5-digit train number" },
          station: { type: "string", description: "Station code (optional)" },
        },
        required: ["train_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_STATION_BOARD",
      description: "Kisi station par agle kuch ghante mein aane/jaane wali trains (live board).",
      parameters: {
        type: "object",
        properties: {
          station_code: { type: "string", description: "Station code jaise ASR" },
          hours: { type: "number", description: "Window ghante mein (2/4/8, default 2)" },
        },
        required: ["station_code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_TRAIN_HISTORY",
      description: "Train ka PIChhla/completed run (diya gaya date) — actual arrival/departure aur delay per station. 'Kal ki train late thi?' jaise sawaalon ke liye.",
      parameters: {
        type: "object",
        properties: {
          train_number: { type: "string", description: "5-digit train number" },
          date: { type: "string", description: "Run date YYYY-MM-DD (aaj nahi — pichhla din)" },
        },
        required: ["train_number", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "SEARCH_TRAINS",
      description: "Station codes/names + YYYY-MM-DD date ke saath direct trains search karo.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Origin station code (ASR) ya naam (Amritsar). Code sirf known context ya pichle tool result se lo — guess mat karo." },
          destination: { type: "string", description: "Destination: city NAAM (jaise Delhi) best hai ya known rail code (NDLS). Airport-style codes galat hain — DEL DENDULURU hai, Delhi nahi." },
          date: { type: "string", description: "Journey date YYYY-MM-DD" },
        },
        required: ["origin", "destination", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_TRAIN_INFO",
      description: "Ek train ka naam/running days info.",
      parameters: {
        type: "object",
        properties: { train_number: { type: "string", description: "5-digit train number" } },
        required: ["train_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_TIMETABLE",
      description: "Train ka poora timetable (stops, arrival/departure, duration).",
      parameters: {
        type: "object",
        properties: { train_number: { type: "string" } },
        required: ["train_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "TRACK_TRAIN",
      description: "Live running status (position, delay). Date optional (default aaj).",
      parameters: {
        type: "object",
        properties: { train_number: { type: "string" }, date: { type: "string" } },
        required: ["train_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "CHECK_AVAILABILITY",
      description: "Ek train ki seat availability. class_code chhodo to saari classes. Route/date optional hai — na do to server timetable se route aur aaj ki date khud use karta hai.",
      parameters: {
        type: "object",
        properties: {
          train_number: { type: "string" },
          date: { type: "string" },
          origin: { type: "string" },
          destination: { type: "string" },
          class_code: { type: "string", description: "CC/3A/SL... optional" },
          quota: { type: "string", description: "GN default" },
        },
        required: ["train_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_FARE",
      description: "Ek train + class ka ticket fare (service fee ke saath total). Route/date optional hai — na do to server timetable se route aur aaj ki date khud use karta hai.",
      parameters: {
        type: "object",
        properties: {
          train_number: { type: "string" },
          date: { type: "string" },
          origin: { type: "string" },
          destination: { type: "string" },
          class_code: { type: "string" },
          passengers: { type: "number" },
        },
        required: ["train_number", "class_code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "CHECK_PNR",
      description: "10-digit PNR ka status.",
      parameters: {
        type: "object",
        properties: { pnr: { type: "string" } },
        required: ["pnr"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "GET_CANCELLED_TRAINS",
      description: "Aaj ki fully/partially cancelled trains list.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "GENERAL_RAILWAY_ANSWER",
      description: "Railway rules/terms ka verified answer (tatkal, rac, waitlist, cancellation...).",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: ["tatkal", "rac", "waitlist", "cancellation", "refund", "id_proof", "upgrade", "senior_citizen", "child_fare", "live_tracking"],
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "JOURNEY_ANALYZE",
      description:
        "Atlas engine: fastest/cheapest/earliest/best_value train rank + optional alternative dates aur connecting routes. Filters: max_fare_inr (budget cap), preferred_class (jaise CC/3A), depart_after/depart_before (HH:MM window). Comparison/optimisation sawaalon ke liye yeh use karo. Origin/destination mein city NAAM (Delhi) ya known rail code (NDLS) do — airport codes mat bhejo (DEL DENDULURU hai, Delhi nahi).",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string" },
          destination: { type: "string" },
          date: { type: "string" },
          preference: { type: "string", enum: ["fastest", "cheapest", "earliest", "earliest_arrival", "best_value"] },
          include_alternative_dates: { type: "boolean" },
          include_connections: { type: "boolean" },
          max_fare_inr: { type: "integer" },
          preferred_class: { type: "string" },
          depart_after: { type: "string" },
          depart_before: { type: "string" },
        },
        required: ["origin", "destination", "date", "preference"],
      },
    },
  },
] as const;

/**
 * Train-specific fare/availability ke liye missing route/date DETERMINISTIC resolve:
 * route na mile to timetable ke first/last stop, date na ho to aaj (IST).
 * Model ko kabhi route/date invent nahi karni padti — server bharata hai, label ke saath.
 */
async function resolveTrainRouteDate(a: {
  train_number: string;
  date?: string;
  origin?: string;
  destination?: string;
}): Promise<{ origin?: string; destination?: string; date: string; autoRoute: boolean; autoDate: boolean }> {
  let origin = (a.origin ?? "").trim().toUpperCase() || undefined;
  let destination = (a.destination ?? "").trim().toUpperCase() || undefined;
  const autoDate = !a.date;
  const date = a.date ?? todayYmd();
  const autoRoute = !origin || !destination;
  if (origin && !/^[A-Z0-9]{2,5}$/.test(origin)) {
    const r = await resolveStationRef(origin);
    if ("code" in r) origin = r.code;
  }
  if (destination && !/^[A-Z0-9]{2,5}$/.test(destination)) {
    const r = await resolveStationRef(destination);
    if ("code" in r) destination = r.code;
  }
  if (!origin || !destination) {
    try {
      const sched = await routedSchedule(a.train_number);
      const stops = sched.schedule?.stops ?? [];
      if (stops.length >= 2) {
        origin = origin ?? stops[0].code;
        destination = destination ?? stops[stops.length - 1].code;
      }
    } catch {
      /* route resolve nahi hua — provider wali error honest aayegi */
    }
  }
  return { origin, destination, date, autoRoute, autoDate };
}

/* ── Secure execution (server-side only; keys never leave) ───────── */

export type ApprovedToolResult = {
  ok: boolean;
  source: string | null;
  summary: string;
  data: unknown;
  rejected?: string;
  /** Post-zod arguments that were ACTUALLY executed (trace shows these, not raw model JSON). */
  executedArgs?: Record<string, unknown>;
};

function providerOf(): string | null {
  return getLastRailwayLog()?.railwayProvider ?? null;
}

type ResolvedStn = { code: string } | { candidates: { code: string; name: string }[]; city: string } | { error: string };

async function resolveStationRef(raw: string): Promise<ResolvedStn> {
  const s = raw.trim();
  if (!s) return { error: "Station khaali hai." };
  if (/^[A-Z0-9]{2,5}$/.test(s)) return { code: s.toUpperCase() };
  const res = await routedStationSearch(s);
  if (res.needChoice && res.stations.length > 1) {
    return {
      candidates: res.stations.slice(0, 8).map((x) => ({ code: x.code, name: x.name })),
      city: res.city || s,
    };
  }
  if (res.stations.length) return { code: res.stations[0].code };
  return { error: `"${s}" station lookup mein nahi mila — invent nahi karunga.` };
}

/** Station code ka OFFICIAL naam (station API se) — code-mixups (DEL≠Delhi) pakadne ke liye. */
async function stationNameOf(code: string): Promise<string | null> {
  try {
    const re = await routedStationSearch(code);
    return re.stations.find((st) => st.code.toUpperCase() === code.toUpperCase())?.name ?? null;
  } catch {
    return null;
  }
}

function okResult(source: string | null, summary: string, data: unknown): ApprovedToolResult {
  return { ok: true, source, summary, data };
}

function failResult(source: string | null, summary: string, data: unknown = null): ApprovedToolResult {
  return { ok: false, source, summary, data };
}

/** Compile-checked hub list for connection itineraries (Atlas route optimisation). */
const CONNECTION_HUBS = ["NDLS", "UMB", "LJN", "CNB"] as const;

async function journeyAnalyze(args: {
  origin: string;
  destination: string;
  date: string;
  preference: "fastest" | "cheapest" | "earliest" | "earliest_arrival" | "best_value";
  include_alternative_dates?: boolean;
  include_connections?: boolean;
  max_fare_inr?: number;
  preferred_class?: string;
  depart_after?: string;
  depart_before?: string;
}): Promise<ApprovedToolResult> {
  const fromRes = await resolveStationRef(args.origin);
  if ("error" in fromRes) return failResult(null, fromRes.error);
  if ("candidates" in fromRes) {
    return failResult(null, `${fromRes.city} ambiguous hai — pehle user se station poochna hoga.`, {
      needs_choice: true,
      city: fromRes.city,
      stations: fromRes.candidates,
    });
  }
  const toRes = await resolveStationRef(args.destination);
  if ("error" in toRes) return failResult(null, toRes.error);
  if ("candidates" in toRes) {
    return failResult(null, `${toRes.city} ambiguous hai — pehle user se station poochna hoga.`, {
      needs_choice: true,
      city: toRes.city,
      stations: toRes.candidates,
    });
  }
  const from = fromRes.code;
  const to = toRes.code;

  const search = await searchTrainsRouted({ from, to, date: args.date });
  let direct = search.trains;
  const providers = { search: search.provider };

  // RailCore 200+empty de de (coverage gap, jaise kuch intermediate pairs) aur RailKit
  // configured ho to ek RailKit attempt — fake data nahi, dusra provider.
  if (!direct.length && search.provider === "railcore" && env.railkitApiKey) {
    try {
      const kitTrains = await new RailKitProvider().searchTrains({ from, to, date: args.date });
      if (kitTrains.length) {
        direct = kitTrains;
        providers.search = "railkit_fallback";
      }
    } catch {
      /* railkit fail — honest empty jaari */
    }
  }

  // Khali search + code-jaisa station input = shayad galat code (jaise DEL airport code).
  // Code ko station API se re-verify karo; alag stations mile to needs_choice — chup-chaap
  // "0 trains" jhooth nahi bolna.
  if (!direct.length && search.provider !== "none") {
    for (const [rawInput, resolved] of [
      [args.origin, from],
      [args.destination, to],
    ] as const) {
      if (resolved && new RegExp(`^${resolved}$`, "i").test(String(rawInput ?? ""))) {
        try {
          const re = await routedStationSearch(String(rawInput));
          const rows = re.stations ?? [];
          if (rows.length && !rows.some((st) => st.code.toUpperCase() === resolved.toUpperCase())) {
            return failResult(search.provider, `${rawInput} koi railway station code nahi nikla — in options mein se chuno.`, {
              needs_choice: true,
              city: String(rawInput),
              stations: rows.slice(0, 8).map((x) => ({ code: x.code, name: x.name })),
            });
          }
        } catch {
          /* re-verify fail — normal empty-answer flow */
        }
      }
    }
  }

  // Dono providers fail (provider="none") ho to "0 trains" bolaana jhooth hai — saaf unavailable bolo.
  if (!direct.length && search.provider === "none") {
    return failResult(null, "Railway data source unavailable — RailCore/RailKit dono se jawab nahi mila, kuch invent nahi karunga.", {
      unavailable: true,
      query: { from, to, date: args.date },
      providers,
    });
  }

  const slim = direct.map((t) => ({
    number: t.number,
    name: t.name,
    departure: t.departure,
    arrival: t.arrival,
    arrivalDayOffset: t.arrivalDayOffset,
    durationMinutes: t.durationMinutes,
    classes: t.classes.map((c) => c.code),
  }));

  type SlimTrain = (typeof slim)[number] & {
    cheapest?: { fare: number; classCode: string; status: string; seats: number | null } | null;
  };
  let working: SlimTrain[] = [...slim];
  const filterNotes: string[] = [];

  // Deterministic departure-window filter (user-requested constraint, no guessing).
  if (args.depart_after || args.depart_before) {
    const afterMin = args.depart_after ? minutesOf(args.depart_after) : null;
    const beforeMin = args.depart_before ? minutesOf(args.depart_before) : null;
    const before0 = working.length;
    working = working.filter((t) => {
      const m = minutesOf(t.departure);
      if (m == null) return false;
      if (afterMin != null && beforeMin != null) {
        // Wrap-around window (jaise 22:00-02:00) intentional: after OR before.
        return afterMin <= beforeMin ? m >= afterMin && m <= beforeMin : m >= afterMin || m <= beforeMin;
      }
      if (afterMin != null) return m >= afterMin;
      return m <= (beforeMin as number);
    });
    if (working.length < before0 || before0 === 0) filterNotes.push(`window ${args.depart_after ?? "00:00"}-${args.depart_before ?? "23:59"}`);
  }

  const pc = args.preferred_class ?? null;
  if (pc) filterNotes.push(`preferred class ${pc}`);
  const cap = args.max_fare_inr ?? null;
  if (cap != null) filterNotes.push(`max fare ₹${cap}`);

  // Bounded fare probe: cheapest/best_value preferences ya fare-cap/class filters par.
  let fareProbeNote: string | null = null;
  const needProbe = Boolean(working.length) && (args.preference === "cheapest" || args.preference === "best_value" || pc || cap != null);
  let ranked: SlimTrain[] = [...working];
  if (needProbe) {
    // Bounded: top-3 candidates by duration get one class-board each.
    const candidates = [...working].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9)).slice(0, 3);
    const fares = new Map<string, { fare: number; classCode: string; status: string; seats: number | null } | null>();
    await Promise.all(
      candidates.map(async (t) => {
        try {
          const board = await routedClassBoard(t.number, args.date, from, to, "GN");
          const available = board.classes.filter((c) => c.status === "AVAILABLE" && c.fare > 0);
          const preferred = pc ? available.find((c) => c.code === pc) : undefined;
          const usable = preferred ?? available.sort((a, b) => a.fare - b.fare)[0];
          fares.set(
            t.number,
            usable ? { fare: usable.fare, classCode: usable.code, status: usable.status, seats: usable.seats ?? null } : null,
          );
        } catch {
          fares.set(t.number, null);
        }
      }),
    );
    working = working.map((t) => ({ ...t, cheapest: fares.get(t.number) ?? null }));
    const knownFares = working.filter((t) => t.cheapest);
    if (knownFares.length) {
      if (args.preference === "cheapest" || args.preference === "best_value" || cap != null) {
        ranked = [...working].sort((a, b) => {
          const fa = a.cheapest?.fare ?? Number.MAX_SAFE_INTEGER;
          const fb = b.cheapest?.fare ?? Number.MAX_SAFE_INTEGER;
          return fa - fb || (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9);
        });
      }
    } else {
      fareProbeNote = "Fare/availability provider se nahi aayi — cheapest/fare-cap abhi verify nahi ho sakta.";
    }
  }
  if (args.preference === "fastest" && !cap) {
    ranked = [...working].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9));
  } else if (args.preference === "fastest" && cap) {
    // cap ke saath: pehle fare sort hua, phir duration tie-break — deterministic rehta hai.
    ranked = [...ranked].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9));
  } else if (args.preference === "earliest") {
    ranked = [...(needProbe && fareProbeNote ? working : ranked)].sort((a, b) => a.departure.localeCompare(b.departure));
  } else if (args.preference === "earliest_arrival") {
    ranked = [...(needProbe && fareProbeNote ? working : ranked)].sort((a, b) => {
      const aArr = (a.arrivalDayOffset || 0) * 1440 + (minutesOf(a.arrival) ?? 9e9);
      const bArr = (b.arrivalDayOffset || 0) * 1440 + (minutesOf(b.arrival) ?? 9e9);
      return aArr - bArr;
    });
  }

  // Preferred class: deterministic stable partition — class waale trains pehle.
  // Search results mein classes kabhi-kabhi missing hoti hain (RailKit mapping);
  // fare-probe ka VERIFIED classCode (cheapest.classCode) bhi partition evidence hai.
  if (pc) {
    const hasPc = (t: (typeof ranked)[number]) => t.classes.includes(pc as never) || t.cheapest?.classCode === pc;
    const withPc = ranked.filter(hasPc);
    const withoutPc = ranked.filter((t) => !hasPc(t));
    ranked = [...withPc, ...withoutPc];
  }

  // Deterministic fare cap — sirf VERIFIED fares par; bina fare ke train drop (note ke saath).
  let capExcluded = 0;
  if (cap != null) {
    const beforeCap = ranked.length;
    ranked = ranked.filter((t) => t.cheapest != null && t.cheapest.fare <= cap);
    capExcluded = beforeCap - ranked.length;
    if (!ranked.length) {
      return okResult("engine", `Atlas: ${beforeCap} candidates mile, par koi bhi max_fare ₹${cap} ke andar VERIFIED nahi hua (fares missing/unavailable).`, {
        query: { from, to, date: args.date, preference: args.preference },
        direct: { count: working.length, best: null, ranked: [] },
        filters: { notes: filterNotes, max_fare_inr: cap, cap_excluded_unknown_or_over: capExcluded, fare_probe_ok: !fareProbeNote },
        fare_note: fareProbeNote,
        providers,
      });
    }
  }

  const best = ranked[0]
    ? {
        number: ranked[0].number,
        name: ranked[0].name,
        departure: ranked[0].departure,
        arrival: ranked[0].arrival,
        durationMinutes: ranked[0].durationMinutes,
        classes: ranked[0].classes,
        cheapest:
          "cheapest" in ranked[0] && ranked[0].cheapest
            ? (ranked[0] as { cheapest: { fare: number; classCode: string } }).cheapest
            : null,
        why:
          args.preference === "fastest"
            ? "sabse kam duration"
            : args.preference === "cheapest"
              ? "sabse kam verified fare"
              : args.preference === "earliest"
                ? "sabse pehle departure"
                : args.preference === "earliest_arrival"
                  ? "sabse pehle arrival"
                  : "duration-fare balance",
      }
    : null;

  // Alternative dates (bounded: ±1 and +2, search-only — no per-train fan-out).
  let alternatives: { date: string; count: number; fastest: { number: string; durationMinutes: number } | null; provider_failed?: boolean }[] | undefined;
  if (args.include_alternative_dates) {
    const base = args.date.split("-").map(Number);
    const shift = (days: number) => {
      const d = new Date(base[0], base[1] - 1, base[2] + days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const altDates = [shift(-1), shift(1), shift(2)].filter((d) => d >= todayYmd());
    alternatives = await Promise.all(
      altDates.map(async (d) => {
        const alt = await searchTrainsRouted({ from, to, date: d });
        const fastest = [...alt.trains].sort((a, b) => (a.durationMinutes || 9e9) - (b.durationMinutes || 9e9))[0];
        return {
          date: d,
          count: alt.trains.length,
          fastest: fastest ? { number: fastest.number, durationMinutes: fastest.durationMinutes } : null,
          ...(alt.provider === "none" ? { provider_failed: true } : {}),
        };
      }),
    );
  }

  // Connecting journeys: only when thin direct list or explicitly requested (bounded: 2 hubs).
  let connections: { via: string; legs: { train: string; from: string; to: string; departure: string; arrival: string; durationMinutes: number }[]; totalDurationMinutes: number; waitMinutes: number }[] | undefined;
  if (args.include_connections || direct.length <= 1) {
    const options: NonNullable<typeof connections> = [];
    for (const hub of CONNECTION_HUBS.slice(0, 2)) {
      if (hub === from || hub === to) continue;
      try {
        const [legA, legB] = await Promise.all([
          getProvider().searchTrains({ from, to: hub, date: args.date }),
          getProvider().searchTrains({ from: hub, to, date: args.date }),
        ]);
        for (const a of legA.slice(0, 3)) {
          for (const b of legB.slice(0, 4)) {
            const arrMin = (a.arrivalDayOffset || 0) * 1440 + (minutesOf(a.arrival) ?? 9e9);
            const depMin = minutesOf(b.departure) ?? 9e9;
            if (!Number.isFinite(arrMin) || !Number.isFinite(depMin) || arrMin >= 9e9 || depMin >= 9e9) continue;
            const wait = depMin - arrMin;
            if (wait < 45 || wait > 360) continue;
            const total = (a.durationMinutes || 0) + wait + (b.durationMinutes || 0);
            options.push({
              via: hub,
              legs: [
                { train: `${a.number} ${a.name}`, from, to: hub, departure: a.departure, arrival: a.arrival, durationMinutes: a.durationMinutes },
                { train: `${b.number} ${b.name}`, from: hub, to, departure: b.departure, arrival: b.arrival, durationMinutes: b.durationMinutes },
              ],
              totalDurationMinutes: total,
              waitMinutes: wait,
            });
          }
        }
      } catch {
        /* hub pair fail — skip, never invent */
      }
      if (options.length >= 4) break;
    }
    options.sort((x, y) => x.totalDurationMinutes - y.totalDurationMinutes);
    connections = options.slice(0, 3);
  }

  // 0 direct trains hone par resolved station NAMES bhi bhejo taaki model
  // code-mixup pakde (DEL = DENDULURU hai, Delhi nahi) aur city naam se retry kare.
  // Connections/alternatives ki computation pehle normal flow mein hoti rehti hai.
  let resolvedStations: { from: string; from_name: string | null; to: string; to_name: string | null } | undefined;
  let emptyNote = "";
  if (!direct.length) {
    const [fromName, toName] = await Promise.all([stationNameOf(from), stationNameOf(to)]);
    resolvedStations = { from, from_name: fromName, to, to_name: toName };
    emptyNote = ` Resolved stations: ${from} = ${fromName ?? "unknown"}, ${to} = ${toName ?? "unknown"}. Code galat lag raha hai to CITY NAAM se dobara try karo (jaise "Delhi") — railway codes misleading ho sakte hain (jaise DEL DENDULURU hai, Delhi nahi).`;
  }

  return okResult("engine", `Atlas analysis: ${direct.length} direct trains, preference=${args.preference}.${filterNotes.length ? ` filters: ${filterNotes.join(", ")}.` : ""}${emptyNote}`, {
    query: { from, to, date: args.date, preference: args.preference },
    resolved_stations: resolvedStations,
    direct: { count: direct.length, best, ranked: ranked.slice(0, 5) },
    filters: filterNotes.length
      ? { notes: filterNotes, ...(cap != null ? { max_fare_inr: cap, cap_excluded_unknown_or_over: capExcluded, fare_probe_ok: !fareProbeNote } : {}) }
      : undefined,
    fare_note: fareProbeNote,
    alternatives,
    connections,
    providers,
  });
}

function minutesOf(hhmm: string): number | null {
  const m = String(hhmm ?? "").match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Static, long-stable railway rules — factual grounding for general questions. */
const RAILWAY_KB: Record<string, string> = {
  tatkal: "Tatkal booking journey date se 1 din pehle 10:00 AM (AC classes) / 11:00 AM (non-AC) khulti hai, limited quota, premium charges ke saath. Tatkal mein refund rules strict hote hain.",
  rac: "RAC (Reservation Against Cancellation) ka matlab: seat share hoti hai, jaise khaali seat milti hai to full confirm. RAC ticket se sleeper coach mein do passengers ek seat share karte hain.",
  waitlist: "Waitlist (WL) ticket tab hota hai jab RAC bhi full ho. Chart banne tak WL number ghata confirm/RAC ho sakta hai; na ho to ticket cancel ho jaata hai aur refund milta hai.",
  cancellation: "IRCTC cancellation charges (long-standing): 48 ghante se pehle flat clerk charge — AC classes mein ₹200 (1A/2A/3A/CC/EC/3E), sleeper/2S mein ₹60. 48-12 ghante ke beech fare ka 25% + clerk charge; 12 ghante ke andar (AC) 50% + clerk. Tatkal mostly non-refundable.",
  refund: "Confirm ticket cancel karne par refund cancellation charges kat ke milta hai. Waitlist/autopurge par charges kam hote hain. Ticket scheme se online cancel 4 ghante pehle (non-AC) / chart se 30 min pehle tak hota hai.",
  id_proof: "E-ticket ke during journey mein kisi ek passenger ke liye original photo ID (Aadhaar/PAN/passport/DL voter ID) zaroori hoti hai; na hone par sab tickets treat-as-without-ticket.",
  upgrade: "Free upgrade scheme: booking time 'consider for auto-upgrade' opt-in par confirmed passengers same class mein higher class mein upgrade ho sakte hain jab seat uplabdh ho. Upgrade par ek hi jagah baithte hain, fare difference nahi dena hota.",
  senior_citizen: "Purush 60+ / mahila 58+ ke liye senior citizen concession opt-in hota hai (lower berth + partial fare concession) — abhi limited classes mein available, booking form mein choose karna padta hai.",
  child_fare: "5 saal se kam umra ke bachche ka ticket FREE (alag seat/berth nahi). 5-11 saal ke bachche full fare ya child fare option ke saath seat mil sakti hai (child fare berth ke saath).",
  live_tracking: "Live tracking provider (RailCore/RailKit) ke real feed se aata hai — position, delay aur last updated station. Data na ho to hum saaf mana kar dete hain, andaza nahi lagate.",
};

export async function executeApprovedTool(
  name: string,
  rawArgs: Record<string, unknown>,
): Promise<ApprovedToolResult> {
  if (!APPROVED.includes(name as AgenticToolName)) {
    return {
      ok: false,
      source: null,
      summary: `Tool "${name}" approved list mein nahi hai. Sirf approved tools use karo.`,
      data: null,
      rejected: "not_in_allowlist",
    };
  }
  // Paranoia: URLs in args are never executed anywhere — strip early.
  for (const [k, v] of Object.entries(rawArgs)) {
    if (typeof v === "string" && /https?:\/\//i.test(v)) {
      return { ok: false, source: null, summary: `Args mein URL allowed nahi (${k}).`, data: null, rejected: "url_in_args" };
    }
  }

  const schema = ArgSchemas[name as AgenticToolName];
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      ok: false,
      source: null,
      summary: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ")}.`,
      data: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      rejected: "invalid_args",
    };
  }
  const a = parsed.data as Record<string, unknown> & Record<string, never>;
  // GPT-OSS jaise models optional params par explicit null bhejte hain —
  // nullish schema accept karta hai; execution se pehle null == absent.
  for (const k of Object.keys(a)) {
    if (a[k] == null) delete a[k];
  }

  try {
    switch (name as AgenticToolName) {
      case "WEB_SEARCH": {
        const q = String(a.query ?? "").trim();
        if (!q) return failResult("web", "Search query khaali hai.");
        const results = await webSearch(q, 4);
        if (!results.length) {
          return failResult("web", `"${q}" par web se bhi kuch nahi mila — invent nahi karunga.`);
        }
        return okResult(
          "web",
          `Web search "${q}": ${results.length} results (Wikipedia/DDG — UNVERIFIED, live railway data nahi).`,
          {
            query: q,
            count: results.length,
            results,
            note: "Ye WEB-sourced hai (Wikipedia/DuckDuckGo) — railway API ka live data NAHI. Reply mein 'web se mila' bolo; time/fare/seats/booking ke liye use mat karo.",
          },
        );
      }
      case "TRAIN_NAME_SEARCH": {
        const q0 = String(a.query ?? "").trim();
        /* 2026-09-06: "kon kon se stops hai" jaise FOLLOW-UP question-words ko
         * train naam mat samjho (model ne 'kon kon' se KONKAN KANYA dhoondh li
         * thi). Solid naam bachta hai to hi search karo. */
        if (!/\d{4,6}/.test(q0) && isQuestionPhraseNotTrainName(q0)) {
          return failResult("railcore", `"${q0}" train ka naam nahi lagta — ye follow-up/question phrase hai. Pichhli baat ki train ka data use karo (history/context mein hai).`);
        }
        const results = await searchRailcoreTrainsByName(a.query as string);
        if (!results.length) {
          return failResult("railcore", `"${a.query}" naam se koi train nahi mili — train number (5-digit) maango.`);
        }
        return okResult(
          "railcore",
          `"${a.query}": ${results.length} trains mili.`,
          { query: a.query, count: results.length, trains: results.slice(0, 10) },
        );
      }
      case "SEARCH_STATIONS": {
        const res = await routedStationSearch(a.query as string);
        if (!res.stations.length) {
          return failResult(res.provider, `"${a.query}" se koi station nahi mila.`);
        }
        return okResult(
          res.provider,
          `${res.city ?? a.query}: ${res.stations.length} stations mile.`,
          { query: a.query, city: res.city ?? null, stations: res.stations.slice(0, 10) },
        );
      }
      case "GET_COACH_POSITION": {
        const res = await routedCoachPosition(a.train_number as string, (a.station as string | undefined) ?? undefined);
        const cp = res.coachPosition;
        if (!cp) return failResult(res.provider, "Coach position abhi provider se nahi aayi — main fake layout nahi bataunga.");
        const coaches = Array.isArray(cp.coaches) ? cp.coaches : [];
        return okResult(
          res.provider,
          `${a.train_number}: ${coaches.length} coaches (engine se): ${coaches.map((c: { name: string }) => c.name).join(", ")}.${webSourceLabel(res.provider)}`,
          { trainNumber: a.train_number, stationCode: cp.stationCode ?? null, coaches },
        );
      }
      case "GET_STATION_BOARD": {
        const board = await stationBoard(String(a.station_code as string).toUpperCase(), typeof a.hours === "number" ? a.hours : 2);
        if (!board) return failResult(null, "Station board abhi available nahi hai.");
        const rows = Array.isArray(board.trains) ? board.trains.slice(0, 12) : [];
        return okResult(
          null,
          `${a.station_code}: ${board.total ?? rows.length} trains (${board.summary ?? "agle ghante"}).`,
          { station: a.station_code, total: board.total ?? rows.length, summary: board.summary, trains: rows },
        );
      }
      case "GET_TRAIN_HISTORY": {
        const history = await trainHistory(a.train_number as string, a.date as string);
        if (!history) return failResult(null, "Is date ka completed run nahi mila — main yesterday ka live invent nahi karunga.");
        const stops = Array.isArray(history.stops) ? history.stops.slice(0, 20) : [];
        return okResult(
          "railkit",
          `${history.trainNumber} ${history.trainName} (${history.date}) — ${stops.length} stops ka completed run.`,
          { trainNumber: history.trainNumber, trainName: history.trainName, date: history.date, stops },
        );
      }
      case "SEARCH_TRAINS": {
        const fromRes = await resolveStationRef(a.origin as string);
        if ("error" in fromRes) return failResult(null, fromRes.error);
        if ("candidates" in fromRes) {
          return failResult(null, `${fromRes.candidates[0] && fromRes.city} — origin ambiguous, user se poochna hoga.`, {
            needs_choice: true,
            city: fromRes.city,
            stations: fromRes.candidates,
          });
        }
        const toRes = await resolveStationRef(a.destination as string);
        if ("error" in toRes) return failResult(null, toRes.error);
        if ("candidates" in toRes) {
          return failResult(null, `${toRes.city} — destination ambiguous, user se poochna hoga.`, {
            needs_choice: true,
            city: toRes.city,
            stations: toRes.candidates,
          });
        }
        const search = await searchTrainsRouted({
          from: fromRes.code,
          to: toRes.code,
          date: a.date as string,
        });
        const trains = search.trains;
        if (!trains.length && search.provider === "none") {
          return failResult(null, "Railway data source unavailable — RailCore/RailKit dono se jawab nahi mila, kuch invent nahi karunga.", {
            unavailable: true,
            query: { from: fromRes.code, to: toRes.code, date: a.date },
          });
        }
        if (!trains.length && search.provider !== "none") {
          // 0 trains par provider healthy: resolved station NAMES surface karo
          // taaki model apna code-mixup khud pakde (DEL = DENDULURU, Delhi nahi).
          const [fromName, toName] = await Promise.all([stationNameOf(fromRes.code), stationNameOf(toRes.code)]);
          return okResult(
            search.provider,
            `${fromRes.code}→${toRes.code} (${a.date}): koi direct train nahi mili. Resolved stations: ${fromRes.code} = ${fromName ?? "unknown"}, ${toRes.code} = ${toName ?? "unknown"}. Code galat lag raha hai to CITY NAAM se dobara search karo (jaise "Delhi") — railway codes misleading ho sakte hain (jaise DEL DENDULURU hai, Delhi nahi).`,
            {
              from: fromRes.code,
              to: toRes.code,
              from_name: fromName,
              to_name: toName,
              date: a.date,
              count: 0,
              trains: [],
            },
          );
        }
        // User feedback (2026-09-05): train list dete waqt SABSE FAST train usi
        // summary mein batao — user ko dobara poochna na pade. Duration ke hisaab se.
        const withDur = trains.filter((t) => t.durationMinutes != null);
        const fastest = withDur.length
          ? withDur.reduce((best, t) => ((t.durationMinutes ?? Infinity) < (best.durationMinutes ?? Infinity) ? t : best))
          : null;
        const durLabel = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
        const fastestLine = fastest
          ? ` Sabse fast: ${fastest.number} ${fastest.name} (${fastest.durationLabel ?? durLabel(fastest.durationMinutes ?? 0)}).`
          : "";
        return okResult(
          search.provider,
          trains.length
            ? `${fromRes.code}→${toRes.code} (${a.date}): ${trains.length} trains.${fastestLine}`
            : `${fromRes.code}→${toRes.code} (${a.date}): koi train nahi mili.`,
          {
            from: fromRes.code,
            to: toRes.code,
            date: a.date,
            count: trains.length,
            trains: trains.slice(0, 12).map((t) => ({
              number: t.number,
              name: t.name,
              departure: t.departure,
              arrival: t.arrival,
              arrivalDayOffset: t.arrivalDayOffset,
              durationMinutes: t.durationMinutes,
              durationLabel: t.durationLabel,
              classes: t.classes.map((c) => c.code),
            })),
          },
        );
      }
      case "GET_TRAIN_INFO": {
        const res = await routedTrainInfo(a.train_number as string);
        return res.info
          ? okResult(res.provider, `${res.info.trainNumber} ${res.info.trainName}.${webSourceLabel(res.provider)}`, res.info)
          : failResult(res.provider, "Train info nahi mili.");
      }
      case "GET_TIMETABLE": {
        const res = await routedSchedule(a.train_number as string);
        if (!res.schedule) return failResult(res.provider, "Timetable nahi mili.");
        const stops = "stops" in res.schedule ? res.schedule.stops ?? [] : [];
        const name = "trainName" in res.schedule ? res.schedule.trainName : "";
        const totalDur = "durationMinutes" in res.schedule ? (res.schedule as { durationMinutes: number | null }).durationMinutes ?? null : null;
        // User feedback (2026-09-05): "kitne time leti hai" par poora-route
        // duration bol raha tha — user ke origin→destination SEGMENT duration do.
        let seg: ReturnType<typeof segmentOfStops> = null;
        const segFrom = (a.origin as string | undefined) ?? null;
        const segTo = (a.destination as string | undefined) ?? null;
        if (segFrom && segTo) {
          const fromRes = await resolveStationRef(segFrom);
          const toRes = await resolveStationRef(segTo);
          if (!("error" in fromRes) && !("candidates" in fromRes) && !("error" in toRes) && !("candidates" in toRes)) {
            seg = segmentOfStops(stops, fromRes.code, toRes.code);
          }
        }
        const segLine = seg ? `, ${seg.from}→${seg.to} ${seg.departure}→${seg.arrival} (${seg.durationLabel})` : "";
        // Web-scrape fallback (2026-09-06): verified-site data — label saaf.
        const webLine = webSourceLabel(res.provider);
        return okResult(
          res.provider,
          `${a.train_number} ${name} — ${stops.length} stops${segLine}.${webLine}`,
          {
            trainNumber: a.train_number,
            trainName: name,
            stops,
            segment: seg,
            totalRouteDurationMinutes: totalDur,
          },
        );
      }
      case "TRACK_TRAIN": {
        const res = await routedLiveStatus(a.train_number as string, a.date as string | undefined);
        if (!res.live) return failResult(res.provider, "Live status unavailable — main fake position nahi bataunga.");
        const live = res.live as {
          trainNumber?: string;
          trainName?: string;
          status?: string;
          currentStation?: string | null;
          nextStation?: string | null;
          delayMinutes?: number | null;
          lastUpdatedAt?: string | null;
        };
        return okResult(res.provider, `${live.trainNumber ?? a.train_number} — ${live.status ?? "unknown"}${live.currentStation ? `, last ${live.currentStation}` : ""}${live.delayMinutes != null ? `, delay ${live.delayMinutes}m` : ""}.`, live);
      }
      case "CHECK_AVAILABILITY": {
        const ctx = await resolveTrainRouteDate(a as unknown as { train_number: string; date?: string; origin?: string; destination?: string });
        if (!ctx.origin || !ctx.destination) {
          return failResult(null, `Availability ke liye route chahiye (origin/destination) aur timetable se route resolve nahi hua — user se poochho.`);
        }
        const code = (a.class_code as string | undefined)?.toUpperCase() as ClassCode | undefined;
        if (!code) {
          const board = await routedClassBoard(
            a.train_number as string,
            ctx.date,
            ctx.origin,
            ctx.destination,
            (a.quota as string | undefined) ?? "GN",
          );
          if (!board.classes.length) return failResult(board.provider, `Availability unavailable (${ctx.origin}→${ctx.destination}, ${ctx.date}).`);
          return okResult(
            board.provider,
            `${a.train_number} ${ctx.origin}→${ctx.destination} (${ctx.date}${ctx.autoDate ? ", aaj ke liye" : ""}): ${board.classes.map((c) => `${c.code} ${c.status}${c.seats != null ? ` ${c.seats}` : ""}`).join(", ")}.`,
            { train_number: a.train_number, date: ctx.date, resolvedRoute: { origin: ctx.origin, destination: ctx.destination, autoDate: ctx.autoDate }, classes: board.classes },
          );
        }
        const row = await getProvider().getAvailability(
          a.train_number as string,
          ctx.date,
          ctx.origin,
          ctx.destination,
          code,
          (a.quota as string | undefined) ?? "GN",
        );
        if (row.status === "UNKNOWN") return failResult(providerOf(), `Availability unavailable (${ctx.origin}→${ctx.destination}, ${ctx.date}) — invent nahi karunga.`, row);
        return okResult(
          providerOf(),
          `${a.train_number} ${code} ${ctx.origin}→${ctx.destination} (${ctx.date}${ctx.autoDate ? ", aaj ke liye" : ""}): ${row.status}${row.seats != null ? `, ${row.seats} seats` : ""}${row.fare > 0 ? `, ₹${row.fare}` : ""}.`,
          { ...row, resolvedRoute: { origin: ctx.origin, destination: ctx.destination, date: ctx.date, autoDate: ctx.autoDate } },
        );
      }
      case "GET_FARE": {
        const ctx = await resolveTrainRouteDate(a as unknown as { train_number: string; date?: string; origin?: string; destination?: string });
        if (!ctx.origin || !ctx.destination) {
          return failResult(null, `Fare ke liye route chahiye (origin/destination) aur timetable se route resolve nahi hua — user se poochho. Train ${a.train_number} ki timetable bhi unavailable thi.`);
        }
        const fare = await getProvider().getFare(
          a.train_number as string,
          ctx.date,
          ctx.origin,
          ctx.destination,
          (a.class_code as string).toUpperCase() as ClassCode,
          (a.passengers as number | undefined) ?? 1,
        );
        if (!fare.railwayAvailable && fare.baseFare <= 0)
          return failResult(
            providerOf(),
            `Fare unavailable (${ctx.origin}→${ctx.destination}, ${ctx.date})${fare.unavailableReason ? ` — ${fare.unavailableReason}` : ""} — andaza nahi lagaunga.`,
            fare,
          );
        return okResult(
          providerOf(),
          `${a.train_number} ${(a.class_code as string).toUpperCase()} ${ctx.origin}→${ctx.destination} (${ctx.date}${ctx.autoRoute ? ", poora route" : ""}${ctx.autoDate ? ", aaj ke liye" : ""}): ticket ₹${fare.baseFare}, service ₹${fare.serviceFee}, total ₹${fare.total}${(a.passengers as number | undefined) ? ` (${a.passengers} pax)` : ""}.`,
          { ...fare, resolvedRoute: { origin: ctx.origin, destination: ctx.destination, date: ctx.date, autoRoute: ctx.autoRoute, autoDate: ctx.autoDate } },
        );
      }
      case "CHECK_PNR": {
        const remote = await routedPnr(a.pnr as string);
        if (remote) return okResult("railkit", `PNR ${a.pnr} ka status mila.`, remote);
        const local = await getProvider().getBooking(a.pnr as string);
        if (local) return okResult("local", `PNR ${a.pnr} local booking se mila.`, { booking: local });
        return failResult("railkit", "PNR status provider se nahi aaya.");
      }
      case "GET_CANCELLED_TRAINS": {
        const list = await routedCancelled();
        if (!list) return failResult("railkit", "Cancelled list unavailable.");
        const fully = (list.fully ?? []).length;
        const partial = (list.partial ?? []).length;
        return okResult("railkit", `Fully cancelled ${fully}, partial ${partial}.`, list);
      }
      case "GENERAL_RAILWAY_ANSWER": {
        const text = RAILWAY_KB[a.topic as string];
        if (!text) {
          // Web fallback (user 2026-09-06): KB miss par flat denial nahi —
          // verified web (Wikipedia/DDG) se topic ki jankari le aao, labeled.
          const webResults = await webSearch(`Indian Railways ${a.topic} rules information`, 3);
          if (webResults.length) {
            const best = webResults[0];
            return okResult(
              "web",
              `Web se mila: ${best.snippet}\n(Source: ${best.title} — ${best.url})`,
              { topic: a.topic, answer: best.snippet, webSource: best.url },
            );
          }
          return failResult("kb", `Topic "${a.topic}" KB mein nahi hai — bina evidence answer nahi dunga.`);
        }
        return okResult("kb", text, { topic: a.topic, answer: text });
      }
      case "JOURNEY_ANALYZE":
        return await journeyAnalyze(a as never);
      default:
        return { ok: false, source: null, summary: "Unknown tool.", data: null, rejected: "not_in_allowlist" };
    }
  } catch (err) {
    return failResult(null, `Tool execution fail hua: ${err instanceof Error ? err.message : "error"}`);
  }
}

/* ── The multi-step loop ─────────────────────────────────────────── */

type ChatMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

const MAX_STEPS = 6;

/** Deterministic weekday→date map (IST) for the next 7 days — model ko date math nahi karni. */
function weekdayDateMap(nowIso?: string): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const baseMs = (nowIso && Date.parse(nowIso) ? Date.parse(nowIso) : Date.now()) + 5.5 * 3600 * 1000; // IST offset
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(baseMs + i * 86400000);
    const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    parts.push(`${DAYS[d.getUTCDay()]}=${ymd}`);
  }
  return parts.join(", ");
}

/**
 * Deterministic date resolver — booking flow wala parseDatePhrase (IST) reuse.
 * Arbitrary calendar dates (aaj/kal/parson/weekday/next/coming/DD-MM/named-month)
 * handle karta hai; 8-day map sirf hint hai, resolver ka result final.
 * Train numbers/PNR (5-10 digit) pehle strip — "12014 ko" ko date na samjha jaye.
 */
export function deterministicDateHint(
  text: string,
  now: Date,
): { kind: "date"; date: string } | { kind: "ambiguous"; options: { date: string; label: string }[] } | null {
  try {
    const cleaned = String(text ?? "").replace(/\b\d{5,10}\b/g, " ");
    const hit = parseDatePhrase(cleaned, now);
    if (hit?.date) return { kind: "date", date: hit.date };
    if (hit?.ambiguous?.length) return { kind: "ambiguous", options: hit.ambiguous };
  } catch {
    /* resolver kabhi crash se turn nahi rok sakta — model map use karega */
  }
  return null;
}

function systemPrompt(
  now: string | undefined,
  known: {
    origin?: string | null;
    destination?: string | null;
    date?: string | null;
    trainNumber?: string | null;
    classCode?: string | null;
    passengers?: number | null;
    /** User ne pichhle options-list se number/code/name se station CHUNA hai —
     *  yeh FINAL hai, dobara confirm mat karo. */
    stationPicked?: "origin" | "destination" | null;
    /** User ne ambiguous city bola hai (jaise "Delhi") jo abhi resolve NAHI hui —
     *  sabse pehle station choice resolve karo, preference/date baad mein. */
    destinationAmbiguous?: string | null;
    /** Round-9 (Agra-bug): origin-side ambiguous city (jaise "Agra"). */
    originAmbiguous?: string | null;
  },
  dateHint: { kind: "date"; date: string } | { kind: "ambiguous"; options: { date: string; label: string }[] } | null,
  history: AgenticHistoryTurn[] = [],
): string {
  const hintLine =
    dateHint?.kind === "date"
      ? `Deterministic date resolver (IST): user ke text se date=${dateHint.date} resolve hui — FINAL, yahi use karo.`
      : dateHint?.kind === "ambiguous"
        ? `Deterministic date resolver (IST): user ki date AMBIGUOUS hai — options: ${dateHint.options
            .map((o) => `${o.label} (${o.date})`)
            .join(" / ")} — dono user ko poochho, assume mat karo.`
        : "Deterministic date resolver (IST): user text mein koi date resolve nahi hui — neeche wali date map use karo, warna user se poochho.";
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
  const baseMs = (now && Date.parse(now) ? Date.parse(now) : Date.now()) + 5.5 * 3600 * 1000;
  const today = new Date(baseMs);
  const todayYmdStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  const todayLabel = `${todayYmdStr} (${DAYS[today.getUTCDay()]})`;
  return [
    "Tum RailBook ka railway assistant ho (Hinglish jawab, 2-4 chhoti lines).",
    "Tumhara kaam: user ke sawaal samajhkar APPROVED TOOLS se sachchi railway data laana. Tum khud decide karte ho kaunsa tool chahiye — multi-step allowed hai.",
    `Aaj ki date (IST): ${todayLabel}.`,
    `Date map (agle 7 din, IST): ${weekdayDateMap(now)}.`,
    hintLine,
    known.origin || known.destination || known.date || known.trainNumber || known.classCode || known.passengers
      ? `Known context (inhi par continue karo, dobara mat poochho): origin=${known.origin ?? "-"}, destination=${known.destination ?? "-"}, date=${known.date ?? "-"}, train=${known.trainNumber ?? "-"}, class=${known.classCode ?? "-"}, passengers=${known.passengers ?? "-"}.${
          known.stationPicked
            ? ` User ne abhi pichhle station-options se apni choice bheji hai — ${known.stationPicked}=${known.stationPicked === "origin" ? known.origin : known.destination} FINAL hai (server ne verify kiya). Confirm mat karo, seedha tool call karke jawab do.`
            : known.destinationAmbiguous
              ? ` User ne destination "${known.destinationAmbiguous}" bola jo AMBIGUOUS hai (multiple stations) — AGAR user ka current message isi journey ke baare mein hai to JOURNEY_ANALYZE ya SEARCH_TRAINS tool call karo aur needs_choice ke options user ko do. Station options SIRF tool result se — apni knowledge se station codes/options KABHI mat likho. Preference/date baad mein. Par agar current message koi ALAG sawaal hai (doosri train/PNR/status/fare/doosra route), to PEHLE us naye sawaal ka jawab do — station options us reply mein repeat mat karo. Options dete waqt sirf options do — saath mein koi denial/extra claim ("ye train wahin stop nahi karti" jaisa) mat jodo.`
              : known.originAmbiguous
                  ? ` User ne ORIGIN "${known.originAmbiguous}" bola jo AMBIGUOUS hai (multiple stations — jaise Agra mein AGC/AF/AGA) — AGAR user ka current message isi journey ke baare mein hai to SEARCH_STATIONS ya JOURNEY_ANALYZE se REAL station options lao aur user se poochho kaunsa. Station options SIRF tool result se — apni knowledge se codes/options KABHI mat likho. Origin station choose hone tak search complete nahi hogi — generic "Kahan se jana hai?" MAT poochho (city pata hai, sirf station chunna hai).`
                  : ""
        }`
      : "",
    history.length
      ? `Conversation history upar di gayi hai — user ka pichla context wahi se aata hai (jaise \"saturday\" pichle sawaal ka jawab hai, ya \"wahi train\" = pichhli selected train). History + known context use karo, user se dobara wahi mat poochho jo already pata hai. PAR user ka CURRENT message naya/alag sawaal ho to history ki purani trains/options se uska jawab mat banao — naye sawaal ke liye naya tool call karo.`
      : "",
    "RULES:",
    "1. Railway data ke liye khud decide karke approved tools call karo — tabhi jab jawab ke liye data chahiye. Agar context/history se required info (origin/destination/date/train) already pata hai to poochho mat, seedha tool call karo.",
    "2. Fastest/cheapest/earliest/best/compare/alternative-dates/connecting routes ke liye JOURNEY_ANALYZE use karo (yeh deterministic Atlas engine hai — uske output par explain karo).",
    "3. Multi-step tool calling allowed + encouraged hai: pehle SEARCH_TRAINS, phir results dekh kar zaroorat ke hisaab se GET_TIMETABLE / GET_FARE / CHECK_AVAILABILITY / GET_TRAIN_INFO call karo. Ek tool call mein sab na mile to agla tool call karo.",
    "3b. User sirf train number + class poochhe (route/date na de) to bhi GET_FARE / CHECK_AVAILABILITY turant bulao — route/date optional hain, server timetable se route aur aaj ki date khud lagata hai. Missing slots ki bhikh mat maango.",
    "4. Sirf tool results ke facts bolo. Train number, naam, time, fare, seats, delay, STATION CODE — kuch bhi invent mat karo. Station codes/options sirf tool results se; apni knowledge se station code mat banao.",
    "5. Required info (origin/destination/date/train number/PNR) genuinely missing ho to POOCHHO — journey/book intent ke liye DATE sabse pehle poochho (sabse zaroori slot); station ambiguity ho to usi ek line mein saath mein poochho (jaise: \"Kis date ko jaana hai? Aur Delhi mein kaunsa station — NDLS, DLI?\"). Aaj ki date silently assume mat karo. Station options sirf tool result (needs_choice) ya well-known stations se bolo — airport/foreign codes (BCT jaise) kabhi Delhi ke options mein mat likho.",
    "6. Data na mile to saaf bolo ki unavailable hai — kabhi fake number/seats/fare mat banao, aur train/station ka naam ya code khud se guess mat karo (sab kuch sirf tool result se).",
    "7. Final jawab mein koi API key/secret/URL nahi hoga.",
    "8. Jab user ko station options dikhane hon (needs_choice), options Gin ke poochho.",
    "9. Date sirf Deterministic date resolver line, date map ya known context se aayegi — khud calendar math kabhi mat karo. Resolver ka result FINAL hai; ambiguous ho to user se poochho; resolver kuch na de aur user ne absolute date di ho (jaise 5 September ya 05/09/2026) to map mein nahi hogi — tab user se confirm karo. Dhyan rahe: \"next <weekday>\" = AGLE hafte ka woh din (next Saturday aane wala Saturday nahi), \"coming <weekday>\"/bela weekday = aane wala pehla.",
    "10. Booking/payment kabhi tum nahi karte — booking tool tumhare paas hai hi nahi. User ticket book karna chahe to slots (origin/destination/date/passengers) jama karo aur trains dikhaao (SEARCH_TRAINS), phir bolo ki booking app ke TrainBoard/Confirm UI se hogi.",
    "11. Multi-station cities (Delhi, Bombay/Mumbai, Madras/Chennai, Calcutta/Kolkata…) ke liye KHUD station mat chuno — destination mein CITY NAAM hi pass karo; tool needs_choice ke saath real station options laayega, wahi user ko dikhao. Apni knowledge se station substitute (Calcutta→Howrah jaisa) kabhi nahi.",
            "16. User ne train ka NAAM bola aur known context mein uska number nahi hai (ya naam doosri train ka lag raha hai) to PEHLE TRAIN_NAME_SEARCH call karke number resolve karo, phir jo poocha uska data doosre tool se lao. Naam se multiple trains milein to user se kaunsi poochho — galat train ka data KABHI mat do.",
    "17. SIRF wahi data do jo user ne poocha. 'kitne time leti hai' = sirf duration; 'fare kitna' = sirf fare; 'platform/coach' = sirf coach position; 'kahan hai abhi' = sirf live position. Poora dump mat karo — user ne jo manga bas wahi, ek-do line mein.",
    "14. Train ka NAAM user ne bola (jaise 'swarn shatabdi', 'vande bharat') to USI train ka jawab do — known context mein trainNumber aaya hai ya list mein se naam match hua hai. Pichhli selected train se mix mat karo. Naam se train identify na ho to honestly poochho, galat train ka data mat do.",
    "15. 'Kitne time leti hai / kitna samay lagta hai' = user ke origin→destination SEGMENT ka duration (GET_TIMETABLE summary mein 'FROM→TO dep→arr (Xh YYm)' segment line hai). Poora-route duration sirf tab batao jab user 'poora route' maange.",
    "12. Jab bhi train LIST dikha rahe ho (SEARCH_TRAINS/JOURNEY_ANALYZE results): reply TEXT mein sirf 2-3 line ka summary do — count + 'Sabse fast: <number> <name> (<duration>)' top par highlight. POORI train-by-train list reply text mein MAT likho — app khud organized TABLE mein saari trains dikhata hai. User ko dobara poochna na pade. Cheapest/earliest bhi isi tarah jab relevant ho.",
    "13. Reply ke end mein PROACTIVE offer/continuation KABHI mat likho (jaise 'waise hum continue kar sakte hain', 'aap chahe to…', 'kya aapko aur kuch chahiye?', 'shall I continue?'). Sirf user ke sawaal ka jawab do — aage ka step tabhi batao jab user poochhe. (Zaroori slot-filling questions — date/station/passengers/booking-confirm — exempt hain, woh poochte raho.)",
    "18. CONTEXT-SWITCH (sabse zaroori): user ka CURRENT message hi priority hai. Agar aapne pichhle reply mein kuch poochha tha (station options/date/confirm) par user ne uska jawab NAHI diya aur koi alag cheez/train poochh li — to PEHLE naye sawaal ka jawab do (tool call karke). Apna pending sawaal naye reply mein dobara repeat ya attach mat karo; jab user khud wapas usi journey ki baat kare tab options yaad dilao. Same chat mein topic/train badalna normal hai — 'chhodo/arré chhad' jaise words ko ignore-marker ki tarah samjho.",
    "19. Purani search ki trains se current sawaal ka jawab MAT banao (jaise user ne fastest train poocha aur aap pichhli list ki kisi train par 'nahi, ye wahin stop nahi karti' bolo). Current sawaal ka data na mile to: pehle relevant TOOL call karo; phir bhi na mile to 1-2 line mein saaf bolo kya unavailable hai — flat 'is question ka jawab evidence mein nahi hai' jaisa kabhi nahi.",
    "20. Timetable/stops/route poora poochha jaye ('poora timetable do', 'kon kon se stops hain', 'har stop ka naam', 'route kya hai', 'kahan kahan rukti hai') to GET_TIMETABLE ke data se SABHI stops list karo — naam + arrival/departure (max ~25, numbered). Sirf '11 stops' jaisa COUNT mat bolna. Ye sawaal journey-slot (origin/date) ka nahi hai — 'kahan se jana hai?' MAT poochna. 'Kon kon se/kaun kaun se' jaise question-words TRAIN KE NAAM nahi hote — bina number ke follow-up par pichhli train (history/known context) use karo, TRAIN_NAME_SEARCH par ye phrase mat bhejo.",
    "21. Do trains compare karne ko kahe ('12014 and 12054 mein se kon si better', 'X vs Y') to DONO par GET_TIMETABLE call karo aur duration/stops/classes/timing compare karke 2-4 line mein data-based verdict do. Ek train ka data na mile to doosre ka jo mila wo do + saaf bolo kaunsa nahi mila — poora compare 'data nahi mila' se cancel MAT karo. Route alag ho (last stop different) to pehle batao.",
    "22. User ne clearly kaha ki travel NAHI karna, sirf information chahiye ('jaana nahi hai', 'sirf details chahiye', 'bas batao') to journey slots (origin/destination/date) kabhi mat poochho — seedha info tool se do. Travel-denial wale message ko station/journey input ki tarah parse MAT karna.",
      "23. GENERAL-FACT sawaal (top speed/max speed/kitni tez/average speed/kab chalu hui/kab shuru/history/kitne coach) par WEB_SEARCH PEHLA tool hai — train ka naam/number dhoondh kar train-list 'kaunsi?' bilkul mat poochho. Web results 'web se mila' + source ke saath do — unhe verified railway data jaisa present na karo. Baaki cases mein WEB_SEARCH last-resort hai (railway tools/KB jawab na dein YA sawaal general railway background/history/news ka ho). Live time/fare/seats/availability/booking ke liye web data kabhi use na karo. Ek reply mein max 1 web search.",
      "24. UNIVERSAL WEB FALLBACK (user request 2026-09-06: 'ChatGPT jaisa — koi bhi railway sawaal, API se jawab na mile to khud web se dhoondh lo'): koi bhi railway ka sawaal (catering/pantry/rules/facilities/history/facts/general knowledge) jiska jawab railway data tools (timetable/live/fare/seats) se NAHI aata — WEB_SEARCH se dhoondo aur 'web se mila' + source label ke saath do. Railway-irrelevant web results (cars/automobiles jaise) skip karo, railway-relevant hi do. Na mile to honest 'nahi mil paya' bolo — guess kabhi nahi. Live status/fare/seats/availability/PNR ke liye web search kabhi use mat karna — wahan sirf railway tools.",
  ]
    .filter(Boolean)
    .join("\n");
}

function redact(s: string): string {
  return s
    .replace(/rk_live_[A-Za-z0-9_-]+|rk_test_[A-Za-z0-9_-]+|nvapi-[A-Za-z0-9_-]+|vcp_[A-Za-z0-9]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
}

/**
 * User feedback (2026-09-05): model reply ke end mein proactive
 * offer/continuation sentences ("waise hum continue kar sakte hain",
 * "aap chahe to…", "kya aapko aur kuch chahiye?") NAHI aane chahiye —
 * jab tak user khud na poochhe. Sentence-level scrub (model-agnostic guard;
 * system-prompt rule 13 bhi hai, yeh defensive backup hai).
 * Slot-filling questions (date/station/passengers/booking-confirm) is se
 * match nahi hote — woh required hain aur bane rehte hain.
 */
export function scrubProactiveOffers(s: string): string {
  const OFFER_RE =
    /(?:waise\b[^.?!]*continue|continue\s+kar\s+sakte|hum\s+continue\s+kar|aap\s+chahe\w*\s+to\b[^.?!]*(?:kar\s+sakte|dekh|bata|dika)|kya\s+aapko\s+(?:aur|bhi)\s+[^.?!]*(?:chahiye|dekh|bata|dika)|shall\s+(?:we|i)\s+(?:continue|proceed)|aur\s+kuch\s+(?:chahiye|poochh))/i;
  const sentences = s.split(/(?<=[.?!])\s+/);
  const kept = sentences.filter((x) => !OFFER_RE.test(x));
  // Sirf-pura-offer reply → "" (runAgent phir deterministic fallback se jawab dega).
  // Short-but-legit remainder ("Done.") kabhi original se replace NAHI hota.
  const out = kept.join(" ").replace(/\s{2,}/g, " ").trimEnd();
  return out.length > 0 ? out : "";
}

/** Trace/test ke liye: model ke raw args ko zod se guzar kar EXECUTED args nikaalo. */
export function sanitizedArgs(name: string, raw: Record<string, unknown>): Record<string, unknown> {
  if (!APPROVED.includes(name as AgenticToolName)) return {};
  const schema = ArgSchemas[name as AgenticToolName];
  if (!schema) return {};
  const parsed = schema.safeParse(raw);
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}

/**
 * GPT-OSS harmony output kabhi-kabhi tool name mein raw channel token leek karta hai
 * (e.g. "CHECK_AVAILABILITY<|channel|>commentary"). Token strip karo, aur bacha hua
 * string allowlisted tool ke prefix par ho to wahi tool lo — koi naya tool kabhi
 * execute nahi hota, allowlist hamesha gate hai.
 */
function sanitizeToolName(raw: string): string {
  const s = String(raw ?? "")
    .replace(/<\|[^|]*\|>/g, "")
    .trim();
  if ((APPROVED as readonly string[]).includes(s)) return s;
  const m = s.match(/^(SEARCH_TRAINS|TRAIN_NAME_SEARCH|SEARCH_STATIONS|GET_COACH_POSITION|GET_STATION_BOARD|GET_TRAIN_HISTORY|GET_TRAIN_INFO|GET_TIMETABLE|TRACK_TRAIN|CHECK_AVAILABILITY|GET_FARE|CHECK_PNR|GET_CANCELLED_TRAINS|GENERAL_RAILWAY_ANSWER|JOURNEY_ANALYZE)/);
  return m ? m[1] : s;
}

/**
 * Final answer ke numbers STATION-CODE style tokens tool results/known context
 * mein hone chahiye — warna deterministic summary. "NDAP" jaise invented codes
 * (jo kisi provider result mein nahi) user tak nahi jaane chahiye.
 */
const SAFE_UPPER_TOKENS = new Set([
  // class/quota codes + common uppercase abbreviations (stations nahi hain)
  "CC", "SL", "EC", "EA", "FC", "GN", "PQ", "PT", "TQ", "SS", "DP", "AC",
  "PNR", "RAC", "IR", "UTC", "IST", "INR", "API", "OK", "NO", "PM", "AM",
  "EX", "EXP", "IRCTC", "URL", "ID", "SMS", "TAT",
]);

function groundingCheck(content: string, steps: ToolTraceStep[], evidenceParts: string[]): { grounded: boolean; evidence: string } {
  const evidence =
    JSON.stringify(steps.map((s) => s.summary)) +
    " " +
    JSON.stringify(steps.map((s) => s.args)) +
    " " +
    evidenceParts.join(" ");
  const numbers = content.match(/\d+(?:\.\d+)?/g) ?? [];
  const bad = numbers.filter((n) => n.length >= 3 && !evidence.includes(n));
  // Station-code style tokens (2–5 uppercase letters) — evidence/system-prompt/
  // user text mein na mile to hallucination (jaise "NDAP" for Delhi Airport).
  const tokens = [...new Set(content.match(/\b[A-Z]{2,5}\b/g) ?? [])];
  // Word-boundary match: "NDL" ko "NDLS" ke ANDAR substring mil jaata tha —
  // invented code ko exact token ki tarah check karo.
  const badTokens = tokens.filter((t) => !SAFE_UPPER_TOKENS.has(t) && !new RegExp(`\\b${t}\\b`).test(evidence));
  // Train-type proper names (Rajdhani/Shatabdi/Vande Bharat…): data fail hone par
  // model kabhi khud se naam guess karta hai (12014 ko "Rajdhani" bolna — Shatabdi
  // hai). User ne bola ho ya provider data mein ho to theek; warna ungrounded.
  // ("SHTABDI" transliteration provider data mein aata hai — normalize karke compare.)
  const normName = (x: string) => x.toLowerCase().replace(/shtabdi/g, "shatabdi").replace(/\s+/g, " ");
  const nameHits = [...new Set((content.match(/\b(?:vande\s+bharat|rajdhani|shatabdi|garib\s+rath|duronto|tejas|humsafar|antyodaya|sampark\s+kranti)\b/gi) ?? []).map(normName))];
  const normEvidence = normName(evidence);
  const badNames = nameHits.filter((n) => !normEvidence.includes(n));
  return { grounded: bad.length === 0 && badTokens.length === 0 && badNames.length === 0, evidence: [...bad, ...badTokens, ...badNames].join(",") };
}

function deterministicSummary(steps: ToolTraceStep[]): string {
  const okSteps = steps.filter((s) => s.ok);
  if (!okSteps.length) return "Ye jaankari abhi provider se nahi mil pa rahi. Main gadh ke nahi bataunga.";
  return okSteps
    .map((s) => `• ${s.summary}`)
    .join("\n");
}

export function agenticConfigured(): boolean {
  if (env.agenticProvider === "hf") return Boolean(env.hfToken && env.hfModel);
  return Boolean(env.nvidiaApiKey);
}

/**
 * Agentic model transport — OpenAI-compatible. Default: NVIDIA GPT-OSS-20B
 * (primary + nemotron fallback model chain). AGENTIC_PROVIDER=hf par Hugging
 * Face router se GLM chalta hai. Railway providers/tools/safety guards
 * provider se INDEPENDENT hain — model sirf validated tool plans deta hai,
 * execution waise hi server-side allowlist + zod se hoti hai; API keys model
 * tak kabhi nahi jaati.
 */
type AgenticTransport = {
  provider: "nvidia" | "hf";
  url: string;
  apiKey: string;
  models: string[];
  primaryModel: string;
  /** reasoning_effort sirf NVIDIA GPT-OSS ko bhejte hain. */
  reasoningEffort: boolean;
};

function agenticTransport(): AgenticTransport | null {
  if (env.agenticProvider === "hf") {
    if (!env.hfToken || !env.hfModel) return null;
    return {
      provider: "hf",
      url: `${env.hfBaseUrl.replace(/\/$/, "")}/chat/completions`,
      apiKey: env.hfToken,
      models: [env.hfModel],
      primaryModel: env.hfModel,
      reasoningEffort: false,
    };
  }
  if (!env.nvidiaApiKey) return null;
  // BENCHMARK-ONLY (AGENTIC_MODEL): single-model chain, sirf benchmark scripts set karte hain.
  // Prod kabhi set nahi karta — wahan [NVIDIA_MODEL (+fallback)] hi rehta hai.
  const benchOverride = env.agenticModelOverride;
  const models = benchOverride
    ? [benchOverride]
    : [env.nvidiaModel, ...(env.nvidiaFallbackModel && env.nvidiaFallbackModel !== env.nvidiaModel ? [env.nvidiaFallbackModel] : [])];
  return {
    provider: "nvidia",
    url: `${env.nvidiaBaseUrl.replace(/\/$/, "")}/chat/completions`,
    apiKey: env.nvidiaApiKey,
    models,
    primaryModel: benchOverride || env.nvidiaModel,
    reasoningEffort: true,
  };
}

type NvidiaChatJson = {
  model?: string;
  choices?: { message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: ChatMsg["tool_calls"] } }[];
};

export type AgenticHistoryTurn = { role: "user" | "assistant"; content: string };

export async function runAgenticTurn(input: {
  text: string;
  now?: string;
  known?: {
    origin?: string | null;
    destination?: string | null;
    date?: string | null;
    trainNumber?: string | null;
    classCode?: string | null;
    passengers?: number | null;
    /** User ne pichhle options-list se station chuna hai — FINAL, confirm nahi karna. */
    stationPicked?: "origin" | "destination" | null;
    /** Ambiguous city (jaise "Delhi") jo abhi resolve nahi hui. */
    destinationAmbiguous?: string | null;
    /** Round-9 (Agra-bug): ORIGIN-side ambiguous city (jaise "Agra") —
     * doosri side ke choice ke baad bhi yaad rehti hai. */
    originAmbiguous?: string | null;
  };
  /** Prior conversation turns (multi-turn state) — redacted, capped, sent before the current user message. */
  history?: AgenticHistoryTurn[];
  /** Optional out-param: successful search tools yahan structured table capture karte hain. */
  capture?: SearchCapture;
}): Promise<AgenticTurn> {
  const startedAll = Date.now();
  const transport = agenticTransport();
  if (!transport) {
    return { ok: false, reply: null, grounded: false, steps: [], modelUsed: null, latencyMs: 0, failureReason: "missing_key" };
  }
  // Deterministic date resolver (IST) — arbitrary dates bhi; model sirf follow karta hai.
  const nowDate = input.now && Date.parse(input.now) ? new Date(input.now) : new Date();
  const dateHint = deterministicDateHint(String(input.text ?? ""), nowDate);
  const historyTurns = (Array.isArray(input.history) ? input.history : [])
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim())
    .slice(-8)
    .map((h) => ({ role: h.role, content: redact(h.content.slice(0, 700)) }));
  const messages: ChatMsg[] = [
    {
      role: "system",
      content: systemPrompt(
        input.now,
        {
          origin: input.known?.origin ?? null,
          destination: input.known?.destination ?? null,
          date: input.known?.date ?? null,
          trainNumber: input.known?.trainNumber ?? null,
          classCode: input.known?.classCode ?? null,
          passengers: input.known?.passengers ?? null,
          stationPicked: input.known?.stationPicked ?? null,
          destinationAmbiguous: input.known?.destinationAmbiguous ?? null,
          originAmbiguous: input.known?.originAmbiguous ?? null,
        },
        dateHint,
        historyTurns,
      ),
    },
    ...historyTurns,
    {
      role: "user",
      content:
        redact(input.text) +
        (GENERAL_FACT_RE.test(input.text)
          ? "\n\n(System note: ye general-fact sawaal hai — WEB_SEARCH pehla tool hai; train ka naam/number dhoondh kar train-list kaunsi? mat poochho.)"
          : ""),
    },
  ];

  const steps: ToolTraceStep[] = [];
  const evidenceParts: string[] = [];
  let lastNeedsChoice: { city: string; stations: { code: string; name: string }[] } | null = null;
  let modelUsed: string | null = null;
  const url = transport.url;

  // AI chain: NVIDIA = primary (GPT-OSS) -> fallback (Nemotron); HF = single GLM.
  // Model chain poor fail ho to upar caller (runAgent) deterministic fallback chalata hai.
  const modelChain = transport.models;
  let repaired = false;

  // Vercel function wall (~30s default) — poora turn is budget ke andar raho.
  // Wall paar hua to jo tool-data mila uska summary return karo (null nahi).
  const TURN_TIME_BUDGET_MS = Number(process.env.AI_AGENTIC_TURN_BUDGET_MS ?? 30000);
  const timeLeft = () => TURN_TIME_BUDGET_MS - (Date.now() - startedAll);

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (timeLeft() < 2500) {
      return {
        ok: steps.length > 0,
        reply: steps.length ? deterministicSummary(steps) : null,
        grounded: steps.length > 0,
        steps,
        modelUsed,
        latencyMs: Date.now() - startedAll,
        failureReason: "turn_time_budget",
      };
    }
    const started = Date.now();
    // Agentic loop ke paas multi-step reasoning + bada context hota hai — NLU se zyada time do,
    // par ek single call poora budget kha nahi sakti.
    const agenticTimeoutMs = Math.max(3000, Math.min(Number(process.env.AI_AGENTIC_TIMEOUT_MS ?? 25000), timeLeft() - 1500));
    let json: NvidiaChatJson | null = null;
    let msg: { content?: string | null; reasoning_content?: string | null; tool_calls?: ChatMsg["tool_calls"] } | undefined;
    let lastFailure: string | null = null;
    for (const model of modelChain) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), agenticTimeoutMs);
      try {
        const res = await fetchImpl()(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${transport.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0,
            // reasoning_effort GPT-OSS-specific hai (openai/gpt-oss* family only);
            // HF/GLM ya Nemotron jaise models ko bhejne par API reject/ignore karti hai.
            ...(transport.reasoningEffort && model === transport.primaryModel && model.startsWith("openai/gpt-oss")
              ? { reasoning_effort: "low" }
              : {}),
            // DeepSeek V4 hybrid-thinking: production mein thinking OFF — latency
            // experiment mein measured: 63s/call (thinking ON) → 18-31s/call (OFF),
            // quality identical (6/6 tool-selection/JSON). Params: chat_template_kwargs.
            ...(model.startsWith("deepseek") ? { chat_template_kwargs: { thinking: false } } : {}),
            max_tokens: 900,
            messages,
            tools: AGENTIC_TOOLS,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          lastFailure = `http_${res.status}`;
          continue;
        }
        let parsed: NvidiaChatJson;
        try {
          parsed = await res.json();
        } catch {
          lastFailure = "bad_json";
          continue;
        }
        const m = parsed.choices?.[0]?.message;
        if (!m || (m.content == null && !(m.tool_calls ?? []).length && !m.reasoning_content)) {
          lastFailure = "empty_content";
          continue;
        }
        json = parsed;
        msg = m;
        modelUsed = typeof parsed.model === "string" ? parsed.model : model;
        break;
      } catch (err) {
        clearTimeout(timer);
        lastFailure = err instanceof Error && err.name === "AbortError" ? "timeout" : "network";
        continue;
      }
    }
    if (!json || !msg) {
      // Model chain poori tarah fail — par agar tools chal chuke hain to unka
      // provider-backed summary hi sahi jawab hai (weak deterministic NLU par mat ja).
      const reason = lastFailure ?? "empty_content";
      return {
        ok: false,
        reply: steps.length ? deterministicSummary(steps) : null,
        grounded: steps.length > 0,
        steps,
        modelUsed,
        latencyMs: Date.now() - startedAll,
        failureReason: reason,
      };
    }
    const toolCalls = (msg?.tool_calls ?? []).filter(
      (tc) => tc && tc.function && typeof tc.function.name === "string",
    );

    if (toolCalls.length) {
      messages.push({
        role: "assistant",
        content: msg?.content ?? null,
        tool_calls: toolCalls,
      });
      for (const tc of toolCalls) {
        const stepStarted = Date.now();
        let args: Record<string, unknown> = {};
        try {
          args = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
        } catch {
          args = {};
        }
        const toolName = sanitizeToolName(tc.function.name);
        // Airport guard: user ne "airport" bola (jaise "Delhi airport") to koi
        // rail station silently substitute nahi hoga — airports railway stations
        // nahi hote; user se railway station/city poochna hi honest hai.
        if (
          /airport|हवाईअड्डा|hawai\s*adda/i.test(String(input.text ?? "")) &&
          (toolName === "SEARCH_TRAINS" || toolName === "JOURNEY_ANALYZE")
        ) {
          const result = failResult(
            null,
            "Airport ke liye koi railway station silently assume nahi karunga — kis CITY ya railway station ki trains chahiye? (jaise Delhi ke liye NDLS/DLI/NZM options honge)",
            { needs_airport_clarification: true },
          );
          evidenceParts.push(JSON.stringify(result.data ?? {}).slice(0, 20000));
          steps.push({
            step,
            tool: toolName,
            args: sanitizedArgs(toolName, args),
            ok: result.ok,
            source: result.source,
            summary: result.summary,
            latencyMs: Date.now() - stepStarted,
            dataPreview: redact(JSON.stringify(result.data ?? null)).slice(0, 400),
          });
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ ok: result.ok, source: result.source, summary: result.summary, data: result.data }),
          });
          continue;
        }
        // "next <weekday>" guard: model kabhi date-map ka immediate occurrence
        // utha leta hai (next Saturday → is Saturday). Resolver hi FINAL hai —
        // user ne literally "next <weekday>" bola hai to args.date hint se align.
        if (
          dateHint?.kind === "date" &&
          /\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat|ravivar|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar)\b/.test(
            String(input.text ?? "").toLowerCase(),
          ) &&
          typeof args?.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(args.date) &&
          args.date !== dateHint.date
        ) {
          args = { ...args, date: dateHint.date };
        }
        // GET_TIMETABLE segment (2026-09-05): model ne origin/destination na
        // bheje ho to known context se inject — "kitne time leti hai" ka jawab
        // user ke segment ka hona chahiye, poora-route ka nahi.
        if (toolName === "GET_TIMETABLE" && typeof args.date === "undefined") {
          /* date irrelevant here */
        }
        if (toolName === "GET_TIMETABLE") {
          if (!args.origin && input.known?.origin) args = { ...args, origin: input.known.origin };
          if (!args.destination && input.known?.destination) args = { ...args, destination: input.known.destination };
        }
        /* Screenshot fix (2026-09-06 #3): "12054 ki top speed btana" par
         * model ne GET_TIMETABLE chala diya — user ko timetable dikha, speed
         * ka jawab nahi. System-note soft guidance se model nahi ruka, isliye
         * HARD guard: general-fact sawaal par railway data tools reject (sirf
         * WEB_SEARCH + train ka naam dhoondhne wale tools allowed). */
        let result: ApprovedToolResult;
        if (
          GENERAL_FACT_RE.test(input.text) &&
          toolName !== "WEB_SEARCH" &&
          toolName !== "GET_TRAIN_INFO" &&
          toolName !== "TRAIN_NAME_SEARCH" &&
          toolName !== "GENERAL_RAILWAY_ANSWER"
        ) {
          result = {
            ok: false,
            source: null,
            summary:
              "Ye general-fact sawaal (top speed / history / coaches / locomotive) hai — railway data tools (timetable/live/fare) iska jawab NAHI dete. WEB_SEARCH use karo: train ka naam + number + fact (jaise 'Jan Shatabdi Express 12054 top speed').",
            data: null,
            rejected: "general_fact_tool_block",
          };
        } else {
          result = await executeApprovedTool(toolName, args);
        }
        // Structured table capture (user feedback 2026-09-05): SEARCH/JOURNEY
        // success par rows nikalo — client proper <table> render karega, aur
        // run.ts inhi se ctx memory (lastTrainNumbers/fastest) bharta hai.
        if (result.ok && input.capture && (toolName === "SEARCH_TRAINS" || toolName === "JOURNEY_ANALYZE")) {
          const d = result.data as
            | {
                from?: string;
                to?: string;
                date?: string;
                trains?: AgentTrainRow[];
                query?: { from?: string; to?: string; date?: string };
                direct?: { ranked?: (AgentTrainRow & { cheapest?: { fare: number; classCode: string } | null })[] };
              }
            | null;
          const q = d?.query ?? d;
          const rows: AgentTrainRow[] =
            toolName === "SEARCH_TRAINS"
              ? Array.isArray(d?.trains)
                ? (d?.trains ?? []).map((t) => ({ ...t, fare: t.fare ?? null }))
                : []
              : Array.isArray(d?.direct?.ranked)
                ? (d?.direct?.ranked ?? []).map((t) => ({
                    ...t,
                    durationLabel: t.durationLabel ?? (t.durationMinutes != null ? `${Math.floor(t.durationMinutes / 60)}h ${String(t.durationMinutes % 60).padStart(2, "0")}m` : null),
                    fare: t.cheapest ? { classCode: t.cheapest.classCode, amount: t.cheapest.fare } : null,
                  }))
                : [];
          if (d && rows.length && q?.from && q?.to && q?.date) {
            const withDur = rows.filter((t) => t.durationMinutes != null);
            const fastest = withDur.length
              ? withDur.reduce((best, t) => ((t.durationMinutes ?? Infinity) < (best.durationMinutes ?? Infinity) ? t : best))
              : null;
            input.capture.table = {
              from: String(q.from),
              to: String(q.to),
              date: String(q.date),
              fastest: fastest?.number ?? null,
              rows: rows.map((t) => ({
                number: String(t.number),
                name: String(t.name ?? ""),
                departure: String(t.departure ?? "--:--"),
                arrival: String(t.arrival ?? "--:--"),
                arrivalDayOffset: Number(t.arrivalDayOffset ?? 0) || 0,
                durationMinutes: t.durationMinutes ?? null,
                durationLabel: t.durationLabel ?? null,
                classes: Array.isArray(t.classes) ? t.classes.map(String) : [],
                fare: t.fare ?? null,
              })),
            };
          }
        }
        const rd = result.data as { needs_choice?: boolean; city?: string; stations?: { code: string; name: string }[] } | null;
        if (!result.ok && rd?.needs_choice && Array.isArray(rd.stations)) {
          lastNeedsChoice = { city: rd.city ?? "station", stations: rd.stations };
        }
        try {
          evidenceParts.push(JSON.stringify(result.data ?? {}).slice(0, 20000));
        } catch {
          /* circular-free data expected; ignore */
        }
        steps.push({
          step,
          tool: toolName,
          args: sanitizedArgs(toolName, args),
          ok: result.ok,
          source: result.source,
          summary: result.summary,
          latencyMs: Date.now() - stepStarted,
          dataPreview: redact(JSON.stringify(result.data ?? null)).slice(0, 400),
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ ok: result.ok, source: result.source, summary: result.summary, data: result.data }),
        });
      }
      continue; // model dekhega results aur decide karega next step
    }

    const content = (msg?.content ?? msg?.reasoning_content ?? "").trim();
    if (!content) {
      // Model ne na tool call kiya na content diya — tools chal chuke hain to unka summary do.
      return {
        ok: false,
        reply: steps.length ? deterministicSummary(steps) : null,
        grounded: steps.length > 0,
        steps,
        modelUsed,
        latencyMs: Date.now() - startedAll,
        failureReason: "empty_content",
      };
    }
    const clean = scrubProactiveOffers(redact(content));

    // Repair pass (one-shot): model ne tools chala kar data le liya, phir bhi
    // "info maango" wala jawab de diya? Ek corrective call do — data upar hai.
    const okSteps = steps.filter((st) => st.ok);
    // Model tools chala ke data le chuka hai, phir bhi route/date/class jaisi cheez
    // "maang" raha hai — jo summaries mein already hai. "availability bhi dekhun?"
    // jaise legit offers trigger na hon — sirf demand-phrasing trigger karti hai.
    const demandsKnownInfo =
      /(route|origin|destination|date|tarikh|class|train\s*(?:number|no|ka\s*n))?[^.?!\n]{0,28}(chahiye|bolo|batao|bataye|poochh?o?|missing|dena)[^.?!\n]{0,28}/i.test(clean) &&
      /(route|origin|destination|date|tarikh|class|train)/i.test(clean);
    const asksInsteadOfAnswering = okSteps.length > 0 && demandsKnownInfo;
    if (asksInsteadOfAnswering) {
      if (!repaired && step < MAX_STEPS) {
        repaired = true;
        messages.push({ role: "assistant", content });
        messages.push({
          role: "user",
          content:
            "SYSTEM CHECK: tools ALREADY returned the data (see the tool results above). " +
            "Do NOT ask the user for information you already have. Rewrite the final answer now using ONLY those tool results " +
            "(route, date, fare, availability jo bhi mila). Sirf tab poochho jab koi genuinely missing field answer block kar rahi ho — aur sirf wohi ek field.",
        });
        continue;
      }
      // Repair ke baad bhi model wahi harkat kare to tool summaries hi FINAL jawab hain.
      return {
        ok: true,
        reply: deterministicSummary(steps),
        grounded: true,
        steps,
        modelUsed,
        latencyMs: Date.now() - startedAll,
        failureReason: "model_asked_instead_of_answered",
      };
    }

    // System prompt (date map, resolver line, known context) server-generated hai —
    // isme ke server-provided dates/numbers model ne "invent" nahi kiye.
    // Deterministic relay: tool ne needs_choice diya (ambiguous station) par model ne
    // options user ko nahi dikhayi? Options khud banao — 100% tool-data se.
    const pendingNeedsChoice = lastNeedsChoice; // grounding-fail relay ke liye save
    if (lastNeedsChoice) {
      const mentioned = lastNeedsChoice.stations.filter((x) => clean.toUpperCase().includes(x.code.toUpperCase())).length;
      if (mentioned < Math.min(2, lastNeedsChoice.stations.length)) {
        const lines = lastNeedsChoice.stations.map((x, i) => `${i + 1}. ${x.code} – ${x.name}`).join("\n");
        const relay = `**${lastNeedsChoice.city} ke liye kaunsa station?**\n${lines}\nKripya number ya station code bata do.`;
        return {
          ok: true,
          reply: relay,
          grounded: true,
          steps,
          modelUsed,
          latencyMs: Date.now() - startedAll,
          failureReason: "needs_choice_relayed_deterministically",
        };
      }
      lastNeedsChoice = null; // model ne dikhayi — aage model ka jawab hi final
    }

    // Round-9 (Agra-bug): ORIGIN-side ambiguous city hai (server ko pata) par
    // model ne generic "Kahan se jana hai? Departure station bataiye" poochha
    // ya options nahi diye — REAL station options relay karo (grounding se pehle,
    // kyunki aisa reply "grounded" hota hai aur niche nahi phansta).
    if (input.known?.originAmbiguous && !lastNeedsChoice) {
      try {
        const res = await resolveStationRef(input.known.originAmbiguous);
        if ("candidates" in res && res.candidates.length) {
          const mentioned = res.candidates.filter((x) => clean.toUpperCase().includes(x.code.toUpperCase())).length;
          if (mentioned < Math.min(2, res.candidates.length)) {
            const lines = res.candidates.map((x, i) => `${i + 1}. ${x.code} – ${x.name}`).join("\n");
            const relay = `**${res.city} se jaana hai — kaunsa station?**\n${lines}\nKripya number ya station code bata do.`;
            return {
              ok: true,
              reply: relay,
              grounded: true,
              steps,
              modelUsed,
              latencyMs: Date.now() - startedAll,
              failureReason: "origin_choice_relayed_deterministically",
            };
          }
        }
      } catch {
        /* station API fail — model reply as-is */
      }
    }

    const check = groundingCheck(clean, steps, [...evidenceParts, ...messages.map((m) => m.content ?? "")]);
    if (!check.grounded) {
      // Ungrounded output — deterministic, provider-backed replacement.
      // Needs_choice waale turn par REAL tool options relay karo (model ne
      // mixed/invented options likhe the — jaise "NDL" jo kisi station nahi).
      if (pendingNeedsChoice) {
        const lines = pendingNeedsChoice.stations.map((x, i) => `${i + 1}. ${x.code} – ${x.name}`).join("\n");
        const relay = `**${pendingNeedsChoice.city} ke liye kaunsa station?**\n${lines}\nKripya number ya station code bata do.`;
        return {
          ok: true,
          reply: relay,
          grounded: true,
          steps,
          modelUsed,
          latencyMs: Date.now() - startedAll,
          failureReason: `ungrounded_options_replaced:${check.evidence}`,
        };
      }
      // Destination AMBIGUOUS tha (server ko pata) par model ne apni knowledge
      // se options likhe — REAL station API se options la kar relay karo.
      if (input.known?.destinationAmbiguous) {
        try {
          const res = await resolveStationRef(input.known.destinationAmbiguous);
          if ("candidates" in res && res.candidates.length) {
            const lines = res.candidates.map((x, i) => `${i + 1}. ${x.code} – ${x.name}`).join("\n");
            const relay = `**${res.city} ke liye kaunsa station?**\n${lines}\nKripya number ya station code bata do.`;
            return {
              ok: true,
              reply: relay,
              grounded: true,
              steps,
              modelUsed,
              latencyMs: Date.now() - startedAll,
              failureReason: `ungrounded_options_replaced:${check.evidence}`,
            };
          }
        } catch {
          /* station API fail — generic summary (neeche) */
        }
      }
      // Round-9 (Agra-bug): ORIGIN ambiguous — model ne generic "Kahan se jana
      // hai?" poochha ya khud ke options likhe — REAL options relay karo.
      if (input.known?.originAmbiguous) {
        try {
          const res = await resolveStationRef(input.known.originAmbiguous);
          if ("candidates" in res && res.candidates.length) {
            const lines = res.candidates.map((x, i) => `${i + 1}. ${x.code} – ${x.name}`).join("\n");
            const relay = `**${res.city} se jaana hai — kaunsa station?**\n${lines}\nKripya number ya station code bata do.`;
            return {
              ok: true,
              reply: relay,
              grounded: true,
              steps,
              modelUsed,
              latencyMs: Date.now() - startedAll,
              failureReason: `origin_choice_relayed:${check.evidence}`,
            };
          }
        } catch {
          /* station API fail — generic summary (neeche) */
        }
      }
      return {
        ok: steps.some((s) => s.ok),
        reply: `${deterministicSummary(steps)}\n(AI ka jawab providers ke data se match nahi hua — sirf verified data dikha raha hoon.)`,
        grounded: false,
        steps,
        modelUsed,
        latencyMs: Date.now() - startedAll,
        failureReason: `ungrounded_numbers:${check.evidence}`,
      };
    }
    return { ok: true, reply: clean, grounded: true, steps, modelUsed, latencyMs: Date.now() - startedAll, failureReason: null };
  }

  // Step budget kharch — honest deterministic summary.
  return {
    ok: steps.some((s) => s.ok),
    reply: deterministicSummary(steps),
    grounded: true,
    steps,
    modelUsed,
    latencyMs: Date.now() - startedAll,
    failureReason: "step_budget_exhausted",
  };
}
