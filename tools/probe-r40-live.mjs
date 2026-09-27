/* Round-40 live verify — user ke wale sawaal (typo, missing-info, general knowledge, live, capability). */
const BASE = "https://railbook-gegs.onrender.com";
const QS = [
  ["typo+date-missing", "bhai 12054 ki statsu batao"],
  ["missing-info", "Amritsar se Haridwar jaana hai"],
  ["gk-count", "India me total kitne railway station hain?"],
  ["gk-first", "India ki pehli train kab chali thi?"],
  ["kb-vivek", "Vivek express kahan se kahan chalti hai?"],
  ["live-honest", "Is Saturday ko Vande Bharat Express chalegi?"],
  ["live-seat", "12054 me kal ki seat availability"],
  ["kb-pet", "kutta train me le ja sakte hain?"],
  ["gk-platform", "Ludhiana station pe kitne platform hain?"],
  ["capability", "tum kya kya kar sakte ho?"],
];
const call = async (text) => {
  const res = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, history: [], known: {}, now: new Date().toISOString() }),
    signal: AbortSignal.timeout(240000),
  });
  return res.json();
};
for (const [tag, q] of QS) {
  try {
    const r = await call(q);
    const reply = String(r.reply ?? "").replace(/\s+/g, " ").trim();
    console.log(`── [${tag}] ${((r.latencyMs ?? 0) / 1000).toFixed(1)}s fr=${r.failureReason ?? "-"} grounded=${r.grounded}`);
    console.log(`   Q: ${q}`);
    console.log(`   A: ${reply.slice(0, 300)}`);
  } catch (e) {
    console.log(`── [${tag}] ERR ${String(e).slice(0, 80)}`);
  }
}
