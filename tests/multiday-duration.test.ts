/* Round-16l: multi-day trains (LDH→KOAA ~27h) showed "3h 23m" — clock diff
 * mod 24h dropped whole days. Duration must honour stop `day` fields (or the
 * provider total) and arrivalDayOffset must be derived, not hardcoded 0. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRailcoreFetch } from "../server/railway/railcore";
import { clearScheduleCache, searchTrainsRouted } from "../server/railway/router";
import { setProvider } from "../server/providers/index";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test_secret";
  process.env.RAILKIT_API_KEY = "";
  setProvider(null);
  clearScheduleCache();
});
afterEach(() => {
  setRailcoreFetch(null);
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  setProvider(null);
  clearScheduleCache();
});

function mock(withDay: boolean): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    if (p.endsWith("/routes/trains")) {
      return jsonResponse(200, {
        success: true,
        data: {
          from_station_code: "LDH",
          to_station_code: "KOAA",
          trains: [
            { train_number: "12358", train_name: "DURGIANA EXP", departure_time: "08:12", arrival_time: "11:35", duration_minutes: 1643, classes: ["SL", "3A"], running_days: ["MON", "THU"] },
            { train_number: "13152", train_name: "KOLKATA EXPRESS", departure_time: "01:55", arrival_time: "15:40", duration_minutes: 2265, classes: ["SL", "3A"], running_days: ["MON"] },
          ],
        },
      });
    }
    if (p.endsWith("/schedule")) {
      const num = (p.match(/\/trains\/(\d+)\/schedule/) || [])[1];
      const d = (n: number) => (withDay ? { day: n } : {});
      const stops =
        num === "12358"
          ? [
              { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "05:55", ...d(1) },
              { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "08:02", departure_time: "08:12", ...d(1) },
              { station_code: "KOAA", station_name: "KOLKATA", arrival_time: "11:35", departure_time: null, ...d(2) },
            ]
          : [
              { station_code: "JAT", station_name: "JAMMU TAWI", arrival_time: null, departure_time: "21:45", ...d(1) },
              { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "01:45", departure_time: "01:55", ...d(2) },
              { station_code: "KOAA", station_name: "KOLKATA", arrival_time: "15:40", departure_time: null, ...d(3) },
            ];
      return jsonResponse(200, { success: true, data: { train_number: num, train_name: "X", running_days: ["MON"], total_duration_minutes: num === "12358" ? 1980 : 2650, classes: ["SL"], stops } });
    }
    return jsonResponse(404, { success: false });
  });
}

describe("Round-16l: multi-day journey duration", () => {
  it("uses stop day fields: 08:12 (day1) → 11:35 (day2) = 27h 23m, +1d", async () => {
    mock(true);
    const res = await searchTrainsRouted({ from: "LDH", to: "KOAA", date: "2026-09-10" });
    const t = res.trains.find((x) => x.number === "12358")!;
    expect(t.durationMinutes).toBe(1643);
    expect(t.durationLabel).toBe("27h 23m");
    expect(t.arrivalDayOffset).toBe(1);
    const k = res.trains.find((x) => x.number === "13152")!;
    expect(k.durationMinutes).toBe(2265);
    expect(k.arrivalDayOffset).toBe(1);
  });
  it("without day fields, snaps clock-diff to the provider's total (never 3h 23m)", async () => {
    mock(false);
    const res = await searchTrainsRouted({ from: "LDH", to: "KOAA", date: "2026-09-10" });
    const t = res.trains.find((x) => x.number === "12358")!;
    expect(t.durationMinutes).toBe(1643);
    expect(t.durationLabel).toBe("27h 23m");
  });
});
