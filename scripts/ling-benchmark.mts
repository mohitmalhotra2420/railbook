/**
 * LING-3.0-FLASH-VL (OpenRouter free) vs MUSE-GLIMMER-30B vs GPT-OSS-20B — benchmark ONLY.
 * No prod change. Ling runs through the existing OpenAI-compatible "hf" transport with
 * HF_BASE_URL=https://openrouter.ai/api/v1 (env override in this script only).
 *   BENCH_MODEL=ling|muse|gptoss npx tsx scripts/ling-benchmark.mts
 * Output: .railbook-private/bench/LING_BENCH_<leg>.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const LEG = (process.env.BENCH_MODEL ?? "ling") as "ling" | "muse" | "gptoss";
const LING = "inclusionai/ling-3.0-flash-vl:free";
let MODEL_NAME = "";
if (LEG === "ling") {
  process.env.AGENTIC_PROVIDER = "hf";
  process.env.HF_BASE_URL = "https://openrouter.ai/api/v1";
  process.env.HF_TOKEN = process.env.OPENROUTER_API_KEY ?? "";
  process.env.HF_MODEL = LING;
  delete process.env.AGENTIC_MODEL;
  MODEL_NAME = LING;
} else {
  process.env.AGENTIC_PROVIDER = "nvidia";
  process.env.AGENTIC_MODEL = LEG === "muse" ? "meta/muse-glimmer-30b" : "openai/gpt-oss-20b";
  MODEL_NAME = process.env.AGENTIC_MODEL;
}
process.env.AI_AGENTIC_TIMEOUT_MS = "60000";
process.env.AI_AGENTIC_TURN_BUDGET_MS = "150000";
const AI_HOST = LEG === "ling" ? "openrouter.ai" : "integrate.api.nvidia.com";
const CALLS = { ai: 0, durs: [] as number[] };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: any, init?: any) => {
  const t0 = Date.now();
  let host = "";
  try { host = new URL(String(input instanceof Request ? input.url : input)).hostname; } catch {}
  if (host === AI_HOST) CALLS.ai++;
  const res = await realFetch(input, init);
  if (host === AI_HOST) CALLS.durs.push(Date.now() - t0);
  return res;
}) as typeof fetch;
const { runAgenticTurn } = await import("../server/agent/agentic.js");
const NOW = new Date();
const YMD = (d: Date) => d.toISOString().slice(0, 10);
const TOMORROW = YMD(new Date(NOW.getTime() + 86400000));
const LEAK_RE = /<\||im_start|im_end|AGENTIC_TOOLS|<\/?function>|system_prompt/i;
const RESULTS: Record<string, unknown>[] = [];
async function turn(id: string, text: string, known: Record<string, unknown> = {}, history: { role: "user" | "assistant"; content: string }[] = []) {
  const ai0 = CALLS.ai, d0 = CALLS.durs.length, t0 = Date.now();
  const t = await runAgenticTurn({ text, now: NOW.toISOString(), known: known as never, history });
  const reply = String(t.reply ?? "");
  const row = {
    id, text, model: t.modelUsed ?? MODEL_NAME, ok: t.ok, failureReason: t.failureReason ?? null, grounded: t.grounded,
    reply: reply.slice(0, 400), replyLen: reply.length, tools: t.steps.map((s) => `${s.tool}${s.ok ? "" : "✗"}`),
    modelCalls: CALLS.ai - ai0, modelMs: CALLS.durs.slice(d0).reduce((a, b) => a + b, 0), turnMs: Date.now() - t0,
    leak: LEAK_RE.test(reply), hinglish: /\b(hai|hain|ke|ki|ka|mein|se|nahi|ko)\b/i.test(reply),
  };
  RESULTS.push(row);
  console.log(`\n[${id}] ${text}\n  → ok=${row.ok} grounded=${row.grounded} tools=${row.tools.join(",") || "-"} calls=${row.modelCalls} modelMs=${row.modelMs} turnMs=${row.turnMs}${row.failureReason ? " FAIL=" + row.failureReason : ""}\n  ${reply.slice(0, 260).replace(/\n/g, " ")}`);
  return t;
}
console.log(`LEG=${LEG} MODEL=${MODEL_NAME}`);
await turn("A", "Amritsar se Ludhiana kal jaana hai, 2 log");
await turn("B", "Ludhiana se New Delhi sabse fast train kaunsi hai kal?");
await turn("C", `12014 ka CC mein availability aur fare batao ${TOMORROW} ko ASR se NDLS`);
await turn("D", "12014 abhi kahan hai?");
await turn("E", "RAC aur WL mein kya difference hai?");
await turn("F", "Amritsar se Delhi jaana hai"); // date missing → must ask, not assume
await turn("G", "12030 ka timetable batao");
await turn("H", "kal Ludhiana se Delhi 2S mein kitna lagega?");
const summary = {
  leg: LEG, model: MODEL_NAME, at: NOW.toISOString(), turns: RESULTS.length,
  ok: RESULTS.filter((r) => r.ok).length, grounded: RESULTS.filter((r) => r.grounded).length,
  leaks: RESULTS.filter((r) => r.leak).length, hinglish: RESULTS.filter((r) => r.hinglish).length,
  avgTurnMs: Math.round(RESULTS.reduce((a, r) => a + Number(r.turnMs), 0) / RESULTS.length),
  avgModelMsPerCall: Math.round(CALLS.durs.reduce((a, b) => a + b, 0) / Math.max(1, CALLS.durs.length)),
  totalModelCalls: CALLS.ai, results: RESULTS,
};
mkdirSync("/home/user/.railbook-private/bench", { recursive: true });
writeFileSync(`/home/user/.railbook-private/bench/LING_BENCH_${LEG}.json`, JSON.stringify(summary, null, 2));
console.log("\nSUMMARY", JSON.stringify({ ...summary, results: undefined }));
