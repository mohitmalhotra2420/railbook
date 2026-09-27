/* ══ ROUND-41 (27 Sep 2026) — user (dohraaya): "jaise ChatGPT/Gemini/Manus sahi tools use karte hain
 * sahi as per user query — mera AI bhi ek dum perfectly sahi tools use kare, user query samajhke."
 *
 * LIVE audit (12 sawaal, toolTrace ke saath) ne 4 dikkat pakdi:
 *   1. comparison ("Tejas aur Vande Bharat me kya fark") → ek hi cheez ka KB answer (adhoora)
 *   2. "Amritsar station code kya hai" → generic KB definition chala, SEARCH_STATIONS tool nahi
 *   3. "12054 time par chalti hai ya late" → date poochh li, GET_TRAIN_HISTORY tool nahi chala
 *   4. coach-position tool fail → "gadh ke nahi bataunga" dump (purani phrasing)
 * Fix: comparison guard + dedicated compare KB + station-code guard + prompt rule 32 (tool routing
 * table: intent → exact tool, tool fail ho to agla sahi tool / sach) + honesty phrasing.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { asksStationCode, isComparisonQuery } from "../server/agent/answerMode";
import { railKbAnswer } from "../server/agent/railkb";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("Round-41 · sahi tool chunna (intent → tool)", () => {
  it("comparison sawaal pehchano (X aur Y me fark / vs / behtar)", () => {
    for (const q of ["Tejas aur Vande Bharat me kya fark hai?", "2S vs SL", "SL aur 3A me fark", "Rajdhani vs Vande Bharat behtar kaunsi hai?"]) {
      expect(isComparisonQuery(q), q).toBe(true);
    }
    for (const q of ["12054 kahan hai", "sabse tez train kaunsi hai", "Amritsar station code kya hai"]) {
      expect(isComparisonQuery(q), q).toBe(false);
    }
  });

  it("station-code sawaal (specific station) — definition wala nahi", () => {
    expect(asksStationCode("Amritsar station code kya hai")).toBe(true);
    expect(asksStationCode("Ludhiana ka code batao")).toBe(true);
    expect(asksStationCode("station code kya hota hai")).toBe(false);
    expect(asksStationCode("station code ka matlab kya hai")).toBe(false);
  });

  it("KB-first comparison/station-code par nahi chalta (warna adhoora/galat jawab)", () => {
    const a = read("server/agent/agentic.ts");
    const fn = a.slice(a.indexOf("function kbAuthoritativeRebound"), a.indexOf("function kbAuthoritativeRebound") + 1600);
    expect(fn).toContain("if (asksStationCode(userText)) return null;");
    expect(fn).toContain("if (isComparisonQuery(userText)) {");
    expect(fn).toContain("const both = comparisonSubjects(userText);");
    expect(fn).toContain("hasBoth");
  });

  it("prompt rule 32 (tool routing table) — har intent ka exact tool likha hai", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain('"32. SAHI TOOL CHUNO');
    for (const t of ["TRACK_TRAIN", "GET_TIMETABLE", "GET_TRAIN_HISTORY", "CHECK_AVAILABILITY", "GET_FARE", "SEARCH_TRAINS", "JOURNEY_ANALYZE", "RANK_JOURNEY_OPTIONS", "FIND_ALTERNATIVE_TRAINS", "FIND_CONNECTIONS", "CHECK_PNR", "GET_CANCELLED_TRAINS", "SEARCH_STATIONS", "GET_STATION_BOARD", "GET_COACH_POSITION", "WEB_SEARCH"]) {
      expect(a.slice(a.indexOf('"32. SAHI TOOL CHUNO'), a.indexOf('"32. SAHI TOOL CHUNO') + 2600), t).toContain(t);
    }
    expect(a).toContain("tool fail ho to agla sahi tool");
  });

  it("purani 'gadh ke nahi bataunga' phrasing poori tarah gayi", () => {
    for (const f of ["server/agent/agentic.ts", "server/agent/context.ts", "server/agent/run.ts"]) {
      expect(read(f)).not.toContain("gadh ke nahi bataunga");
    }
  });
});

describe("Round-41 · comparison ka poora jawab (dono taraf)", () => {
  const cases: [string, string[]][] = [
    ["Tejas aur Vande Bharat me kya fark hai?", ["Tejas", "Vande Bharat", "locomotive", "EMU"]],
    ["SL aur 3A me kya fark hai", ["SL", "3A", "berths", "AC"]],
    ["2S vs SL", ["2S", "SL", "non-AC"]],
    ["CC vs EC", ["CC", "EC", "Executive"]],
  ];
  for (const [q, bits] of cases) {
    it(q, () => {
      const a = railKbAnswer(q) ?? "";
      for (const b of bits) expect(a, b).toContain(b);
      expect((a.match(/•/g) ?? []).length).toBeGreaterThanOrEqual(3);
    });
  }

  it("coach position ka how-to jawab (live data na mile to sach — andaza nahi)", () => {
    const a = railKbAnswer("coach position kaise pata karun") ?? "";
    expect(a).toMatch(/1–2 ghante|1-2 ghante/);
    expect(a).toMatch(/display board|NTES|IRCTC/);
    expect(a).toMatch(/andaza nahi/i);
  });

  it("coach/platform LIVE sirf khaas train ke saath (how-to knowledge)", async () => {
    const { liveDataQuestion } = await import("../server/agent/answerMode");
    expect(liveDataQuestion("12054 ka coach position batao")).toBe(true);
    expect(liveDataQuestion("coach position kaise pata karun")).toBe(false);
    expect(liveDataQuestion("mera pnr 4561237890 check karo")).toBe(true);
  });
});
