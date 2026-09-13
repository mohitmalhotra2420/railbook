/* Round-18m-30g (prod screenshot 2026-09-13 17:32): user "Mujhe ludhiana se AYODHYA jaana hai kal" — pichhli chat
 * LDH→BSB thi; model ne SEARCH_TRAINS(destination="Varanasi") chala diya → "Varanasi ke liye kaunsa station?
 * BSB/BCY" → user "1" → LDH→BSB plan. Station galat identify hua (user rule: KABHI nahi).
 * Fix: (a) tool args mein user ka is-turn ka shehar HARD override (model ki guess nahi), (b) lookup se 0 stations
 * aayein to deterministic honest ask — model ko guess ka mauka hi nahi. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../server/agent/run";
import { runAgenticTurn, setAgenticNvidiaFetch } from "../server/agent/agentic";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setProvider } from "../server/providers/index";
import { emptyAgentContext } from "../server/agent/context.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const toolCall = (name: string, args: unknown) => ({ id: `c_${name}`, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });

describe("Round-18m-30g: the city the user typed is the city the tools get", () => {
  const calls: { path: string; q: string }[] = [];
  beforeEach(() => {
    calls.length = 0;
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_test";
    process.env.NVIDIA_API_KEY = "nvapi-test";
    setProvider(null);
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, q: url.searchParams.get("q") ?? "" });
      if (url.pathname.endsWith("/stations/search")) {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        if (q.includes("ayodhya")) return json(200, { success: true, data: { results: [{ station_code: "AYC", station_name: "AYODHYA CANTT", city: "Ayodhya", confidence: 0.9 }, { station_code: "AY", station_name: "AYODHYA DHAM JN", city: "Ayodhya", confidence: 0.9 }] } });
        if (q.includes("varanasi")) return json(200, { success: true, data: { results: [{ station_code: "BSB", station_name: "VARANASI JN", city: "Varanasi", confidence: 0.9 }, { station_code: "BCY", station_name: "VARANASI CITY", city: "Varanasi", confidence: 0.8 }] } });
        if (q.includes("ludhiana") || q === "ldh") return json(200, { success: true, data: { results: [{ station_code: "LDH", station_name: "LUDHIANA JN", city: "Ludhiana", confidence: 1 }] } });
        return json(200, { success: true, data: { results: [] } });
      }
      return json(200, { success: true, data: { trains: [] } });
    });
  });
  afterEach(() => { setRailcoreFetch(null); setAgenticNvidiaFetch(null); setProvider(null); process.env.NVIDIA_API_KEY = ""; process.env.RAILCORE_API_KEY = ""; });

  it("agentic loop: model guesses destination='Varanasi' (old chat) → tool receives 'Ayodhya'; options are Ayodhya stations", async () => {
    let round = 0;
    setAgenticNvidiaFetch(async () => {
      round++;
      if (round === 1) return json(200, { choices: [{ message: { content: null, tool_calls: [toolCall("SEARCH_TRAINS", { origin: "LDH", destination: "Varanasi", date: "2026-09-14" })] } }] });
      return json(200, { choices: [{ message: { content: "ok" } }] });
    });
    const turn = await runAgenticTurn({ text: "Mujhe ludhiana se ayodhya jaana hai kal", now: "2026-09-13T12:05:00.000Z", history: [{ role: "user", content: "ldh se bsb 14 sept" }, { role: "assistant", content: "LDH → BSB plan ready" }], known: { origin: "LDH", destination: null, date: "2026-09-14", dateProvided: true, destinationAmbiguous: "Ayodhya", passengers: 2 } } as never);
    const searchArgs = turn.steps.find((s) => s.tool === "SEARCH_TRAINS")?.args as { destination?: string } | undefined;
    expect(searchArgs?.destination).toBe("Ayodhya");
    expect(calls.some((c) => c.path.endsWith("/stations/search") && /varanasi/i.test(c.q))).toBe(false);
    expect(turn.reply).toMatch(/Ayodhya/);
    expect(turn.reply).not.toMatch(/Varanasi|BSB|BCY/);
  }, 30000);

  it("runAgent (full path): station options offered are Ayodhya's, previous BSB destination is dropped", async () => {
    setAgenticNvidiaFetch(async () => json(200, { choices: [{ message: { content: "ok" } }] }));
    const prev = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Jn" }, destination: { code: "BSB", name: "Varanasi Jn" }, date: "2026-09-14", dateProvided: true, passengers: 2, paxProvided: true };
    const res = await runAgent({ text: "Mujhe ludhiana se ayodhya jaana hai kal", now: "2026-09-13T12:05:00.000Z", context: prev, history: [{ role: "user", content: "ldh se bsb 14 sept" }, { role: "assistant", content: "**Varanasi ke liye kaunsa station?**\n1. BSB – Varanasi Jn\n2. BCY – Varanasi City" }, { role: "user", content: "1" }] });
    expect(res.context.destination ?? null).toBeNull();
    expect(res.context.pendingDestinationChoice).toBe("Ayodhya");
    expect(res.reply).toMatch(/AYC|Ayodhya/);
    expect(res.reply).not.toMatch(/BSB|BCY|Varanasi/);
  }, 30000);

  it("lookup returns nothing for the typed city → honest ask for code/name, never a guessed station", async () => {
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/stations/search")) return json(200, { success: true, data: { results: [] } });
      return json(200, { success: true, data: { trains: [] } });
    });
    setAgenticNvidiaFetch(async () => json(200, { choices: [{ message: { content: null, tool_calls: [toolCall("SEARCH_TRAINS", { origin: "LDH", destination: "Varanasi", date: "2026-09-14" })] } }] }));
    const prev = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Jn" }, destination: { code: "BSB", name: "Varanasi Jn" }, date: "2026-09-14", dateProvided: true, passengers: 2, paxProvided: true };
    const res = await runAgent({ text: "Mujhe ludhiana se zorawarpur jaana hai kal", now: "2026-09-13T12:05:00.000Z", context: prev });
    expect(res.reply).toMatch(/zorawarpur/i);
    expect(res.reply).not.toMatch(/BSB|BCY|Varanasi/);
    expect(res.context.destination ?? null).toBeNull();
  }, 30000);
});
