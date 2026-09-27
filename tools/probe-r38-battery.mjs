/* Round-38 battery — "kisi bhi sawaal ka ek dumm sahi jawab" (user requirement, 27 Sep):
 *   node tools/probe-r38-battery.mjs [--live]
 * Har category ke sawaal live /api/agent par; har jawab ko in cheezon par naapta hai:
 *   ok       = jawab aaya (khaali nahi), 
 *   hinglish = Hinglish/short (raw English paragraph dump nahi),
 *   direct   = sawaal ka seedha jawab (refusal/"data nahi aayi" nahi),
 *   sec      = kitne second
 */
import fs from "node:fs";

const BASE = process.env.RAILBOOK_URL ?? "https://railbook-gegs.onrender.com";
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const QS = [
  ["train-identity", "12054 kaunsi train hai aur kahan se kahan chalti hai?"],
  ["station-info", "Ludhiana junction ke kitne platform hain?"],
  ["fare", "ASR se HW 2S ka kiraya kitna hai?"],
  ["live-status", "12054 abhi kahan chalti hai? live status batao"],
  ["schedule", "12013 Shatabdi ka timetable batao"],
  ["rules-tatkal", "Tatkal booking kab khulti hai?"],
  ["rules-pnr", "PNR status kaise check karein?"],
  ["rules-refund", "Train 3 ghante late ho gayi to refund milta hai?"],
  ["catering", "Vande Bharat me khaana milta hai?"],
  ["berth", "Sleeper coach me kitne berth hote hain?"],
  ["list-route", "Ludhiana se Delhi jaane wali 2 trains ke naam batao"],
  ["capability", "Tum kya kya kar sakte ho?"],
  ["station-code", "LDH kaunsa station hai?"],
  ["general-speed", "Rajdhani ki top speed kitni hoti hai?"],
  ["accessibility", "Wheelchair wale passenger ke liye train me kya facility hai?"],
  ["offdomain", "Ludhiana me aaj mausam kaisa hai?"],
  ["light", "Chai kitne ki milti hai train me?"],
  ["booking-generic", "Amritsar se Haridwar ticket book karna hai"],
];

const score = (q, r) => {
  const reply = String(r.reply ?? "").trim();
  const t = reply.replace(/\s+/g, " ");
  const hinglish = /[a-z]/i.test(t) && !(t.length > 320 && !/\b(hai|ho|ki|ka|ke|me|mein|kya|batao|chalti|milega|milta|kar|se\b)/i.test(t));
  const direct = !/^(?:Ye jaankari abhi provider se nahi mil pa rahi|Nahi, main booking nahi kar sakta|kuch bhi nahi)/i.test(t) && !/data nahi aayi|provider se nahi mil|abhi nahi mil pa/i.test(t.slice(0, 120));
  return {
    q,
    sec: Number(((r.latencyMs ?? 0) / 1000).toFixed(1)),
    len: t.length,
    hinglish,
    direct,
    reply: t.slice(0, 170),
    tools: (r.toolTrace ?? []).filter((s) => s.ok).map((s) => s.tool).join("+") || "-",
  };
};

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
  if (ONLY && !cat.includes(ONLY)) continue;
  try {
    const r = await call(q);
    const s = score(cat, r);
    rows.push(s);
    console.log(
      `${s.direct ? "✅" : "⚠️ "} ${s.hinglish ? "H" : "E"} [${cat}] ${s.sec}s ${s.tools} :: ${s.reply}`,
    );
  } catch (e) {
    rows.push({ q: cat, sec: 0, len: 0, hinglish: false, direct: false, reply: `ERR ${String(e).slice(0, 80)}`, tools: "-" });
    console.log(`❌ [${cat}] ERR ${String(e).slice(0, 80)}`);
  }
}

const ok = rows.filter((r) => r.direct).length;
const hin = rows.filter((r) => r.hinglish).length;
console.log(`\nBATTERY: ${ok}/${rows.length} seedha jawab · ${hin}/${rows.length} Hinglish/short · avg ${(rows.reduce((a, b) => a + b.sec, 0) / rows.length).toFixed(1)}s`);
fs.writeFileSync("/tmp/r38-battery.json", JSON.stringify(rows, null, 1));
console.log("detail: /tmp/r38-battery.json");
