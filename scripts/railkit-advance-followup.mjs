import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import {
  configure,
  getTrainInfo,
  trackTrain,
  getAvailability,
  fareLookup,
  liveAtStation,
} from "railkit";

config({ path: new URL("../.env", import.meta.url) });
const key = (process.env.RAILKIT_API_KEY || "").trim();
configure(key);

function slim(res) {
  const ok = Boolean(res?.success);
  return {
    success: ok,
    error: res?.error || res?.message || null,
    dataKeys: res?.data && typeof res.data === "object" && !Array.isArray(res.data) ? Object.keys(res.data) : null,
    data: ok ? res.data : null,
  };
}

const out = {};

// Route of 19326: does it include LDH?
const info19326 = slim(await getTrainInfo("19326"));
const route = info19326.data?.route || [];
out.route19326_ldh = route
  .filter((s) => ["LDH", "DDL"].includes(String(s.stnCode || "").toUpperCase()))
  .map((s) => ({ code: s.stnCode, name: s.stnName, arr: s.arrival, dep: s.departure }));

// Shatabdi 12014 — real ASR-LDH service
{
  const r = slim(await getTrainInfo("12014"));
  const ti = r.data?.trainInfo || {};
  out.info12014 = {
    success: r.success,
    error: r.error,
    train: { no: ti.train_no, name: ti.train_name, type: ti.type, days: ti.running_days },
    hasClasses: Boolean(ti.classes),
    trainInfoKeys: Object.keys(ti),
  };
}

out.avail12014_CC = slim(await getAvailability("12014", "ASR", "LDH", "23-08-2026", "CC", "GN"));
out.avail12014_EC = slim(await getAvailability("12014", "ASR", "LDH", "23-08-2026", "EC", "GN"));
out.fare12014_CC = slim(await fareLookup("12014", "ASR", "LDH", "23-08-2026", "CC", "GN"));
out.avail12716_SL = slim(await getAvailability("12716", "ASR", "LDH", "23-08-2026", "SL", "GN"));
out.fare12716_SL = slim(await fareLookup("12716", "ASR", "LDH", "23-08-2026", "SL", "GN"));

// Live: train currently on the LDH board
const board = slim(await liveAtStation("LDH", 2));
const liveTrain = board.data?.trains?.[0];
out.boardFirst = liveTrain
  ? { trainNo: liveTrain.trainNo, trainName: liveTrain.trainName, runDate: liveTrain.runDate }
  : null;
if (liveTrain?.trainNo) {
  out.trackBoardTrain = slim(await trackTrain(String(liveTrain.trainNo)));
  out.trackBoardTrainDated = slim(await trackTrain(String(liveTrain.trainNo), "22-08-2026"));
}
out.track12014_today = slim(await trackTrain("12014", "22-08-2026"));
out.track12014_nodate = slim(await trackTrain("12014"));
out.track12014_tomorrow = slim(await trackTrain("12014", "23-08-2026"));

// availability using DDL if that's the stop
out.avail19326_DDL = slim(await getAvailability("19326", "ASR", "DDL", "23-08-2026", "SL", "GN"));

writeFileSync("/tmp/railkit-advance-followup.json", JSON.stringify(out, null, 2));

function brief(x) {
  if (!x) return x;
  if (x.success && x.data) {
    const d = x.data;
    if (d.availability || d.fare || d.train) {
      return {
        success: true,
        train: d.train || d.trainName || d.trainNo,
        fare: d.fare || { totalFare: d.totalFare, baseFare: d.baseFare },
        availability: Array.isArray(d.availability)
          ? d.availability.slice(0, 3)
          : d.availability || d.availabilityText || d.status,
      };
    }
    if (d.statusNote || d.timeline) {
      return {
        success: true,
        statusNote: d.statusNote,
        current: d.currentStationCode,
        lastUpdate: d.lastUpdate,
        timelineLen: Array.isArray(d.timeline) ? d.timeline.length : 0,
      };
    }
    return { success: true, keys: Object.keys(d) };
  }
  return { success: false, error: x.error };
}

console.log(
  JSON.stringify(
    {
      route19326_ldh: out.route19326_ldh,
      info12014: out.info12014,
      avail12014_CC: brief(out.avail12014_CC),
      avail12014_EC: brief(out.avail12014_EC),
      fare12014_CC: brief(out.fare12014_CC),
      avail12716_SL: brief(out.avail12716_SL),
      fare12716_SL: brief(out.fare12716_SL),
      boardFirst: out.boardFirst,
      trackBoardTrain: brief(out.trackBoardTrain),
      trackBoardTrainDated: brief(out.trackBoardTrainDated),
      track12014_today: brief(out.track12014_today),
      track12014_nodate: brief(out.track12014_nodate),
      track12014_tomorrow: brief(out.track12014_tomorrow),
      avail19326_DDL: brief(out.avail19326_DDL),
    },
    null,
    2,
  ),
);
