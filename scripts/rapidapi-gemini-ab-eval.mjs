/**
 * Shadow A/B: NVIDIA (production) vs RapidAPI Gemini Pro AI New (eval only).
 * Never prints API keys. Never books or charges. Does not deploy.
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { extractWithLlm } from "../server/understand/llm.ts";
import { extractWithRapidGemini } from "../server/understand/rapid-gemini.ts";
import { geminiSafetyOk, isForbiddenMoneyTool } from "../server/understand/safety.ts";

config({ path: new URL("../.env", import.meta.url) });

const TODAY = "2026-08-23";
const TOMORROW = "2026-08-24";
const PARSO = "2026-08-25";

const teamId = "team_mjPt9Nv2iYRaq4Ag1KrCJseo";
const projectId = "prj_OZR43H0BKgFy3Ly9wlvvWaxKhuHK";

async function loadNvidiaKeyFromVercel() {
  if ((process.env.NVIDIA_API_KEY || "").trim()) return true;
  const token = (process.env.VERCEL_TOKEN || "").trim();
  if (!token) return false;
  try {
    const list = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env?teamId=${teamId}&decrypt=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!list.ok) return false;
    const json = await list.json();
    const row = (json.envs || []).find((e) => e.key === "NVIDIA_API_KEY" && e.value);
    if (row?.value) {
      process.env.NVIDIA_API_KEY = String(row.value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function placeOk(got, aliases) {
  if (!got) return false;
  const g = norm(got);
  return aliases.some((a) => g === a || g.includes(a) || a.includes(g));
}

function toolOf(ex) {
  if (!ex) return null;
  return ex.tool || ex.suggestedAction || null;
}

const ASR = ["amritsar", "asr", "amritsar junction"];
const LDH = ["ludhiana", "ldh", "ludhiana junction"];
const DELHI = ["delhi", "dilli", "ndls", "new delhi", "दिल्ली"];
const JAMMU = ["jammu", "jat", "jammu tawi"];
const BEAS = ["beas"];

const CASES = [
  {
    id: 1,
    text: "Mujhe Amritsar se Ludhiana jaana hai",
    known: {},
    lastAsked: null,
    expect: {
      intents: ["BOOK_TRAIN", "SEARCH_TRAIN"],
      origin: ASR,
      dest: LDH,
      dateMissing: true,
      noAssumeToday: true,
      tools: ["searchTrains", "updateBookingState", "none", null],
    },
  },
  {
    id: 2,
    text: "Kal Amritsar se Delhi ki 2 ticket book karni hain",
    known: {},
    lastAsked: null,
    expect: {
      intents: ["BOOK_TRAIN", "SEARCH_TRAIN"],
      origin: ASR,
      dest: DELHI,
      dateIso: TOMORROW,
      passengers: 2,
      tools: ["searchTrains", "updateBookingState", "none", null],
    },
  },
  {
    id: 3,
    text: "12014 ka live status batao",
    known: {},
    lastAsked: null,
    expect: {
      intents: ["LIVE_TRAIN_STATUS"],
      trainNumber: "12014",
      tools: ["getLiveStatus"],
      dateIsoNull: true,
    },
  },
  {
    id: 4,
    text: "12014 mein CC available hai?",
    known: {},
    lastAsked: null,
    expect: {
      intents: ["CHECK_AVAILABILITY"],
      trainNumber: "12014",
      classCodes: ["CC"],
      tools: ["getAvailability"],
    },
  },
  {
    id: 5,
    text: "12014 ka CC fare?",
    known: {},
    lastAsked: null,
    expect: {
      intents: ["CHECK_FARE"],
      trainNumber: "12014",
      classCodes: ["CC"],
      tools: ["getFare"],
    },
  },
  {
    id: 6,
    text: "CC kya hota hai?",
    known: {},
    lastAsked: null,
    expect: {
      intents: ["GENERAL_RAILWAY_KNOWLEDGE"],
      tools: ["none", null],
      noLiveTool: true,
    },
  },
  {
    id: 7,
    text: "meri ticket history dikhao",
    known: {},
    lastAsked: null,
    expect: { intents: ["VIEW_BOOKINGS"], tools: ["getMyBookings"] },
  },
  {
    id: 8,
    text: "PNR check karo",
    known: {},
    lastAsked: null,
    expect: { intents: ["CHECK_PNR"], tools: ["checkPNR"], missingPnr: true },
  },
  {
    id: 9,
    text: "wallet mein kitne paise hain?",
    known: {},
    lastAsked: null,
    expect: { intents: ["VIEW_WALLET"], tools: ["getWallet"] },
  },
  {
    id: 10,
    text: "Jammu se Beas jaana hai",
    known: {},
    lastAsked: null,
    expect: {
      intents: ["BOOK_TRAIN", "SEARCH_TRAIN"],
      origin: JAMMU,
      dest: BEAS,
      dateMissing: true,
    },
  },
  {
    id: 11,
    text: "pehli wali",
    known: {},
    lastAsked: "train",
    expect: { intents: ["SELECT_TRAIN"], selectionIndex: 1, tools: ["selectTrain"] },
  },
  {
    id: 12,
    text: "doosri wali",
    known: {},
    lastAsked: "train",
    expect: { intents: ["SELECT_TRAIN"], selectionIndex: 2, tools: ["selectTrain"] },
  },
  {
    id: 13,
    text: "12014 wali",
    known: {},
    lastAsked: "train",
    expect: { intents: ["SELECT_TRAIN"], trainNumber: "12014", tools: ["selectTrain"] },
  },
  {
    id: 14,
    text: "12014 aur 14542 mein kaunsi better hai?",
    known: {},
    lastAsked: "train",
    expect: { intents: ["COMPARE_TRAINS"], tools: ["compareTrains"] },
  },
  {
    id: 15,
    text: "12014 ka live status batao",
    known: { origin: "Amritsar Junction (ASR)", destination: "Ludhiana Junction (LDH)" },
    lastAsked: "date",
    expect: {
      intents: ["LIVE_TRAIN_STATUS"],
      trainNumber: "12014",
      tools: ["getLiveStatus"],
      contextAction: ["interrupt", "preserve"],
      preserveRoute: true,
    },
  },
  {
    id: 16,
    text: "Kal",
    known: { origin: "Amritsar Junction (ASR)", destination: "Ludhiana Junction (LDH)" },
    lastAsked: "date",
    expect: {
      intents: ["BOOK_TRAIN", "SEARCH_TRAIN", "CHANGE_DATE", "NONE"],
      dateIso: TOMORROW,
      notLive: true,
    },
  },
  {
    id: 17,
    text: "Nahi, Ludhiana se jaana hai",
    known: { origin: "Amritsar Junction (ASR)", destination: "New Delhi (NDLS)" },
    lastAsked: null,
    expect: {
      intents: ["BOOK_TRAIN", "SEARCH_TRAIN", "NONE"],
      origin: LDH,
      dest: DELHI,
      correction: true,
    },
  },
  {
    id: 18,
    text: "12014 cancel hai?",
    known: {},
    lastAsked: null,
    expect: { intents: ["CANCELLED_TRAINS"], trainNumber: "12014", tools: ["getCancelledTrains"] },
  },
  {
    id: 19,
    text: "Amritsar se cancelled trains batao",
    known: {},
    lastAsked: null,
    expect: { intents: ["CANCELLED_TRAINS"], tools: ["getCancelledTrains"] },
  },
  {
    id: 20,
    text: "Haan book kar do",
    known: { origin: "Amritsar Junction (ASR)", destination: "Ludhiana Junction (LDH)", date: TOMORROW },
    lastAsked: null,
    expect: {
      intents: ["BOOK_TRAIN", "CONFIRM_YES"],
      noMoneyTool: true,
      confirmBook: false,
    },
  },
  {
    id: 21,
    text: "12014 abhi kaha hai?",
    known: {},
    lastAsked: null,
    expect: { intents: ["LIVE_TRAIN_STATUS"], trainNumber: "12014", tools: ["getLiveStatus"] },
  },
  {
    id: 22,
    text: "12014 kitni late hai?",
    known: {},
    lastAsked: null,
    expect: { intents: ["LIVE_TRAIN_STATUS"], tools: ["getLiveStatus"] },
  },
  {
    id: 23,
    text: "fast wali kaunsi hai?",
    known: {},
    lastAsked: "train",
    expect: { intents: ["SELECT_FASTEST"] },
  },
  {
    id: 24,
    text: "Nahi, parso",
    known: { origin: "Amritsar Junction (ASR)", destination: "Ludhiana Junction (LDH)", date: TOMORROW },
    lastAsked: "date",
    expect: { dateIso: PARSO, intents: ["CHANGE_DATE", "BOOK_TRAIN", "SEARCH_TRAIN", "NONE"] },
  },
  {
    id: 25,
    text: "Nahi, 3 passengers",
    known: {
      origin: "Amritsar Junction (ASR)",
      destination: "Ludhiana Junction (LDH)",
      date: TOMORROW,
      passengers: 2,
    },
    lastAsked: "passengers",
    expect: { passengers: 3, intents: ["BOOK_TRAIN", "SEARCH_TRAIN", "NONE"] },
  },
  {
    id: 26,
    text: "bhai 12014 abhi kaha hai",
    known: {},
    lastAsked: null,
    expect: { intents: ["LIVE_TRAIN_STATUS"], trainNumber: "12014", tools: ["getLiveStatus"] },
  },
  {
    id: 27,
    text: "meri last ticket dikhao",
    known: {},
    lastAsked: null,
    expect: { intents: ["VIEW_BOOKINGS"], tools: ["getMyBookings"] },
  },
  {
    id: 28,
    text: "kal 2 ticket chahiye",
    known: { origin: "Amritsar Junction (ASR)", destination: "Ludhiana Junction (LDH)" },
    lastAsked: "date",
    expect: { intents: ["BOOK_TRAIN", "SEARCH_TRAIN", "NONE"], dateIso: TOMORROW, passengers: 2 },
  },
];

function scoreOne(ex, expect, latencyMs, failureReason) {
  const jsonValid = Boolean(ex);
  const safety =
    !ex ||
    (!isForbiddenMoneyTool(ex.tool) && !isForbiddenMoneyTool(ex.suggestedAction) && geminiSafetyOk(ex));
  const intentOk = jsonValid && expect.intents.includes(ex.intent);
  let entityHits = 0;
  let entityNeed = 0;
  const checkPlace = (got, aliases) => {
    entityNeed += 1;
    if (placeOk(got, aliases)) entityHits += 1;
  };
  if (expect.origin) checkPlace(ex?.origin, expect.origin);
  if (expect.dest) checkPlace(ex?.destination, expect.dest);
  if (expect.trainNumber) {
    entityNeed += 1;
    if (String(ex?.trainNumber || "").includes(expect.trainNumber)) entityHits += 1;
  }
  if (expect.classCodes) {
    entityNeed += 1;
    const klass = String(ex?.class || "").toUpperCase();
    if (expect.classCodes.some((c) => klass.includes(c))) entityHits += 1;
  }
  if (expect.passengers != null) {
    entityNeed += 1;
    if (ex?.passengers === expect.passengers) entityHits += 1;
  }
  if (expect.dateIso) {
    entityNeed += 1;
    if (ex?.dateIso === expect.dateIso) entityHits += 1;
  }
  if (expect.selectionIndex) {
    entityNeed += 1;
    if (ex?.selectionIndex === expect.selectionIndex) entityHits += 1;
  }
  const entityOk = entityNeed === 0 ? jsonValid : entityHits === entityNeed;
  const tool = toolOf(ex);
  const toolOk = expect.tools ? expect.tools.includes(tool) : true;
  const missingOk = expect.dateMissing
    ? !ex?.dateIso && !(ex?.date && /aaj|today/i.test(String(ex.date)))
    : true;
  const noToday = expect.noAssumeToday ? ex?.dateIso !== TODAY : true;
  const dateIsoNull = expect.dateIsoNull ? !ex?.dateIso : true;
  const noLive = expect.noLiveTool ? tool !== "getLiveStatus" && ex?.intent !== "LIVE_TRAIN_STATUS" : true;
  const notLive = expect.notLive ? ex?.intent !== "LIVE_TRAIN_STATUS" : true;
  const noMoney = expect.noMoneyTool ? safety && tool !== "confirmBooking" : true;
  const contextOk = expect.preserveRoute
    ? true
    : expect.correction
      ? Boolean(ex?.corrections?.length) || placeOk(ex?.origin, expect.origin || [])
      : true;
  const timeout = failureReason === "timeout" || failureReason === "network" || String(failureReason || "").startsWith("http_");
  return {
    jsonValid,
    intentOk,
    entityOk,
    toolOk: toolOk && noLive,
    missingOk: missingOk && noToday && dateIsoNull,
    contextOk,
    safetyOk: safety && noMoney && notLive !== false,
    latencyMs,
    error: Boolean(failureReason) && !jsonValid,
    timeout,
    intent: ex?.intent ?? null,
    origin: ex?.origin ?? null,
    destination: ex?.destination ?? null,
    dateIso: ex?.dateIso ?? null,
    passengers: ex?.passengers ?? null,
    class: ex?.class ?? null,
    trainNumber: ex?.trainNumber ?? null,
    tool,
    selectionIndex: ex?.selectionIndex ?? null,
    contextAction: ex?.contextAction ?? null,
    failureReason: failureReason ?? null,
  };
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function p95(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1);
  return s[i];
}

function avg(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function nluToExtraction(nlu) {
  if (!nlu) return null;
  const toolByIntent = {
    LIVE_TRAIN_STATUS: "getLiveStatus",
    CHECK_AVAILABILITY: "getAvailability",
    CHECK_FARE: "getFare",
    COMPARE_TRAINS: "compareTrains",
    SELECT_TRAIN: "selectTrain",
    VIEW_BOOKINGS: "getMyBookings",
    CHECK_PNR: "checkPNR",
    VIEW_WALLET: "getWallet",
    CANCELLED_TRAINS: "getCancelledTrains",
    GENERAL_RAILWAY_KNOWLEDGE: "none",
    BOOK_TRAIN: "updateBookingState",
    SEARCH_TRAIN: "searchTrains",
    SELECT_FASTEST: "selectTrain",
    CHANGE_DATE: "updateBookingState",
    CONFIRM_YES: "none",
  };
  return {
    intent: nlu.intent,
    origin: nlu.from?.city || nlu.from?.name || nlu.unresolvedFrom || null,
    destination: nlu.to?.city || nlu.to?.name || nlu.unresolvedTo || null,
    date: nlu.date || null,
    dateIso: nlu.date || null,
    passengers: nlu.passengerCount ?? null,
    class: nlu.classCodes?.[0] ?? null,
    trainNumber: nlu.trainNumber ?? null,
    tool: toolByIntent[nlu.intent] ?? null,
    suggestedAction: toolByIntent[nlu.intent] ?? "none",
    selectionIndex: null,
    contextAction: "preserve",
    corrections: nlu.correction ? [{ field: "origin", value: nlu.from?.city || "" }] : [],
    missingFields: [],
    confidence: 0.7,
    clarificationNeeded: false,
    preferences: { train: null, time: null, seat: null, quota: null },
  };
}

async function nvidiaViaProduction(row) {
  const started = Date.now();
  try {
    const res = await fetch("https://railbook-three.vercel.app/api/understand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: row.text,
        lastAsked: row.lastAsked,
        now: `${TODAY}T06:00:00.000Z`,
        known: {
          from: row.known.origin && /ASR/.test(row.known.origin) ? { code: "ASR", name: "Amritsar Junction", city: "Amritsar" } : row.known.origin && /NDLS/.test(row.known.origin) ? { code: "NDLS", name: "New Delhi", city: "Delhi" } : undefined,
          to: row.known.destination && /LDH/.test(row.known.destination) ? { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" } : row.known.destination && /NDLS/.test(row.known.destination) ? { code: "NDLS", name: "New Delhi", city: "Delhi" } : undefined,
          date: row.known.date ?? null,
          passengerCount: row.known.passengers ?? null,
        },
      }),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { extraction: null, latencyMs, failureReason: `http_${res.status}`, source: res.status ? "ai" : null, provider: "nvidia", modelUsed: "production-stack" };
    }
    const json = await res.json();
    return {
      extraction: nluToExtraction(json.nlu),
      latencyMs: json.latencyMs ?? latencyMs,
      failureReason: json.failureReason && json.source === "nlu" && json.failureReason !== "fast_path" ? json.failureReason : null,
      source: json.source ?? "nlu",
      provider: json.provider ?? "nvidia",
      modelUsed: json.modelUsed ?? (json.source === "nlu" ? "nlu-fast-path" : "openai/gpt-oss-20b"),
    };
  } catch {
    return { extraction: null, latencyMs: Date.now() - started, failureReason: "network", source: null, provider: "nvidia", modelUsed: null };
  }
}

async function runProvider(kind, row) {
  const input = {
    text: row.text,
    today: TODAY,
    lastAsked: row.lastAsked,
    known: row.known,
  };
  if (kind === "nvidia") {
    const direct = await extractWithLlm(input);
    if (direct.extraction || direct.failureReason !== "missing_key") return direct;
    return nvidiaViaProduction(row);
  }
  return extractWithRapidGemini(input);
}

function mdEscape(s) {
  return String(s ?? "—").replace(/\|/g, "/").replace(/\n/g, " ");
}

async function main() {
  const nvidiaReady = await loadNvidiaKeyFromVercel();
  const geminiReady = Boolean((process.env.GEMINI_API_KEY || "").trim());
  if (!nvidiaReady) console.error("EVAL nvidia_key=missing");
  else console.error("EVAL nvidia_key=present");
  const rapidReady = Boolean((process.env.RAPIDAPI_GEMINI_KEY || process.env.RAPIDAPI_KEY || "").trim());
  if (!rapidReady) console.error("EVAL rapidapi_gemini_key=missing");
  else console.error("EVAL rapidapi_gemini_key=present");
  console.error(`EVAL rapidapi_gemini_host=${process.env.RAPIDAPI_GEMINI_HOST || "gemini-pro-ai-new.p.rapidapi.com"}`);
  console.error(`EVAL rapidapi_gemini_model=${process.env.RAPIDAPI_GEMINI_MODEL || "gemini-2.5-pro"}`);
  console.error(`EVAL nvidia_model=${process.env.NVIDIA_MODEL || "openai/gpt-oss-20b"}`);

  const rows = [];
  for (const c of CASES) {
    const [nvidia, gemini] = await Promise.all([runProvider("nvidia", c), runProvider("gemini", c)]);
    const nScore = scoreOne(nvidia.extraction, c.expect, nvidia.latencyMs, nvidia.failureReason);
    const gScore = scoreOne(gemini.extraction, c.expect, gemini.latencyMs, gemini.failureReason);
    const nWins =
      Number(nScore.intentOk) + Number(nScore.entityOk) + Number(nScore.toolOk) + Number(nScore.jsonValid);
    const gWins =
      Number(gScore.intentOk) + Number(gScore.entityOk) + Number(gScore.toolOk) + Number(gScore.jsonValid);
    let winner = "tie";
    if (gWins > nWins) winner = "gemini";
    else if (nWins > gWins) winner = "nvidia";
    rows.push({
      id: c.id,
      text: c.text,
      nvidia: nScore,
      gemini: gScore,
      winner,
    });
    console.error(`EVAL case=${c.id} nvidia_ok=${nScore.intentOk && nScore.jsonValid} gemini_ok=${gScore.intentOk && gScore.jsonValid} winner=${winner}`);
  }

  const metric = (side, key) => pct(rows.filter((r) => r[side][key]).length, rows.length);
  const nLat = rows.map((r) => r.nvidia.latencyMs);
  const gLat = rows.map((r) => r.gemini.latencyMs);
  const summary = {
    cases: rows.length,
    nvidia: {
      intent: metric("nvidia", "intentOk"),
      entity: metric("nvidia", "entityOk"),
      tool: metric("nvidia", "toolOk"),
      json: metric("nvidia", "jsonValid"),
      context: metric("nvidia", "contextOk"),
      safety: metric("nvidia", "safetyOk"),
      missing: metric("nvidia", "missingOk"),
      avgLatency: avg(nLat),
      p95Latency: p95(nLat),
      errorRate: metric("nvidia", "error"),
    },
    gemini: {
      intent: metric("gemini", "intentOk"),
      entity: metric("gemini", "entityOk"),
      tool: metric("gemini", "toolOk"),
      json: metric("gemini", "jsonValid"),
      context: metric("gemini", "contextOk"),
      safety: metric("gemini", "safetyOk"),
      missing: metric("gemini", "missingOk"),
      avgLatency: avg(gLat),
      p95Latency: p95(gLat),
      errorRate: metric("gemini", "error"),
    },
    geminiWins: rows.filter((r) => r.winner === "gemini").map((r) => r.id),
    nvidiaWins: rows.filter((r) => r.winner === "nvidia").map((r) => r.id),
    ties: rows.filter((r) => r.winner === "tie").map((r) => r.id),
  };

  const better =
    summary.gemini.intent + summary.gemini.entity + summary.gemini.tool + summary.gemini.json >
    summary.nvidia.intent + summary.nvidia.entity + summary.nvidia.tool + summary.nvidia.json;

  const lines = [];
  lines.push("# RapidAPI Gemini Pro AI New vs NVIDIA A/B report");
  lines.push("");
  lines.push(`Date: 2026-08-23 (Asia/Calcutta). Cases: ${rows.length}.`);
  lines.push("");
  lines.push("**Mode:** RapidAPI Gemini is SHADOW / EVALUATION only. NVIDIA remains the production default.");
  lines.push("RapidAPI Gemini output is never applied to the customer reply, never runs tools, never books, never debits the wallet.");
  lines.push("");
  lines.push("| Provider | Role | Host / model |");
  lines.push("|---|---|---|");
  lines.push(`| NVIDIA | production / primary | ${process.env.NVIDIA_MODEL || "openai/gpt-oss-20b"} |`);
  lines.push(`| RapidAPI Gemini Pro AI New | shadow / eval | ${process.env.RAPIDAPI_GEMINI_HOST || "gemini-pro-ai-new.p.rapidapi.com"} / ${process.env.RAPIDAPI_GEMINI_MODEL || "gemini-2.5-pro"} |`);
  lines.push("");
  lines.push("## Headline scores");
  lines.push("");
  lines.push("| Metric | NVIDIA | Gemini |");
  lines.push("|---|---:|---:|");
  lines.push(`| Intent accuracy | ${summary.nvidia.intent}% | ${summary.gemini.intent}% |`);
  lines.push(`| Entity accuracy | ${summary.nvidia.entity}% | ${summary.gemini.entity}% |`);
  lines.push(`| Tool-selection accuracy | ${summary.nvidia.tool}% | ${summary.gemini.tool}% |`);
  lines.push(`| JSON validity | ${summary.nvidia.json}% | ${summary.gemini.json}% |`);
  lines.push(`| Context accuracy | ${summary.nvidia.context}% | ${summary.gemini.context}% |`);
  lines.push(`| Missing-slot handling | ${summary.nvidia.missing}% | ${summary.gemini.missing}% |`);
  lines.push(`| Safety accuracy | ${summary.nvidia.safety}% | ${summary.gemini.safety}% |`);
  lines.push(`| Average latency | ${summary.nvidia.avgLatency} ms | ${summary.gemini.avgLatency} ms |`);
  lines.push(`| P95 latency | ${summary.nvidia.p95Latency} ms | ${summary.gemini.p95Latency} ms |`);
  lines.push(`| Timeout / error rate | ${summary.nvidia.errorRate}% | ${summary.gemini.errorRate}% |`);
  lines.push("");
  lines.push("## Per-case");
  lines.push("");
  lines.push("| # | Utterance | NVIDIA intent | Gemini intent | NVIDIA entities | Gemini entities | NVIDIA tool | Gemini tool | JSON N/G | Context | Missing | Safety G | NVIDIA ms | Gemini ms | Winner |");
  lines.push("|---:|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---|");
  for (const r of rows) {
    const ne = `${mdEscape(r.nvidia.origin)}→${mdEscape(r.nvidia.destination)} ${r.nvidia.dateIso || ""} pax=${r.nvidia.passengers ?? "—"} ${r.nvidia.trainNumber || ""} ${r.nvidia.class || ""}`.trim();
    const ge = `${mdEscape(r.gemini.origin)}→${mdEscape(r.gemini.destination)} ${r.gemini.dateIso || ""} pax=${r.gemini.passengers ?? "—"} ${r.gemini.trainNumber || ""} ${r.gemini.class || ""}`.trim();
    lines.push(
      `| ${r.id} | ${mdEscape(r.text)} | ${mdEscape(r.nvidia.intent)} | ${mdEscape(r.gemini.intent)} | ${ne} | ${ge} | ${mdEscape(r.nvidia.tool)} | ${mdEscape(r.gemini.tool)} | ${r.nvidia.jsonValid ? "Y" : "N"}/${r.gemini.jsonValid ? "Y" : "N"} | N ${r.nvidia.contextOk ? "Y" : "N"} / G ${r.gemini.contextOk ? "Y" : "N"} | N ${r.nvidia.missingOk ? "Y" : "N"} / G ${r.gemini.missingOk ? "Y" : "N"} | ${r.gemini.safetyOk ? "Y" : "N"} | ${r.nvidia.latencyMs} | ${r.gemini.latencyMs} | ${r.winner} |`,
    );
  }
  lines.push("");
  lines.push("## Who won which cases");
  lines.push("");
  lines.push(`- Gemini won: ${summary.geminiWins.join(", ") || "none"}`);
  lines.push(`- NVIDIA won: ${summary.nvidiaWins.join(", ") || "none"}`);
  lines.push(`- Tie: ${summary.ties.join(", ") || "none"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- NVIDIA remains default. Gemini cannot book, confirm, debit wallet, create PNR, or mutate booking/railway data.");
  lines.push("- `extractWithGemini` always returns `confirmBook: false` and `executeTools: false`.");
  lines.push("- Customer `/api/understand` still packs NVIDIA or deterministic NLU only.");
  lines.push("- No API keys are written into this report.");
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  if (better) {
    lines.push("Gemini scored higher on this shadow set, but **replacing NVIDIA is NOT recommended automatically**.");
    lines.push("Keep NVIDIA as production. Re-run shadow after more live traffic before any cutover.");
  } else {
    lines.push("NVIDIA scored at least as well as Gemini on this set. **Do not replace NVIDIA.**");
    lines.push("Keep Gemini in shadow/eval if you want more samples.");
  }
  lines.push("");
  lines.push("BookKaro production path is unchanged: NVIDIA gpt-oss-20b + deterministic NLU fast-path + RailCore/RailKit facts.");

  writeFileSync(new URL("../RAPIDAPI_GEMINI_VS_NVIDIA_AB_REPORT.md", import.meta.url), `${lines.join("\n")}\n`);
  console.error("EVAL report=RAPIDAPI_GEMINI_VS_NVIDIA_AB_REPORT.md");
  console.error(
    JSON.stringify({
      nvidia: summary.nvidia,
      gemini: summary.gemini,
      geminiWins: summary.geminiWins,
      nvidiaWins: summary.nvidiaWins,
      betterForBookKaro: better ? "gemini_shadow_only" : "nvidia",
      replaceNvidia: false,
    }),
  );
}

main().catch((err) => {
  console.error("EVAL_FAIL", err instanceof Error ? err.message : "error");
  process.exit(1);
});
