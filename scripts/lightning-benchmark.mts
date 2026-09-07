/**
 * LIGHTNING-30B-A3B vs GPT-OSS-20B vs GLM (HF) — Round-14 A/B/C BENCHMARK
 * Mandate: benchmark ONLY. NO deploy, NO production config change.
 * Same system prompt / tools / schema / allowlist / validation / grounding
 * guards / providers — sirf model badalta hai. Cases A–L EXACT same
 * (nemotron-benchmark.mts se — fair historical comparison bhi).
 *
 * Run:
 *   BENCH_MODEL=gptoss    npx tsx scripts/lightning-benchmark.mts
 *   BENCH_MODEL=lightning npx tsx scripts/lightning-benchmark.mts
 *   BENCH_MODEL=glm       npx tsx scripts/lightning-benchmark.mts
 */
import { readFileSync, writeFileSync } from "node:fs";

/* ── 0) .env load BEFORE server imports ─────────────────────────────── */
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const LEG_RAW = process.env.BENCH_MODEL ?? "gptoss";
const LEG = (["lightning", "lightning-nothink", "glm", "deepseek", "gptoss", "muse"].includes(LEG_RAW) ? LEG_RAW : "gptoss") as
  | "lightning" | "lightning-nothink" | "glm" | "deepseek" | "gptoss" | "muse";
const MUSE = "meta/muse-glimmer-30b";
const NEMOTRON_LIGHTNING = "nvidia/nemotron-3.5-lightning-30b-a3b";
const GPT_OSS = "openai/gpt-oss-20b";
const DEEPSEEK = "deepseek-ai/deepseek-v4-flash-0731";
let MODEL_NAME = GPT_OSS;
/* Round-14 fix: pichhla "gptoss" leg asal mein .env ke NVIDIA_MODEL (deepseek)
 * par chala tha — ab HAR leg explicitly AGENTIC_MODEL pin karta hai (prod
 * primary = GPT_OSS, Render env). Fair A/B/C. */
if (LEG === "lightning" || LEG === "lightning-nothink") {
  process.env.AGENTIC_MODEL = NEMOTRON_LIGHTNING;
  process.env.AGENTIC_PROVIDER = "nvidia";
  process.env.NEMOTRON_THINKING = LEG === "lightning-nothink" ? "off" : "on";
  MODEL_NAME = NEMOTRON_LIGHTNING + (LEG === "lightning-nothink" ? " (thinking=off)" : " (thinking=on)");
} else if (LEG === "glm") {
  process.env.AGENTIC_PROVIDER = "hf";
  delete process.env.AGENTIC_MODEL;
  MODEL_NAME = process.env.HF_MODEL ?? "hf-glm";
} else if (LEG === "muse") {
  process.env.AGENTIC_MODEL = MUSE;
  process.env.AGENTIC_PROVIDER = "nvidia";
  if (process.env.BENCH_NVIDIA_KEY) process.env.NVIDIA_API_KEY = process.env.BENCH_NVIDIA_KEY;
  MODEL_NAME = MUSE;
} else if (LEG === "deepseek") {
  process.env.AGENTIC_MODEL = DEEPSEEK;
  process.env.AGENTIC_PROVIDER = "nvidia";
  MODEL_NAME = DEEPSEEK;
} else {
  process.env.AGENTIC_MODEL = GPT_OSS; // prod primary (Render: NVIDIA_MODEL=openai/gpt-oss-20b)
  process.env.AGENTIC_PROVIDER = "nvidia";
}
// Fairness: teeno legs ko same generous timeouts
process.env.AI_AGENTIC_TIMEOUT_MS = process.env.BENCH_TIMEOUT_MS ?? "60000";
process.env.AI_AGENTIC_TURN_BUDGET_MS = process.env.BENCH_TURN_BUDGET_MS ?? "150000";

const AI_BASE = LEG === "glm" ? process.env.HF_BASE_URL : (process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1");
const KEY = LEG === "glm" ? process.env.HF_TOKEN : process.env.NVIDIA_API_KEY;
if (!KEY) {
  console.error(`${LEG === "glm" ? "HF_TOKEN" : "NVIDIA_API_KEY"} missing — .env check karo.`);
  process.exit(2);
}

/* ── fetch instrumentation ── */
const AI_HOST = new URL(AI_BASE).hostname;
const SECRET_RE = /rk_live_[A-Za-z0-9_-]+|rk_test_[A-Za-z0-9_-]+|railkit_[A-Za-z0-9]{20,}/;
const CALLS = { ai: 0, railcore: 0, railkit: 0, aiDurations: [] as number[] };
let leakDetected = false;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: any, init?: any) => {
  const t0 = Date.now();
  let host = "";
  try {
    const u = new URL(String(input instanceof Request ? input.url : input));
    host = u.hostname;
    if (host === AI_HOST) {
      CALLS.ai++;
      if (init?.body && SECRET_RE.test(String(init.body))) leakDetected = true;
    } else if (host === "ir.railcore.tech") CALLS.railcore++;
    else if (host.includes("railkit")) CALLS.railkit++;
  } catch {
    /* non-URL input */
  }
  const res = await realFetch(input, init);
  if (host === AI_HOST) CALLS.aiDurations.push(Date.now() - t0);
  return res;
}) as typeof fetch;

const { runAgenticTurn } = await import("../server/agent/agentic.js");

/* ── helpers ────────────────────────────────────────────────────────── */
const NOW = new Date();
const YMD = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = YMD(NOW);
const TOMORROW = YMD(new Date(NOW.getTime() + 86400000));
const pace = (ms = 15000) => new Promise((r) => setTimeout(r, ms)); // RailCore 20/min pacing


const RESULTS: Record<string, unknown>[] = [];
const METRICS = { turns: 0, toolCalls: 0, toolOk: 0, aiCalls: 0, hallucinationFlags: 0 };

function evidenceOf(steps: { args?: unknown; summary?: unknown; dataPreview?: unknown }[], text: string, history: { role: string; content: string }[] = []): string {
  // Server-side grounding full tool-data (20k) use karta hai jo turn-result par expose
  // nahi hota — hum heuristic mein user text + history bhi evidence maante hain
  // (user ne khud bola number hallucination nahi). Dono legs same logic = fair.
  return JSON.stringify(steps.map((s) => [s.summary, s.args, s.dataPreview])) + " " + text + " " + history.map((h) => h.content).join(" ");
}
/** Secondary heuristic (server ka `grounded` flag PRIMARY hai — full-data wala).
 *  Reply ke 5-digit numbers / ₹ amounts / unknown uppercase tokens jo kisi
 *  bhi evidence mein nahi mile. Preview-truncation se thoda over-count kar sakta hai. */
function hallucinations(reply: string, steps: { args?: unknown; summary?: unknown; dataPreview?: unknown }[], text = "", history: { role: string; content: string }[] = []): string[] {
  const ev = evidenceOf(steps, text, history);
  const bad: string[] = [];
  for (const n of reply.match(/\b\d{5}\b/g) ?? []) if (!ev.includes(n)) bad.push(`train:${n}`);
  for (const n of reply.match(/₹\s?\d+(?:\.\d+)?/g) ?? []) if (!ev.includes(n.replace(/₹\s?/, ""))) bad.push(`fare:${n}`);
  for (const t of [...new Set(reply.match(/\b[A-Z]{2,5}\b/g) ?? [])]) {
    if (["CC", "SL", "AC", "GN", "TATKAL", "RAC", "WL", "ASR", "NDLS", "LDH", "DLI", "NZM", "AI", "OK", "PM", "AM"].includes(t)) continue;
    if (!new RegExp(`\\b${t}\\b`).test(ev)) bad.push(`token:${t}`);
  }
  return [...new Set(bad)];
}
const LEAK_RE = /<\||im_start|im_end|tool_calls|AGENTIC_TOOLS|\{"name"\s*:|<\/?function>|system_prompt/i;

async function turn(id: string, text: string, known: Record<string, unknown> = {}, history: { role: "user" | "assistant"; content: string }[] = []) {
  METRICS.turns++;
  const ai0 = CALLS.ai;
  const aiDur0 = CALLS.aiDurations.length;
  const t = await runAgenticTurn({ text, now: NOW.toISOString(), known: known as never, history });
  const reply = String(t.reply ?? "");
  const modelCalls = CALLS.ai - ai0;
  const modelLatencyMs = CALLS.aiDurations.slice(aiDur0).reduce((a, b) => a + b, 0);
  const toolLatencyMs = t.steps.reduce((a, s) => a + (s.latencyMs ?? 0), 0);
  const hal = reply ? hallucinations(reply, t.steps, text, history) : [];
  METRICS.toolCalls += t.steps.length;
  for (const s of t.steps) if (s.ok) METRICS.toolOk++;
  METRICS.aiCalls += modelCalls;
  METRICS.hallucinationFlags += hal.length;
  const hygiene = {
    noUnknownTools: t.steps.every((s) => !/approved list mein nahi|Unknown tool/i.test(String(s.summary ?? ""))),
    noMalformedJson: t.steps.every((s) => !/Invalid arguments for|bad_json/i.test(String(s.summary ?? ""))),
    noTemplateLeakage: !LEAK_RE.test(reply),
    stoppedAfterSufficient: t.steps.length <= 4,
  };
  return {
    id, text, reply: reply.slice(0, 500), tools: t.steps.map((s) => ({ tool: s.tool, args: s.args, ok: s.ok, source: s.source, summary: String(s.summary ?? "").slice(0, 160) })),
    metrics: {
      modelUsed: t.modelUsed, modelCalls, modelLatencyMs, ttfr: null as null,
      toolCalls: t.steps.length, toolLatencyMs, totalMs: t.latencyMs,
      ok: t.ok, grounded: t.grounded, failureReason: t.failureReason, fallbackWouldTrigger: t.failureReason != null || !t.ok,
    },
    hallucinations: hal, hygiene,
  };
}

function record(id: string, title: string, checks: Record<string, boolean>, detail: string, r: Record<string, unknown>) {
  const pass = Object.values(checks).every((v) => v === true);
  RESULTS.push({ id, title, pass, checks, detail, ...r });
  console.log(`  ${pass ? "✅" : "❌"} [${id}] ${title}`);
  if (!pass) console.log(`     checks: ${JSON.stringify(checks)} | ${detail.slice(0, 200)}`);
  // Incremental write — 550B slow hai; agar process kahin bhi mare, data mila rahe.
  try {
    writeFileSync(
      new URL(`../LIGHTNING_BENCH_${LEG}.json`, import.meta.url),
      JSON.stringify({ ranAt: new Date().toISOString(), leg: LEG, model: MODEL_NAME, partial: true, results: RESULTS, calls: CALLS, metrics: METRICS, leakDetected }, null, 2),
    );
  } catch {
    /* write fail par bhi benchmark chalta rahe */
  }
}

/* ── crash guards + guaranteed report write ──────────────────────────── */
let REPORT_WRITTEN = false;
function writeReport() {
  if (REPORT_WRITTEN) return;
  REPORT_WRITTEN = true;
  writeFileSync(
    new URL(`../LIGHTNING_BENCH_${LEG}.json`, import.meta.url),
    JSON.stringify({ ranAt: new Date().toISOString(), leg: LEG, model: MODEL_NAME, results: RESULTS, calls: CALLS, metrics: METRICS, leakDetected }, null, 2),
  );
  console.log(`\nFull JSON: LIGHTNING_BENCH_${LEG}.json`);
}
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("beforeExit", () => {
  if (!REPORT_WRITTEN) writeReport();
});
const ONLY = new Set((process.env.BENCH_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const run = (id: string) => ONLY.size === 0 || ONLY.has(id);

/* ════ CASES (user-specified A–L, EXACT prompts) ═══════════════════════ */

/* A. BASIC JOURNEY — "Amritsar se Ludhiana kal jaana hai" */
if (run("A")) {
  await pace();
  const r = await turn("A", "Amritsar se Ludhiana kal jaana hai");
  const st = r.tools.find((t) => t.tool === "SEARCH_TRAINS" || t.tool === "JOURNEY_ANALYZE");
  const args = st?.args as Record<string, unknown> ?? {};
  record("A", "BASIC JOURNEY — SEARCH_TRAINS, date=tomorrow", {
    searchCalled: Boolean(st),
    dateTomorrow: String(args.date ?? "") === TOMORROW,
    routeOk: /asr|amritsar/i.test(String(args.origin ?? "")) && /ldh|ludhiana/i.test(String(args.destination ?? "")),
    grounded: r.metrics.grounded === true,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | date=${String(args.date)} | ${r.metrics.totalMs}ms`, r);
}

/* B. FASTEST TRAIN — "Amritsar se Delhi sabse fast train kaunsi hai?" */
if (run("B")) {
  await pace();
  const r = await turn("B", "Amritsar se Delhi sabse fast train kaunsi hai?");
  const st = r.tools.find((t) => t.tool === "SEARCH_TRAINS" || t.tool === "JOURNEY_ANALYZE");
  const args = st?.args as Record<string, unknown> ?? {};
  record("B", "FASTEST TRAIN — search + deterministic fastest", {
    searchOrAtlas: Boolean(st),
    routeOk: /asr|amritsar/i.test(String(args.origin ?? "")) && /delhi|ndls|dli|nzm/i.test(String(args.destination ?? "")),
    grounded: r.metrics.grounded === true,
    nonEmptyReply: Boolean(r.reply),
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | ${r.metrics.totalMs}ms | reply=${r.reply.slice(0, 80).replace(/\n/g, " ")}`, r);
}

/* C. MULTI-TOOL — "12014 ka CC mein availability aur fare batao" */
if (run("C")) {
  await pace();
  const r = await turn("C", "12014 ka CC mein availability aur fare batao");
  const av = r.tools.find((t) => t.tool === "CHECK_AVAILABILITY");
  const fa = r.tools.find((t) => t.tool === "GET_FARE");
  const avArgs = av?.args as Record<string, unknown> ?? {};
  const faArgs = fa?.args as Record<string, unknown> ?? {};
  record("C", "MULTI-TOOL — CHECK_AVAILABILITY + GET_FARE", {
    availabilityCalled: Boolean(av),
    fareCalled: Boolean(fa),
    argsOk: String(avArgs.trainNumber ?? avArgs.train_number ?? "") === "12014" && String(faArgs.trainNumber ?? faArgs.train_number ?? "") === "12014" && /CC/i.test(String(avArgs.classCode ?? avArgs.class_code ?? faArgs.classCode ?? faArgs.class_code ?? "")),
    grounded: r.metrics.grounded === true,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | ${r.metrics.totalMs}ms`, r);
}

/* D. TRAIN COMPARISON — "12014 aur 14542 mein kaunsi Ludhiana jaldi pahunchti hai?" */
if (run("D")) {
  await pace();
  const r = await turn("D", "12014 aur 14542 mein kaunsi Ludhiana jaldi pahunchti hai?");
  const tt = r.tools.filter((t) => t.tool === "GET_TIMETABLE");
  const allArgs = JSON.stringify(r.tools.map((t) => t.args));
  const ja = r.tools.find((t) => t.tool === "JOURNEY_ANALYZE");
  record("D", "TRAIN COMPARISON — GET_TIMETABLE dono + deterministic compare", {
    timetablesOrAtlas: tt.length >= 2 || Boolean(ja),
    bothTrainsInArgs: allArgs.includes("12014") && allArgs.includes("14542"),
    replyMentionsBoth: r.reply.includes("12014") && r.reply.includes("14542"),
    grounded: r.metrics.grounded === true,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | ${r.metrics.totalMs}ms`, r);
}

/* E. LIVE STATUS — "12014 abhi kahan hai?" */
if (run("E")) {
  await pace();
  const r = await turn("E", "12014 abhi kahan hai?");
  const tr = r.tools.find((t) => t.tool === "TRACK_TRAIN");
  const args = tr?.args as Record<string, unknown> ?? {};
  record("E", "LIVE STATUS — TRACK_TRAIN", {
    trackCalled: Boolean(tr),
    trainOk: String(args.trainNumber ?? args.train_number ?? args.number ?? "") === "12014",
    grounded: r.metrics.grounded === true,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | ${r.metrics.totalMs}ms`, r);
}

/* F. MISSING DATE — "Amritsar se Ludhiana jaana hai" (date assume NAHI) */
if (run("F")) {
  await pace();
  const r = await turn("F", "Amritsar se Ludhiana jaana hai");
  const st = r.tools.find((t) => t.tool === "SEARCH_TRAINS" || t.tool === "JOURNEY_ANALYZE");
  const args = st?.args as Record<string, unknown> ?? {};
  const asksDate = /kab|date|tareekh|din| kis din /i.test(r.reply);
  record("F", "MISSING DATE — date poochhe, assume na kare", {
    asksDate: asksDate || !st,
    noAssumedSearch: !st || String(args.date ?? "") === "" || String(args.date ?? "x") === "x",
    noInventedTrains: (r.reply.match(/\b\d{5}\b/g) ?? []).length === 0 || r.hallucinations.filter((h) => h.startsWith("train:")).length === 0,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | reply=${r.reply.slice(0, 100).replace(/\n/g, " ")}`, r);
}

/* G. EXPLICIT TODAY — "Aaj Amritsar se Ludhiana jaana hai" */
if (run("G")) {
  await pace();
  const r = await turn("G", "Aaj Amritsar se Ludhiana jaana hai");
  const st = r.tools.find((t) => t.tool === "SEARCH_TRAINS" || t.tool === "JOURNEY_ANALYZE");
  const args = st?.args as Record<string, unknown> ?? {};
  record("G", "EXPLICIT TODAY — date=today", {
    searchCalled: Boolean(st),
    dateToday: String(args.date ?? "") === TODAY,
    grounded: r.metrics.grounded === true,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | date=${String(args.date)} (aaj=${TODAY}) | ${r.metrics.totalMs}ms`, r);
}

/* H. HINDI/HINGLISH — "bhai kal amritsar se delhi ki sabse jaldi wali train bata" */
if (run("H")) {
  await pace();
  const r = await turn("H", "bhai kal amritsar se delhi ki sabse jaldi wali train bata");
  const st = r.tools.find((t) => t.tool === "SEARCH_TRAINS" || t.tool === "JOURNEY_ANALYZE");
  const args = st?.args as Record<string, unknown> ?? {};
  record("H", "HINDI/HINGLISH — semantic plan sahi", {
    searchOrAtlas: Boolean(st),
    dateTomorrow: String(args.date ?? "") === TOMORROW,
    routeOk: /asr|amritsar/i.test(String(args.origin ?? "")) && /delhi|ndls|dli|nzm/i.test(String(args.destination ?? "")),
    grounded: r.metrics.grounded === true,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | date=${String(args.date)} | ${r.metrics.totalMs}ms`, r);
}

/* I. AMBIGUOUS DELHI — "Amritsar se Delhi jaana hai" (station invent NAHI) */
if (run("I")) {
  await pace();
  const r = await turn("I", "Amritsar se Delhi jaana hai");
  const st = r.tools.find((t) => t.tool === "SEARCH_TRAINS");
  const args = st?.args as Record<string, unknown> ?? {};
  const asksStation = /kaunsi|kaunsa|which station|station (?:bata|chun|choose)|NDLS|DLI|NZM|options/i.test(r.reply);
  const silentPick = Boolean(st) && /ndls|dli|nzm/i.test(String(args.destination ?? "")) && !asksStation && !/needs_choice|ambiguous/i.test(JSON.stringify(r.tools));
  record("I", "AMBIGUOUS DELHI — clarification, silent pick nahi", {
    asksStation,
    noSilentPick: !silentPick,
    noInventedStation: r.hallucinations.filter((h) => h.startsWith("token:")).length === 0,
  }, `tools=${r.tools.map((t) => `${t.tool}(${t.ok ? "ok" : "fail"})`).join("→")} | dest=${String(args.destination ?? "")} | reply=${r.reply.slice(0, 100).replace(/\n/g, " ")}`, r);
}

/* J. GENERAL RAILWAY — "RAC aur WL mein kya difference hai?" */
if (run("J")) {
  await pace();
  const r = await turn("J", "RAC aur WL mein kya difference hai?");
  const ga = r.tools.find((t) => t.tool === "GENERAL_RAILWAY_ANSWER");
  record("J", "GENERAL RAILWAY — GENERAL_RAILWAY_ANSWER", {
    generalAnswerCalled: Boolean(ga),
    nonEmptyReply: Boolean(r.reply) && r.reply.length > 40,
    explainsRacWl: /RAC/i.test(r.reply) && /WL|waitlist|waiting/i.test(r.reply),
    noHallucinatedData: r.hallucinations.length === 0,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | ${r.metrics.totalMs}ms | reply=${r.reply.slice(0, 80).replace(/\n/g, " ")}`, r);
}

/* K. UNEXPECTED NL — "Kal subah aisi train dekh jo jaldi Delhi chhod de aur shaam tak pahucha de" */
if (run("K")) {
  await pace();
  const r = await turn("K", "Kal subah aisi train dekh jo jaldi Delhi chhod de aur shaam tak pahucha de");
  const st = r.tools.find((t) => t.tool === "SEARCH_TRAINS" || t.tool === "JOURNEY_ANALYZE");
  const args = st?.args as Record<string, unknown> ?? {};
  const asksOrigin = /kahan se|from|source| kis station se/i.test(r.reply);
  record("K", "UNEXPECTED NL — semantic interpretation, no hallucination", {
    validPlanOrAsk: Boolean(st) || asksOrigin,
    dateTomorrowIfSearched: !st || String(args.date ?? "") === TOMORROW,
    delhiDest: !st || /delhi|ndls|dli|nzm/i.test(String(args.destination ?? "")),
    noHallucinatedFacts: r.hallucinations.length === 0 && r.metrics.grounded !== false,
  }, `tools=${r.tools.map((t) => t.tool).join("→")} | date=${String(args.date ?? "-")} | reply=${r.reply.slice(0, 100).replace(/\n/g, " ")}`, r);
}

/* L. MULTI-TURN — T1: "Amritsar se Delhi jaana hai" → T2: "Kal" */
if (run("L")) {
  await pace();
  const t1 = await turn("L1", "Amritsar se Delhi jaana hai");
  const reply1 = t1.reply || "Theek hai.";
  const t2 = await turn("L2", "Kal", { origin: "ASR", destination: "NDLS", date: TOMORROW }, [
    { role: "user", content: "Amritsar se Delhi jaana hai" },
    { role: "assistant", content: reply1 },
  ]);
  const st = t2.tools.find((t) => t.tool === "SEARCH_TRAINS" || t.tool === "JOURNEY_ANALYZE");
  const args = st?.args as Record<string, unknown> ?? {};
  record("L", "MULTI-TURN — state preserve, date fill, re-ask nahi", {
    statePreserved: Boolean(st) ? /asr|amritsar/i.test(String(args.origin ?? "")) && /delhi|ndls|dli|nzm/i.test(String(args.destination ?? "")) : true,
    dateFilled: !st || String(args.date ?? "") === TOMORROW,
    noReAskKnownSlots: !/kahan se|kis station|from (?:kahan|kaunsa)|destination bata/i.test(t2.reply),
    grounded: t2.metrics.grounded === true || !st,
  }, `T1=${t1.tools.map((t) => t.tool).join(",") || "ask"} → T2 tools=${t2.tools.map((t) => t.tool).join("→") || "ask"} | date=${String(args.date ?? "-")} | T2=${t2.metrics.totalMs}ms`, t2);
}

/* ── summary ────────────────────────────────────────────────────────── */
const pass = RESULTS.filter((r) => r.pass).length;
const totLat = RESULTS.map((r: any) => r.metrics?.totalMs ?? 0).filter((n) => n > 0);
const modLat = CALLS.aiDurations;
console.log(`\n══════ NEMOTRON BENCH [${LEG}] : ${pass}/${RESULTS.length} CASES PASS`);
console.log(`  Model                       : ${MODEL_NAME}`);
console.log(`  Real AI (NVIDIA API) calls  : ${CALLS.ai} | RailCore: ${CALLS.railcore} | RailKit: ${CALLS.railkit}`);
console.log(`  Tool calls / ok             : ${METRICS.toolCalls} / ${METRICS.toolOk}`);
console.log(`  Hallucination flags         : ${METRICS.hallucinationFlags}`);
console.log(`  AI call latency  avg/p50    : ${modLat.length ? Math.round(modLat.reduce((a, b) => a + b, 0) / modLat.length) : 0} ms / ${modLat.length ? [...modLat].sort((a, b) => a - b)[Math.floor(modLat.length / 2)] : 0} ms`);
console.log(`  Turn latency      avg/p50    : ${totLat.length ? Math.round(totLat.reduce((a, b) => a + b, 0) / totLat.length) : 0} ms / ${totLat.length ? [...totLat].sort((a, b) => a - b)[Math.floor(totLat.length / 2)] : 0} ms`);
console.log(`  Secret leak (AI bodies)     : ${leakDetected ? "DETECTED ❌" : "none ✓"}`);
console.log(`  TTFR                        : N/A (non-streaming API)`);
console.log("NOTE: benchmark ONLY — koi deploy/production change NAHI hua.");
writeReport();
process.exit(pass === RESULTS.length ? 0 : 1);
