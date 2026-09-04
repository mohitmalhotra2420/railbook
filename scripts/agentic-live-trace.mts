/**
 * REAL end-to-end agentic trace: actual NVIDIA GPT-OSS-20B + actual RailCore.
 * Keys stay server-side; nothing secret is printed. Run: npx tsx scripts/agentic-live-trace.mts
 */
import { runAgenticTurn, agenticConfigured } from "../server/agent/agentic.js";

function mask(s: string | null): string {
  return String(s ?? "")
    .replace(/rk_live_[A-Za-z0-9_\-]+/g, "rk_live_***")
    .replace(/nvapi-[A-Za-z0-9_\-]+/g, "nvapi-***")
    .replace(/rk_test_[A-Za-z0-9_\-]+/g, "rk_test_***");
}

async function trace(title: string, text: string, known?: { origin?: string; destination?: string; date?: string; trainNumber?: string }) {
  console.log("\n" + "=".repeat(76));
  console.log(`TRACE: ${title}`);
  console.log(`USER: ${text}`);
  const t0 = Date.now();
  const turn = await runAgenticTurn({ text, now: new Date().toISOString(), known });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`MODEL: ${turn.modelUsed} | ok=${turn.ok} grounded=${turn.grounded} total=${dt}s${turn.failureReason ? ` failure=${turn.failureReason}` : ""}`);
  for (const s of turn.steps) {
    console.log(`  step ${s.step}: ${s.tool}(${JSON.stringify(s.args)}) -> ok=${s.ok} source=${s.source} ${s.latencyMs}ms`);
    console.log(`    ${mask(s.summary).slice(0, 160)}`);
  }
  for (const s of turn.steps) {
    if (s.dataPreview) console.log(`    data[${s.step}]: ${s.dataPreview.slice(0, 700)}`);
  }
  console.log(`REPLY: ${mask(turn.reply).slice(0, 900)}`);
  return turn;
}

console.log(`agenticConfigured=${agenticConfigured()} (key hidden)`);
const ONLY = (process.env.TRACE_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const want = (n: number) => !ONLY.length || ONLY.includes(String(n));

// Turn 1: acceptance example — ambiguous "Delhi" must yield an honest station question.
if (want(1))
  await trace(
    "Acceptance 1/2: fastest ASR->Delhi Saturday + CC fare/availability (station clarification expected)",
    "Amritsar se Delhi is Saturday ko jaana hai — sabse fast train batao aur uske CC class ka fare aur availability bhi.",
  );

// Turn 2: user picks NDLS and restates the pending need — known context continues, no re-asking.
if (want(2))
  await trace(
    "Acceptance 2/2: multi-turn continue after station choice (NDLS)",
    "NDLS theek hai — sabse fast train aur uske CC class ka fare aur availability batao",
    { origin: "Amritsar", destination: "NDLS", date: "2026-09-05" },
  );

if (want(3))
  await trace(
    "Live tracking: 12014 abhi kaha hai",
    "12014 abhi kahan tak pahuncha hai? delay kya hai?",
  );

if (want(4))
  await trace(
    "Atlas: JOURNEY_ANALYZE with connections",
    "Amritsar se Nagpur Saturday ko jana hai, koi direct na mile to connecting bhi dikhao — sabse best option suggest karo.",
  );
