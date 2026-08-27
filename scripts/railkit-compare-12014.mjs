import { readFileSync } from "node:fs";
const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2];
}
const { configure, trackTrain, getAvailability, fareLookup, getTrainInfo } = await import("railkit");
const key = (process.env.RAILKIT_API_KEY || "").trim();
configure(key);
const started = Date.now();
const live = await trackTrain("12014", "22-08-2026");
const liveMs = Date.now() - started;
const a0 = Date.now();
const avail = await getAvailability("12014", "ASR", "LDH", "23-08-2026", "CC", "GN");
const availMs = Date.now() - a0;
const f0 = Date.now();
const fare = await fareLookup("12014", "ASR", "LDH", "23-08-2026", "CC", "GN");
const fareMs = Date.now() - f0;
const i0 = Date.now();
const info = await getTrainInfo("12014");
const infoMs = Date.now() - i0;
function slim(res) {
  return {
    success: Boolean(res?.success),
    error: res?.error || res?.message || null,
    dataKeys: res?.data && typeof res.data === "object" ? Object.keys(res.data) : null,
    snippet: res?.success
      ? {
          statusNote: res.data?.statusNote,
          current: res.data?.currentStationCode,
          lastUpdate: res.data?.lastUpdate,
          trainName: res.data?.trainName || res.data?.trainInfo?.train_name,
          fare: res.data?.totalFare || res.data?.fare?.totalFare,
          avail: res.data?.availability?.[0] || res.data?.classes,
        }
      : null,
  };
}
console.log(
  JSON.stringify(
    {
      live: { ms: liveMs, ...slim(live) },
      avail: { ms: availMs, ...slim(avail) },
      fare: { ms: fareMs, ...slim(fare), total: fare?.data?.totalFare, base: fare?.data?.baseFare },
      info: { ms: infoMs, ...slim(info) },
    },
    null,
    2,
  ),
);
