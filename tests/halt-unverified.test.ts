/* Round-16m: LDH→DLI 12 Sep par UI "No trains available" dikha raha tha jabki
 * RailCore ne 27 trains di thin — har train ki /schedule call 20/min burst
 * limit par "Too many requests" khaati thi aur cluster-station (DLI) hone se
 * unverified trains DROP ho jaati thin. Ab: unverified → rakho, flag lagao. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRailcoreFetch } from "../server/railway/railcore";
import { clearScheduleCache, routedStationSearch, searchTrainsRouted } from "../server/railway/router";
import { setProvider } from "../server/providers/index";
import { setScrapeFetch } from "../server/railway/webscrape";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test_secret";
  process.env.RAILKIT_API_KEY = "";
  setProvider(null);
  clearScheduleCache();
  setScrapeFetch(async () => new Response("", { status: 404 }));
});
afterEach(() => {
  setRailcoreFetch(null);
  setScrapeFetch(null);
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  setProvider(null);
  clearScheduleCache();
});

const TRAINS = [
  { train_number: "12014", train_name: "AMRITSAR SHTABDI", departure_time: "07:02", arrival_time: "11:02", duration_minutes: 240, classes: ["CC", "EC"], running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] },
  { train_number: "12904", train_name: "GOLDEN TEMPLE M", departure_time: "21:10", arrival_time: "03:45", duration_minutes: 395, classes: ["SL", "3A"], running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] },
  { train_number: "22488", train_name: "VANDE BHARAT EXP", departure_time: "10:18", arrival_time: "13:50", duration_minutes: 212, classes: ["CC"], running_days: ["MON"] },
];

describe("Round-16m: timetable rate-limited → trains kept (halt unverified), not dropped", () => {
  it("cluster destination DLI: all provider trains survive when /schedule returns 429", async () => {
    setRailcoreFetch(async (input) => {
      const p = new URL(String(input)).pathname;
      if (p.endsWith("/routes/trains")) {
        return jsonResponse(200, { success: true, data: { from_station_code: "LDH", to_station_code: "DLI", trains: TRAINS } });
      }
      if (p.endsWith("/schedule")) {
        // 20/min burst exceeded — no daily-limit headers, plain 429.
        return jsonResponse(429, { success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } }, { "retry-after": "5" });
      }
      return jsonResponse(404, { success: false });
    });
    const res = await searchTrainsRouted({ from: "LDH", to: "DLI", date: "2026-09-12" });
    expect(res.trains.map((t) => t.number).sort()).toEqual(["12014", "12904", "22488"]);
    expect(res.trains.every((t) => t.haltVerified === false)).toBe(true);
    // Provider duration/day offset preserved for overnight train.
    const gt = res.trains.find((t) => t.number === "12904")!;
    expect(gt.arrivalDayOffset).toBe(1);
    expect(gt.durationLabel).toBe("6h 35m");
  });

  it("verified trains are flagged haltVerified=true; non-halting train still dropped", async () => {
    setRailcoreFetch(async (input) => {
      const p = new URL(String(input)).pathname;
      if (p.endsWith("/routes/trains")) {
        return jsonResponse(200, { success: true, data: { from_station_code: "LDH", to_station_code: "DLI", trains: TRAINS } });
      }
      if (p.endsWith("/schedule")) {
        const num = (p.match(/\/trains\/(\d+)\/schedule/) || [])[1];
        const stops =
          num === "22488"
            ? [
                { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: null, departure_time: "10:18", day: 1 },
                { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "13:50", departure_time: null, day: 1 },
              ]
            : [
                { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: null, departure_time: "07:02", day: 1 },
                { station_code: "DLI", station_name: "DELHI JN", arrival_time: "11:02", departure_time: null, day: 1 },
              ];
        return jsonResponse(200, { success: true, data: { train_number: num, stops, total_duration_minutes: 240, classes: ["CC"], running_days: ["MON"] } });
      }
      return jsonResponse(404, { success: false });
    });
    const res = await searchTrainsRouted({ from: "LDH", to: "DLI", date: "2026-09-12" });
    const nums = res.trains.map((t) => t.number);
    expect(nums).not.toContain("22488"); // goes to NDLS only, verified non-halt at DLI
    expect(res.trains.find((t) => t.number === "12014")?.haltVerified).toBe(true);
  });
});

describe("Round-16m: cluster station names come from curated dataset (Howrah Junction, not 'KOLKATA - ALL STATIONS')", () => {
  it("kolkata → HWH labelled Howrah Junction, group order HWH, SDAH, KOAA, SHM", async () => {
    setRailcoreFetch(async (input) => {
      const p = new URL(String(input)).pathname;
      if (p.endsWith("/stations/search")) {
        return jsonResponse(200, {
          success: true,
          data: {
            results: [
              { station_code: "KOAA", station_name: "KOLKATA", city: "Kolkata", confidence: 0.9 },
              { station_code: "HWH", station_name: "KOLKATA - ALL STATIONS", city: "Kolkata", confidence: 0.9 },
              { station_code: "SDAH", station_name: "SEALDAH", city: "Kolkata", confidence: 0.9 },
              { station_code: "SHM", station_name: "SHALIMAR", city: "Kolkata", confidence: 0.9 },
            ],
          },
        });
      }
      return jsonResponse(404, { success: false });
    });
    const res = await routedStationSearch("kolkata");
    expect(res.needChoice).toBe(true);
    expect(res.stations.slice(0, 4).map((s) => s.code)).toEqual(["HWH", "SDAH", "KOAA", "SHM"]);
    expect(res.stations.find((s) => s.code === "HWH")?.name).toBe("Howrah Junction");
  });
});
