import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { env } from "../server/env";
import { setRailcoreFetch, resetRailcoreBookings } from "../server/railway/railcore";
import { setScrapeFetch } from "../server/railway/webscrape";
import { setRailkitSdk, resetRailkitBookings } from "../server/railway/railkit";
import { setProvider } from "../server/providers/index";
import { getLastRailwayLog, FallbackRailwayProvider, routedStationSearch } from "../server/railway/router";
import { pickStations, scoreStation, stationSearchQuery } from "../server/railway/station-resolve";
import { understand } from "../src/ai/nlu";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";

const NOW = new Date(2026, 7, 21);
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

function blank() {
  return { ...initialBooking("2026-08-21"), date: "" };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function failingSdk(overrides: Record<string, unknown> = {}) {
  return {
    configure: () => undefined,
    searchTrainBetweenStations: async () => ({ success: false }),
    getTrainInfo: async () => ({ success: false }),
    trackTrain: async () => ({ success: false }),
    getAvailability: async () => ({ success: false }),
    fareLookup: async () => ({ success: false }),
    checkPNRStatus: async () => ({ success: false }),
    ...overrides,
  };
}

afterEach(() => {
  setRailcoreFetch(null);
  setScrapeFetch(null);
  setRailkitSdk(null);
  resetRailcoreBookings();
  resetRailkitBookings();
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  process.env.RAILKIT_API_KEY = "";
  setProvider(null);
});

describe("1. RailCore primary selection", () => {
  it("RAILWAY_PROVIDER=railcore uses FallbackRailwayProvider id railcore", () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    setProvider(null);
    expect(env.provider).toBe("railcore");
    const p = new FallbackRailwayProvider();
    expect(p.id).toBe("railcore");
  });

  it("unset and unknown RAILWAY_PROVIDER default to railcore, not railkit or mock", async () => {
    const { DEFAULT_RAILWAY_PROVIDER } = await import("../server/env");
    expect(DEFAULT_RAILWAY_PROVIDER).toBe("railcore");
    const prev = process.env.RAILWAY_PROVIDER;
    delete process.env.RAILWAY_PROVIDER;
    expect(env.provider).toBe("railcore");
    process.env.RAILWAY_PROVIDER = "";
    expect(env.provider).toBe("railcore");
    process.env.RAILWAY_PROVIDER = "hybrid";
    expect(env.provider).toBe("railcore");
    process.env.RAILWAY_PROVIDER = prev ?? "mock";
  });
});

describe("3–7. Station ranking (no invented codes)", () => {
  it("Jammu → Beas ranks JAT and BEAS from real payload shape", () => {
    const jammu = pickStations("Jammu", [
      { code: "JAT", name: "JAMMU TAWI", city: "Jammu" },
      { code: "JATN", name: "JAMUTANA", city: "Jamutana" },
    ]);
    expect(jammu.kind).toBe("single");
    if (jammu.kind === "single") expect(jammu.station.code).toBe("JAT");

    const beas = pickStations("Beas", [{ code: "BEAS", name: "BEAS", city: "Beas" }]);
    expect(beas.kind).toBe("single");
    if (beas.kind === "single") expect(beas.station.code).toBe("BEAS");
  });

  it("Amritsar → Ludhiana ranks ASR and LDH", () => {
    const asr = pickStations("Amritsar", [{ code: "ASR", name: "AMRITSAR JN", city: "Amritsar" }]);
    const ldh = pickStations("Ludhiana", [
      { code: "DDL", name: "DHANDARI KALAN", city: "Ludhiana" },
      { code: "LDH", name: "LUDHIANA JN", city: "Ludhiana" },
      { code: "LQTS", name: "LUDHIANA QUICK TRANS", city: "Ludhiana" },
    ]);
    expect(asr.kind === "single" && asr.station.code).toBe("ASR");
    expect(ldh.kind).toBe("single");
    if (ldh.kind === "single") expect(ldh.station.code).toBe("LDH");
  });

  it("Delhi is ambiguous across NDLS/DLI/NZM", () => {
    const pick = pickStations("Delhi", [
      { code: "DLI", name: "DELHI", city: "Delhi" },
      { code: "NDLS", name: "NEW DELHI", city: "Delhi" },
      { code: "NZM", name: "H NIZAMUDDIN", city: "Delhi" },
    ]);
    expect(pick.kind).toBe("ambiguous");
    if (pick.kind === "ambiguous") {
      expect(pick.stations.map((s) => s.code).sort()).toEqual(["DLI", "NDLS", "NZM"]);
    }
  });

  it("Kochi does not select KFX KOCHEWAHI as first-result", () => {
    expect(scoreStation("Kochi", { code: "KFX", name: "KOCHEWAHI", city: "Kochewahi" })).toBe(0);
    const pick = pickStations("Kochi", [{ code: "KFX", name: "KOCHEWAHI", city: "Kochewahi" }]);
    expect(pick.kind).toBe("none");
    expect(pick.stations).toEqual([]);
  });

  it("Kochi prefers ERS when RailCore actually returned it", () => {
    const pick = pickStations("Kochi", [
      { code: "KFX", name: "KOCHEWAHI", city: "Kochewahi" },
      { code: "ERS", name: "ERNAKULAM JN", city: "Kochi" },
    ]);
    expect(pick.kind).toBe("single");
    if (pick.kind === "single") expect(pick.station.code).toBe("ERS");
  });

  it("stationSearchQuery uses city unless user named a specific station", () => {
    const delhi = { code: "NDLS", name: "New Delhi", city: "Delhi" };
    expect(stationSearchQuery(delhi, "Delhi se Mumbai jaana hai")).toBe("Delhi");
    expect(stationSearchQuery(delhi, "NDLS se Mumbai")).toBe("NDLS");
    expect(stationSearchQuery(delhi, "New Delhi se Mumbai")).toBe("New Delhi");
  });
});

describe("RailCore HTTP + RailKit fallback", () => {
  it("2/8. train search uses RailCore primary", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () =>
      jsonResponse(200, {
        success: true,
        data: {
          from_station_code: "ASR",
          to_station_code: "LDH",
          trains: [{ train_number: "12014", train_name: "AMRITSAR SHTABDI", departure_time: "04:55", arrival_time: "06:57", duration_minutes: 122, classes: ["CC"] }],
        },
      }),
    );
    setRailkitSdk(
      failingSdk({
        searchTrainBetweenStations: async () => ({
          success: true,
          data: [{ train_no: "99999", train_name: "SHOULD NOT MERGE" }],
        }),
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    expect(res.body.trains).toHaveLength(1);
    expect(res.body.trains[0].number).toBe("12014");
    expect(res.body.trains.some((t: { number: string }) => t.number === "99999")).toBe(false);
    expect(getLastRailwayLog()?.railwayProvider).toBe("railcore");
  });

  it("2/10. live status falls back to RailKit when RailCore fails", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () => jsonResponse(500, { success: false, error: { message: "upstream" } }));
    setRailkitSdk(
      failingSdk({
        trackTrain: async () => ({
          success: true,
          data: { trainNumber: "12014", trainName: "AMRITSAR SHTABDI", statusNote: "running", delayMinutes: 6, currentStation: { name: "New Delhi" } },
        }),
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/live").query({ number: "12014", date: "2026-08-22" });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("railkit_fallback");
    expect(res.body.live.trainNumber).toBe("12014");
    expect(res.body.live.delayMinutes).toBe(6);
    expect(JSON.stringify(res.body)).not.toMatch(/rk_live_test|rk_test|RAILCORE|RAILKIT_API/i);
  });

  it("9. RailCore live status maps without inventing", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    setRailcoreFetch(async () =>
      jsonResponse(200, {
        success: true,
        data: {
          train_number: "12014",
          train_name: "Amritsar Shtabdi",
          status: "COMPLETED",
          status_text: "Journey completed",
          current_station_name: "New Delhi",
          delay_minutes: 6,
          last_reported_at: "2026-08-22T11:08:00+05:30",
        },
      }),
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/live").query({ number: "12014", date: "2026-08-22" });
    expect(res.body.provider).toBe("railcore");
    expect(res.body.live.delayMinutes).toBe(6);
    expect(res.body.live.currentStation).toBe("New Delhi");
  });

  it("class board uses hint classes and skips schedule", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    const urls: string[] = [];
    setRailcoreFetch(async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/availability/seats")) {
        return jsonResponse(200, {
          success: true,
          data: { classes: [{ class_code: "CC", status: "AVAILABLE", available_count: 12, total_fare: 510 }] },
        });
      }
      return jsonResponse(500, { success: false });
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classes: "CC",
    });
    expect(res.body.classes).toHaveLength(1);
    expect(res.body.classes[0].status).toBe("AVAILABLE");
    expect(res.body.classes[0].seats).toBe(12);
    expect(urls.some((u) => u.includes("/schedule"))).toBe(false);
    expect(urls.some((u) => u.includes("/availability/seats"))).toBe(true);
  });

  it("11. RailCore availability", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    setRailcoreFetch(async () =>
      jsonResponse(200, {
        success: true,
        data: { classes: [{ class_code: "CC", status: "AVAILABLE", available_count: 570, total_fare: 510 }] },
      }),
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
    });
    expect(res.body.availability.status).toBe("AVAILABLE");
    expect(res.body.availability.seats).toBe(570);
    expect(res.body.availability.fare).toBe(510);
  });

  it("12. availability falls back to RailKit", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    setRailkitSdk(
      failingSdk({
        getAvailability: async () => ({ success: true, data: { status: "AVAILABLE-0489", fare: { totalFare: 480 } } }),
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
    });
    expect(res.body.availability.status).toBe("AVAILABLE");
    expect(res.body.availability.seats).toBe(489);
    expect(getLastRailwayLog()?.railwayProvider).toBe("railkit_fallback");
  });

  it("13. RailCore fare keeps service fee separate", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    setRailcoreFetch(async () => jsonResponse(200, { success: true, data: { fares: [{ class_code: "CC", fare: 510 }] } }));
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/fare").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
      passengers: 1,
    });
    expect(res.body.fare.railwayAvailable).toBe(true);
    expect(res.body.fare.baseFare).toBe(510);
    expect(res.body.fare.serviceFee).toBeGreaterThan(0);
    expect(res.body.fare.total).toBe(510 + res.body.fare.serviceFee);
  });

  it("14. fare falls back to RailKit", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    setRailkitSdk(failingSdk({ fareLookup: async () => ({ success: true, data: { totalFare: 480 } }) }) as never);
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/fare").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
      passengers: 1,
    });
    expect(res.body.fare.baseFare).toBe(480);
    expect(res.body.fare.railwayAvailable).toBe(true);
    expect(getLastRailwayLog()?.railwayProvider).toBe("railkit_fallback");
  });

  it("15. PNR always uses RailKit — never a RailCore PNR URL", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    const urls: string[] = [];
    setRailcoreFetch(async (input) => {
      urls.push(String(input));
      return jsonResponse(404, { success: false });
    });
    setRailkitSdk(
      failingSdk({
        checkPNRStatus: async (pnr: string) => ({ success: true, data: { pnrNumber: pnr, chartStatus: "CHART NOT PREPARED" } }),
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/pnr-status").query({ pnr: "1234567890" });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("railkit");
    expect(urls.some((u) => /pnr/i.test(u))).toBe(false);
  });

  it("16. cancelled trains always use RailKit cancelList", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () => jsonResponse(404, { success: false }));
    setRailkitSdk(
      failingSdk({
        cancelList: async () => ({
          success: true,
          data: { fullyCancelledTrains: [{ trainNo: "12345", trainName: "TEST EXP" }], partiallyCancelledTrains: [] },
        }),
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/cancelled");
    expect(res.body.cancelled.fully).toHaveLength(1);
    expect(res.body.provider).toBe("railkit");
  });

  it("19. both providers failing does not invent trains/seats/live", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    setRailkitSdk(failingSdk() as never);
    /* Web-scrape fallback bhi fail ho (network-dependent test na bane) */
    setScrapeFetch(async () => jsonResponse(500, { success: false }));
    setProvider(null);
    const app = createApp();
    const trains = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    expect(trains.body.trains).toEqual([]);
    const live = await request(app).get("/api/live").query({ number: "12014" });
    expect(live.status).toBe(404);
    expect(live.body.live).toBeUndefined();
    const avail = await request(app).get("/api/availability").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
    });
    expect(avail.body.availability.status).toBe("UNKNOWN");
    expect(avail.body.bookable).toBe(false);
  });

  it("20. provider logs never include secrets", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_secret_value";
    setRailcoreFetch(async () => jsonResponse(401, { success: false, error: { message: "unauthorized" } }));
    setProvider(null);
    const logs: string[] = [];
    const orig = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const app = createApp();
      await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    } finally {
      console.info = orig;
    }
    const blob = logs.join("\n");
    expect(blob).not.toMatch(/rk_live_secret_value/);
    expect(blob).toMatch(/railwayProvider/);
  });

  it("station lookup Jammu/Beas via mocked RailCore", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    setRailcoreFetch(async (input) => {
      const q = new URL(String(input)).searchParams.get("q") || "";
      if (/jammu/i.test(q)) {
        return jsonResponse(200, { success: true, data: { results: [{ station_code: "JAT", station_name: "JAMMU TAWI", city: "Jammu" }] } });
      }
      if (/beas/i.test(q)) {
        return jsonResponse(200, { success: true, data: { results: [{ station_code: "BEAS", station_name: "BEAS", city: "Beas" }] } });
      }
      return jsonResponse(200, { success: true, data: { results: [] } });
    });
    setProvider(null);
    const app = createApp();
    const jammu = await request(app).get("/api/stations").query({ q: "Jammu" });
    const beas = await request(app).get("/api/stations").query({ q: "Beas" });
    expect(jammu.body.stations[0].code).toBe("JAT");
    expect(jammu.body.needChoice).toBe(false);
    expect(beas.body.stations[0].code).toBe("BEAS");
  });

  it("Delhi station API asks for a choice", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    setRailcoreFetch(async () =>
      jsonResponse(200, {
        success: true,
        data: {
          results: [
            { station_code: "DLI", station_name: "DELHI", city: "Delhi" },
            { station_code: "NDLS", station_name: "NEW DELHI", city: "Delhi" },
            { station_code: "NZM", station_name: "H NIZAMUDDIN", city: "Delhi" },
          ],
        },
      }),
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/stations").query({ q: "Delhi" });
    expect(res.body.needChoice).toBe(true);
    expect(res.body.stations.map((s: { code: string }) => s.code)).toEqual(expect.arrayContaining(["NDLS", "DLI", "NZM"]));
  });

  it("Kochi exact city query with lookalike KFX hit returns the city's real stations, never the lookalike first", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    setRailcoreFetch(async () =>
      jsonResponse(200, {
        success: true,
        data: { results: [{ station_code: "KFX", station_name: "KOCHEWAHI", city: "Kochewahi" }] },
      }),
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/stations").query({ q: "Kochi" });
    // Exact multi-station city key: curated city stations (ERS/ERN) hi options —
    // API ka lookalike (KFX KOCHEWAHI) kabhi "the station" nahi ban sakta.
    const codes = (res.body.stations ?? []).map((s: { code: string }) => s.code);
    expect(codes.length).toBeGreaterThanOrEqual(2);
    expect(codes).toContain("ERS");
    expect(codes).toContain("ERN");
    expect(codes[0]).not.toBe("KFX");
    expect(res.body.needChoice).toBe(true);
  });
});

describe("cluster station train filter", () => {
  it("does not list a train at DLI when timetable only has NDLS", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    setRailcoreFetch(async (input) => {
      const url = String(input);
      if (url.includes("/routes/trains")) {
        return jsonResponse(200, {
          success: true,
          data: {
            from_station_code: "LDH",
            to_station_code: "DLI",
            trains: [
              { train_number: "12014", train_name: "AMRITSAR SHTABDI", departure_time: "07:02", arrival_time: "11:02", duration_minutes: 240, classes: ["CC"] },
              { train_number: "11058", train_name: "ASR CSMT EXP", departure_time: "08:50", arrival_time: "15:20", duration_minutes: 390, classes: ["SL"] },
            ],
          },
        });
      }
      if (url.includes("/trains/12014/schedule")) {
        return jsonResponse(200, {
          success: true,
          data: {
            train_number: "12014",
            train_name: "AMRITSAR SHTABDI",
            stops: [
              { station_code: "LDH", station_name: "LUDHIANA JN", departure_time: "07:02" },
              { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "11:02" },
            ],
          },
        });
      }
      if (url.includes("/trains/11058/schedule")) {
        return jsonResponse(200, {
          success: true,
          data: {
            train_number: "11058",
            train_name: "ASR CSMT EXP",
            stops: [
              { station_code: "LDH", station_name: "LUDHIANA JN", departure_time: "08:50" },
              { station_code: "DLI", station_name: "DELHI", arrival_time: "15:20" },
            ],
          },
        });
      }
      return jsonResponse(404, { success: false });
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "LDH", to: "DLI", date: FUTURE });
    const numbers = (res.body.trains as { number: string }[]).map((t) => t.number);
    expect(numbers).toContain("11058");
    expect(numbers).not.toContain("12014");
    expect(res.body.trains[0].to.code).toBe("DLI");
  });

  it("drops a train that does not halt at the requested boarding station", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    setRailcoreFetch(async (input) => {
      const url = String(input);
      if (url.includes("/routes/trains")) {
        return jsonResponse(200, {
          success: true,
          data: {
            from_station_code: "BEAS",
            to_station_code: "NDLS",
            trains: [{ train_number: "12014", train_name: "AMRITSAR SHTABDI", departure_time: "05:25", arrival_time: "11:02", duration_minutes: 337, classes: ["CC"] }],
          },
        });
      }
      if (url.includes("/trains/12014/schedule")) {
        return jsonResponse(200, {
          success: true,
          data: {
            train_number: "12014",
            stops: [
              { station_code: "ASR", station_name: "AMRITSAR JN", departure_time: "04:55" },
              { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "11:02" },
            ],
          },
        });
      }
      return jsonResponse(404, { success: false });
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "BEAS", to: "NDLS", date: FUTURE });
    expect(res.body.trains).toEqual([]);
  });
});

describe("17–18. date behaviour unchanged", () => {
  it("missing date still asks Kab jaana hai", () => {
    const turn = planTurn({
      text: "Mujhe Jammu se Beas jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.ask).toBe("date");
    expect(turn.text).toMatch(/Kab jaana hai/i);
    expect(understand("Mujhe Jammu se Beas jaana hai", { now: NOW }).from?.code).toBe("JAT");
    expect(understand("Mujhe Jammu se Beas jaana hai", { now: NOW }).to?.code).toBe("BEAS");
  });

  it("multi-turn date persists", () => {
    const first = planTurn({
      text: "Mujhe 23 August ke liye 2 ticket chahiye",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(first.apply?.date).toBe("2026-08-23");
    const mid = {
      ...blank(),
      date: "2026-08-23",
      dateProvided: true,
      passengerCount: 2,
      paxProvided: true,
      from: { code: "JAT", name: "Jammu Tawi", city: "Jammu" },
    };
    const dest = planTurn({
      text: "Beas",
      now: NOW,
      booking: mid,
      prefs: {},
      saved: [],
      lastAsked: "to",
    });
    expect(dest.apply?.to?.code).toBe("BEAS");
    expect(dest.search).toBe(true);
    expect(dest.text).not.toMatch(/Kab jaana/i);
  });

  it("NVIDIA defaults unchanged", () => {
    const prevModel = process.env.NVIDIA_MODEL;
    const prevBase = process.env.NVIDIA_BASE_URL;
    delete process.env.NVIDIA_MODEL;
    delete process.env.NVIDIA_BASE_URL;
    expect(env.nvidiaModel).toBe("openai/gpt-oss-20b");
    expect(env.nvidiaBaseUrl).toBe("https://integrate.api.nvidia.com/v1");
    if (prevModel != null) process.env.NVIDIA_MODEL = prevModel;
    if (prevBase != null) process.env.NVIDIA_BASE_URL = prevBase;
  });
});

/* ------------------------------------------------------------------ */
/* Round-7 (2026-09-06): fare + station-lookup web fallback            */
/* ------------------------------------------------------------------ */

const ERail_FARE_HTML = `<html><body>
<table class="fare"><tr><th></th><th>CC</th><th>2S</th><th>GN</th></tr>
<tr><td>General</td><td>650</td><td>205</td><td>140</td></tr>
<tr><td>Tatkal</td><td>825</td><td>220</td><td>-</td></tr></table>
Total fare for 1 Adult</body></html>`;

function htmlResponse(html: string) {
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}

describe("21. Round-7 web fallback: erail fare + railenquiry station", () => {
  it("21a. parseErailFare extracts class fares, skips non-class columns (GN)", async () => {
    const { parseErailFare } = await import("../server/railway/webscrape");
    const f = parseErailFare(ERail_FARE_HTML, "12054", "https://erail.in/train-fare/12054");
    expect(f?.provider).toBe("web_erail");
    const cc = f?.classes.find((c) => c.code === "CC");
    expect(cc?.general).toBe(650);
    expect(cc?.tatkal).toBe(825);
    const twoS = f?.classes.find((c) => c.code === "2S");
    expect(twoS?.general).toBe(205);
    expect(twoS?.tatkal).toBe(220);
    expect(f?.classes.find((c) => c.code === "GN")).toBeUndefined();
  });

  it("21b. parseErailFare returns null without fare table marker", async () => {
    const { parseErailFare } = await import("../server/railway/webscrape");
    expect(parseErailFare("<html><body>nothing here</body></html>", "1", "u")).toBeNull();
  });

  it("21c. availability: both APIs fail → erail fare-only row (status UNKNOWN, fare filled)", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    setRailkitSdk(failingSdk() as never);
    setScrapeFetch(async (url: unknown) =>
      String(url).includes("erail.in/train-fare/") ? htmlResponse(ERail_FARE_HTML) : jsonResponse(500, {}),
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12054",
      date: FUTURE,
      from: "ASR",
      to: "HW",
      classCode: "CC",
    });
    expect(res.body.availability.status).toBe("UNKNOWN");
    expect(res.body.availability.fare).toBe(650);
    expect(res.body.availability.source).toBe("web_erail");
    expect(res.body.bookable).toBe(false);
    expect(getLastRailwayLog()?.railwayProvider).toBe("web_erail");
  });

  it("21d. availability: both APIs fail + scrape fail → plain UNKNOWN (test-19 contract)", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    setRailkitSdk(failingSdk() as never);
    setScrapeFetch(async () => jsonResponse(500, { success: false }));
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12054",
      date: FUTURE,
      from: "ASR",
      to: "HW",
      classCode: "CC",
    });
    expect(res.body.availability.status).toBe("UNKNOWN");
    expect(res.body.availability.fare).toBe(0);
    expect(res.body.availability.source).toBeUndefined();
  });

  it("21e. fare: both APIs fail → erail breakdown (railwayAvailable true, source web_erail)", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    setRailkitSdk(failingSdk() as never);
    setScrapeFetch(async (url: unknown) =>
      String(url).includes("erail.in/train-fare/") ? htmlResponse(ERail_FARE_HTML) : jsonResponse(500, {}),
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/fare").query({
      trainNumber: "12054",
      date: FUTURE,
      from: "ASR",
      to: "HW",
      classCode: "CC",
      passengers: 2,
    });
    expect(res.body.fare.baseFare).toBe(650);
    expect(res.body.fare.total).toBe(1300);
    expect(res.body.fare.railwayAvailable).toBe(true);
    expect(res.body.fare.source).toBe("web_erail");
    expect(getLastRailwayLog()?.railwayProvider).toBe("web_erail");
  });

  it("21f. station lookup: local placeholder-only + code query → railenquiry real name", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setScrapeFetch(async (url: unknown) =>
      String(url).includes("railenquiry.in/station/")
        ? htmlResponse("<html><head><title>Khalilpur (KIP) Railway Station</title></head></html>")
        : jsonResponse(500, {}),
    );
    const r = await routedStationSearch("KIP");
    expect(r.provider).toBe("web_railenquiry");
    expect(r.needChoice).toBe(false);
    expect(r.stations[0]?.code).toBe("KIP");
    expect(r.stations[0]?.name).toBe("Khalilpur");
  });

  it("21g. station lookup: scrape fail → placeholder passthrough, no crash", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setScrapeFetch(async () => jsonResponse(500, { success: false }));
    const r = await routedStationSearch("KIP");
    expect(r.provider === "local" || r.provider === "railkit" || r.provider === "none").toBe(true);
    expect(r.stations.length).toBeGreaterThanOrEqual(0);
  });

  it("21h. parseRailEnquiryStation validates code match + rejects junk", async () => {
    const { parseRailEnquiryStation } = await import("../server/railway/webscrape");
    const ok = parseRailEnquiryStation(
      "<html><head><title>Ambala Cant Jn (UMB) Railway Station</title></head></html>",
      "UMB",
      "https://railenquiry.in/station/UMB",
    );
    expect(ok?.name).toBe("Ambala Cant Jn");
    expect(ok?.code).toBe("UMB");
    expect(ok?.provider).toBe("web_railenquiry");
    /* Galat code match → null (invented data nahi). */
    expect(parseRailEnquiryStation("<title>XYZ (ABC) Railway Station</title>", "UMB", "u")).toBeNull();
    expect(parseRailEnquiryStation("<title>Railway Station</title>", "UMB", "u")).toBeNull();
  });
});

describe("22. Round-7b: availability without railkit key (prod shape)", () => {
  it("22a. railcore fail + no RAILKIT_API_KEY → erail fare-only row", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    setScrapeFetch(async (url: unknown) =>
      String(url).includes("erail.in/train-fare/") ? htmlResponse(ERail_FARE_HTML) : jsonResponse(500, {}),
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12054",
      date: FUTURE,
      from: "ASR",
      to: "HW",
      classCode: "CC",
    });
    expect(res.body.availability.status).toBe("UNKNOWN");
    expect(res.body.availability.fare).toBe(650);
    expect(res.body.availability.source).toBe("web_erail");
    expect(getLastRailwayLog()?.railwayProvider).toBe("web_erail");
  });

  it("22b. railcore fail + no railkit + scrape fail → plain UNKNOWN", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    setScrapeFetch(async () => jsonResponse(500, { success: false }));
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12054",
      date: FUTURE,
      from: "ASR",
      to: "HW",
      classCode: "CC",
    });
    expect(res.body.availability.status).toBe("UNKNOWN");
    expect(res.body.availability.fare).toBe(0);
    expect(res.body.bookable).toBe(false);
  });
});

describe("23. Round-7c: erail fare-table layout variance (Render body)", () => {
  /* Render body: fare-classes table "Total fare for" marker ke BAAD —
   * pehle wali table mein sirf stations + Adult/Child selectors. */
  const ERail_RENDER_LAYOUT = `<html><body>
<table><tr><td>Amritsar Jn Beas Jalandhar City</td><td>Haridwar Jn</td></tr>
<tr><td>Adult 0 Adult 1</td><td>Child 0 Child 1</td></tr></table>
Total fare for 1 Adult
<table><tr><th></th><th>CC</th><th>2S</th><th>GN</th></tr>
<tr><td>General</td><td>650</td><td>205</td><td>140</td></tr>
<tr><td>Tatkal</td><td>825</td><td>220</td><td>-</td></tr></table>
</body></html>`;

  it("23a. parseErailFare finds fare table after marker (Render layout)", async () => {
    const { parseErailFare } = await import("../server/railway/webscrape");
    const f = parseErailFare(ERail_RENDER_LAYOUT, "12054", "u");
    expect(f).not.toBeNull();
    const cc = f?.classes.find((c) => c.code === "CC");
    expect(cc?.general).toBe(650);
    expect(cc?.tatkal).toBe(825);
    const twoS = f?.classes.find((c) => c.code === "2S");
    expect(twoS?.general).toBe(205);
  });

  it("23b. multi-class train parse (12958 shape: 1A/2A/3A with gaps)", async () => {
    const { parseErailFare } = await import("../server/railway/webscrape");
    const html = `<html><body>Total fare for<table>
<tr><th></th><th>1A</th><th>2A</th><th>3A</th></tr>
<tr><td>General</td><td>3,945</td><td></td><td>1,810</td></tr>
<tr><td>Tatkal</td><td>-</td><td>2,415</td><td>1,810</td></tr></table></body></html>`;
    const f = parseErailFare(html, "12958", "u");
    const by = (c: string) => f?.classes.find((x) => x.code === c);
    expect(by("1A")?.general).toBe(3945);
    expect(by("1A")?.tatkal).toBeNull();
    expect(by("2A")?.general).toBeNull();
    expect(by("2A")?.tatkal).toBe(2415);
    expect(by("3A")?.general).toBe(1810);
  });
});

/* ------------------------------------------------------------------ */
/* Round-8 (2026-09-06): arrival-at-station + reset + topic-switch    */
/* ------------------------------------------------------------------ */

const R8_SCHEDULE = {
  success: true,
  data: {
    train_number: "18310",
    train_name: "Jammu Tawi - Sambalpur Express",
    stops: [
      { station_code: "JAT", station_name: "Jammu Tawi", arrival_time: "00:00", departure_time: "14:20", day: 1 },
      { station_code: "ASR", station_name: "Amritsar Jn", arrival_time: "20:00", departure_time: "20:35", day: 1 },
      { station_code: "LDH", station_name: "Ludhiana Jn", arrival_time: "23:00", departure_time: "23:10", day: 1 },
      { station_code: "CDG", station_name: "Chandigarh", arrival_time: "01:22", departure_time: "01:45", day: 2 },
    ],
  },
};

function r8Env() {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test";
  process.env.RAILKIT_API_KEY = "";
  process.env.NVIDIA_API_KEY = "";
  setRailcoreFetch(async (url: unknown) =>
    String(url).includes("/schedule") ? jsonResponse(200, R8_SCHEDULE) : jsonResponse(500, { success: false }),
  );
  /* Web-scrape fallbacks bhi down (network-isolated test). */
  setScrapeFetch(async () => jsonResponse(500, { success: false }));
  setRailkitSdk(failingSdk() as never);
  setProvider(null);
}

describe("24. Round-8: arrival-at-station (screenshot fixes)", () => {
  it("24a. '18310 cdg kitne baje pahunchegi' → sirf CDG arrival/departure", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "18310 cdg kitne baje pahunchegi ?",
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.reply).toContain("Chandigarh (CDG)");
    expect(res.body.reply).toContain("arrival 01:22");
    expect(res.body.reply).toContain("departure 01:45");
    expect(res.body.reply).not.toContain("Kahan se");
    expect(res.body.context.selectedTrainNumber).toBe("18310");
  });

  it("24b. context-train + 'Sirf cdg ka btao kitne baje arrival hai' → arrival, not 'Kahan se jana hai?'", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "Sirf cdg ka btao kitne baje arrival hai",
      context: { selectedTrainNumber: "18310", selectedTrainName: "Jammu Tawi - Sambalpur Express", intent: "TRAIN_SCHEDULE" },
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.reply).toContain("arrival 01:22");
    expect(res.body.reply).not.toMatch(/Kahan se jana/);
  });

  it("24c. '18310 ka cdg arrival btao' → arrival, NOT live-status", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "18310 ka cdg arrival btao",
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.reply).toContain("arrival 01:22");
    expect(res.body.reply).not.toMatch(/On time|last |delay/i);
  });

  it("24d. 'At what time 18310 reach chandigarh' (English) → arrival, no route dump", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "At what time 18310 reach chandigarh",
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.reply).toContain("arrival 01:22");
    expect(res.body.reply).not.toContain("Route:");
    expect(res.body.reply).not.toContain("Kahan se kahan");
  });

  it("24e. '18310 kahan hai' → live flow, precheck hijack NAHI hota", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "18310 kahan hai abhi",
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.reply).not.toContain("arrival 01:22");
  });

  it("24f. '18310 ka jalandhar arrival' — route-par-nahi stop → honest, no invention", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "18310 ka delhi arrival btao",
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.reply).not.toContain("arrival 01:22");
  });
});

describe("25. Round-8: reset command + topic-switch", () => {
  it("25a. 'nayi baat' → fresh context + justReset flag", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "nayi baat",
      context: { selectedTrainNumber: "18310", origin: { code: "JAT", name: "Jammu Tawi", city: "Jammu" }, dateProvided: true, date: "2026-09-10" },
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.context.selectedTrainNumber).toBeNull();
    expect(res.body.context.origin).toBeNull();
    expect(res.body.context.dateProvided).toBe(false);
    expect(res.body.context.justReset).toBe(true);
    expect(String(res.body.reply)).toMatch(/bhool/i);
  });

  it("25b. 'reset kar do' bhi kaam karta hai", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({ text: "reset kar do", now: "2026-09-06T18:30:00.000Z" });
    expect(res.body.context.justReset).toBe(true);
  });

  it("25c. mergeAgentContext: poora naya route + no train spoken → selectedTrain clear", async () => {
    const { mergeAgentContext, emptyAgentContext } = await import("../server/agent/context");
    const prev = { ...emptyAgentContext(), selectedTrainNumber: "18310", origin: { code: "JAT", name: "Jammu Tawi", city: "Jammu" } as never, destination: { code: "CDG", name: "Chandigarh", city: "Chandigarh" } as never };
    const next = mergeAgentContext(
      prev,
      { from: { code: "ASR", name: "Amritsar Jn", city: "Amritsar" } as never, to: { code: "NDLS", name: "New Delhi", city: "Delhi" } as never, intent: "SEARCH_TRAIN" } as never,
      "amritsar se new delhi kal",
    );
    expect(next.selectedTrainNumber).toBeNull();
  });

  it("25d. naya route PAR train number bhi bola → selectedTrain RAKHTA hai", async () => {
    const { mergeAgentContext, emptyAgentContext } = await import("../server/agent/context");
    const prev = { ...emptyAgentContext(), origin: { code: "JAT", name: "Jammu Tawi", city: "Jammu" } as never };
    const next = mergeAgentContext(
      prev,
      { from: { code: "ASR", name: "Amritsar Jn", city: "Amritsar" } as never, to: { code: "NDLS", name: "New Delhi", city: "Delhi" } as never, intent: "SEARCH_TRAIN" } as never,
      "12014 amritsar se new delhi",
    );
    expect(next.selectedTrainNumber).toBe("12014");
  });
});

describe("26. Round-8: station-code pehchaan (cdg jaise codes)", () => {
  it("26a. findStationsInText ab codes bhi pakadta hai (cdg/umb/jat)", async () => {
    const { findStationsInText } = await import("../src/ai/stations");
    const codes = findStationsInText("18310 cdg se umb kitne baje pahunchegi").map((s) => s.code);
    expect(codes).toContain("CDG");
    expect(codes).toContain("UMB");
  });

  it("26b. random words code nahi bante (false-positive guard)", async () => {
    const { findStationsInText } = await import("../src/ai/stations");
    const codes = findStationsInText("kya baat hai yaar kitna accha hai").map((s) => s.code);
    expect(codes).toHaveLength(0);
  });
});

describe("27. Round-9: Agra origin-cluster bug (multi-turn station choice)", () => {
  /* Prod bug (2026-09-06): "agra se delhi kal ki train" → Delhi options →
   * user "new delhi" → "Kahan se jaana hai? Departure station bataiye."
   * (Agra bhool gaya). Fix: unresolved cluster-city AgentContext mein
   * persist hoti hai (pendingOrigin/ChoiceChoice). */
  it("27a. 'agra se delhi kal ki train' → Delhi options + dono pending yaad", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "agra se delhi kal ki train",
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.reply).toContain("NDLS");
    expect(res.body.reply).toContain("DLI");
    expect(res.body.context.pendingOriginChoice).toBe("Agra");
    expect(res.body.context.pendingDestinationChoice).toBe("Delhi");
    expect(res.body.context.origin).toBeNull();
  });

  it("27b. turn-2 'new delhi' → AGRA options (NOT 'Kahan se jaana hai?')", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "new delhi",
      lastAsked: "to",
      context: { date: "2026-09-08", dateProvided: true, pendingOriginChoice: "Agra", pendingDestinationChoice: "Delhi", intent: "SEARCH_TRAIN" },
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.reply).toContain("AGC");
    expect(res.body.reply).not.toMatch(/Kahan se jaana hai/);
    expect(res.body.context.destination).toMatchObject({ code: "NDLS" });
    expect(res.body.context.pendingOriginChoice).toBe("Agra");
    expect(res.body.context.pendingDestinationChoice).toBeNull();
  });

  it("27c. turn-3 'agra cantt' → AGC→NDLS search chalti hai (origin set)", async () => {
    r8Env();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({
      text: "agra cantt",
      lastAsked: "from",
      context: { date: "2026-09-08", dateProvided: true, pendingOriginChoice: "Agra", destination: { code: "NDLS", name: "New Delhi", city: "Delhi" } },
      now: "2026-09-06T18:30:00.000Z",
    });
    expect(res.body.context.origin).toMatchObject({ code: "AGC" });
    expect(res.body.context.pendingOriginChoice).toBeNull();
    expect(res.body.reply).not.toMatch(/Kahan se jaana hai|Kahan jaana hai/);
    /* Search honestly chali (providers down par AGC → NDLS attempt dikhta hai). */
    expect(String(res.body.reply)).toMatch(/AGC → NDLS/);
  });

  it("27d. mergeAgentContext: pending persist + station bharne par clear", async () => {
    const { mergeAgentContext, emptyAgentContext } = await import("../server/agent/context");
    const prev = { ...emptyAgentContext(), pendingOriginChoice: "Agra", pendingDestinationChoice: "Delhi" };
    const kept = mergeAgentContext(prev, { intent: "SEARCH_TRAIN", unresolvedFrom: "Agra" } as never, "kal ki train");
    expect(kept.pendingOriginChoice).toBe("Agra");
    const picked = mergeAgentContext(kept, { intent: "SEARCH_TRAIN", from: { code: "AGC", name: "Agra Cantt", city: "Agra" } as never, to: { code: "NDLS", name: "New Delhi", city: "Delhi" } as never } as never, "agra cantt se new delhi");
    expect(picked.pendingOriginChoice).toBeNull();
    expect(picked.pendingDestinationChoice).toBeNull();
    expect(picked.origin).toMatchObject({ code: "AGC" });
  });
});
