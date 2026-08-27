import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { env } from "../server/env";
import { setRailcoreFetch, resetRailcoreBookings } from "../server/railway/railcore";
import { setRailkitSdk, resetRailkitBookings } from "../server/railway/railkit";
import { setProvider } from "../server/providers/index";
import { getLastRailwayLog, FallbackRailwayProvider } from "../server/railway/router";
import { pickStations, scoreStation, stationSearchQuery } from "../server/railway/station-resolve";
import { understand } from "../src/ai/nlu";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";

const NOW = new Date(2026, 7, 21);

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
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: "2026-08-23" });
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
    setProvider(null);
    const app = createApp();
    const trains = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: "2026-08-23" });
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
      await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: "2026-08-23" });
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

  it("Kochi first-result KFX is not returned as the station", async () => {
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
    expect(res.body.stations).toEqual([]);
    expect(res.body.stations[0]?.code).not.toBe("KFX");
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
    const res = await request(app).get("/api/trains").query({ from: "LDH", to: "DLI", date: "2026-08-23" });
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
    const res = await request(app).get("/api/trains").query({ from: "BEAS", to: "NDLS", date: "2026-08-23" });
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
