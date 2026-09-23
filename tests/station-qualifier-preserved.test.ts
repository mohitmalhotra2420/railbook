/**
 * 24 Sep 2026 (user screenshot 00:48): "Mujhe ludhiana se mathura jn jaana hai kal
 * 1 passenger" — app ne phir bhi "Mathura — kaunsa station?" (MTJ/MRT/MUW/MPRD)
 * poochha. Wajah: "mathura jn" ka "jn" phrase-extraction me kat jata tha, provider
 * tak sirf "Mathura" (city) pahunchta tha → 4 stations → options.
 *
 * Fix: (1) NLU phrase me qualifier preserve (Mathura Jn / Mathura Cantt),
 *      (2) provider scoring me Junction/Jn aur Cantt/Cant ek hi maane jayein,
 *      (3) agentic SEARCH_STATIONS me model ka query user ke literal qualifier se
 *          extend ho, aur (4) LLM prompt me qualifier preserve karne ka rule.
 */
import { describe, expect, it } from "vitest";
import { understand } from "../server/understand/legacy-nlu";
import { pickStations } from "../server/railway/station-resolve";
import { stationQueryWithUserQualifier } from "../server/agent/agentic";
import type { Station } from "../server/providers/types";

const HITS = [
  { code: "MTJ", name: "Mathura Jn", city: "Mathura" },
  { code: "MRT", name: "Mathura Cant", city: "Mathura" },
  { code: "MUW", name: "Mathurapur", city: "Mathurapur" },
  { code: "MPRD", name: "Mathurapur Road", city: "Mathurapur" },
] as unknown as Station[];

describe("station phrase: user ka qualifier bachta hai", () => {
  it("'ludhiana se mathura jn jaana hai' → unresolvedTo 'Mathura Jn' (sirf 'Mathura' nahi)", () => {
    const nlu = understand("Mujhe ludhiana se mathura jn jaana hai kal 1 passenger", {
      now: new Date("2026-09-24T00:50:00+05:30"),
    } as never) as unknown as { unresolvedTo?: string; from?: { code: string } };
    expect(nlu.from?.code).toBe("LDH");
    expect(nlu.unresolvedTo).toBe("Mathura Jn");
  });

  it("'...mathura junction...' aur '...mathura cantt...' bhi canonical ho jate hain", () => {
    const j = understand("ludhiana se mathura junction kal", { now: new Date() } as never) as unknown as { unresolvedTo?: string };
    const c = understand("ludhiana se mathura cantt jaana hai", { now: new Date() } as never) as unknown as { unresolvedTo?: string };
    expect(j.unresolvedTo).toBe("Mathura Jn");
    expect(c.unresolvedTo).toBe("Mathura Cantt");
  });

  it("provider: 'Mathura Jn'/Junction → single MTJ, 'Mathura' (bina qualifier) → options", () => {
    expect(pickStations("Mathura Jn", HITS)).toMatchObject({ kind: "single", station: { code: "MTJ" } });
    expect(pickStations("Mathura Junction", HITS)).toMatchObject({ kind: "single", station: { code: "MTJ" } });
    expect(pickStations("Mathura Cantt", HITS)).toMatchObject({ kind: "single", station: { code: "MRT" } });
    /* Bare city par options hi chahiye — guess nahi. */
    const bare = pickStations("Mathura", HITS);
    expect(bare.kind).toBe("ambiguous");
    expect(bare.stations.map((s) => s.code).sort()).toEqual(["MPRD", "MRT", "MTJ", "MUW"]);
  });

  it("agentic guard: model 'Mathura' bheje par user ne 'jn' likha → 'Mathura Jn' search", () => {
    const t = "Mujhe ludhiana se mathura jn jaana hai kal 1 passenger";
    expect(stationQueryWithUserQualifier("Mathura", t)).toBe("Mathura Jn");
    expect(stationQueryWithUserQualifier("Mathura", "ludhiana se mathura cantt jaana hai")).toBe("Mathura Cantt");
    /* Qualifier na ho to query waisi hi rahe (city ambiguity options flow). */
    expect(stationQueryWithUserQualifier("Mathura", "ludhiana se mathura jaana hai")).toBe("Mathura");
  });

  /* 24 Sep 2026 (user: "wo station wala fix karo jisme Jn miss ho raha tha"): hyphens,
   * underscores aur ATTACHED likhne par bhi qualifier bachna chahiye — warna wapas
   * 4-option picker aa jata tha. */
  it("hyphen / attached / no-space forms bhi qualifier preserve karte hain", () => {
    const t = (x: string) => `ludhiana se ${x} jaana hai kal`;
    expect(stationQueryWithUserQualifier("Mathura", t("mathura-jn"))).toBe("Mathura Jn");
    expect(stationQueryWithUserQualifier("Mathura", t("mathurajn"))).toBe("Mathura Jn");
    expect(stationQueryWithUserQualifier("Mathura", t("mathura_jn"))).toBe("Mathura Jn");
    expect(stationQueryWithUserQualifier("Mathura", t("mathura junction"))).toBe("Mathura Jn");
    expect(stationQueryWithUserQualifier("Mathura", t("mathura junc"))).toBe("Mathura Jn");
    expect(stationQueryWithUserQualifier("Mathura", t("mathura jct"))).toBe("Mathura Jn");
    expect(stationQueryWithUserQualifier("Mathura", t("mathura-jn,"))).toBe("Mathura Jn");
    expect(stationQueryWithUserQualifier("Mathura", t("mathuracantt"))).toBe("Mathura Cantt");
    expect(stationQueryWithUserQualifier("Mathura", t("mathura-cant"))).toBe("Mathura Cantt");
  });

  it("provider resolution: hyphen/attached forms bhi single station deti hain (options nahi)", () => {
    for (const q of ["Mathura Jn", "mathurajn", "mathura-jn", "mathurajn.", "Mathura Junction", "mathura junc", "mathura JCT"]) {
      expect(pickStations(q, HITS), q).toMatchObject({ kind: "single", station: { code: "MTJ" } });
    }
    for (const q of ["Mathura Cantt", "mathuracantt", "mathura-cant", "mathura cntt"]) {
      expect(pickStations(q, HITS), q).toMatchObject({ kind: "single", station: { code: "MRT" } });
    }
  });

  it("aur koi naam galti se na toote: 'Sanjan', 'Bijnor', 'Rajnandgaon' jaisi spelling safe", () => {
    const other = [
      { code: "SJN", name: "Sanjan", city: "Sanjan" },
      { code: "BJI", name: "Bijnor", city: "Bijnor" },
      { code: "RJN", name: "Rajnandgaon", city: "Rajnandgaon" },
      { code: "PRD", name: "Pithapuram Road", city: "Pithapuram" },
    ] as unknown as Station[];
    expect(pickStations("Sanjan", other)).toMatchObject({ kind: "single", station: { code: "SJN" } });
    expect(pickStations("Bijnor", other)).toMatchObject({ kind: "single", station: { code: "BJI" } });
    expect(pickStations("Rajnandgaon", other)).toMatchObject({ kind: "single", station: { code: "RJN" } });
    expect(pickStations("Pithapuram Road", other)).toMatchObject({ kind: "single", station: { code: "PRD" } });
    expect(pickStations("pithapuramroad", other)).toMatchObject({ kind: "single", station: { code: "PRD" } });
  });

  it("LLM prompt me qualifier rule hai", () => {
    const src = require("node:fs").readFileSync("server/agent/agentic.ts", "utf8") as string;
    expect(src).toContain("STATION QUERY RULE");
    expect(src).toContain('"Mathura Jn"');
  });
});
