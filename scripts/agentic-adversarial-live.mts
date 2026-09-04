/**
 * LIVE adversarial validation — REAL GPT-OSS-20B + REAL RailCore.
 * Counts every real API call by host/model. Keys never printed.
 * Run: npx tsx scripts/agentic-adversarial-live.mts [section]
 *   section: stations | acceptance | hallucination | dates | multitime | all
 */
const SECTION = process.argv[2] || "all";

const counts = { railcore: 0, nvidia: 0, total: 0, hosts: {} as Record<string, number>, models: {} as Record<string, number> };
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: any, init?: any) => {
  const url = String(input);
  try {
    if (url.includes("integrate.api.nvidia.com")) {
      counts.nvidia++;
      const model = JSON.parse(String(init?.body)).model;
      counts.models[model] = (counts.models[model] || 0) + 1;
    } else if (url.includes("railcore")) {
      counts.railcore++;
    }
  } catch { /* counting only */ }
  try {
    counts.total++;
    const host = new URL(url).host;
    counts.hosts[host] = (counts.hosts[host] || 0) + 1;
  } catch { /* ignore */ }
  return realFetch(input, init);
};

function mask(s: string | null): string {
  return String(s ?? "")
    .replace(/rk_live_[A-Za-z0-9_\-]+/g, "rk_live_***")
    .replace(/nvapi-[A-Za-z0-9_\-]+/g, "nvapi-***")
    .replace(/rk_test_[A-Za-z0-9_\-]+/g, "rk_test_***");
}

const { runAgenticTurn } = await import("../server/agent/agentic.js");

async function trace(title: string, text: string, known?: { origin?: string; destination?: string; date?: string; trainNumber?: string }) {
  console.log("\n" + "=".repeat(76));
  console.log(`LIVE: ${title}`);
  console.log(`USER: ${text}`);
  const t0 = Date.now();
  const turn = await runAgenticTurn({ text, now: new Date().toISOString(), known });
  console.log(`MODEL: ${turn.modelUsed} | ok=${turn.ok} grounded=${turn.grounded} ${((Date.now() - t0) / 1000).toFixed(1)}s${turn.failureReason ? ` failure=${turn.failureReason}` : ""}`);
  for (const s of turn.steps) {
    console.log(`  step ${s.step}: ${s.tool}(${JSON.stringify(s.args)}) -> ok=${s.ok} source=${s.source} ${s.latencyMs}ms`);
    console.log(`    ${mask(s.summary).slice(0, 150)}`);
  }
  console.log(`REPLY: ${mask(turn.reply).slice(0, 700)}`);
  return turn;
}

if (SECTION === "all" || SECTION === "stations") {
  console.log("\n############ TEST 2 — AMBIGUOUS STATIONS (LIVE) ############");
  for (const city of ["Delhi", "Bombay", "Madras", "Calcutta", "Jaipur"]) {
    await trace(`Station: ${city}`, `${city} se Amritsar jaana hai — train batao`);
  }
  await trace("Station: Delhi airport (non-railway place)", "Delhi airport se Jaipur jaana hai — train mil sakti hai?");
}

if (SECTION === "all" || SECTION === "acceptance") {
  console.log("\n############ TEST 3 — REAL MULTI-STEP TOOL CALLING (LIVE) ############");
  const t1 = await trace(
    "TEST 3: exact acceptance query",
    "Amritsar se Delhi Saturday ko fastest train batao, CC ka fare aur seat availability bhi batao.",
  );
  // Continue the flow as the user would (station pick) using the returned options.
  await trace(
    "TEST 3 (cont): user picks NDLS",
    "NDLS theek hai — sabse fast train ka CC fare aur seat availability batao",
    { origin: "Amritsar", destination: "NDLS", date: "2026-09-05" },
  );
  void t1;
}

if (SECTION === "all" || SECTION === "hallucination") {
  console.log("\n############ TEST 9 — HALLUCINATION (LIVE) ############");
  await trace("TEST 9a: live location with no provider data", "12014 ka live location batao");
  await trace("TEST 9b: Vande Bharat certainty probe", "Is Saturday ko Vande Bharat definitely chalegi? Amritsar se Delhi.");
}

if (SECTION === "all" || SECTION === "dates") {
  console.log("\n############ TEST 1 — DATE SEMANTICS (LIVE, arbitrary dates) ############");
  await trace("TEST 1a: absolute named date", "5 September 2026 ko Amritsar se New Delhi ki trains dikhao");
  await trace("TEST 1b: slash date", "12/09/2026 ko Amritsar se New Delhi ki trains dikhao");
}

if (SECTION === "all" || SECTION === "multitime") {
  console.log("\n############ TEST 12 — MULTI-TURN STATE (LIVE) ############");
  await trace("TEST 12 turn 1: origin+dest only (date poochni chahiye)", "Amritsar se Delhi jaana hai");
  await trace(
    "TEST 12 turn 2: 'Saturday' with known context",
    "saturday",
    { origin: "Amritsar", destination: "NDLS" },
  );
  await trace(
    "TEST 12 turn 3: fare/availability follow-up",
    "CC ka fare aur availability?",
    { origin: "Amritsar", destination: "NDLS", date: "2026-09-05", trainNumber: "12014" },
  );
}

console.log("\n" + "=".repeat(76));
console.log(`REAL API CALLS: railcore=${counts.railcore} nvidia_total=${counts.nvidia} total_fetch=${counts.total}`);
console.log(`HOSTS: ${JSON.stringify(counts.hosts)} by_model=${JSON.stringify(counts.models)}`);
