/**
 * Live RailCore smoke — server-side only. Never prints credentials.
 */
import { readFileSync, writeFileSync } from "node:fs";

const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2];
}
const key = (process.env.RAILCORE_API_KEY || "").trim();
if (!key) {
  console.error("FAIL: RAILCORE_API_KEY missing");
  process.exit(1);
}

const BASE = "https://ir.railcore.tech/v1";

function redact(v) {
  return JSON.parse(
    JSON.stringify(v).replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]"),
  );
}

async function call(label, path) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "X-RailCore-Key": key, Accept: "application/json" },
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { parseError: true, preview: text.slice(0, 240) };
    }
    return {
      label,
      status: res.status,
      ok: res.ok,
      latencyMs: Date.now() - started,
      body: redact(body),
    };
  } catch (err) {
    return {
      label,
      status: 0,
      ok: false,
      latencyMs: Date.now() - started,
      body: { error: String(err && err.message ? err.message : err).slice(0, 240) },
    };
  }
}

const report = { calls: {} };
report.calls.stationsJammu = await call("stations/search jammu", "/stations/search?q=Jammu&limit=5");
report.calls.stationsBeas = await call("stations/search beas", "/stations/search?q=Beas&limit=5");
report.calls.stationsLudhiana = await call("stations/search ludhiana", "/stations/search?q=Ludhiana&limit=5");
report.calls.stationsKochi = await call("stations/search kochi", "/stations/search?q=Kochi&limit=5");
report.calls.stationsAmritsar = await call("stations/search amritsar", "/stations/search?q=Amritsar&limit=5");
report.calls.stationsDelhi = await call("stations/search delhi", "/limit=5".replace("/limit=5", "/stations/search?q=Delhi&limit=5"));
report.calls.authProbe = report.calls.stationsJammu;

report.calls.routeAsrLdh = await call(
  "routes/trains ASR LDH 2026-08-23",
  "/routes/trains?from=ASR&to=LDH&date=2026-08-23",
);
report.calls.train12014 = await call("trains/12014", "/trains/12014");
report.calls.schedule12014 = await call("trains/12014/schedule", "/trains/12014/schedule");
report.calls.live12014 = await call("trains/12014/live?date=2026-08-22", "/trains/12014/live?date=2026-08-22");
report.calls.running12014 = await call("trains/12014/running?date=2026-08-22", "/trains/12014/running?date=2026-08-22");
report.calls.avail12014 = await call(
  "availability/seats 12014 CC",
  "/availability/seats?train_number=12014&from=ASR&to=LDH&date=2026-08-23&class=CC&quota=GN",
);
report.calls.fare12014 = await call(
  "fares/estimate 12014 CC",
  "/fares/estimate?train_number=12014&from=ASR&to=LDH&class=CC&quota=GN",
);
report.calls.cancelledGuess = await call("cancelled-trains (undocumented probe)", "/trains/cancelled");
report.calls.pnrGuess = await call("pnr (undocumented probe)", "/pnr/1234567890");

writeFileSync("/tmp/railcore-smoke.json", JSON.stringify(report, null, 2));

function brief(c) {
  if (!c) return c;
  const b = c.body;
  const data = b && typeof b === "object" ? b.data ?? b : b;
  return {
    status: c.status,
    ok: c.ok,
    ms: c.latencyMs,
    keys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : Array.isArray(data) ? ["<array>", data.length] : typeof data,
    error: b?.error || b?.message || null,
  };
}

console.log(
  JSON.stringify(
    {
      auth: { status: report.calls.authProbe.status, ok: report.calls.authProbe.ok, ms: report.calls.authProbe.latencyMs },
      jammu: brief(report.calls.stationsJammu),
      beas: brief(report.calls.stationsBeas),
      kochi: brief(report.calls.stationsKochi),
      route: brief(report.calls.routeAsrLdh),
      train: brief(report.calls.train12014),
      schedule: brief(report.calls.schedule12014),
      live: brief(report.calls.live12014),
      running: brief(report.calls.running12014),
      avail: brief(report.calls.avail12014),
      fare: brief(report.calls.fare12014),
      cancelledProbe: brief(report.calls.cancelledGuess),
      pnrProbe: brief(report.calls.pnrGuess),
    },
    null,
    2,
  ),
);
