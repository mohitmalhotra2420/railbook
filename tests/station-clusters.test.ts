import { describe, expect, it } from "vitest";
import {
  CLUSTER_CITY_CODES,
  canonicalClusterCity,
  clusterStations,
  isClusterCityName,
  matchStation,
} from "../src/ai/stations";
import { pickStations } from "../server/railway/station-resolve";
import { mergeNlu, understand } from "../src/ai/nlu";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";

const NOW = new Date(2026, 7, 19);

function blank() {
  return { ...initialBooking("2026-08-19"), date: "" };
}

const EXPECTED_CITIES = [
  "delhi",
  "mumbai",
  "kolkata",
  "hyderabad",
  "ambala",
  "jalandhar",
  "lucknow",
  "kanpur",
  "agra",
  "chennai",
  "bengaluru",
  "bhopal",
  "patna",
  "firozpur",
  "pathankot",
  "thiruvananthapuram",
  "kochi",
];

describe("multi-station cities never lock like Ambala→Cantt", () => {
  it("catalog exposes every confused city as a cluster of 2+ distinct stations", () => {
    for (const city of EXPECTED_CITIES) {
      expect(CLUSTER_CITY_CODES[city], city).toBeTruthy();
      expect(clusterStations(city).length, city).toBeGreaterThanOrEqual(2);
    }
  });

  it("bare city name does not collapse to a default code", () => {
    for (const city of EXPECTED_CITIES) {
      expect(isClusterCityName(city), city).toBe(true);
      expect(matchStation(city), city).toBeUndefined();
    }
    expect(matchStation("दिल्ली")).toBeUndefined();
    expect(matchStation("मुंबई")).toBeUndefined();
    expect(matchStation("अंबाला")).toBeUndefined();
  });

  it("specific station names still resolve", () => {
    expect(matchStation("New Delhi")?.code).toBe("NDLS");
    expect(matchStation("Ambala Cantt")?.code).toBe("UMB");
    expect(matchStation("Ambala City")?.code).toBe("UBC");
    expect(matchStation("Howrah")?.code).toBe("HWH");
    expect(matchStation("Sealdah")?.code).toBe("SDAH");
    expect(matchStation("Mumbai Central")?.code).toBe("BCT");
    expect(matchStation("CSMT")?.code).toBe("CSMT");
    expect(matchStation("Secunderabad")?.code).toBe("SC");
    expect(matchStation("Jalandhar Cantt")?.code).toBe("JRC");
    expect(matchStation("Chennai Egmore")?.code).toBe("MS");
    expect(matchStation("Yesvantpur")?.code).toBe("YPR");
    expect(matchStation("Ludhiana")?.code).toBe("LDH");
    expect(matchStation("Amritsar")?.code).toBe("ASR");
  });

  it("pickStations marks Delhi / Mumbai / Ambala / Kochi ambiguous when API returns the group", () => {
    const delhi = pickStations("Delhi", [
      { code: "NDLS", name: "NEW DELHI", city: "Delhi" },
      { code: "DLI", name: "DELHI", city: "Delhi" },
      { code: "NZM", name: "H NIZAMUDDIN", city: "Delhi" },
    ]);
    expect(delhi.kind).toBe("ambiguous");

    const mumbai = pickStations("Mumbai", [
      { code: "BCT", name: "MUMBAI CENTRAL", city: "Mumbai" },
      { code: "CSMT", name: "CSMT", city: "Mumbai" },
    ]);
    expect(mumbai.kind).toBe("ambiguous");

    const ambala = pickStations("Ambala", [
      { code: "UMB", name: "AMBALA CANT JN", city: "Ambala" },
      { code: "UBC", name: "AMBALA CITY", city: "Ambala" },
    ]);
    expect(ambala.kind).toBe("ambiguous");
  });

  it("booking a cluster city asks for a station chip instead of locking NDLS/BCT/UMB", () => {
    const cases: Array<{ text: string; city: string; codes: string[] }> = [
      { text: "Delhi se Amritsar jaana hai", city: "Delhi", codes: ["NDLS", "DLI", "NZM"] },
      { text: "Mumbai se Delhi jaana hai", city: "Mumbai", codes: ["BCT", "CSMT"] },
      { text: "Ambala se Ludhiana jaana hai", city: "Ambala", codes: ["UMB", "UBC"] },
      { text: "Kolkata se Delhi jaana hai", city: "Kolkata", codes: ["HWH", "SDAH"] },
    ];
    for (const row of cases) {
      const n = understand(row.text, { now: NOW });
      expect(n.from, row.text).toBeUndefined();
      expect(n.unresolvedFrom, row.text).toMatch(new RegExp(row.city, "i"));
      const turn = planTurn({
        text: row.text,
        now: NOW,
        booking: blank(),
        prefs: {},
        saved: [],
      });
      expect(turn.blocks?.[0]?.type, row.text).toBe("stations");
      const block = turn.blocks?.[0];
      const codes = block && block.type === "stations" ? block.options.map((s) => s.code) : [];
      expect(codes, row.text).toEqual(expect.arrayContaining(row.codes));
      expect(turn.text, row.text).not.toMatch(/demo catalog/i);
    }
  });

  it("canonical hindi city names map to the same cluster", () => {
    expect(canonicalClusterCity("दिल्ली")).toBe("delhi");
    expect(canonicalClusterCity("मुंबई")).toBe("mumbai");
    expect(clusterStations("दिल्ली").map((s) => s.code)).toEqual(
      expect.arrayContaining(["NDLS", "DLI", "NZM"]),
    );
  });

  it("Mujhe Lucknow/Ambala jaana hai is destination, not origin", () => {
    for (const text of ["Mujhe Lucknow jaana hai kal", "Mujhe Ambala jaana hai"]) {
      const n = understand(text, { now: NOW });
      expect(n.from, text).toBeUndefined();
      expect(n.unresolvedFrom, text).toBeUndefined();
      expect(n.unresolvedTo, text).toBeTruthy();
      const turn = planTurn({ text, now: NOW, booking: blank(), prefs: {}, saved: [] });
      expect(turn.blocks?.[0]?.type, text).toBe("stations");
      expect(turn.ask, text).toBe("to");
      expect(turn.apply?.from, text).toBeUndefined();
    }
  });

  it("NVIDIA origin-only Lucknow is flipped to destination chips", () => {
    const text = "Mujhe Lucknow jaana hai kal";
    const local = understand(text, { now: NOW });
    const flipped = mergeNlu(
      { intent: "BOOK_TRAIN", unresolvedFrom: "Lucknow", date: "2026-08-20" },
      local,
      text,
    );
    expect(flipped.unresolvedTo).toMatch(/Lucknow/i);
    expect(flipped.unresolvedFrom).toBeUndefined();
    expect(flipped.from).toBeUndefined();
    const turn = planTurn({
      text,
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
      extraction: { intent: "BOOK_TRAIN", unresolvedFrom: "Lucknow", date: "2026-08-20" },
    });
    expect(turn.ask).toBe("to");
    expect(turn.blocks?.[0]?.type).toBe("stations");
    const block = turn.blocks?.[0];
    const codes = block && block.type === "stations" ? block.options.map((s) => s.code) : [];
    expect(codes).toEqual(expect.arrayContaining(["LKO", "LJN"]));
  });

  it("does not re-ask Ambala chips after UBC is already chosen", () => {
    const ubc = { code: "UBC", name: "Ambala City", city: "Ambala" };
    const asr = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };
    const booking = {
      ...blank(),
      from: asr,
      to: ubc,
      date: "2026-08-24",
      dateProvided: true,
    };
    const turn = planTurn({
      text: "Kro na trains check",
      now: NOW,
      booking,
      prefs: {},
      saved: [],
      extraction: { intent: "BOOK_TRAIN", unresolvedTo: "Ambala", date: "2026-08-24" },
    });
    expect(turn.blocks?.[0]?.type).not.toBe("stations");
    expect(turn.search).toBe(true);
    expect(turn.text).toMatch(/Trains check/i);
    expect(turn.text).not.toMatch(/kai stations/i);
  });
});
