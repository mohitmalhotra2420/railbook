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
