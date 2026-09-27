/* Round-40 battery — "user ke questions samjho, ek dum perfect answer/outcome do" (27 Sep, 3rd demand).
 * 30 sawaal — 6 category: typo/messy · general knowledge · rules · live data · booking flow · capability/off.
 *   node tools/probe-r40-battery.mjs
 */
import fs from "node:fs";

const BASE = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com";

const QS = [
  // typo / messy
  ["typo-status", "bhai 12054 ki statsu batao"],
  ["typo-trains", "ldh se asr kitne train hai"],
  ["typo-degraded", "gaadi 12054 kaha pahunchi"],
  ["typo-mix", "vande bharat ki spid kitni h"],
  // general knowledge
  ["gk-oldest", "India ka sabse purana railway station kaunsa hai?"],
  ["gk-count", "India me total kitne railway station hain?"],
  ["gk-fastest", "India ki sabse tez train kaunsi hai?"],
  ["gk-zone", "Indian Railways me kitne zones hain?"],
  ["gk-chair", "Vande Bharat me chair car hoti hai ya sleeper?"],
  ["gk-2s-sl", "2S aur SL me kya better hai?"],
  ["gk-tejas", "Tejas aur Vande Bharat me kya fark hai?"],
  ["gk-first", "India ki pehli train kab chali thi?"],
  // rules
  ["rl-child", "3 saal ke bachche ka ticket chahiye kya?"],
  ["rl-food", "train me khana kaise order kare?"],
  ["rl-tatkal", "tatkal me ticket kaise book kare?"],
  ["rl-late", "train 1 ghante late ho to refund milta hai?"],
  ["rl-wl", "waiting list 45 wala ticket confirm hoga ya nahi?"],
  ["rl-charging", "sleeper me charging point hota hai?"],
  ["rl-platform", "Ludhiana station pe kitne platform hain?"],
  // live data
  ["live-status", "12054 ka live status batao"],
  ["live-seat", "12054 me kal ki seat availability"],
  ["live-fare", "12054 ka 2S fare kitna hai kal ka"],
  ["live-pnr", "mera PNR 4561237890 check karo"],
  ["live-route", "12054 ke saare stops batao"],
  // booking flow
  ["bk-generic", "Amritsar se Haridwar jaana hai"],
  ["bk-class", "12054 me 2S book krdo"],
  // capability / off-domain
  ["cap", "tum kya kya kar sakte ho?"],
  ["cap-no", "tum kya nahi kar sakte?"],
  ["off-weather", "Ludhiana me aaj mausam kaisa hai?"],
  ["off-food", "Ludhiana me best chole bhature kahan milte hain?"],
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

const judge = (q, reply) => {
  const t = String(reply ?? "").replace(/\s+/g, " ").trim();
  const tooShort = t.length < 12;
  const weak = tooShort || /^(Is sawaal ka sahi page nahi mila|Ye jaankari abhi provider se nahi mil pa rahi|kuch bhi nahi)/i.test(t);
  const dumpy = /•\s*Web search "|UNVERIFIED, live railway data nahi/i.test(t);
  const wrongDomain = /Expressway|National Highway|highway/i.test(t) && !/train|rail|station/i.test(t);
  return { len: t.length, weak, dumpy, wrongDomain };
};

const rows = [];
for (const [tag, q] of QS) {
  try {
    const r = await call(q);
    const reply = String(r.reply ?? "").replace(/\s+/g, " ").trim();
    const j = judge(q, reply);
    const bad = j.weak || j.dumpy || j.wrongDomain;
    rows.push({ tag, q, sec: +((r.latencyMs ?? 0) / 1000).toFixed(1), bad, ...j, reply: reply.slice(0, 200), tools: (r.toolTrace ?? []).filter((s) => s.ok).map((s) => s.tool).join("+") || "-" });
    console.log(`${bad ? "❌" : "✅"} [${tag}] ${rows[rows.length - 1].sec}s ${rows[rows.length - 1].tools} :: ${reply.slice(0, 150)}`);
  } catch (e) {
    rows.push({ tag, q, sec: 0, bad: true, weak: true, dumpy: false, wrongDomain: false, len: 0, reply: `ERR ${String(e).slice(0, 70)}`, tools: "-" });
    console.log(`❌ [${tag}] ERR ${String(e).slice(0, 70)}`);
  }
}

const bads = rows.filter((r) => r.bad);
console.log(`\nBATTERY-40: ${rows.length - bads.length}/${rows.length} theek · ${bads.length} fail · avg ${(rows.reduce((a, b) => a + b.sec, 0) / rows.length).toFixed(1)}s`);
if (bads.length) console.log("FAILS:\n" + bads.map((r) => `  [${r.tag}] ${r.q} :: ${r.reply.slice(0, 120)}`).join("\n"));
fs.writeFileSync("/tmp/r40-battery.json", JSON.stringify(rows, null, 1));
