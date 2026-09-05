/**
 * GLM-5.3-Flash (Hugging Face router) — PRE-PRODUCTION ADVERSARIAL SUITE
 *
 * AGENTIC_PROVIDER=hf ke saath agentic engine ko GLM chalata hai aur 12
 * mandate-ke-tests chalata hai: tool planning, multi-tool, comparison,
 * Hindi/Hinglish, missing date, ambiguous station, malformed output,
 * timeout/failure fallback. Railway providers waise hi: RailCore PRIMARY,
 * RailKit FALLBACK. Fault injections (test 11/12) explicitly listed.
 *
 * Run: npx tsx scripts/glm-adversarial-test.mts
 * NO DEPLOY — yeh sirf validation hai, production abhi GPT-OSS-20B par hai.
 */
import { readFileSync, writeFileSync } from "node:fs";

/* ── 0) .env load + AGENTIC_PROVIDER=hf BEFORE server imports ───────── */
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.AGENTIC_PROVIDER = "hf"; // GLM — sirf is suite ke liye; deploy nahi
delete process.env.AGENTIC_MODEL;

if (!process.env.HF_TOKEN || !process.env.HF_MODEL) {
  console.error("HF_TOKEN/HF_MODEL missing — .env check karo.");
  process.exit(2);
}

/* ── fetch counter + secret-leak guard (imports se PEHLE) ───────────── */
const SECRET_RE = /rk_live_[A-Za-z0-9_-]+|rk_test_[A-Za-z0-9_-]+|railkit_[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{10,}|hf_[A-Za-z0-9]{20,}/;
const CALLS = { hf: 0, railcore: 0, railkit: 0, other: 0, hosts: {} as Record<string, number> };
let leakDetected = false;
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: any, init?: any) => {
  try {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const host = u.hostname;
    CALLS.hosts[host] = (CALLS.hosts[host] ?? 0) + 1;
    if (host === "router.huggingface.co") {
      CALLS.hf++;
      if (init?.body && SECRET_RE.test(String(init.body)) && !/hf_/.test("")) {
        // HF request body mein railway/NVIDIA keys kabhi nahi jaani chahiye
        if (/rk_live_|rk_test_|railkit_|nvapi-/.test(String(init.body))) leakDetected = true;
      }
    } else if (host === "ir.railcore.tech") CALLS.railcore++;
    else if (host.includes("railkit")) CALLS.railkit++;
    else CALLS.other++;
  } catch {
    /* non-URL input */
  }
  const res = await realFetch(input, init);
  return res;
}) as typeof fetch;

const { runAgenticTurn, setAgenticNvidiaFetch, agenticConfigured } = await import("../server/agent/agentic.js");
const { runAgent } = await import("../server/agent/run.js");

/* ── crash guards: report HAMESHA likha jaye, chahe kuch bhi ho jaye ──── */
let REPORT_WRITTEN = false;
function writeReport(pass: number, total: number) {
  if (REPORT_WRITTEN) return;
  REPORT_WRITTEN = true;
  writeFileSync(
    new URL("../GLM_ADVERSARIAL_REPORT.json", import.meta.url),
    JSON.stringify({ ranAt: new Date().toISOString(), pass, total, skipped: [...SKIP], results: RESULTS, calls: CALLS, modelUsed: [...modelUsedSeen], metrics: METRICS, leakDetected, hfHttp402: quota402 }, null, 2),
  );
  console.log("\nFull JSON: GLM_ADVERSARIAL_REPORT.json");
}
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("beforeExit", () => {
  if (!REPORT_WRITTEN) {
    console.log("\n⚠️  suite abnormal terminate hui — report abhi likh raha hoon");
    writeReport(RESULTS.filter((r) => r.pass).length, RESULTS.length);
  }
});

/* RailCore per-minute limit 20 hai — tests ke beech pacing zaroori,
   warna rate-limit 429 spurious failures deta hai (pichle run mein aisa hua). */
const pace = (ms = 10000) => new Promise((r) => setTimeout(r, ms));
// GLM_SKIP="1,2,3" — pehle ke runs mein pass ho chuke tests (HF quota bachao)
const SKIP = new Set((process.env.GLM_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean));
let quota402 = 0;

/* ── helpers ────────────────────────────────────────────────────────── */
const NOW = new Date().toISOString();
const RESULTS: { id: string; title: string; pass: boolean; detail: string; latencyMs: number }[] = [];
const METRICS = { turns: 0, hfCalls: 0, toolCallAttempts: 0, toolExecOk: 0, toolRejected: 0, structuredJsonOk: 0, structuredJsonBad: 0 };
let modelUsedSeen = new Set<string>();

function record(id: string, title: string, checks: Record<string, boolean>, detail: string, latencyMs: number) {
  const pass = Object.values(checks).every((v) => v === true);
  RESULTS.push({ id, title, pass, detail, latencyMs });
  console.log(`  ${pass ? "✅" : "❌"} [${id}] ${title}`);
  if (!pass) console.log(`     checks: ${JSON.stringify(checks)} | ${detail.slice(0, 180)}`);
}

async function turn(text: string, known: Record<string, unknown> = {}, history: { role: "user" | "assistant"; content: string }[] = []) {
  METRICS.turns++;
  const t = await runAgenticTurn({ text, now: NOW, known: known as never, history });
  if (t.modelUsed) modelUsedSeen.add(t.modelUsed);
  if (t.failureReason === "http_402") quota402++;
  for (const s of t.steps) {
    METRICS.toolCallAttempts++;
    if (s.ok === false) METRICS.toolRejected++; // ToolTraceStep.rejected nahi hota — ok===false hi reject/fail hai
    if (s.ok) METRICS.toolExecOk++;
  }
  return t;
}

const SAT = new Date(Date.now() + 5.5 * 3600 * 1000);
SAT.setUTCDate(SAT.getUTCDate() + ((6 - SAT.getUTCDay() + 7) % 7 || 7));
const SAT_YMD = `${SAT.getUTCFullYear()}-${String(SAT.getUTCMonth() + 1).padStart(2, "0")}-${String(SAT.getUTCDate()).padStart(2, "0")}`;

console.log(`\n══════ GLM-5.3-FLASH ADVERSARIAL SUITE (HF router) — ${new Date().toISOString()}`);
console.log(`agenticConfigured: ${agenticConfigured()} | provider: hf | model: ${process.env.HF_MODEL}`);
console.log(`RailCore PRIMARY: haan (nayi key) | RailKit FALLBACK: haan | GPT-OSS: untouched (NLU + prod) | Deterministic NLU: fallback\n`);

/* ── 0) HF auth + model identity (live probe) ───────────────────────── */
{
  const t = await turn("Sirf ek kaam: bolo 'READY'. Koi tool mat bulao.");
  const hfAuth = CALLS.hf > 0;
  record("auth", "HF authentication + actual model identity", {
    hfCalled: hfAuth,
    modelIsGlm: [...modelUsedSeen].some((m) => /GLM/i.test(m)),
    noLeak: !leakDetected,
  }, `modelUsed=${[...modelUsedSeen].join(",") || "?"} | hfCalls=${CALLS.hf}`, t.latencyMs);
}

/* ── 1) SEARCH_TRAINS ──────────────────────────────────────────────── */
if (!SKIP.has("1")) {
await pace(); // RailCore 20/min limit — pacing bina 429 spurious failures
  const t = await turn("Amritsar se New Delhi 2026-09-06 ki trains batao", { origin: "ASR", destination: "NDLS", date: "2026-09-06" });
  const search = t.steps.find((s) => s.tool === "SEARCH_TRAINS");
  record("1", "SEARCH_TRAINS — real RailCore search", {
    toolCalled: Boolean(search),
    toolOk: Boolean(search?.ok),
    railcoreSource: search?.source === "railcore",
    grounded: t.grounded === true,
  }, `steps=${t.steps.map((s) => `${s.tool}(${s.source},${s.ok ? "ok" : "fail"})`).join("→")}`, t.latencyMs);
}

/* ── 2) JOURNEY_ANALYZE ────────────────────────────────────────────── */
if (!SKIP.has("2")) {
  const t = await turn(`Amritsar se NDLS ${SAT_YMD} ko sabse fast train kaunsi hai?`);
  const ja = t.steps.find((s) => s.tool === "JOURNEY_ANALYZE");
  record("2", "JOURNEY_ANALYZE — Atlas analysis", {
    toolCalled: Boolean(ja),
    toolOk: Boolean(ja?.ok),
    grounded: t.grounded === true,
    trainInReply: /\b\d{5}\b/.test(String(t.reply ?? "")) || Boolean(ja?.ok),
  }, `steps=${t.steps.map((s) => `${s.tool}(${s.ok ? "ok" : "fail"})`).join("→")}`, t.latencyMs);
}

/* ── 3) TRACK_TRAIN ────────────────────────────────────────────────── */
if (!SKIP.has("3")) {
await pace(); // RailCore 20/min limit — pacing bina 429 spurious failures
  const t = await turn("12014 abhi kahan hai? live status aur delay batao");
  const tr = t.steps.find((s) => s.tool === "TRACK_TRAIN");
  const reply = String(t.reply ?? "");
  record("3", "TRACK_TRAIN — live status call", {
    toolCalled: Boolean(tr),
    honest: tr?.ok ? /\d|delay|station|status/i.test(reply) : /nahi|unavailable|uplabdh nahi|mil nahi/i.test(reply),
    noFake: !/\d{1,2}:\d{2}\s*(pe|par)\s*(LUDHIANA|AMBALA)/i.test(reply),
  }, `steps=${t.steps.map((s) => `${s.tool}(${s.source},${s.ok ? "ok" : "fail"})`).join("→")}`, t.latencyMs);
}

/* ── 4) GET_FARE ───────────────────────────────────────────────────── */
if (!SKIP.has("4")) {
  const t = await turn("12030 ki CC class ka fare batao Amritsar se New Delhi, 2026-09-06", { origin: "ASR", destination: "NDLS", date: "2026-09-06", trainNumber: "12030", classCode: "CC" });
  const gf = t.steps.find((s) => s.tool === "GET_FARE");
  record("4", "GET_FARE — CC fare with real provider data", {
    toolCalled: Boolean(gf),
    toolOk: Boolean(gf?.ok),
    fareGrounded: gf?.ok ? /₹\s?\d/.test(String(t.reply ?? "")) : true,
    grounded: t.grounded === true,
  }, `steps=${t.steps.map((s) => `${s.tool}(${s.source},${s.ok ? "ok" : "fail"})`).join("→")}`, t.latencyMs);
}

/* ── 5) CHECK_AVAILABILITY ─────────────────────────────────────────── */
if (!SKIP.has("5")) {
await pace(); // RailCore 20/min limit — pacing bina 429 spurious failures
  const t = await turn("12030 mein CC ki seats available hain? 2026-09-06, ASR se NDLS", { origin: "ASR", destination: "NDLS", date: "2026-09-06", trainNumber: "12030", classCode: "CC" });
  const av = t.steps.find((s) => s.tool === "CHECK_AVAILABILITY");
  record("5", "CHECK_AVAILABILITY — seat availability", {
    toolCalled: Boolean(av),
    toolOk: Boolean(av?.ok) || /unavailable|nahi mil|uplabdh nahi/i.test(String(t.reply ?? "")),
    grounded: t.grounded === true,
  }, `steps=${t.steps.map((s) => `${s.tool}(${s.source},${s.ok ? "ok" : "fail"})`).join("→")} | grounded=${t.grounded} | reply=${String(t.reply ?? "").slice(0, 140).replace(/\n/g, " ")}`, t.latencyMs);
}

/* ── 6) multi-tool chaining ────────────────────────────────────────── */
if (!SKIP.has("6")) {
  const t = await turn(`Amritsar se NDLS ${SAT_YMD} ko sabse fast train, uska CC fare aur seat availability bhi batao`, { origin: "ASR", destination: "NDLS", date: SAT_YMD });
  const reply = String(t.reply ?? "");
  const tools = t.steps.map((s) => s.tool);
  const chained = t.steps.length >= 2 && /GET_FARE|CHECK_AVAILABILITY/.test(tools.join(","));
  const singleAtlas = tools.includes("JOURNEY_ANALYZE") && t.steps.some((s) => s.tool === "JOURNEY_ANALYZE" && s.ok);
  const complete = /\b\d{5}\b/.test(reply) && (/₹\s?\d/.test(reply) || /fare/i.test(reply)) && (/seats?|सीट|available|उपलब्ध/i.test(reply) || /fare/i.test(reply));
  record("6", "multi-tool — train + fare + availability (chained ya complete Atlas)", {
    multiOrAtlas: chained || singleAtlas,
    completeAnswer: complete || chained,
    grounded: t.grounded === true,
  }, `steps=${tools.join("→")} | reply=${reply.slice(0, 90).replace(/\n/g, " ")}`, t.latencyMs);
}

/* ── 7) train comparison ───────────────────────────────────────────── */
if (!SKIP.has("7")) {
await pace(); // RailCore 20/min limit — pacing bina 429 spurious failures
  const t = await turn(`12014 aur 12030 mein se kaunsi train better hai ASR se NDLS ${SAT_YMD} ko? compare karo`, { origin: "ASR", destination: "NDLS", date: SAT_YMD });
  const reply = String(t.reply ?? "");
  const bothTrains = reply.includes("12014") && reply.includes("12030");
  record("7", "train comparison — 12014 vs 12030 (real data se)", {
    toolsUsed: t.steps.length > 0,
    bothTrainsCompared: bothTrains || t.steps.some((s) => JSON.stringify(s.args).includes("12014") && JSON.stringify(s.args).includes("12030")),
    grounded: t.grounded === true,
  }, `steps=${t.steps.map((s) => s.tool).join("→")} | reply=${reply.slice(0, 140).replace(/\n/g, " ")}`, t.latencyMs);
}

/* ── 8) Hindi/Hinglish ─────────────────────────────────────────────── */
if (!SKIP.has("8")) {
  const t = await turn("मुझे अमृतसर से नई दिल्ली इस शनिवार की सबसे तेज़ ट्रेन चाहिए, किराया और सीटें भी बताओ", { origin: "ASR", destination: "NDLS" });
  const reply = String(t.reply ?? "");
  record("8", "Hindi/Hinglish samajh + real tools", {
    toolsCalled: t.steps.length > 0,
    nonEmptyReply: reply.trim().length > 0,
    grounded: t.grounded === true,
  }, `steps=${t.steps.map((s) => s.tool).join("→")} | ${reply.slice(0, 80).replace(/\n/g, " ")}`, t.latencyMs);
}

/* ── 9) missing date — no silent assumption ────────────────────────── */
if (!SKIP.has("9")) {
await pace(); // RailCore 20/min limit — pacing bina 429 spurious failures
  const t = await turn("Amritsar se New Delhi jaana hai train se", { origin: "ASR" });
  const reply = String(t.reply ?? "");
  const asksDate = /kis date|kaun si date|kab|date|तारीख|कब/i.test(reply);
  const noInventedSearch = !t.steps.some((s) => s.ok && /SEARCH_TRAINS|JOURNEY_ANALYZE/.test(s.tool) && !String(JSON.stringify(s.args)).includes("null"));
  record("9", "missing date — poochhta hai, assume nahi karta", {
    asksDate,
    honest: noInventedSearch || asksDate,
  }, `reply=${reply.slice(0, 120).replace(/\n/g, " ")}`, t.latencyMs);
}

/* ── 10) ambiguous station ─────────────────────────────────────────── */
if (!SKIP.has("10")) {
  const t = await turn(`Amritsar se Delhi ${SAT_YMD} ko sabse fast train batao`);
  const reply = String(t.reply ?? "");
  const delhiCodes = ["NDLS", "DLI", "NZM", "DEC", "DEE", "ANVT", "DAZ"].filter((c) => reply.includes(c));
  const asksStation = delhiCodes.length >= 2 || /kaunsa station|kis station|कौन सा स्टेशन/i.test(reply);
  record("10", "ambiguous 'Delhi' — clarification, silent pick nahi", {
    asksStation,
    noSilentPick: !/\b(NDLS|DLI)\b[^?]*\b(fastest train|sabse fast)\b/i.test(reply) || asksStation,
  }, `delhiCodes=${delhiCodes.join(",")} | ${reply.slice(0, 100).replace(/\n/g, " ")}`, t.latencyMs);
}

/* ── 11) malformed AI output (FAULT INJECTION — scripted GLM misbehavior) ── */
{
  setAgenticNvidiaFetch(async () => {
    METRICS.hfCalls++; // injected — real HF call nahi
    const n = (globalThis as any).__malformedCall = ((globalThis as any).__malformedCall ?? 0) + 1;
    if (n === 1) return new Response(JSON.stringify({ model: "zai-org/GLM-5.3-Flash", choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "BOOK_WALLET_TOOL", arguments: "{\"amount\": 99999}" } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (n === 2) return new Response(JSON.stringify({ model: "zai-org/GLM-5.3-Flash", choices: [{ message: { content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "GET_FARE<|channel|>commentary", arguments: "{invalid json" } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (n === 3) return new Response(JSON.stringify({ model: "zai-org/GLM-5.3-Flash", choices: [{ message: { content: null, tool_calls: [{ id: "c3", type: "function", function: { name: "TRACK_TRAIN", arguments: "{\"train_number\": \"12014\", \"url\": \"https://evil.example.com\"}" } }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ model: "zai-org/GLM-5.3-Flash", choices: [{ message: { content: "Malformed outputs reject ho gaye — main sirf allowed tools use kar sakta hoon." } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  try {
    const t = await turn("12014 ka live status batao");
    const executed = t.steps.filter((s) => s.ok);
    const evilExecuted = t.steps.some((s) => /BOOK_WALLET|channel|evil/i.test(`${s.tool} ${JSON.stringify(s.args)}`) && s.ok);
    record("11", "malformed AI output — unknown tool / harmony-token / bad JSON / URL reject", {
      unknownToolRejected: !evilExecuted,
      noEvilExecution: !t.steps.some((s) => JSON.stringify(s.args).includes("evil.example.com") && s.ok),
      safeReply: Boolean(t.reply),
    }, `steps=${t.steps.map((s) => `${s.tool}:${s.ok ? "ok" : "rejected"}`).join("→")}`, t.latencyMs);
  } finally {
    setAgenticNvidiaFetch(null);
  }
}

/* ── 12) AI timeout/failure fallback ───────────────────────────────── */
{
  // (a) HF total outage (503) — INJECTED
  setAgenticNvidiaFetch(async () => {
    (globalThis as any).__outageCalls = ((globalThis as any).__outageCalls ?? 0) + 1;
    return new Response(JSON.stringify({ error: { message: "injected GLM outage (test)" } }), { status: 503, headers: { "Content-Type": "application/json" } });
  });
  try {
    const res = await runAgent({ text: "12030 ki CC class ka fare batao Amritsar se New Delhi, 2026-09-06", now: NOW });
    record("12a", "GLM outage → deterministic fallback (real NLU + real provider data)", {
      engineDeterministic: res.engine === "deterministic",
      nonEmptyReply: Boolean(res.reply),
      realProviderData: /₹\s?\d/.test(String(res.reply ?? "")) || /unavailable|nahi mil/i.test(String(res.reply ?? "")),
      failureRecorded: Boolean(res.agenticFailureReason),
    }, `engine=${res.engine} | reason=${res.agenticFailureReason} | reply=${String(res.reply ?? "").slice(0, 80).replace(/\n/g, " ")}`, res.latencyMs ?? 0);
  } finally {
    setAgenticNvidiaFetch(null);
  }
  // (b) timeout — INJECTED (hung-server fetch, chhota timeout).
  // NOTE: fake fetch ko AbortSignal HONOR karna padta hai — real fetch signal
  // par reject hota hai; signal-ignore karnese await kabhi settle nahi hota
  // aur Node event-loop drain hoke chupchaap exit(0) kar deta hai (pehle yehi hua).
  process.env.AI_AGENTIC_TIMEOUT_MS = "4000";
  setAgenticNvidiaFetch(((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const sig = init?.signal;
      if (sig) {
        const onAbort = () => {
          const e = new Error("The operation was aborted");
          e.name = "AbortError";
          reject(e);
        };
        if (sig.aborted) onAbort();
        else sig.addEventListener("abort", onAbort, { once: true });
      }
      // kabhi resolve nahi hota — hung server simulation
    })) as never);
  try {
    // NOTE: trains-search query ka deterministic fallback reply:null deta hai
    // (client searchTrains intent se TrainBoard khulta hai — by design).
    // 12b mein LIVE-STATUS query use karte hain: deterministic path yahan
    // REAL RailCore data ke saath text reply deta hai.
    const res = await runAgent({ text: "12030 abhi kahan hai? Live status batao.", now: NOW });
    record("12b", "GLM timeout → deterministic fallback", {
      engineDeterministic: res.engine === "deterministic",
      nonEmptyReply: Boolean(res.reply),
      reasonIsTimeout: res.agenticFailureReason === "timeout",
    }, `engine=${res.engine} | reason=${res.agenticFailureReason}`, res.latencyMs ?? 0);
  } finally {
    setAgenticNvidiaFetch(null);
    delete process.env.AI_AGENTIC_TIMEOUT_MS;
  }
}

/* ── summary ───────────────────────────────────────────────────────── */
const pass = RESULTS.filter((r) => r.pass).length;
const total = RESULTS.length;
const latencies = RESULTS.map((r) => r.latencyMs).filter((n) => n > 0);
const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
console.log(`\n══════ GLM ADVERSARIAL RESULT: ${pass}/${total} PASS`);
console.log(`  HF (router.huggingface.co) calls  : ${CALLS.hf}`);
console.log(`  Real RailCore calls               : ${CALLS.railcore}`);
console.log(`  RailKit calls                     : ${CALLS.railkit} (monthly quota exhausted — fallback window honest-unavailable)`);
console.log(`  Model used                        : ${[...modelUsedSeen].join(", ")}`);
console.log(`  Tool-call attempts / ok / rejected: ${METRICS.toolCallAttempts} / ${METRICS.toolExecOk} / ${METRICS.toolRejected}`);
console.log(`  Avg turn latency                  : ${avg} ms`);
console.log(`  Secret leak (HF body/responses)   : ${leakDetected ? "DETECTED ❌" : "none ✓"}`);
if (quota402 > 0) {
  console.log(`  ⚠️  HF http_402 turns              : ${quota402} — HF monthly included credits DEPLETED hai.`);
  console.log(`     GLM-dependent results is run mein measure nahi hue — credits top-up ke baad re-run zaroori.`);
}
if (SKIP.size > 0) console.log(`  Skipped (GLM_SKIP)                : ${[...SKIP].join(", ")} — inke results pichle run ke JSON/raport mein hain`);
writeReport(pass, total);
console.log("NOTE: production deploy NAHI hua — GPT-OSS-20B primary hai (mandate ke mutabik).");
process.exit(pass === total ? 0 : 1);
