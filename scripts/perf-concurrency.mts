/** R18m-29 rule A: raise the probe limit ONLY if provider rate-limits/errors stay healthy.
 *  Provider-only measurement (planJourney, aiWhy:false) so AI variance doesn't hide the effect.
 *  Same coverage each run. Usage: RAIL_PROBE_CONCURRENCY=15 npx tsx scripts/perf-concurrency.mts */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
type Call = { host: string; ms: number; status: number | string; t: number };
let calls: Call[] = [];
const real = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (i: any, init?: any) => { const t0 = Date.now(); let host = ""; try { host = new URL(String(i instanceof Request ? i.url : i)).hostname; } catch {}
  try { const r = await real(i, init); calls.push({ host, ms: Date.now() - t0, status: r.status, t: t0 }); return r; } catch (e) { calls.push({ host, ms: Date.now() - t0, status: "ERR", t: t0 }); throw e; } }) as typeof fetch;
const { planJourney } = await import("../server/journey/engine.js");
const { runTurnScope, summarize, PROBE_CONCURRENCY } = await import("../server/perf/turnScope.js");
const T = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const out: any[] = [];
for (const [from, to, pax] of [["JAT", "NDLS", 1], ["LDH", "NDLS", 2]] as const) {
  calls = []; const t0 = Date.now();
  const { plan, perf } = await runTurnScope(async (s) => ({ plan: await planJourney({ from, to, date: T, travelClass: null, passengers: pax, aiWhy: false, includeConnections: false, includeAlternativeDates: false }), perf: summarize(s) }));
  const ms = Date.now() - t0;
  const ry = calls.filter((c) => c.host === "sa.railyatri.in");
  const ev = calls.flatMap((x) => [[x.t, 1], [x.t + x.ms, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c0 = 0, maxc = 0; for (const [, d] of ev) { c0 += d; maxc = Math.max(maxc, c0); }
  const rows = plan.routeOptions.flatMap((o) => o.classOptions ?? []).filter((c) => c.status && c.status !== "UNKNOWN");
  const row = { route: `${from}→${to}`, limit: PROBE_CONCURRENCY, ms, maxConc: maxc, calls: calls.length, railyatri: { n: ry.length, ok: ry.filter((c) => c.status === 200).length, rl429: ry.filter((c) => c.status === 429).length, err: ry.filter((c) => c.status === "ERR" || (typeof c.status === "number" && c.status >= 500)).length, p50ms: ry.map((c) => c.ms).sort((a, b) => a - b)[Math.floor(ry.length / 2)] ?? 0 },
    otherRl429: calls.filter((c) => c.host !== "sa.railyatri.in" && c.status === 429).length, trains: plan.routeOptions.length, classRows: rows.length, fresh: rows.filter((r) => !r.stale).length, checks: `${perf.checksDone}/${perf.checksTotal}`, dedupHits: perf.dedupHits };
  out.push(row); console.log(JSON.stringify(row));
}
console.log("RESULT", JSON.stringify({ limit: PROBE_CONCURRENCY, at: new Date().toISOString(), runs: out }));
