/* Round-18m-29: per-turn scope — dedup ONLY inside one user turn (never across turns),
 * bounded concurrency (no unlimited fan-out), metrics + real progress. */
import { describe, expect, it } from "vitest";
import { PROBE_CONCURRENCY, addChecks, checkDone, dedupe, mapLimited, progress, runTurnScope, summarize } from "../server/perf/turnScope.js";
import { readFileSync } from "node:fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Round-18m-29 turn scope", () => {
  it("dedupes identical requests within the SAME turn only", async () => {
    let calls = 0;
    const fetchOnce = () => dedupe("avail:12426:2026-09-14:JAT:NDLS:3A:GN", async () => { calls++; await sleep(5); return { status: "RAC", n: calls }; });
    const a = await runTurnScope(async () => Promise.all([fetchOnce(), fetchOnce(), fetchOnce()]));
    expect(calls).toBe(1);
    expect(a.map((x) => x.n)).toEqual([1, 1, 1]);
    /* Second enquiry ("dobara check karo") → FRESH provider fetch, never the previous turn's value. */
    const b = await runTurnScope(async () => fetchOnce());
    expect(calls).toBe(2);
    expect(b.n).toBe(2);
    /* Inside ONE turn the identical request is served once (user rule: same-turn dedup allowed);
     * the scope dies with the turn, so there is no TTL and nothing survives to the next enquiry. */
    let c = 0;
    await runTurnScope(async () => { await dedupe("k", async () => { c++; }); await dedupe("k", async () => { c++; }); });
    expect(c).toBe(1);
    await runTurnScope(async () => { await dedupe("k", async () => { c++; }); });
    expect(c).toBe(2);
  });

  it("outside a turn scope nothing is cached at all", async () => {
    let calls = 0;
    await dedupe("x", async () => { calls++; });
    await dedupe("x", async () => { calls++; });
    expect(calls).toBe(2);
  });

  it("mapLimited runs everything (same coverage) but never more than the limit at once", async () => {
    let inFlight = 0, peak = 0;
    const items = Array.from({ length: 37 }, (_, i) => i);
    const out = await mapLimited(items, async (i) => { inFlight++; peak = Math.max(peak, inFlight); await sleep(3); inFlight--; return i * 2; });
    expect(out).toEqual(items.map((i) => i * 2));
    expect(peak).toBeLessThanOrEqual(PROBE_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    expect(PROBE_CONCURRENCY).toBe(Number(process.env.RAIL_PROBE_CONCURRENCY ?? 10));
  });

  it("records real progress + metadata (fetchedAt/ageMs/cacheHit/providerUsed)", async () => {
    const events: { phase: string; done?: number; total?: number }[] = [];
    const perf = await runTurnScope(async (scope) => {
      progress("Understanding your request");
      addChecks(2);
      await dedupe("avail:1", async () => ({ ok: true }), { provider: () => "web_railyatri" });
      checkDone();
      await dedupe("avail:2", async () => ({ ok: true }), { provider: () => "web_railyatri" });
      checkDone();
      progress("Preparing results");
      return summarize(scope);
    }, (e) => events.push(e));
    expect(events.map((e) => e.phase)).toEqual(["Understanding your request", "Seat checks", "Seat checks", "Preparing results"]);
    expect(events[2]).toMatchObject({ done: 2, total: 2 });
    expect(perf.checksDone).toBe(2);
    expect(perf.entries.length).toBe(2);
    expect(perf.entries[0]).toMatchObject({ cacheHit: false, providerUsed: "web_railyatri" });
    expect(typeof perf.entries[0].fetchedAt).toBe("string");
    expect(perf.entries[0].ageMs).toBe(0);
    expect(perf.freshVerified).toBe(true);
  });

  it("engine has no unbounded Promise.all over provider probes; router availability goes through dedupe+limited", () => {
    const eng = readFileSync("server/journey/engine.ts", "utf8");
    expect(eng).not.toMatch(/Promise\.all\(\s*\n\s*probeList\.map/);
    expect(eng).not.toMatch(/Promise\.all\(\s*\n\s*found\.slice/);
    expect(eng).not.toMatch(/Promise\.all\(\s*\n\s*args\.trains\.slice/);
    expect(eng).toMatch(/mapLimited\(probeList/);
    const router = readFileSync("server/railway/router.ts", "utf8");
    expect(router).toMatch(/const key = `avail:\$\{trainNumber\}/);
    expect(router).toMatch(/dedupe\(key, \(\) => limited\(/);
    /* No TTL cache for dynamic data anywhere in the scope module. */
    const scope = readFileSync("server/perf/turnScope.ts", "utf8");
    expect(scope).not.toMatch(/\b(ttl|TTL|expires|expiresAt|maxAge)\b/);
  });
});

describe("Round-18m-29 nested fan-out never deadlocks", () => {
  it("outer mapLimited > limit with inner limited leaf calls completes (19 trains × 3 classes)", async () => {
    const { limited } = await import("../server/perf/turnScope.js");
    let leafPeak = 0, leafActive = 0, leafCalls = 0;
    const leaf = () => limited(async () => { leafActive++; leafCalls++; leafPeak = Math.max(leafPeak, leafActive); await new Promise((r) => setTimeout(r, 2)); leafActive--; return 1; });
    const trains = Array.from({ length: 19 }, (_, i) => i);
    const out = await Promise.race([
      mapLimited(trains, async () => { const rows = await mapLimited([1, 2, 3], () => leaf()); return rows.length; }),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 4000)),
    ]);
    expect(out).not.toBe("timeout");
    expect(leafCalls).toBe(57);
    expect(leafPeak).toBeLessThanOrEqual(PROBE_CONCURRENCY);
  });
});
