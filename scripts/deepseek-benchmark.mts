/**
 * DEEPSEEK V4 FLASH (deepseek-ai/deepseek-v4-flash-0731) — COMPACT BENCHMARK
 *
 * Mandate: benchmark ONLY. NO deploy, NO production change, NO commit/push.
 * Production primary (openai/gpt-oss-20b) untouched. Existing NVIDIA integration
 * + existing agentic/tool-planner architecture — sirf AGENTIC_MODEL override
 * (benchmark-only env, prod kabhi set nahi karta).
 *
 * QUOTA-SAVING (user mandate):
 *   - Real RailCore SIRF: T1 (search), T5 (availability/fare), T7 (live status).
 *     (T6 comparison ko bhi real chalana pada — mock catalog mein 14542 nahi hai.)
 *   - T2/T3/T4/T8/T9/T10/T12 → RAILWAY_PROVIDER=mock (synthetic tool results,
 *     clearly marked — planning test hai, data test nahi).
 *   - T11/T12 → fault injection (ZERO real DeepSeek calls).
 *   - GPT-OSS comparison → previously recorded results (NEMOTRON_BENCH_gptoss.json),
 *     koi GPT-OSS re-run nahi.
 *
 * Run: npx tsx scripts/deepseek-benchmark.mts
 * Output: DEEPSEEK_BENCH.json + console. Koi secret kabhi log nahi hota.
 */
import { readFileSync, writeFileSync } from "node:fs";

/* ── 0) env BEFORE server imports ────────────────────────────────────── */
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const MODEL = "deepseek-ai/deepseek-v4-flash-0731";
process.env.AGENTIC_MODEL = MODEL; // benchmark-only override
process.env.AGENTIC_PROVIDER = "nvidia";
delete process.env.NVIDIA_FALLBACK_MODEL;
process.env.RAILWAY_PROVIDER = "mock"; // default mock; real-railcore tests switch karenge
// Fairness: nemotron-bench legs ke same generous timeouts (GPT-OSS recorded
// numbers inhi conditions mein measure hue the)
process.env.AI_AGENTIC_TIMEOUT_MS = "75000";
process.env.AI_AGENTIC_TURN_BUDGET_MS = "200000";

const KEY_FILE = "/tmp/dskey.txt";
try {
  const k = readFileSync(KEY_FILE, "utf8").trim();
  if (k.startsWith("nvapi-")) process.env.NVIDIA_API_KEY = k;
} catch {
  /* /tmp key file nahi — .env ka existing key use hoga */
}

if (!process.env.NVIDIA_API_KEY) {
  console.error("NVIDIA_API_KEY missing.");
  process.exit(2);
}

/* ── fetch instrumentation (AI latency + provider counts + leak guard) ── */
const AI_HOST = new URL(process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1").hostname;
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
    /* non-URL */
  }
  const res = await realFetch(input, init);
  if (host === AI_HOST) CALLS.aiDurations.push(Date.now() - t0);
  return res;
}) as typeof fetch;

const { runAgenticTurn, setAgenticNvidiaFetch } = await import("../server/agent/agentic.js");
const { runAgent } = await import("../server/agent/run.js");

/* ── helpers ─────────────────────────────────────────────────────────── */
const NOW = new Date();
const YMD = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = YMD(NOW);
const TOMORROW = YMD(new Date(NOW.getTime() + 86400000));
const pace = (ms = 12000) => new Promise((r) => setTimeout(r, ms));

const RESULTS: Record<string, unknown>[] = [];
const METRICS = { liveTurns: 0, toolCalls: 0, toolOk: 0, aiCalls: 0, hallucinationFlags: 0, realRailcoreTurns: 0 };
const REAL_RAILCORE = new Set(["T1", "T5", "T6", "T7"]);

const hallucinations = (reply: string, steps: { args?: unknown; summary?: unknown; dataPreview?: unknown }[], text = "", history: { role: string; content: string }[] = []): string[] => {
  const ev = JSON.stringify(steps.map((s) => [s.summary, s.args, s.dataPreview])) + " " + text + " " + history.map((h) => h.content).join(" ");
  const bad: string[] = [];
  for (const n of reply.match(/\b\d{5}\b/g) ?? []) if (!ev.includes(n)) bad.push("train:" + n);
  for (const n of reply.match(/₹\s?\d+(?:\.\d+)?/g) ?? []) if (!ev.includes(n.replace(/₹\s?/, ""))) bad.push("fare:" + n);
  return [...new Set(bad)];
};
const LEAK_RE = /<\||im_start|im_end|tool_calls|AGENTIC_TOOLS|\{"name"\s*:|<\/?function>/i;

async function turn(id: string, text: string, known: Record<string, unknown> = {}, history: { role: "user" | "assistant"; content: string }[] = []) {
  METRICS.liveTurns++;
  if (REAL_RAILCORE.has(id)) {
    process.env.RAILWAY_PROVIDER = "railcore";
    METRICS.realRailcoreTurns++;
    await pace();
  } else {
    process.env.RAILWAY_PROVIDER = "mock";
  }
  const railcore0 = CALLS.railcore;
  const ai0 = CALLS.ai;
  const aiDur0 = CALLS.aiDurations.length;
  const t = await runAgenticTurn({ text, now: NOW.toISOString(), known: known as never, history });
  process.env.RAILWAY_PROVIDER = "mock";
  const reply = String(t.reply ?? "");
  const hal = reply ? hallucinations(reply, t.steps, text, history) : [];
  METRICS.toolCalls += t.steps.length;
  for (const s of t.steps) if (s.ok) METRICS.toolOk++;
  METRICS.aiCalls += CALLS.ai - ai0;
  METRICS.hallucinationFlags += hal.length;
  return {
    id, text, reply: reply.slice(0, 500),
    tools: t.steps.map((s) => ({ tool: s.tool, args: s.args, ok: s.ok, source: s.source, summary: String(s.summary ?? "").slice(0, 160) })),
    metrics: {
      modelUsed: t.modelUsed, modelCalls: CALLS.ai - ai0, modelLatencyMs: CALLS.aiDurations.slice(aiDur0).reduce((a, b) => a + b, 0),
      toolCalls: t.steps.length, toolLatencyMs: t.steps.reduce((a, s) => a + (s.latencyMs ?? 0), 0),
      totalMs: t.latencyMs, ok: t.ok, grounded: t.grounded, failureReason: t.failureReason,
      fallbackWouldTrigger: t.failureReason != null || !t.ok,
      realRailcoreCalls: CALLS.railcore - railcore0,
      schemaValid: t.steps.every((s) => !/Invalid arguments/i.test(String(s.summary ?? ""))),
    },
    hallucinations: hal,
    hygiene: { noTemplateLeakage: !LEAK_RE.test(reply), stepsSane: t.steps.length <= 4 },
  };
}

function record(id: string, title: string, checks: Record<string, boolean>, detail: string, r: Record<string, unknown>) {
  const pass = Object.values(checks).every((v) => v === true);
  RESULTS.push({ id, title, pass, checks, detail, ...r });
  console.log(`  ${pass ? "✅" : "❌"} [${id}] ${title}`);
  if (!pass) console.log(`     checks: ${JSON.stringify(checks)} | ${detail.slice(0, 200)}`);
  try {
    writeFileSync(new URL("../DEEPSEEK_BENCH.json", import.meta.url),
      JSON.stringify({ ranAt: new Date().toISOString(), model: MODEL, partial: true, results: RESULTS, calls: CALLS, metrics: METRICS, leakDetected }, null, 2));
  } catch {
    /* continue */
  }
}
type ToolRec = { tool: string; args?: Record<string, unknown>; ok?: boolean; source?: string | null; summary?: string };
const arg = (t: ToolRec | undefined, k: string) => String(t?.args?.[k] ?? "");
const findT = (r: { tools?: ToolRec[] }, name: string): ToolRec | undefined => (r.tools ?? []).find((t) => t.tool === name);
const searchOf = (r: { tools?: ToolRec[] }): ToolRec | undefined => (r.tools ?? []).find((t) => t.tool === "SEARCH_TRAINS" || t.tool === "JOURNEY_ANALYZE");
const isAsr = (v: string) => /asr|amritsar/i.test(v);
const isDelhi = (v: string) => /delhi|ndls|dli|nzm|dec|anvt|dee/i.test(v);
const isLdh = (v: string) => /ldh|ludhiana/i.test(v);

/* ════ T1 — SEARCH / BASIC (REAL RailCore) ═════════════════════════════ */
{
  const r = await turn("T1", "Kal Amritsar se Ludhiana jaana hai");
  const st = searchOf(r);
  record("T1", "SEARCH/BASIC — date+route sahi, valid args", {
    searchCalled: Boolean(st),
    dateTomorrow: arg(st, "date") === TOMORROW,
    routeOk: isAsr(arg(st, "origin")) && isLdh(arg(st, "destination")),
    grounded: r.metrics.grounded === true,
    realRailcore: r.metrics.realRailcoreCalls > 0,
  }, `date=${arg(st, "date")} | ${r.metrics.totalMs}ms | railcore=${r.metrics.realRailcoreCalls}`, r);
}

/* ════ T2 — MISSING DATE (mock) ════════════════════════════════════════ */
{
  const r = await turn("T2", "Amritsar se Ludhiana jaana hai");
  const st = searchOf(r);
  record("T2", "MISSING DATE — poochhe, assume na kare", {
    asksDate: /kab|date|tareekh|kis din/i.test(r.reply) || !st,
    noAssumedDate: !st || arg(st, "date") === "",
    noInventedTrains: r.hallucinations.filter((h) => h.startsWith("train:")).length === 0,
  }, `tools=${(r.tools ?? []).map((t) => t.tool).join("→") || "none"} | reply=${r.reply.slice(0, 90).replace(/\n/g, " ")}`, r);
}

/* ════ T3 — HINDI/HINGLISH + FASTEST (mock) ════════════════════════════ */
{
  const r = await turn("T3", "bhai kal amritsar se delhi ki sabse jaldi wali train bata");
  const st = searchOf(r);
  const ja = findT(r, "JOURNEY_ANALYZE");
  record("T3", "HINDI/HINGLISH + fastest intent", {
    searchOrAtlas: Boolean(st),
    dateTomorrow: !st || arg(st, "date") === TOMORROW,
    routeOk: !st || (isAsr(arg(st, "origin")) && isDelhi(arg(st, "destination"))),
    fastestIntent: !ja || /fast|earliest|jaldi|quick/i.test(arg(ja, "preference")),
    noInventedTrain: r.hallucinations.filter((h) => h.startsWith("train:")).length === 0,
    grounded: r.metrics.grounded === true,
  }, `tools=${(r.tools ?? []).map((t) => t.tool).join("→")} | pref=${arg(ja, "preference")} | ${r.metrics.totalMs}ms`, r);
}

/* ════ T4 — AMBIGUOUS STATION (mock) ═══════════════════════════════════ */
{
  const r = await turn("T4", "Amritsar se Delhi jaana hai");
  const st = findT(r, "SEARCH_TRAINS");
  const asksStation = /kaunsi|kaunsa|which station|station (?:bata|chun|choose)|NDLS|DLI|NZM|options|kripya/i.test(r.reply);
  record("T4", "AMBIGUOUS STATION — clarification, silent pick nahi", {
    asksStation,
    noSilentPick: !st || !isDelhi(arg(st, "destination")) || asksStation || /ambiguous|needs_choice/i.test(JSON.stringify(r.tools)),
    noInventedStation: r.hallucinations.length === 0 && !/[A-Z]{2,5}/.test(String(r.reply).replace(/\b(NDLS|DLI|NZM|DEC|ANVT|DEE|ASR|LDH|CC|SL|AC|GN|RAC|WL|TATKAL|AI|OK|PM|AM)\b/g, "").replace(/[^A-Z\s]/g, "")),
  }, `tools=${(r.tools ?? []).map((t) => `${t.tool}:${t.ok ? "ok" : "fail"}`).join("→")} | reply=${r.reply.slice(0, 110).replace(/\n/g, " ")}`, r);
}

/* ════ T5 — MULTI-TOOL (REAL RailCore) ═════════════════════════════════ */
{
  const r = await turn("T5", "12014 ka CC mein availability aur fare batao");
  const av = findT(r, "CHECK_AVAILABILITY");
  const fa = findT(r, "GET_FARE");
  record("T5", "MULTI-TOOL — CHECK_AVAILABILITY + GET_FARE", {
    availabilityCalled: Boolean(av),
    fareCalled: Boolean(fa),
    argsOk: Boolean(av) && Boolean(fa) && arg(av, "train_number") === "12014" && arg(fa, "train_number") === "12014" && /CC/i.test(arg(av, "class_code") || arg(fa, "class_code")),
    grounded: r.metrics.grounded === true,
    honestOnFail: r.metrics.grounded === true || /unavailable|nahi mil|provider/i.test(r.reply),
  }, `tools=${(r.tools ?? []).map((t) => `${t.tool}:${t.ok ? "ok" : "fail"}`).join("→")} | ${r.metrics.totalMs}ms | railcore=${r.metrics.realRailcoreCalls}`, r);
}

/* ════ T6 — TRAIN COMPARISON (REAL RailCore — mock mein 14542 nahi) ════ */
{
  const r = await turn("T6", "12014 aur 14542 mein kaunsi Ludhiana jaldi pahunchti hai?");
  const tts = (r.tools ?? []).filter((t) => t.tool === "GET_TIMETABLE");
  const allArgs = JSON.stringify((r.tools ?? []).map((t) => t.args));
  record("T6", "COMPARISON — dono timetables, deterministic winner", {
    timetablesForBoth: tts.length >= 2 || /JOURNEY_ANALYZE/.test(JSON.stringify(r.tools)),
    bothTrainsInArgs: allArgs.includes("12014") && allArgs.includes("14542"),
    replyMentionsBoth: r.reply.includes("12014") && r.reply.includes("14542"),
    grounded: r.metrics.grounded === true,
    noInventedWinner: r.hallucinations.filter((h) => h.startsWith("train:")).length === 0,
  }, `tools=${(r.tools ?? []).map((t) => t.tool).join("→")} | ${r.metrics.totalMs}ms`, r);
}

/* ════ T7 — LIVE STATUS (REAL RailCore) ════════════════════════════════ */
{
  const r = await turn("T7", "12014 abhi kahan hai?");
  const tr = findT(r, "TRACK_TRAIN");
  record("T7", "LIVE STATUS — TRACK_TRAIN 12014", {
    trackCalled: Boolean(tr),
    trainOk: arg(tr, "train_number") === "12014",
    grounded: r.metrics.grounded === true,
    honestIfUnavailable: r.metrics.grounded === true || /unavailable|nahi mil|fake/i.test(r.reply),
    noInventedLocation: r.hallucinations.length === 0,
  }, `tools=${(r.tools ?? []).map((t) => `${t.tool}:${t.ok ? "ok" : "fail"}`).join("→")} | ${r.metrics.totalMs}ms`, r);
}

/* ════ T8 — GENERAL RAILWAY (mock; zero railway API calls) ═════════════ */
{
  const r = await turn("T8", "RAC aur WL mein kya difference hai?");
  const ga = findT(r, "GENERAL_RAILWAY_ANSWER");
  record("T8", "GENERAL RAILWAY — GENERAL_RAILWAY_ANSWER, zero provider calls", {
    generalAnswerCalled: Boolean(ga),
    zeroRailwayApiCalls: r.metrics.realRailcoreCalls === 0 && (r.metrics as any).toolLatencyMs >= 0,
    explainsRacWl: /RAC/i.test(r.reply) && /WL|waitlist|waiting/i.test(r.reply),
    nonEmpty: r.reply.length > 40,
  }, `tools=${(r.tools ?? []).map((t) => t.tool).join("→")} | railcore=${r.metrics.realRailcoreCalls} | ${r.metrics.totalMs}ms`, r);
}

/* ════ T9 — UNEXPECTED NL (mock) ═══════════════════════════════════════ */
{
  const r = await turn("T9", "Kal subah aisi train dekh jo jaldi Delhi pahucha de");
  const st = searchOf(r);
  const asksOrigin = /kahan se|from|kis station se/i.test(r.reply);
  record("T9", "UNEXPECTED NL — semantic plan, no hallucination", {
    validPlanOrAsk: Boolean(st) || asksOrigin,
    dateTomorrowIfSearched: !st || arg(st, "date") === TOMORROW,
    delhiInPlan: !st || isDelhi(arg(st, "destination")) || isDelhi(arg(st, "origin")),
    noHallucinatedTrain: r.hallucinations.filter((h) => h.startsWith("train:")).length === 0,
    schemaValid: r.metrics.schemaValid,
  }, `tools=${(r.tools ?? []).map((t) => t.tool).join("→") || "ask"} | reply=${r.reply.slice(0, 90).replace(/\n/g, " ")}`, r);
}

/* ════ T10 — MULTI-TURN STATE (ONE conversation, mock tools) ═══════════ */
{
  process.env.RAILWAY_PROVIDER = "mock";
  const ai0 = CALLS.ai;
  const t1 = await runAgenticTurn({ text: "Amritsar se Delhi jaana hai", now: NOW.toISOString() });
  const reply1 = String(t1.reply ?? "Theek hai.");
  const t2 = await runAgenticTurn({
    text: "Kal", now: NOW.toISOString(),
    known: { origin: "ASR", destination: "NDLS", date: TOMORROW } as never,
    history: [{ role: "user", content: "Amritsar se Delhi jaana hai" }, { role: "assistant", content: reply1 }],
  });
  METRICS.liveTurns += 2;
  const st = t2.steps.find((s) => s.tool === "SEARCH_TRAINS" || s.tool === "JOURNEY_ANALYZE");
  const sArgs = (st?.args ?? {}) as Record<string, string>;
  const reply2 = String(t2.reply ?? "");
  const hal = hallucinations(reply2, t2.steps, "Kal", [{ role: "user", content: "Amritsar se Delhi jaana hai" }, { role: "assistant", content: reply1 }]);
  const r = {
    id: "T10", text: "T1: 'Amritsar se Delhi jaana hai' → T2: 'Kal'", reply: reply2.slice(0, 500),
    tools: t2.steps.map((s) => ({ tool: s.tool, args: s.args, ok: s.ok, source: s.source, summary: String(s.summary ?? "").slice(0, 160) })),
    metrics: { modelUsed: t2.modelUsed, modelCalls: CALLS.ai - ai0, totalMs: t2.latencyMs, grounded: t2.grounded, failureReason: t2.failureReason, schemaValid: t2.steps.every((s) => !/Invalid arguments/i.test(String(s.summary ?? ""))) },
    hallucinations: hal, hygiene: { noTemplateLeakage: !LEAK_RE.test(reply2), stepsSane: t2.steps.length <= 4 },
  };
  METRICS.aiCalls += CALLS.ai - ai0;
  METRICS.toolCalls += t2.steps.length;
  record("T10", "MULTI-TURN — state preserve, date fill, no re-ask", {
    statePreserved: !st || (isAsr(sArgs.origin ?? "") && isDelhi(sArgs.destination ?? "")),
    dateFilled: !st || sArgs.date === TOMORROW,
    noReAskKnownSlots: !/kahan se|kis station|destination bata|from kahan/i.test(reply2),
    grounded: t2.grounded === true || !st,
  }, `T1→${(t1.steps ?? []).map((s) => s.tool).join(",") || "ask"} | T2 tools=${t2.steps.map((s) => s.tool).join("→") || "ask"} | date=${sArgs.date ?? "-"} | ${t2.latencyMs}ms`, r);
}

/* ════ T11 — MALFORMED OUTPUT GUARD (FAULT INJECTION — zero real calls) ═ */
{
  const n0 = CALLS.ai;
  setAgenticNvidiaFetch(async () => {
    const n = ((globalThis as any).__malformed = ((globalThis as any).__malformed ?? 0) + 1);
    if (n === 1) return new Response(JSON.stringify({ model: MODEL, choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "BOOK_WALLET_TOOL", arguments: "{\"amount\": 99999}" } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (n === 2) return new Response(JSON.stringify({ model: MODEL, choices: [{ message: { content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "GET_FARE<|channel|>commentary", arguments: "{invalid json" } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (n === 3) return new Response(JSON.stringify({ model: MODEL, choices: [{ message: { content: null, tool_calls: [{ id: "c3", type: "function", function: { name: "TRACK_TRAIN", arguments: "{\"train_number\": \"12014\", \"url\": \"https://evil.example.com\"}" } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ model: MODEL, choices: [{ message: { content: "Malformed outputs reject ho gaye — main sirf allowed tools use kar sakta hoon." } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    process.env.RAILWAY_PROVIDER = "mock";
    const t = await runAgenticTurn({ text: "12014 ka live status batao", now: NOW.toISOString() });
    const evilExecuted = t.steps.some((s) => /BOOK_WALLET|channel|evil/i.test(`${s.tool} ${JSON.stringify(s.args)}`) && s.ok);
    const urlExecuted = t.steps.some((s) => JSON.stringify(s.args).includes("evil.example.com") && s.ok);
    record("T11", "MALFORMED GUARD — unknown tool / bad JSON / URL reject (injected)", {
      zeroRealModelCalls: CALLS.ai === n0,
      unknownToolRejected: !evilExecuted,
      noUnsafeExecution: !urlExecuted,
      schemaRejectsInvalid: t.steps.some((s) => !s.ok) || t.steps.length === 0,
      safeReply: Boolean(t.reply),
    }, `steps=${t.steps.map((s) => `${s.tool}:${s.ok ? "ok" : "rejected"}`).join("→")}`, {
      id: "T11", text: "(injected malformed outputs)", reply: String(t.reply ?? "").slice(0, 300),
      tools: t.steps.map((s) => ({ tool: s.tool, args: s.args, ok: s.ok, source: s.source, summary: String(s.summary ?? "").slice(0, 160) })),
      metrics: { modelUsed: null, modelCalls: 0, totalMs: t.latencyMs, injected: true }, hallucinations: [], hygiene: {},
    });
  } finally {
    setAgenticNvidiaFetch(null);
  }
}

/* ════ T12 — PROVIDER FAILURE / FALLBACK (FAULT INJECTION — zero real DS calls) ═ */
{
  const n0 = CALLS.ai;
  setAgenticNvidiaFetch(async () => new Response(JSON.stringify({ error: { message: "injected DeepSeek outage (test)" } }), { status: 503, headers: { "Content-Type": "application/json" } }));
  try {
    process.env.RAILWAY_PROVIDER = "mock";
    const res = await runAgent({ text: "12014 ka CC fare batao Amritsar se New Delhi, " + TOMORROW, now: NOW.toISOString() });
    record("T12", "PROVIDER FAILURE → deterministic fallback (injected 503)", {
      zeroRealDeepSeekCalls: CALLS.ai === n0,
      engineDeterministic: res.engine === "deterministic",
      nonEmptyReply: Boolean(res.reply),
      failureRecorded: Boolean(res.agenticFailureReason),
      noCrash: true,
    }, `engine=${res.engine} | reason=${res.agenticFailureReason} | reply=${String(res.reply ?? "").slice(0, 80).replace(/\n/g, " ")}`, {
      id: "T12", text: "(injected 503 outage)", reply: String(res.reply ?? "").slice(0, 300), tools: [],
      metrics: { modelUsed: null, modelCalls: 0, totalMs: null, injected: true }, hallucinations: [], hygiene: {},
    });
  } finally {
    setAgenticNvidiaFetch(null);
  }
  // (b) timeout — abort-honoring hung-server fake
  process.env.AI_AGENTIC_TIMEOUT_MS = "4000";
  setAgenticNvidiaFetch(((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const sig = init?.signal;
      if (!sig) return;
      const onAbort = () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); };
      if (sig.aborted) onAbort(); else sig.addEventListener("abort", onAbort, { once: true });
    })) as never);
  try {
    const res = await runAgent({ text: "12030 abhi kahan hai? Live status batao.", now: NOW.toISOString() });
    const r12b = RESULTS.find((x) => x.id === "T12") as Record<string, any>;
    r12b.checks.timeoutFallback = res.engine === "deterministic" && Boolean(res.reply) && res.agenticFailureReason === "timeout";
    r12b.pass = Object.values(r12b.checks).every((v) => v === true);
    r12b.detail += ` | timeout-case: engine=${res.engine}, reason=${res.agenticFailureReason}`;
    console.log(`  ${r12b.pass ? "✅" : "❌"} [T12+timeout] 503 + timeout dono fallback verified`);
  } finally {
    setAgenticNvidiaFetch(null);
    process.env.AI_AGENTIC_TIMEOUT_MS = "75000";
  }
}

/* ── summary ─────────────────────────────────────────────────────────── */
const liveTurnLat = RESULTS.filter((r: any) => r.metrics?.totalMs).map((r: any) => r.metrics.totalMs as number);
const aiDur = CALLS.aiDurations;
const s = (a: number[]) => ([...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0);
const pass = RESULTS.filter((r) => r.pass).length;
console.log(`\n══════ DEEPSEEK V4 FLASH BENCH: ${pass}/${RESULTS.length} TESTS PASS`);
console.log(`  Real DeepSeek turns / AI calls : ${METRICS.liveTurns} / ${CALLS.ai}`);
console.log(`  Real RailCore calls            : ${CALLS.railcore} (T1/T5/T6/T7 only)`);
console.log(`  Mock tool-result turns         : T2,T3,T4,T8,T9,T10,T11,T12`);
console.log(`  Tool calls / ok                : ${METRICS.toolCalls} / ${METRICS.toolOk}`);
console.log(`  AI call latency avg/p50/slowest: ${aiDur.length ? Math.round(aiDur.reduce((a, b) => a + b, 0) / aiDur.length) : 0} / ${s(aiDur)} / ${aiDur.length ? Math.max(...aiDur) : 0} ms`);
console.log(`  Turn latency   avg/p50/slowest: ${liveTurnLat.length ? Math.round(liveTurnLat.reduce((a, b) => a + b, 0) / liveTurnLat.length) : 0} / ${s(liveTurnLat)} / ${liveTurnLat.length ? Math.max(...liveTurnLat) : 0} ms`);
console.log(`  Hallucination flags            : ${METRICS.hallucinationFlags}`);
console.log(`  Secret leak                    : ${leakDetected ? "DETECTED ❌" : "none ✓"}`);
console.log("NOTE: benchmark ONLY — no deploy / no commit / no production change.");
writeFileSync(new URL("../DEEPSEEK_BENCH.json", import.meta.url),
  JSON.stringify({ ranAt: new Date().toISOString(), model: MODEL, pass, total: RESULTS.length, results: RESULTS, calls: CALLS, metrics: METRICS, leakDetected }, null, 2));
process.exit(pass === RESULTS.length ? 0 : 1);
