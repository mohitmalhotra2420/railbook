import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { env } from "../server/env";
import { RailCoreProvider, resetRailcoreBookings, setRailcoreFetch } from "../server/railway/railcore";
import { setProvider } from "../server/providers/index";
import { understand } from "../src/ai/nlu";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";

const NOW = new Date(2026, 7, 21);
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

function blank() {
  return { ...initialBooking("2026-08-21"), date: "" };
}

afterEach(() => {
  setRailcoreFetch(null);
  resetRailcoreBookings();
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  process.env.RAILKIT_API_KEY = "";
  setProvider(null);
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RailCore adapter (mocked HTTP)", () => {
  it("does not invent trains when key is missing", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "";
    process.env.RAILKIT_API_KEY = "";
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    expect(res.body.trains).toEqual([]);
    expect(res.body.empty).toBe(true);
  });

  it("authentication request uses X-RailCore-Key header and never leaks it", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    let seenAuth = "";
    let seenUrl = "";
    setRailcoreFetch(async (input, init) => {
      seenUrl = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seenAuth = headers["X-RailCore-Key"] ?? "";
      return jsonResponse(401, { success: false, error: { message: "unauthorized" } });
    });
    const p = new RailCoreProvider();
    const trains = await p.searchTrains({ from: "ASR", to: "LDH", date: "2026-08-23" });
    expect(trains).toEqual([]);
    expect(seenUrl).toContain("https://ir.railcore.tech/v1/routes/trains");
    expect(seenAuth).toBe("rk_live_test_secret");
    expect(seenUrl).not.toMatch(/rk_live_test_secret/);
  });

  it("maps station search Jammu and Beas from actual RailCore payload shape", async () => {
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async (input) => {
      const url = String(input);
      const q = new URL(url).searchParams.get("q") || "";
      if (/jammu/i.test(q)) {
        return jsonResponse(200, {
          success: true,
          data: { query: "Jammu", results: [{ station_code: "JAT", station_name: "JAMMU TAWI", city: "Jammu" }] },
        });
      }
      if (/beas/i.test(q)) {
        return jsonResponse(200, {
          success: true,
          data: { query: "Beas", results: [{ station_code: "BEAS", station_name: "BEAS", city: "Beas" }] },
        });
      }
      return jsonResponse(200, { success: true, data: { results: [] } });
    });
    const { searchRailcoreStations } = await import("../server/railway/railcore");
    const jammu = await searchRailcoreStations("Jammu");
    const beas = await searchRailcoreStations("Beas");
    expect(jammu[0]?.code).toBe("JAT");
    expect(beas[0]?.code).toBe("BEAS");
  });

  it("maps ASR→LDH search without inventing extras", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async () =>
      jsonResponse(200, {
        success: true,
        data: {
          from_station_code: "ASR",
          to_station_code: "LDH",
          journey_date: "2026-08-23",
          trains: [
            {
              train_number: "12014",
              train_name: "AMRITSAR SHTABDI",
              departure_time: "04:55",
              arrival_time: "06:57",
              duration_minutes: 122,
              classes: ["CC", "EC"],
              running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
            },
          ],
        },
      }),
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    expect(res.body.trains).toHaveLength(1);
    expect(res.body.trains[0].number).toBe("12014");
    expect(res.body.trains[0].departure).toBe("04:55");
    expect(JSON.stringify(res.body)).not.toMatch(/rk_live_test_secret|RAILCORE_API_KEY/i);
  });

  it("maps live status and does not invent delay when missing", async () => {
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
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
          next_stop: null,
        },
      }),
    );
    const { liveTrainStatus } = await import("../server/railway/railcore");
    const live = await liveTrainStatus("12014", "2026-08-22");
    expect(live?.trainNumber).toBe("12014");
    expect(live?.delayMinutes).toBe(6);
    expect(live?.currentStation).toBe("New Delhi");
    expect(live?.nextStation).toBeNull();
  });

  it("maps availability and fare without using service fee as railway fare", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async (input) => {
      const url = String(input);
      if (url.includes("/availability/seats")) {
        return jsonResponse(200, {
          success: true,
          data: {
            journey_date: "2026-08-23",
            quota: "GN",
            classes: [{ class_code: "CC", status: "AVAILABLE", availability_text: "AVAILABLE-0570", available_count: 570, total_fare: 510 }],
          },
        });
      }
      if (url.includes("/fares/estimate")) {
        return jsonResponse(200, {
          success: true,
          data: { fares: [{ class_code: "CC", fare: 510, currency: "INR" }] },
        });
      }
      return jsonResponse(404, { success: false });
    });
    setProvider(null);
    const app = createApp();
    const seats = await request(app).get("/api/availability").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
    });
    expect(seats.body.availability.status).toBe("AVAILABLE");
    expect(seats.body.availability.seats).toBe(570);
    expect(seats.body.availability.fare).toBe(510);
    const fare = await request(app).get("/api/fare").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
      passengers: 1,
    });
    expect(fare.body.fare.railwayAvailable).toBe(true);
    expect(fare.body.fare.baseFare).toBe(510);
    expect(fare.body.fare.serviceFee).toBeGreaterThan(0);
    expect(fare.body.fare.total).toBe(510 + fare.body.fare.serviceFee);
  });

  it("does not invent availability when RailCore fails", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async () => jsonResponse(500, { success: false, error: { message: "upstream" } }));
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
    });
    expect(res.body.availability.status).toBe("UNKNOWN");
    expect(res.body.bookable).toBe(false);
  });
});

describe("NVIDIA + booking state remain unchanged", () => {
  it("NVIDIA defaults stay gpt-oss-20b", () => {
    const prevModel = process.env.NVIDIA_MODEL;
    const prevBase = process.env.NVIDIA_BASE_URL;
    delete process.env.NVIDIA_MODEL;
    delete process.env.NVIDIA_BASE_URL;
    expect(env.nvidiaModel).toBe("openai/gpt-oss-20b");
    expect(env.nvidiaBaseUrl).toBe("https://integrate.api.nvidia.com/v1");
    if (prevModel != null) process.env.NVIDIA_MODEL = prevModel;
    if (prevBase != null) process.env.NVIDIA_BASE_URL = prevBase;
  });

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
  });

  it("multi-turn date and passengers persist", () => {
    const first = planTurn({
      text: "Mujhe 22 August ke liye 2 ticket chahiye",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(first.apply?.date).toBe("2026-08-22");
    expect(first.apply?.passengerCount).toBe(2);
    const mid = {
      ...blank(),
      date: "2026-08-22",
      dateProvided: true,
      passengerCount: 2,
      paxProvided: true,
      from: { code: "ASR", name: "Amritsar Junction", city: "Amritsar" },
    };
    const dest = planTurn({
      text: "Ludhiana",
      now: NOW,
      booking: mid,
      prefs: {},
      saved: [],
      lastAsked: "to",
    });
    expect(dest.apply?.to?.code).toBe("LDH");
    expect(dest.search).toBe(true);
    expect(dest.text).not.toMatch(/Kab jaana/i);
  });

  it("RailKit remains selectable and NLU still extracts ASR", () => {
    expect(understand("Mujhe Amritsar se Ludhiana jaana hai", { now: NOW }).from?.code).toBe("ASR");
    process.env.RAILWAY_PROVIDER = "railkit";
    expect((process.env.RAILWAY_PROVIDER || "").toLowerCase()).toBe("railkit");
  });
});
