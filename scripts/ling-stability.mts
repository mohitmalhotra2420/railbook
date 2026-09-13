/**
 * Ling-3.0-Flash-VL (OpenRouter free) — 30-turn STABILITY run. Benchmark only, no prod change.
 * Tracks: HTTP 429/5xx, empty_content, timeouts, leaks, grounding, Hinglish, latency per call/turn.
 *   BENCH_MODEL=ling|muse npx tsx scripts/ling-stability.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const LEG = (process.env.BENCH_MODEL ?? "ling") as "ling" | "muse" | "gptoss";
const LING = process.env.LING_MODEL ?? "inclusionai/ling-3.0-flash-vl:free";
let MODEL_NAME = "";
if (LEG === "ling") {
  process.env.AGENTIC_PROVIDER = "hf"; process.env.HF_BASE_URL = "https://openrouter.ai/api/v1";
  process.env.HF_TOKEN = process.env.OPENROUTER_API_KEY ?? ""; process.env.HF_MODEL = LING; delete process.env.AGENTIC_MODEL; MODEL_NAME = LING;
} else {
  process.env.AGENTIC_PROVIDER = "nvidia"; process.env.AGENTIC_MODEL = LEG === "muse" ? "meta/muse-glimmer-30b" : "openai/gpt-oss-20b"; MODEL_NAME = process.env.AGENTIC_MODEL;
}
process.env.AI_AGENTIC_TIMEOUT_MS = "60000"; process.env.AI_AGENTIC_TURN_BUDGET_MS = "150000";
const AI_HOST = LEG === "ling" ? "openrouter.ai" : "integrate.api.nvidia.com";
const HTTP = { calls: 0, durs: [] as number[], statuses: {} as Record<string, number>, errors: 0 };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: any, init?: any) => {
  const t0 = Date.now(); let host = "";
  try { host = new URL(String(input instanceof Request ? input.url : input)).hostname; } catch {}
  if (host !== AI_HOST) return realFetch(input, init);
  HTTP.calls++;
  try {
    const res = await realFetch(input, init);
    HTTP.durs.push(Date.now() - t0); HTTP.statuses[res.status] = (HTTP.statuses[res.status] ?? 0) + 1;
    if (res.status !== 200) { const c = res.clone(); console.log(`  !! HTTP ${res.status}: ${(await c.text()).slice(0, 200)}`); }
    return res;
  } catch (e) { HTTP.errors++; HTTP.durs.push(Date.now() - t0); console.log(`  !! fetch error: ${String(e).slice(0, 120)}`); throw e; }
}) as typeof fetch;
const { runAgenticTurn } = await import("../server/agent/agentic.js");
const NOW = new Date(); const YMD = (d: Date) => d.toISOString().slice(0, 10);
const TOMORROW = YMD(new Date(NOW.getTime() + 86400000)); const DAY3 = YMD(new Date(NOW.getTime() + 3 * 86400000));
const LEAK_RE = /<\||im_start|im_end|AGENTIC_TOOLS|<\/?function>|system_prompt/i;
const RESULTS: Record<string, unknown>[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type H = { role: "user" | "assistant"; content: string };
async function turn(id: string, text: string, known: Record<string, unknown> = {}, history: H[] = []) {
  const c0 = HTTP.calls, d0 = HTTP.durs.length, t0 = Date.now();
  let t: any;
  try { t = await runAgenticTurn({ text, now: NOW.toISOString(), known: known as never, history }); }
  catch (e) { t = { ok: false, reply: "", steps: [], failureReason: "exception:" + String(e).slice(0, 80), grounded: false }; }
  const reply = String(t.reply ?? "");
  const row = { id, text, ok: t.ok, failureReason: t.failureReason ?? null, grounded: t.grounded, reply: reply.slice(0, 300), replyLen: reply.length,
    tools: (t.steps ?? []).map((s: any) => `${s.tool}${s.ok ? "" : "✗"}`), modelCalls: HTTP.calls - c0, modelMs: HTTP.durs.slice(d0).reduce((a, b) => a + b, 0),
    turnMs: Date.now() - t0, leak: LEAK_RE.test(reply), hinglish: /\b(hai|hain|ke|ki|ka|mein|se|nahi|ko|karo|batao)\b/i.test(reply), empty: reply.trim().length === 0 };
  RESULTS.push(row);
  console.log(`\n[${id}] ${text}\n  → ok=${row.ok} gr=${row.grounded} tools=${row.tools.join(",") || "-"} calls=${row.modelCalls} modelMs=${row.modelMs} turnMs=${row.turnMs}${row.failureReason ? " FAIL=" + row.failureReason : ""}\n  ${reply.slice(0, 220).replace(/\n/g, " ")}`);
  await sleep(4000);
  return { t, reply };
}
console.log(`LEG=${LEG} MODEL=${MODEL_NAME} start=${NOW.toISOString()}`);
// ── 30 turns: journeys, availability, live, timetable, fare, general, follow-ups, edge cases ──
await turn("01", "Ludhiana se Amritsar kal jaana hai, 1 passenger");
await turn("02", "Jammu se New Delhi kal ki trains, 2 log");
await turn("03", `12426 ki 3A availability ${TOMORROW} ko JAT se NDLS`);
await turn("04", "12426 ka fare 2A mein JAT se NDLS");
await turn("05", "12426 abhi kahan hai?");
await turn("06", "12426 ka timetable");
await turn("07", "Tatkal booking kab khulti hai?");
await turn("08", "Chandigarh se Delhi parso subah ki sabse fast train");
await turn("09", "Amritsar se Mumbai jaana hai 3 log");                  // date missing → ask
await turn("10", "Delhi se Kolkata kal jaana hai");                       // ambiguous stations → ask
await turn("11", `12014 CC ${TOMORROW} ASR se NDLS seats hain?`);
await turn("12", "12014 aur 12030 mein kaunsi Delhi jaldi pahunchti hai?");
await turn("13", "Vande Bharat kya hoti hai?");
await turn("14", "12030 mein platform kaunsa hai Ludhiana pe?");
await turn("15", "kal Ludhiana se New Delhi 2S mein kitna lagega?");
// multi-turn
const a = await turn("16", "Bathinda se Delhi jaana hai");
await turn("17", "kal, 2 log, NDLS", { origin: "BTI", destination: "NDLS" }, [{ role: "user", content: "Bathinda se Delhi jaana hai" }, { role: "assistant", content: a.reply.slice(0, 300) }]);
await turn("18", "sabse sasti kaunsi hai?", { origin: "BTI", destination: "NDLS", date: TOMORROW }, [{ role: "user", content: "Bathinda se NDLS kal 2 log" }, { role: "assistant", content: "BTI→NDLS kal ki trains dikha di hain." }]);
await turn("19", "12426 mein RAC hai to milegi seat?");
await turn("20", `Ludhiana se Varanasi ${DAY3} ko, 2 passengers, SL`);
await turn("21", "13006 ka live status");
await turn("22", "Ambala se Kalka kal subah");
await turn("23", "kya 22439 kal chal rahi hai?");
await turn("24", "IRCTC pe senior citizen concession kitna hai?");
await turn("25", "12904 ka coach position");
await turn("26", "Ludhiana se Jalandhar aaj shaam ko");
await turn("27", "Delhi se Jaipur kal, 4 log, AC chair car");
await turn("28", "12626 Kerala Express kitna time leti hai NDLS se TVC?");
await turn("29", "mere PNR 1234567890 ka status");
await turn("30", "shukriya, bas itna hi");
const ok = RESULTS.filter((r) => r.ok).length;
const summary = { leg: LEG, model: MODEL_NAME, at: NOW.toISOString(), turns: RESULTS.length, ok, okPct: Math.round((ok / RESULTS.length) * 100),
  grounded: RESULTS.filter((r) => r.grounded).length, hinglish: RESULTS.filter((r) => r.hinglish).length, leaks: RESULTS.filter((r) => r.leak).length,
  emptyReplies: RESULTS.filter((r) => r.empty).length, failures: RESULTS.filter((r) => r.failureReason).map((r) => `${r.id}:${r.failureReason}`),
  http: { calls: HTTP.calls, statuses: HTTP.statuses, fetchErrors: HTTP.errors, avgMs: Math.round(HTTP.durs.reduce((a, b) => a + b, 0) / Math.max(1, HTTP.durs.length)), p95Ms: [...HTTP.durs].sort((a, b) => a - b)[Math.floor(HTTP.durs.length * 0.95)] ?? 0, maxMs: Math.max(0, ...HTTP.durs) },
  avgTurnMs: Math.round(RESULTS.reduce((a, r) => a + Number(r.turnMs), 0) / RESULTS.length), maxTurnMs: Math.max(...RESULTS.map((r) => Number(r.turnMs))), results: RESULTS };
mkdirSync("/home/user/.railbook-private/bench", { recursive: true });
writeFileSync(`/home/user/.railbook-private/bench/LING_STAB_${LEG}.json`, JSON.stringify(summary, null, 2));
console.log("\nSUMMARY", JSON.stringify({ ...summary, results: undefined }));
