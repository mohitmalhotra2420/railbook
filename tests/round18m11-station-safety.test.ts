import { describe, it, expect } from "vitest";
import { matchStation, matchStationFuzzy } from "../server/understand/legacy-stations.js";
import { pickStations, isPassengerStation } from "../server/railway/station-resolve.js";
import { readFileSync } from "node:fs";

describe("Round-18m-11: station resolution must never mistake one city for another", () => {
  it("'prayagraj' is NOT Agra (substring 'agra' inside a longer word)", () => {
    expect(matchStation("prayagraj")).toBeUndefined();
    expect(matchStation("prayagraj jaana")).toBeUndefined();
    expect(matchStationFuzzy("prayagraj")).toBeUndefined();
  });
  it("whole-word city still matches ('agra cantt se', 'agra')", () => {
    expect(matchStation("agra cantt se")?.code).toBe("AGC");
  });
  it("distinct real cities are never fuzzy-matched to look-alikes (raipur≠jaipur)", () => {
    expect(matchStationFuzzy("raipur")).toBeUndefined();
    expect(matchStationFuzzy("rajkot")).toBeUndefined();
    expect(matchStationFuzzy("ludiyana")?.code).toBe("LDH"); // typo tolerance stays
  });
  it("Prayagraj city group: PRYJ first; sidings / 'PRYJ2' duplicates hidden", () => {
    const hits = [
      { code: "PCOI", name: "Prayagraj Chheoki", city: "Prayagraj" },
      { code: "PRRB", name: "Prayagraj Rambag", city: "Prayagraj" },
      { code: "PRYJ", name: "Prayagraj Jn", city: "Prayagraj" },
      { code: "PRYJ2", name: "Prayagraj Jn 2", city: "Prayagraj" },
      { code: "PYGS", name: "Prayagraj Sangam", city: "Prayagraj" },
      { code: "PPGS", name: "M/Sprayagrajpowergeneration Co. Limited,bara", city: "Prayagraj" },
    ];
    const pick = pickStations("prayagraj", hits);
    expect(pick.kind).toBe("ambiguous");
    expect(pick.stations.map((s) => s.code)).toEqual(["PRYJ", "PCOI", "PRRB", "PYGS"]);
    expect(isPassengerStation({ code: "PPGS", name: "M/Sprayagrajpowergeneration Co. Limited,bara" })).toBe(false);
    expect(isPassengerStation({ code: "PRYJ2", name: "Prayagraj Jn 2" })).toBe(false);
    expect(isPassengerStation({ code: "NDLS", name: "New Delhi" })).toBe(true);
  });
  it("same-train alternative rows show Book from / Boarding / Deboarding", () => {
    const jo = readFileSync("src/components/JourneyOptions.tsx", "utf8");
    expect(jo).toContain("jx-bfe-row");
    expect(jo).toMatch(/<span>Book from<\/span><span>Boarding<\/span><span>Deboarding<\/span>/);
  });
});
