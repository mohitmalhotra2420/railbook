/* Round-40 final battery — user ke exact wale sawaal (10). */
const BASE = "https://railbook-gegs.onrender.com";
const QS = [
  ["typo-status", "bhai 12054 ki statsu batao"],
  ["missing-info", "Amritsar se Haridwar jaana hai"],
  ["gk-oldest", "India ka sabse purana railway station kaunsa hai?"],
  ["kb-vivek", "Vivek express kahan se kahan chalti hai?"],
  ["gk-platform", "Ludhiana station pe kitne platform hain?"],
  ["kb-child", "3 saal ke bachche ka ticket chahiye kya?"],
  ["live-honest", "Is Saturday ko Vande Bharat Express chalegi?"],
  ["live-seat", "12054 me kal ki seat availability"],
  ["gk-compare", "Tejas aur Vande Bharat me kya fark hai?"],
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
let bad = 0;
for (const [tag, q] of QS) {
  try {
    const r = await call(q);
    const reply = String(r.reply ?? "").replace(/\s+/g, " ").trim();
    const weak = reply.length < 15 || /mere live .*nahi hoti|available nahi hai — provider/i.test(reply);
    if (weak) bad++;
    console.log(`${weak ? "❌" : "✅"} [${tag}] ${((r.latencyMs ?? 0) / 1000).toFixed(1)}s :: ${reply.slice(0, 190)}`);
  } catch (e) {
    bad++;
    console.log(`❌ [${tag}] ERR ${String(e).slice(0, 70)}`);
  }
}
console.log(`\nR40-FINAL: ${QS.length - bad}/${QS.length} theek`);
