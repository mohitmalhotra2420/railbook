/* Round-18m-30h (prod screenshot 18:54): options "1. AY – Ayodhya …" → user "1" → reply "LDH → BZA" (Vijayawada!).
 * Wajah: local station search "AY" ko substring se vijAYawada de raha tha aur verifyStationCode ne single result
 * accept kar liya. Rule: user ne jo CODE chuna EXACT wahi — kabhi koi aur code nahi.
 * Saath mein (C): gate-questions ki wording AI se, par facts locked (validator). */
import { describe, expect, it, afterEach } from "vitest";
import { searchStations } from "../server/data/stations.js";
import { resolveStationPick } from "../server/agent/run";
import { emptyAgentContext } from "../server/agent/context.js";
import { aiPhraseGate, setAgenticNvidiaFetch } from "../server/agent/agentic";

describe("Round-18m-30h: station pick = exact code", () => {
  it("local search: 2–4 letter query never substring-matches inside a name (AY ≠ Vijayawada)", () => {
    expect(searchStations("AY").some((s) => s.code === "BZA")).toBe(false);
    expect(searchStations("ASR")[0]?.code).toBe("ASR");
    expect(searchStations("ldh")[0]?.code).toBe("LDH");
  });
  it("'1' on Ayodhya options resolves to AY (never another code), '3' → AYC", async () => {
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Jn" } };
    const hist = [{ role: "assistant" as const, content: "LDH se Ayodhya: Ayodhya mein kaunsa station chahiye? Options: 1. AY – Ayodhya, 2. APN – Ayodhyapattanam, 3. AYC – Ayodhya Cantt." }];
    const p1 = await resolveStationPick("1", hist, ctx);
    expect(p1?.code).toBe("AY");
    expect(p1?.name).toMatch(/Ayodhya/i);
    const p3 = await resolveStationPick("3", hist, ctx);
    expect(p3?.code).toBe("AYC");
    const pay = await resolveStationPick("AY", hist, ctx);
    expect(pay?.code).toBe("AY");
  });
});

describe("Round-18m-30h (C): AI-phrased gate questions keep facts locked", () => {
  afterEach(() => { setAgenticNvidiaFetch(null); delete process.env.VITEST_ALLOW_GATE_AI; });
  it("under VITEST without AI → deterministic fallback text", async () => {
    const r = await aiPhraseGate("passengers", { fallback: "LDH → AY 2026-09-14 ko — kitne passengers hain? (1–6)", mustContain: ["LDH", "AY"], context: "x" });
    expect(r.text).toContain("kitne passengers");
    expect(r.model).toBeNull();
  });
});

describe("Round-18m-30j: date-format hint in a clarifying question is not a hallucinated station code", () => {
  afterEach(() => { setAgenticNvidiaFetch(null); process.env.NVIDIA_API_KEY = ""; });
  it("'Kis date ko jaana hai? (YYYY-MM-DD)' after a station pick → grounded, no 'provider se nahi mil' reply", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    const { runAgenticTurn } = await import("../server/agent/agentic");
    setAgenticNvidiaFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Theek hai — LDH → LKO. Kis date ko jaana hai? (jaise 2026-09-15 ya YYYY-MM-DD, DD/MM bhi chalega)" } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const turn = await runAgenticTurn({ text: "1", now: "2026-09-13T14:05:00.000Z", history: [{ role: "assistant", content: "LDH se Lucknow: 1. LKO – Lucknow NR, 2. LJN – Lucknow Junction NER." }], known: { origin: "LDH", destination: "LKO", stationPicked: "destination", dateProvided: false } } as never);
    expect(turn.grounded).toBe(true);
    expect(turn.reply).toMatch(/Kis date/);
    expect(turn.reply).not.toMatch(/provider se nahi mil/);
  }, 30000);
});

describe("Round-18m-30l: AI-written station options are parsed; 0 trains at chosen sibling → same-city fallback with a clear note", () => {
  it("'2' on '1. LKO — Lucknow NR\\n2. LJN — Lucknow Junction NER' → LJN", async () => {
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, pendingDestinationChoice: "Lucknow" };
    const p = await resolveStationPick("2", [{ role: "assistant", content: "Lucknow mein 2 stations hain — kaunsa chahiye? 1. LKO — Lucknow NR\n2. LJN — Lucknow Junction NER" }], ctx);
    expect(p?.code).toBe("LJN");
  });
});

describe("Round-18m-30m: bare 'N. CODE' options (model's own wording) map correctly", () => {
  it("'2' on '… 1. LKO 2. LJN (Please reply with 1 or 2.)' → LJN with its name from the same text", async () => {
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana Junction", city: "Ludhiana" }, pendingDestinationChoice: "Lucknow" };
    const c = "Lucknow mein 2 stations hain – LKO (Lucknow NR) aur LJN (Lucknow Junction NER). Kaunsa station chahte hain? 1. LKO 2. LJN (Please reply with 1 or 2.)";
    const p = await resolveStationPick("2", [{ role: "assistant", content: c }], ctx);
    expect(p?.code).toBe("LJN");
    expect(p?.name).toMatch(/Lucknow Junction/);
    expect((await resolveStationPick("1", [{ role: "assistant", content: c }], ctx))?.code).toBe("LKO");
  });
});
