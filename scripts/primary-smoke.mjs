/**
 * Live smoke for RailCore-primary + RailKit fallback.
 * Never prints credentials.
 */
import { readFileSync, writeFileSync } from "node:fs";

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
process.env.RAILWAY_PROVIDER = "railcore";

const { setRailcoreFetch } = await import("../server/railway/railcore.ts");
const { setRailkitSdk } = await import("../server/railway/railkit.ts");
const {
  routedStationSearch,
  routedLiveStatus,
  routedSchedule,
  routedTrainInfo,
  routedPnr,
  routedCancelled,
  getLastRailwayLog,
  FallbackRailwayProvider,
} = await import("../server/railway/router.ts");

const report = { when: new Date().toISOString(), results: {}, notes: [] };

function redact(s) {
  return String(s ?? "")
    .replace(/rk_live_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/railkit_[A-Za-z0-9]+/g, "[REDACTED]");
}

async function section(name, fn) {
  const started = Date.now();
  try {
    const data = await fn();
    report.results[name] = { ok: true, ms: Date.now() - started, data };
    console.log(`PASS ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    report.results[name] = { ok: false, ms: Date.now() - started, error: redact(err?.message || err) };
    console.log(`FAIL ${name}: ${redact(err?.message || err)}`);
  }
}

await section("A_jammu_beas_stations", async () => {
  const jammu = await routedStationSearch("Jammu");
  const beas = await routedStationSearch("Beas");
  if (jammu.stations[0]?.code !== "JAT") throw new Error(`Jammu resolved ${jammu.stations[0]?.code || "none"}`);
  if (beas.stations[0]?.code !== "BEAS") throw new Error(`Beas resolved ${beas.stations[0]?.code || "none"}`);
  return {
    jammu: jammu.stations.slice(0, 3),
    beas: beas.stations.slice(0, 3),
    provider: jammu.provider,
    needChoice: { jammu: jammu.needChoice, beas: beas.needChoice },
  };
});

await section("B_asr_ldh_trains", async () => {
  const p = new FallbackRailwayProvider();
  const trains = await p.searchTrains({ from: "ASR", to: "LDH", date: "2026-08-23" });
  if (!trains.length) throw new Error("no trains");
  const sample = trains.find((t) => t.number === "12014") ?? trains[0];
  return {
    count: trains.length,
    provider: getLastRailwayLog()?.railwayProvider,
    sample: { number: sample.number, name: sample.name, departure: sample.departure, arrival: sample.arrival },
  };
});

await section("C_live_12014_railcore", async () => {
  const routed = await routedLiveStatus("12014", "2026-08-22");
  if (!routed.live) throw new Error("no live");
  return {
    provider: routed.provider,
    trainNumber: routed.live.trainNumber,
    trainName: routed.live.trainName,
    status: routed.live.status,
    delayMinutes: routed.live.delayMinutes,
    currentStation: routed.live.currentStation,
  };
});

await section("C2_train_info_schedule", async () => {
  const info = await routedTrainInfo("12014");
  const sch = await routedSchedule("12014");
  if (!info.info?.trainName && !sch.schedule?.trainName) throw new Error("no train info");
  return {
    infoProvider: info.provider,
    name: info.info?.trainName || sch.schedule?.trainName,
    stops: sch.schedule?.stops?.length ?? 0,
    scheduleProvider: sch.provider,
  };
});

await section("D_force_railcore_fail_fallback", async () => {
  setRailcoreFetch(async () => {
    throw new Error("forced_railcore_down");
  });
  const p = new FallbackRailwayProvider();
  const trains = await p.searchTrains({ from: "ASR", to: "LDH", date: "2026-08-23" });
  const live = await routedLiveStatus("12014", "2026-08-22");
  setRailcoreFetch(null);
  return {
    searchCount: trains.length,
    searchProvider: getLastRailwayLog()?.railwayProvider,
    searchSample: trains[0] ? { number: trains[0].number, name: trains[0].name } : null,
    liveProvider: live.provider,
    liveStatus: live.live?.status ?? null,
    liveTrain: live.live?.trainNumber ?? null,
  };
});

await section("E_pnr_railkit", async () => {
  const remote = await routedPnr("1234567890");
  return {
    found: Boolean(remote),
    provider: getLastRailwayLog()?.railwayProvider,
    hasData: Boolean(remote?.data),
    invented: false,
  };
});

await section("F_cancelled_railkit", async () => {
  const list = await routedCancelled();
  if (!list) throw new Error("cancel list unavailable");
  return {
    fully: Array.isArray(list.fully) ? list.fully.length : 0,
    partial: Array.isArray(list.partial) ? list.partial.length : 0,
    provider: "railkit",
  };
});

await section("G_delhi_ambiguous", async () => {
  const delhi = await routedStationSearch("Delhi");
  return {
    needChoice: delhi.needChoice,
    codes: delhi.stations.map((s) => s.code),
    provider: delhi.provider,
  };
});

await section("H_kochi_no_kfx", async () => {
  const kochi = await routedStationSearch("Kochi");
  const first = kochi.stations[0]?.code ?? null;
  if (first === "KFX") throw new Error("selected KFX");
  return {
    first,
    codes: kochi.stations.map((s) => s.code),
    needChoice: kochi.needChoice,
    provider: kochi.provider,
  };
});

await section("I_asr_ldh_avail_fare", async () => {
  const p = new FallbackRailwayProvider();
  const avail = await p.getAvailability("12014", "2026-08-23", "ASR", "LDH", "CC", "GN");
  const fare = await p.getFare("12014", "2026-08-23", "ASR", "LDH", "CC", 1);
  return {
    availStatus: avail.status,
    seats: avail.seats ?? null,
    railwayFare: avail.fare,
    fareBase: fare.baseFare,
    serviceFee: fare.serviceFee,
    total: fare.total,
    railwayAvailable: fare.railwayAvailable,
    provider: getLastRailwayLog()?.railwayProvider,
  };
});

setRailkitSdk(null);
setRailcoreFetch(null);

const pass = Object.values(report.results).filter((r) => r.ok).length;
const fail = Object.values(report.results).filter((r) => !r.ok).length;
report.summary = { pass, fail, total: pass + fail };
writeFileSync("/tmp/primary-smoke.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summary: report.summary, results: report.results }, null, 2));
process.exit(fail ? 1 : 0);
