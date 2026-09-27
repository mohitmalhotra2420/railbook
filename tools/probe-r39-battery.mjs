/* Round-39 battery — "har tarah ke sawaal" (user: "koi bhi trains/India railway/Booking/live status/
 * stations etc — ek dum se accurate answer"). Round-38 battery ke baad yeh NAYE 24 sawaal:
 * knowledge, rules, comparison, distance, capability, chhote follow-ups.
 *   node tools/probe-r39-battery.mjs
 */
import fs from "node:fs";

const BASE = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com";

const QS = [
  ["st-code", "Amritsar junction ka code kya hai?"],
  ["st-fullform", "NDLS ka poora naam kya hai?"],
  ["st-distance", "Ludhiana se Amritsar kitni doori hai?"],
  ["st-city", "Haridwar me kaunsa railway station hai?"],
  ["tr-name", "12054 ka naam kya hai?"],
  ["tr-compare", "Rajdhani aur Shatabdi me kya fark hai?"],
  ["tr-count", "India me kitni Vande Bharat trains chalti hain?"],
  ["tr-route", "Kashi Vishwanath Express kahan se kahan jaati hai?"],
  ["bk-tatkal-how", "Tatkal me ticket kaise book karein?"],
  ["bk-fare-diff", "3A aur 2A me fare ka fark kitna hota hai?"],
  ["bk-senior", "Senior citizen ko ticket me concession milta hai?"],
  ["bk-child", "Bachche ka ticket kab lagta hai?"],
  ["live-late", "12013 aaj late chal rahi hai kya?"],
  ["live-where", "12054 abhi kahan hai?"],
  ["rl-pet", "Kutta train me le ja sakte hain?"],
  ["rl-smoke", "Train me smoking allowed hai?"],
  ["rl-charge", "Mobile charging point har coach me hota hai?"],
  ["rl-acfail", "AC kharab ho gaya to paisa wapas milta hai?"],
  ["rl-bedroll", "Sleeper me blanket milti hai?"],
  ["gn-biggest", "Indian Railways ka sabse bada station kaunsa hai?"],
  ["gn-longest", "Sabse lambi train route kaunsi hai?"],
  ["gn-konkan", "Konkan Railway kahan se kahan tak hai?"],
  ["cap-book", "Mere liye ticket book kar do"],
  ["cap-limit", "Tum kya nahi kar sakte?"],
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

const rows = [];
for (const [cat, q] of QS) {
  try {
    const r = await call(q);
    const reply = String(r.reply ?? "").replace(/\s+/g, " ").trim();
    const weak = /^(Is sawaal ka sahi page nahi mila|Ye jaankari abhi provider se nahi mil pa rahi)/i.test(reply);
    const rawEn = reply.length > 260 && !/\b(hai|ho|ki|ka|ke|me|mein|kya|batao|chalti|milta|kar|se\b)/i.test(reply);
    rows.push({ cat, q, sec: Number(((r.latencyMs ?? 0) / 1000).toFixed(1)), weak, rawEn, tools: (r.toolTrace ?? []).filter((s) => s.ok).map((s) => s.tool).join("+") || "-", reply: reply.slice(0, 190) });
    console.log(`${weak ? "❌" : rawEn ? "⚠️ " : "✅"} [${cat}] ${(Number((r.latencyMs ?? 0) / 1000)).toFixed(0)}s ${rows[rows.length - 1].tools} :: ${reply.slice(0, 165)}`);
  } catch (e) {
    rows.push({ cat, q, sec: 0, weak: true, rawEn: false, tools: "-", reply: `ERR ${String(e).slice(0, 70)}` });
    console.log(`❌ [${cat}] ERR ${String(e).slice(0, 70)}`);
  }
}

const weakN = rows.filter((r) => r.weak).length;
console.log(`\nBATTERY-39: ${rows.length - weakN}/${rows.length} theek · ${weakN} fail · avg ${(rows.reduce((a, b) => a + b.sec, 0) / rows.length).toFixed(1)}s`);
console.log("FAILS:", rows.filter((r) => r.weak).map((r) => `[${r.cat}] ${r.q}`).join(" | ") || "koi nahi");
fs.writeFileSync("/tmp/r39-battery.json", JSON.stringify(rows, null, 1));
