/**
 * R18m-29 perf harness — BEFORE/AFTER measurement of the same enquiries.
 * Instruments fetch (railway hosts vs AI host), counts calls, duplicate identical requests,
 * per-turn latency, AI calls per turn. Model NOT changed. Output: .railbook-private/bench/PERF_<tag>.json
 *   PERF_TAG=before npx tsx scripts/perf-measure.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
process.env.AI_AGENTIC_TURN_BUDGET_MS = process.env.PERF_TURN_BUDGET_MS || "120000"; // == prod Render setting
process.env.AI_PRIMARY_MIN_MS = process.env.AI_PRIMARY_MIN_MS || "25000"; // == prod
const TAG = process.env.PERF_TAG ?? "before";
const AI_HOST = "integrate.api.nvidia.com";
type Call = { host: string; url: string; ms: number; status: number | string; t: number };
let calls: Call[] = [];
const real = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (i: any, init?: any) => {
  const t0 = Date.now(); const url = String(i instanceof Request ? i.url : i); let host = ""; try { host = new URL(url).hostname; } catch {}
  try { const r = await real(i, init); calls.push({ host, url, ms: Date.now() - t0, status: r.status, t: t0 }); return r; }
  catch (e) { calls.push({ host, url, ms: Date.now() - t0, status: "ERR", t: t0 }); throw e; }
}) as typeof fetch;
const { runAgent } = await import("../server/agent/run.js");
const scopeMod: any = await import("../server/perf/turnScope.js").catch(() => null); // absent in "before" tree
const { runTurnScope, summarize, progress } = scopeMod ?? { runTurnScope: null, summarize: null, progress: () => {} };
const SCOPED = Boolean(scopeMod) && process.env.PERF_SCOPED !== "0"; // "after" runs the same per-turn scope as /api/agent
const { emptyAgentContext } = await import("../server/agent/context.js");
const NOW = new Date(); const YMD = (d: Date) => d.toISOString().slice(0, 10); const TOMORROW = YMD(new Date(NOW.getTime() + 86400000));
const norm = (u: string) => u.replace(/([?&])(authentication_token|user_id|_ts|t)=[^&]*/g, "$1");
function stats(c: Call[]) {
  const rail = c.filter((x) => x.host !== AI_HOST), ai = c.filter((x) => x.host === AI_HOST);
  const seen = new Map<string, number>(); for (const x of rail) seen.set(norm(x.url), (seen.get(norm(x.url)) ?? 0) + 1);
  const dups = [...seen.values()].reduce((a, n) => a + (n - 1), 0);
  const byHost: Record<string, { n: number; ms: number; err: number; rl: number }> = {};
  for (const x of rail) { const h = (byHost[x.host] ??= { n: 0, ms: 0, err: 0, rl: 0 }); h.n++; h.ms += x.ms; if (x.status === "ERR" || (typeof x.status === "number" && x.status >= 500)) h.err++; if (x.status === 429) h.rl++; }
  // wall-clock time during which ≥1 railway call was in flight
  const iv = rail.map((x) => [x.t, x.t + x.ms]).sort((a, b) => a[0] - b[0]); let busy = 0, cur: number[] | null = null;
  for (const [s, e] of iv) { if (!cur || s > cur[1]) { if (cur) busy += cur[1] - cur[0]; cur = [s, e]; } else cur[1] = Math.max(cur[1], e); } if (cur) busy += cur[1] - cur[0];
  // max concurrency
  const ev = rail.flatMap((x) => [[x.t, 1], [x.t + x.ms, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c0 = 0, maxc = 0; for (const [, d] of ev) { c0 += d; maxc = Math.max(maxc, c0); }
  return { railCalls: rail.length, railBusyMs: busy, railSumMs: rail.reduce((a, x) => a + x.ms, 0), maxConcurrency: maxc, duplicateIdentical: dups, byHost,
    aiCalls: ai.length, aiMs: ai.reduce((a, x) => a + x.ms, 0), rateLimit429: rail.filter((x) => x.status === 429).length, errors: rail.filter((x) => x.status === "ERR" || (typeof x.status === "number" && x.status >= 500)).length };
}
const RESULTS: any[] = [];
async function turn(id: string, text: string, ctx: any, extra: any = {}) {
  calls = []; const t0 = Date.now();
  let perf: unknown = null; const phases: string[] = [];
  const res = SCOPED
    ? await runTurnScope(async (scope) => { progress("Understanding your request"); const r = await runAgent({ text, now: NOW.toISOString(), context: ctx, ...extra }); progress("Preparing results"); perf = summarize(scope); return r; }, (e) => phases.push(e.total ? `${e.phase} ${e.done}/${e.total}` : e.phase))
    : await runAgent({ text, now: NOW.toISOString(), context: ctx, ...extra });
  const ms = Date.now() - t0; const s = stats(calls);
  const j = res.journey as any;
  const row = { id, text, ms, ...s, engine: res.engine, model: res.modelUsed, tool: res.tool, reply: String(res.reply ?? "").slice(0, 160), perf, phases, decisionSource: (res.journey as any)?.decision?.source ?? null, whySource: (res.journey as any)?.whySource ?? null,
    coverage: j ? { routeOptions: j.routeOptions?.length ?? 0, classRows: (j.routeOptions ?? []).reduce((a: number, r: any) => a + (r.classOptions?.length ?? 0), 0), bfe: j.recovery?.boardFromEarlier?.length ?? 0, legPlans: j.legPlans?.length ?? 0, audit: j.audit ?? null } : null,
    fresh: j ? (j.routeOptions ?? []).flatMap((r: any) => r.classOptions ?? []).filter((c: any) => c.status && c.status !== "UNKNOWN").map((c: any) => !c.stale) : [] };
  RESULTS.push(row);
  console.log(`[${id}] ${ms}ms | rail ${s.railCalls} calls (busy ${s.railBusyMs}ms, maxConc ${s.maxConcurrency}, dup ${s.duplicateIdentical}, 429×${s.rateLimit429}) | ai ${s.aiCalls} calls ${s.aiMs}ms | ${res.engine}/${res.modelUsed ?? "-"} | cov ${JSON.stringify(row.coverage)}`);
  console.log(`   ${row.reply.replace(/\n/g, " ")}`);
  return res;
}
const JAT = { code: "JAT", name: "Jammu Tawi" }, NDLS = { code: "NDLS", name: "New Delhi" }, LDH = { code: "LDH", name: "Ludhiana Jn" };
const base = emptyAgentContext();
// J1: full journey planner (pax answered) — the heavy path
await turn("J1", "1", { ...base, origin: JAT, destination: NDLS, date: TOMORROW, dateProvided: true, bookingStage: "collecting", pendingAsk: "passengers" }, { lastAsked: "passengers" });
// J2: second journey LDH→NDLS 2 pax
await turn("J2", "2", { ...base, origin: LDH, destination: NDLS, date: TOMORROW, dateProvided: true, bookingStage: "collecting", pendingAsk: "passengers" }, { lastAsked: "passengers" });
// A1: single-train availability (agentic)
await turn("A1", `12426 ki seat availability 3A ${TOMORROW} ko JAT se NDLS`, { ...base });
// A2: repeat enquiry must re-verify (freshness)
await turn("A2", `12426 ki seat availability 3A ${TOMORROW} ko JAT se NDLS dobara check karo`, { ...base });
// L1: live status
await turn("L1", "12014 abhi kahan hai aaj?", { ...base });
const ms = RESULTS.map((r) => r.ms).sort((a, b) => a - b);
const summary = { tag: TAG, at: NOW.toISOString(), turns: RESULTS.length, totalMs: RESULTS.reduce((a, r) => a + r.ms, 0), p50Ms: ms[Math.floor(ms.length / 2)], p95Ms: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))],
  aiCallsTotal: RESULTS.reduce((a, r) => a + r.aiCalls, 0), aiMsTotal: RESULTS.reduce((a, r) => a + r.aiMs, 0), railCallsTotal: RESULTS.reduce((a, r) => a + r.railCalls, 0), railBusyMsTotal: RESULTS.reduce((a, r) => a + r.railBusyMs, 0),
  duplicatesTotal: RESULTS.reduce((a, r) => a + r.duplicateIdentical, 0), rateLimit429Total: RESULTS.reduce((a, r) => a + r.rateLimit429, 0), errorsTotal: RESULTS.reduce((a, r) => a + r.errors, 0), maxConcurrency: Math.max(...RESULTS.map((r) => r.maxConcurrency)),
  freshRate: (() => { const f = RESULTS.flatMap((r) => r.fresh); return f.length ? `${f.filter(Boolean).length}/${f.length}` : "n/a"; })(), results: RESULTS };
writeFileSync(`/home/user/.railbook-private/bench/PERF_${TAG}.json`, JSON.stringify(summary, null, 2));
console.log("\nSUMMARY", JSON.stringify({ ...summary, results: undefined }));
