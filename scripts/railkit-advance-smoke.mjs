/**
 * Live RailKit Advance smoke — server-side only.
 * Never prints credentials. Writes sanitized JSON to /tmp.
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import {
  configure,
  searchTrainBetweenStations,
  getTrainInfo,
  trackTrain,
  getAvailability,
  fareLookup,
  checkPNRStatus,
  cancelList,
  liveAtStation,
  getTrainHistory,
} from "railkit";

config({ path: new URL("../.env", import.meta.url) });

const key = (process.env.RAILKIT_API_KEY || "").trim();
if (!key) {
  console.error("FAIL: RAILKIT_API_KEY missing in server env");
  process.exit(1);
}

configure(key);

function sanitize(value) {
  const raw = JSON.stringify(value);
  const redacted = raw
    .replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]")
    .replace(/railkit_[A-Za-z0-9]+/g, "[REDACTED]");
  try {
    return JSON.parse(redacted);
  } catch {
    return { parseError: true, text: redacted.slice(0, 2000) };
  }
}

function summarize(label, started, res) {
  const ok = Boolean(res && res.success);
  const msg = res?.message || res?.error || res?.msg || null;
  return {
    label,
    success: ok,
    latencyMs: Date.now() - started,
    message: msg ? String(msg).slice(0, 240) : null,
    keys: res && typeof res === "object" ? Object.keys(res) : [],
    dataKeys:
      res?.data && typeof res.data === "object" && !Array.isArray(res.data)
        ? Object.keys(res.data)
        : Array.isArray(res?.data)
          ? ["<array>", res.data.length]
          : typeof res?.data,
    sample: sanitize(ok ? res.data : res),
  };
}

async function call(label, fn) {
  const started = Date.now();
  try {
    const res = await fn();
    return summarize(label, started, res);
  } catch (err) {
    return {
      label,
      success: false,
      latencyMs: Date.now() - started,
      message: String(err && err.message ? err.message : err).slice(0, 240),
      keys: [],
      dataKeys: null,
      sample: null,
    };
  }
}

const report = {
  auth: {
    keyPresent: true,
    keyPrefix: "railkit_",
    keyLength: key.length,
  },
  calls: {},
};

// 1) Train search ASR → LDH
report.calls.search = await call("searchTrainBetweenStations ASR LDH", () =>
  searchTrainBetweenStations("ASR", "LDH", "23-08-2026"),
);

const trains = Array.isArray(report.calls.search.sample)
  ? report.calls.search.sample
  : [];
const first = trains[0] || null;
report.realSearch = {
  success: report.calls.search.success,
  count: trains.length,
  latencyMs: report.calls.search.latencyMs,
  first: first
    ? {
        train_no: first.train_no ?? first.train_number ?? null,
        train_name: first.train_name ?? first.trainName ?? null,
        from_time: first.from_time ?? null,
        to_time: first.to_time ?? null,
        travel_time: first.travel_time ?? first.duration ?? null,
        from_stn_code: first.from_stn_code ?? null,
        to_stn_code: first.to_stn_code ?? null,
        running_days: first.running_days ?? null,
        keys: Object.keys(first),
      }
    : null,
  sampleNumbers: trains.slice(0, 8).map((t) => ({
    no: t.train_no ?? t.train_number ?? null,
    name: t.train_name ?? t.trainName ?? null,
    dep: t.from_time ?? null,
    arr: t.to_time ?? null,
  })),
};

const trainNo = String(report.realSearch.first?.train_no || "12014");

// 2) Train info / timetable
report.calls.trainInfo = await call(`getTrainInfo ${trainNo}`, () => getTrainInfo(trainNo));

// 3) Live status
report.calls.live = await call(`trackTrain ${trainNo} 22-08-2026`, () =>
  trackTrain(trainNo, "22-08-2026"),
);

// 4) Availability — use a likely class; Shatabdi CC else SL
const coachGuess = /SHTABDI|VANDE|TEJAS|GARIB RATH/i.test(String(report.realSearch.first?.train_name || ""))
  ? "CC"
  : "SL";
report.calls.availability = await call(
  `getAvailability ${trainNo} ASR LDH 23-08-2026 ${coachGuess} GN`,
  () => getAvailability(trainNo, "ASR", "LDH", "23-08-2026", coachGuess, "GN"),
);

// 5) Fare
report.calls.fare = await call(
  `fareLookup ${trainNo} ASR LDH 23-08-2026 ${coachGuess} GN`,
  () => fareLookup(trainNo, "ASR", "LDH", "23-08-2026", coachGuess, "GN"),
);

// 6) Station board (not city search) — proves station-code APIs work
report.calls.liveAtStation = await call("liveAtStation LDH", () => liveAtStation("LDH", 2));

// 7) Cancelled trains
report.calls.cancelList = await call("cancelList", () => cancelList());

// 8) Train history (may 404 if journey not complete)
report.calls.history = await call(`getTrainHistory ${trainNo} 21-08-2026`, () =>
  getTrainHistory(trainNo, "21-08-2026"),
);

// 9) Station lookup: there is no documented method. Record absence.
report.stationLookup = {
  documentedMethod: false,
  attemptedInventedMethod: false,
  result: "Station lookup unavailable",
};

// 10) PNR: no authorized test PNR provided — do not call a fake PNR.
report.pnr = {
  tested: false,
  reason: "PNR endpoint not fully live-tested.",
};

writeFileSync("/tmp/railkit-advance-smoke.json", JSON.stringify(report, null, 2));
console.log("SMOKE_WRITTEN /tmp/railkit-advance-smoke.json");
console.log(
  JSON.stringify(
    {
      searchSuccess: report.calls.search.success,
      searchCount: report.realSearch.count,
      searchMs: report.realSearch.latencyMs,
      first: report.realSearch.first,
      trainInfo: { success: report.calls.trainInfo.success, ms: report.calls.trainInfo.latencyMs, message: report.calls.trainInfo.message, dataKeys: report.calls.trainInfo.dataKeys },
      live: { success: report.calls.live.success, ms: report.calls.live.latencyMs, message: report.calls.live.message, dataKeys: report.calls.live.dataKeys },
      availability: { success: report.calls.availability.success, ms: report.calls.availability.latencyMs, message: report.calls.availability.message, dataKeys: report.calls.availability.dataKeys },
      fare: { success: report.calls.fare.success, ms: report.calls.fare.latencyMs, message: report.calls.fare.message, dataKeys: report.calls.fare.dataKeys },
      liveAtStation: { success: report.calls.liveAtStation.success, ms: report.calls.liveAtStation.latencyMs, message: report.calls.liveAtStation.message },
      cancelList: { success: report.calls.cancelList.success, ms: report.calls.cancelList.latencyMs, message: report.calls.cancelList.message },
      history: { success: report.calls.history.success, ms: report.calls.history.latencyMs, message: report.calls.history.message },
    },
    null,
    2,
  ),
);
