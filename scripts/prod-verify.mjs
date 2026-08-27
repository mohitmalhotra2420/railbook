/**
 * Production verification — never prints secrets.
 */
const BASE = process.argv[2] || "https://railbook-three.vercel.app";

function redact(v) {
  return JSON.parse(
    JSON.stringify(v ?? null).replace(
      /railkit_[A-Za-z0-9]+|rk_live_[A-Za-z0-9_-]+|vcp_[A-Za-z0-9]+|nvapi-[A-Za-z0-9_-]+/gi,
      "[REDACTED]",
    ),
  );
}

async function call(label, path, init) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { parseError: true, preview: text.slice(0, 160) };
  }
  const leaked = /railkit_[A-Za-z0-9]|rk_live_|nvapi-|vcp_/i.test(text);
  return {
    label,
    status: res.status,
    ok: res.ok,
    ms: Date.now() - started,
    leaked,
    body: redact(body),
  };
}

const out = { base: BASE, checks: {} };

function rec(name, pass, detail) {
  out.checks[name] = { pass, ...detail };
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
}

const health = await call("health", "/api/health");
rec("health_provider_railcore", health.body?.provider === "railcore" && health.body?.fallback === "railkit", {
  provider: health.body?.provider,
  fallback: health.body?.fallback,
  mock: health.body?.mock,
  status: health.status,
});

const meta = await call("meta", "/api/meta");
rec("meta_no_secrets", !meta.leaked && !JSON.stringify(meta.body).match(/API_KEY|SECRET|rk_live|railkit_/i), {
  provider: meta.body?.provider,
});

const jammu = await call("jammu", "/api/stations?q=Jammu");
const beas = await call("beas", "/api/stations?q=Beas");
rec(
  "jammu_beas",
  jammu.body?.stations?.[0]?.code === "JAT" && beas.body?.stations?.[0]?.code === "BEAS" && jammu.body?.provider === "railcore",
  {
    jammu: jammu.body?.stations?.slice(0, 2),
    beas: beas.body?.stations?.slice(0, 2),
    provider: jammu.body?.provider,
    needChoice: { jammu: jammu.body?.needChoice, beas: beas.body?.needChoice },
  },
);

const asr = await call("asr", "/api/stations?q=Amritsar");
const ldh = await call("ldh", "/api/stations?q=Ludhiana");
rec("asr_ldh_stations", asr.body?.stations?.[0]?.code === "ASR" && ldh.body?.stations?.[0]?.code === "LDH", {
  asr: asr.body?.stations?.[0],
  ldh: ldh.body?.stations?.[0],
  provider: asr.body?.provider,
});

const kochi = await call("kochi", "/api/stations?q=Kochi");
rec("kochi_no_kfx", (kochi.body?.stations?.[0]?.code ?? null) !== "KFX", {
  first: kochi.body?.stations?.[0]?.code ?? null,
  codes: (kochi.body?.stations || []).map((s) => s.code),
  needChoice: kochi.body?.needChoice,
  provider: kochi.body?.provider,
});

const delhi = await call("delhi", "/api/stations?q=Delhi");
rec("delhi_choice", delhi.body?.needChoice === true && (delhi.body?.stations || []).length > 1, {
  needChoice: delhi.body?.needChoice,
  codes: (delhi.body?.stations || []).map((s) => s.code),
  provider: delhi.body?.provider,
});

const trains = await call("trains", "/api/trains?from=ASR&to=LDH&date=2026-08-23");
const sample = (trains.body?.trains || []).find((t) => t.number === "12014") || trains.body?.trains?.[0];
rec("train_search", trains.ok && (trains.body?.trains || []).length > 0 && Boolean(sample?.number && sample?.name && sample?.departure), {
  count: trains.body?.trains?.length,
  empty: trains.body?.empty,
  sample: sample
    ? {
        number: sample.number,
        name: sample.name,
        departure: sample.departure,
        arrival: sample.arrival,
        duration: sample.durationLabel,
      }
    : null,
});

const live = await call("live", "/api/live?number=12014&date=2026-08-22");
rec("live_status", live.ok && live.body?.live?.trainNumber === "12014" && live.body?.provider === "railcore", {
  provider: live.body?.provider,
  status: live.body?.live?.status,
  delayMinutes: live.body?.live?.delayMinutes ?? null,
  currentStation: live.body?.live?.currentStation ?? null,
  nextStation: live.body?.live?.nextStation ?? null,
  lastUpdatedAt: live.body?.live?.lastUpdatedAt ?? null,
  http: live.status,
});

const avail = await call(
  "avail",
  "/api/availability?trainNumber=12014&date=2026-08-23&from=ASR&to=LDH&classCode=CC",
);
rec("availability", avail.ok && avail.body?.availability?.status && avail.body?.availability?.status !== "UNKNOWN", {
  status: avail.body?.availability?.status,
  seats: avail.body?.availability?.seats ?? null,
  fare: avail.body?.availability?.fare ?? null,
});

const fare = await call(
  "fare",
  "/api/fare?trainNumber=12014&date=2026-08-23&from=ASR&to=LDH&classCode=CC&passengers=1",
);
rec(
  "fare",
  fare.ok && fare.body?.fare?.railwayAvailable === true && fare.body?.fare?.baseFare > 0 && fare.body?.fare?.serviceFee > 0,
  {
    baseFare: fare.body?.fare?.baseFare,
    serviceFee: fare.body?.fare?.serviceFee,
    total: fare.body?.fare?.total,
    railwayAvailable: fare.body?.fare?.railwayAvailable,
  },
);

const schedule = await call("schedule", "/api/schedule?number=12014");
rec("timetable", schedule.ok && (schedule.body?.schedule?.stops || []).length > 0, {
  name: schedule.body?.schedule?.trainName,
  stops: schedule.body?.schedule?.stops?.length,
  provider: schedule.body?.provider,
});

const cancelled = await call("cancelled", "/api/cancelled");
rec("cancelled_railkit", cancelled.ok && cancelled.body?.provider === "railkit" && Array.isArray(cancelled.body?.cancelled?.fully), {
  provider: cancelled.body?.provider,
  fully: cancelled.body?.cancelled?.fully?.length,
  partial: cancelled.body?.cancelled?.partial?.length,
});

const pnr = await call("pnr", "/api/pnr-status?pnr=1234567890");
rec("pnr_railkit_no_invent", pnr.status === 404 || (pnr.ok && pnr.body?.provider === "railkit"), {
  http: pnr.status,
  provider: pnr.body?.provider ?? null,
  invented: Boolean(pnr.body?.pnr?.booking?.pnr && String(pnr.body.pnr.booking.pnr).startsWith("12")),
  error: pnr.body?.error ?? null,
});

const dateMissing = await call("nlu_date", "/api/understand", {
  method: "POST",
  body: JSON.stringify({ text: "Mujhe Amritsar se Ludhiana jaana hai", now: "2026-08-22T06:00:00.000Z" }),
});
rec(
  "date_not_assumed",
  dateMissing.ok && !dateMissing.body?.nlu?.date && dateMissing.body?.nlu?.from?.code === "ASR",
  {
    date: dateMissing.body?.nlu?.date ?? null,
    from: dateMissing.body?.nlu?.from?.code,
    to: dateMissing.body?.nlu?.to?.code,
    source: dateMissing.body?.source,
    missingFields: dateMissing.body?.missingFields,
  },
);

const dateGiven = await call("nlu_dated", "/api/understand", {
  method: "POST",
  body: JSON.stringify({ text: "Mujhe 23 August ko Amritsar se Ludhiana jaana hai", now: "2026-08-22T06:00:00.000Z" }),
});
rec("date_kept", dateGiven.ok && dateGiven.body?.nlu?.date === "2026-08-23", {
  date: dateGiven.body?.nlu?.date,
  from: dateGiven.body?.nlu?.from?.code,
  to: dateGiven.body?.nlu?.to?.code,
});

const help = await call("nvidia", "/api/understand", {
  method: "POST",
  body: JSON.stringify({ text: "kal Amritsar se Delhi 2 ticket", now: "2026-08-22T06:00:00.000Z" }),
});
rec("nvidia_or_nlu", help.ok && (help.body?.source === "ai" || help.body?.source === "nlu") && help.body?.nlu?.from?.code === "ASR", {
  source: help.body?.source,
  provider: help.body?.provider,
  modelUsed: help.body?.modelUsed,
  from: help.body?.nlu?.from?.code,
  to: help.body?.nlu?.to?.code,
  date: help.body?.nlu?.date,
});

const html = await fetch(BASE);
rec("site_up", html.ok, { status: html.status });

const pass = Object.values(out.checks).filter((c) => c.pass).length;
const fail = Object.values(out.checks).filter((c) => !c.pass).length;
out.summary = { pass, fail, total: pass + fail };
console.log(JSON.stringify(out, null, 2));
process.exit(fail ? 1 : 0);
