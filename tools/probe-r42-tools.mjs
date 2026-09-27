/* Round-42 tool-routing battery — 24 sawaal, har ek ka EXPECTED tool set. Judge: sahi tool + jawab.
 * Chalao: node tools/probe-r42-tools.mjs   (live Render par) */
const BASE = "https://railbook-gegs.onrender.com";

/** [tag, question, acceptable tools (any), kya jawab "weak" lagega] */
const QS = [
  // ── train-name / info
  ["name-info", "Rajdhani Express ki jankari do", ["TRAIN_NAME_SEARCH", "SEARCH_TRAIN_BY_NAME", "GET_TRAIN_INFO"]],
  ["name-picker", "Shatabdi se related trains batao", ["TRAIN_NAME_SEARCH", "SEARCH_TRAIN_BY_NAME"]],
  // ── station board / code
  ["board", "Ludhiana junction par ab kaunsi trains aane wali hain", ["GET_STATION_BOARD"]],
  ["code", "Haridwar ka station code kya hai", ["SEARCH_STATIONS"]],
  // ── timetable variants
  ["arrival-at", "12054 Haridwar kitne baje pahunchegi", ["GET_TIMETABLE", "SEARCH_TRAIN_BY_NUMBER"]],
  ["stops-messy", "gaadi 12054 kahan kahan rukti hai", ["GET_TIMETABLE"]],
  // ── live status variants
  ["late-simple", "12054 late hai kya", ["TRACK_TRAIN"]],
  ["where-messy", "12054 abhi kaha pahunchi", ["TRACK_TRAIN"]],
  // ── seat intents
  ["seat-generic", "ASR se NDLS kal 2A me kaunsi train me seat hai", ["FIND_SEATS", "FIND_VACANT_SEATS"]],
  ["seat-window", "ASR se NDLS kal raat 9 ke baad sleeper me seat batao", ["FIND_SEATS"]],
  ["seat-cheapest", "ASR se NDLS kal sabse sasti seat wali train", ["FIND_SEATS"]],
  ["vacant", "Delhi se Jaipur kal 2 log ke liye khaali berth chahiye", ["FIND_VACANT_SEATS", "FIND_SEATS", "CHECK_AVAILABILITY"]],
  ["partial", "aadhi yatra kar rahe hain ASR se NDLS, seat milegi kya", ["FIND_PARTIAL_ROUTE_SEATS", "FIND_SEATS"]],
  // ── availability/fare specific
  ["avail-specific", "12054 me 28 September ko 3A me seat hai kya", ["CHECK_AVAILABILITY"]],
  ["fare-class", "12054 ka CC fare kal ka batao", ["GET_FARE"]],
  // ── plan / alternatives / connections
  ["alt-trains", "12054 ke alawa ASR se HW aur trains batao kal", ["FIND_ALTERNATIVE_TRAINS", "SEARCH_TRAINS"]],
  ["connections", "Delhi se Kolkata kal connecting trains batao", ["FIND_CONNECTIONS", "SEARCH_TRAINS"]],
  ["rank", "ASR se NDLS kal best plan 2 log ke liye", ["RANK_JOURNEY_OPTIONS", "JOURNEY_ANALYZE"]],
  // ── booking flow
  ["book-class-ask", "12054 mein book krdo kal ke liye", ["CHECK_AVAILABILITY", "FIND_SEATS", "GET_FARE"]],
  ["book-class-given", "12054 mein 2S book krdo kal ke liye", ["CHECK_AVAILABILITY", "GET_FARE", "FIND_SEATS"]],
  // ── PNR / cancelled / coach
  ["pnr", "PNR 4561237890 status batao", ["CHECK_PNR"]],
  ["coach", "12054 ka coach position kya hai", ["GET_COACH_POSITION", "GET_STATION_BOARD"]],
  // ── knowledge (tools optional — KB/web)
  ["kb-vs", "Rajdhani aur Vande Bharat me kya fark hai", ["WEB_SEARCH", "KB"]],
  ["kb-rule", "tatkal booking kab khulti hai", ["WEB_SEARCH", "KB"]],
];

const WEAK_RE = /^(kya aap|kis date|kaunsi date|kahan se|kis station|mujhe batao|please|sorry)|provider se nahi mil pa rahi|abhi available nahi ho rahi/i;

const run = async (q) => {
  const res = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: q, history: [], known: {}, now: new Date().toISOString() }),
    signal: AbortSignal.timeout(240000),
  });
  return res.json();
};

let okCount = 0;
const fails = [];
for (const [tag, q, expect] of QS) {
  try {
    const r = await run(q);
    const tools = (r.toolTrace ?? []).filter((s) => s.ok).map((s) => s.tool);
    const allTools = (r.toolTrace ?? []).map((s) => `${s.tool}${s.ok ? "✓" : "✗"}`);
    const reply = String(r.reply ?? "").replace(/\s+/g, " ").trim();
    const toolOk = expect.includes("KB") ? true : tools.some((t) => expect.includes(t));
    const weak = reply.length < 20 || WEAK_RE.test(reply);
    const ok = toolOk && !weak;
    if (ok) okCount++;
    else fails.push({ tag, q, tools: allTools, expect, reply: reply.slice(0, 160) });
    console.log(`${ok ? "✅" : "❌"} [${tag}] ${((r.latencyMs ?? 0) / 1000).toFixed(1)}s tools=[${allTools.join(",") || "-"}] expect=[${expect.join("|")}]`);
    console.log(`     ${reply.slice(0, 170)}`);
  } catch (e) {
    fails.push({ tag, q, tools: ["ERR"], expect, reply: String(e).slice(0, 90) });
    console.log(`❌ [${tag}] ERR ${String(e).slice(0, 80)}`);
  }
}
console.log(`\nR42-TOOLS: ${okCount}/${QS.length} sahi tool + jawab`);
if (fails.length) {
  console.log("\nFAILS:");
  for (const f of fails) console.log(`  [${f.tag}] "${f.q}"\n    tools=[${f.tools.join(",") || "-"}] expect=[${f.expect.join("|")}]\n    reply: ${f.reply}`);
}
