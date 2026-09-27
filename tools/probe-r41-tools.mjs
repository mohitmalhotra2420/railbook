/* Round-41 tool-routing audit — kis sawaal par kaunsa tool chala, aur kya wo SAHI tool tha? */
const BASE = "https://railbook-gegs.onrender.com";
const QS = [
  ["compare-Tejas-VB", "Tejas aur Vande Bharat me kya fark hai?", ["WEB_SEARCH", "KB"]],
  ["stops", "12054 ke saare stops batao", ["GET_TIMETABLE"]],
  ["live-where", "12054 abhi kahan hai", ["TRACK_TRAIN"]],
  ["fare", "12054 ka 2S fare kal ka kitna hai", ["GET_FARE"]],
  ["plan", "ASR se NDLS kal ka plan banao", ["JOURNEY_ANALYZE", "RANK_JOURNEY_OPTIONS", "SEARCH_TRAINS"]],
  ["coach", "12054 ka coach position batao", ["GET_COACH_POSITION", "GET_STATION_BOARD"]],
  ["station-code", "Amritsar station code kya hai", ["SEARCH_STATIONS", "GET_STATION_BOARD"]],
  ["cancelled", "aaj kaunsi trains cancelled hain Amritsar se", ["GET_CANCELLED_TRAINS"]],
  ["history", "12054 time par chalti hai ya late", ["GET_TRAIN_HISTORY", "TRACK_TRAIN"]],
  ["avail-pax", "Delhi se Jaipur kal 2 log ke liye seat", ["CHECK_AVAILABILITY", "FIND_VACANT_SEATS"]],
  ["compare-SL-3A", "SL aur 3A me kya fark hai", ["WEB_SEARCH", "KB"]],
  ["pnr", "mera pnr 4561237890 check karo", ["CHECK_PNR"]],
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
for (const [tag, q, expect] of QS) {
  try {
    const r = await call(q);
    const tools = (r.toolTrace ?? []).map((s) => `${s.tool}${s.ok ? "✓" : "✗"}`);
    const used = new Set(tools.map((t) => t.replace(/[✓✗]$/, "")));
    const ok = expect.some((e) => e === "KB" ? false : used.has(e));
    const reply = String(r.reply ?? "").replace(/\s+/g, " ").trim();
    console.log(`${ok ? "✅" : "⚠️"} [${tag}] ${((r.latencyMs ?? 0) / 1000).toFixed(1)}s tools=[${tools.join(",")}] expect=[${expect.join("|")}]`);
    console.log(`     ${reply.slice(0, 230)}`);
  } catch (e) {
    console.log(`❌ [${tag}] ERR ${String(e).slice(0, 70)}`);
  }
}
