import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { env } from "../server/env";
import { setRailkitSdk, resetRailkitBookings, ymdToDmy } from "../server/railway/railkit";
import { setProvider } from "../server/providers/index";
import { understand } from "../src/ai/nlu";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";

const NOW = new Date(2026, 7, 21);
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const FUTURE_DMY = ymdToDmy(FUTURE);

function blank() {
  return { ...initialBooking("2026-08-21"), date: "" };
}

afterEach(() => {
  setRailkitSdk(null);
  resetRailkitBookings();
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILKIT_API_KEY = "";
  setProvider(null);
});

describe("RailKit provider (mocked SDK)", () => {
  it("does not invent trains when key is missing", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "";
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    expect(res.status).toBe(200);
    expect(res.body.trains).toEqual([]);
    expect(res.body.empty).toBe(true);
  });

  it("maps searchTrainBetweenStations without inventing extras", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async (from, to, date) => {
        expect(from).toBe("ASR");
        expect(to).toBe("LDH");
        expect(date).toBe(FUTURE_DMY);
        return {
          success: true,
          data: [
            {
              train_no: "12498",
              train_name: "Shane Punjab",
              from_time: "15:10",
              to_time: "16:40",
              duration: "1:30",
              run_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
              classes: ["CC", "2S"],
            },
          ],
        };
      },
      getTrainInfo: async () => ({ success: false }),
      trackTrain: async () => ({ success: false }),
      getAvailability: async () => ({ success: false }),
      fareLookup: async () => ({ success: false }),
      checkPNRStatus: async () => ({ success: false }),
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    expect(res.status).toBe(200);
    expect(res.body.trains).toHaveLength(1);
    expect(res.body.trains[0].number).toBe("12498");
    expect(res.body.trains[0].name).toBe("Shane Punjab");
    expect(JSON.stringify(res.body)).not.toMatch(/rk_test|RAILKIT_API_KEY/i);
  });

  it("station lookup does not call RailRadar and accepts Kochi via ERS", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async () => ({ success: false }),
      getTrainInfo: async () => ({ success: false }),
      trackTrain: async () => ({ success: false }),
      getAvailability: async () => ({ success: false }),
      fareLookup: async () => ({ success: false }),
      checkPNRStatus: async () => ({ success: false }),
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/stations").query({ q: "Kochi" });
    expect(res.status).toBe(200);
    expect(res.body.stations[0].code).toBe("ERS");
    expect(JSON.stringify(res.body)).not.toMatch(/railradar|rr_live|Bearer/i);
  });

  it("live status maps SDK payload and does not invent delay", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async () => ({ success: false }),
      getTrainInfo: async () => ({ success: false }),
      trackTrain: async (n) => {
        expect(n).toBe("12919");
        return {
          success: true,
          data: {
            trainNumber: "12919",
            trainName: "Malwa Express",
            statusNote: "running",
            delayMinutes: 12,
            currentStation: { code: "BPL", name: "Bhopal" },
            nextStation: { name: "Bina" },
          },
        };
      },
      getAvailability: async () => ({ success: false }),
      fareLookup: async () => ({ success: false }),
      checkPNRStatus: async () => ({ success: false }),
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains/12919/live");
    expect(res.status).toBe(200);
    expect(res.body.live.trainNumber).toBe("12919");
    expect(res.body.live.delayMinutes).toBe(12);
    expect(res.body.live.raw).toBeUndefined();
  });

  it("live fallback names the train but does not invent location", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async () => ({ success: false }),
      getTrainInfo: async () => ({
        success: true,
        data: { trainInfo: { train_no: "12054", train_name: "HW JANSHATABDI" } },
      }),
      trackTrain: async () => ({ success: false, error: "Indian Railway server returned an error." }),
      getAvailability: async () => ({ success: false }),
      fareLookup: async () => ({ success: false }),
      checkPNRStatus: async () => ({ success: false }),
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/live").query({ number: "12054" });
    expect(res.status).toBe(200);
    expect(res.body.live.trainName).toBe("HW JANSHATABDI");
    expect(res.body.live.status).toBe("Live location not available");
    expect(res.body.live.currentStation).toBeNull();
    expect(res.body.live.delayMinutes).toBeNull();
  });

  it("live status is 404 when SDK has no data — never invented", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async () => ({ success: false }),
      getTrainInfo: async () => ({ success: false }),
      trackTrain: async () => ({ success: false }),
      getAvailability: async () => ({ success: false }),
      fareLookup: async () => ({ success: false }),
      checkPNRStatus: async () => ({ success: false }),
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains/12919/live");
    expect(res.status).toBe(404);
    expect(res.body.live).toBeUndefined();
  });

  it("maps seat availability without inventing extras", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async () => ({ success: false }),
      getTrainInfo: async () => ({ success: false }),
      trackTrain: async () => ({ success: false }),
      getAvailability: async (train, from, to, date, coach) => {
        expect(train).toBe("12013");
        expect(date).toBe("22-08-2026");
        expect(coach).toBe("CC");
        return { success: true, data: { status: "AVAILABLE-0484", availableSeats: 484 } };
      },
      fareLookup: async () => ({ success: false }),
      checkPNRStatus: async () => ({ success: false }),
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12013",
      date: "2026-08-22",
      from: "NDLS",
      to: "ASR",
      classCode: "CC",
    });
    expect(res.status).toBe(200);
    expect(res.body.availability.status).toBe("AVAILABLE");
    expect(res.body.availability.seats).toBe(484);
    expect(res.body.bookable).toBe(true);
  });

  it("class board uses getTrainInfo classes only — no fake SL/3E", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk({
      configure: () => undefined,
      searchTrainBetweenStations: async () => ({ success: false }),
      getTrainInfo: async () => ({
        success: true,
        data: { trainInfo: { train_number: "12013", train_name: "Shatabdi", classes: ["CC", "EC"] } },
      }),
      trackTrain: async () => ({ success: false }),
      getAvailability: async (_t, _f, _to, _d, coach) => ({
        success: true,
        data: { status: coach === "CC" ? "AVAILABLE-0010" : "AVAILABLE-0002", availableSeats: coach === "CC" ? 10 : 2 },
      }),
      fareLookup: async () => ({ success: false }),
      checkPNRStatus: async () => ({ success: false }),
    });
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12013",
      date: "2026-08-22",
      from: "NDLS",
      to: "ASR",
    });
    expect(res.status).toBe(200);
    const codes = (res.body.classes as { code: string }[]).map((c) => c.code);
    expect(codes).toEqual(["CC", "EC"]);
    expect(codes).not.toContain("SL");
  });

  it("converts ISO dates to DD-MM-YYYY for RailKit", () => {
    expect(ymdToDmy("2026-08-22")).toBe("22-08-2026");
  });
});

describe("regression A–H", () => {
  it("A: Amritsar se Ludhiana asks date, no search", () => {
    const n = understand("Mujhe Amritsar se Ludhiana jaana hai", { now: NOW });
    expect(n.from?.city).toMatch(/Amritsar/i);
    expect(n.to?.city).toMatch(/Ludhiana/i);
    expect(n.date).toBeUndefined();
    const turn = planTurn({ text: "Mujhe Amritsar se Ludhiana jaana hai", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.search).not.toBe(true);
    expect(turn.text).toBe("Bilkul. Kab jaana hai?");
  });

  it("B: date+pax persist across origin/dest turns", () => {
    const first = planTurn({
      text: "Mujhe 22 August ke liye 2 ticket chahiye",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(first.apply?.date).toBe("2026-08-22");
    expect(first.apply?.passengerCount).toBe(2);
    const asr = { code: "ASR", name: "Amritsar Junction", city: "Amritsar" };
    const mid = {
      ...blank(),
      date: "2026-08-22",
      dateProvided: true,
      passengerCount: 2,
      paxProvided: true,
      from: asr,
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

  it("C: kal Amritsar se Delhi is 2026-08-22", () => {
    const n = understand("Mujhe kal Amritsar se Delhi jaana hai", { now: NOW });
    expect(n.from?.code).toBe("ASR");
    expect(n.to).toBeUndefined();
    expect(n.unresolvedTo).toMatch(/Delhi/i);
    expect(n.date).toBe("2026-08-22");
  });

  it("D: aaj uses today", () => {
    const n = understand("Mujhe aaj Amritsar se Delhi jaana hai", { now: NOW });
    expect(n.date).toBe("2026-08-21");
  });

  it("E: Kochi is not catalog-rejected; date asked", () => {
    const n = understand("Mujhe Ludhiana se Kochi jaana hai", { now: NOW });
    expect(n.unresolvedTo).toMatch(/Kochi/i);
    const turn = planTurn({
      text: "Mujhe Ludhiana se Kochi jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.text).not.toMatch(/bookable nahi/i);
  });

  it("F: kal Ludhiana se Kochi is not catalog-rejected; date kept, tickets asked", () => {
    const turn = planTurn({
      text: "Mujhe kal Ludhiana se Kochi jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.apply?.date).toBe("2026-08-22");
    expect(turn.apply?.from?.code).toBe("LDH");
    expect(turn.apply?.to?.city).toMatch(/Kochi/i);
    expect(turn.search).not.toBe(true);
    expect(turn.blocks?.[0]?.type).toBe("stations");
    expect(turn.text).not.toMatch(/bookable nahi/i);
  });

  it("live status without number asks for 5-digit, then 12054 tracks", () => {
    const first = planTurn({
      text: "Mere ko live status pata krna haridwar amritsar janshatabdi ka",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(first.liveTrain).toBeUndefined();
    expect(first.ask).toBe("trainNumber");
    expect(first.text).toMatch(/Train number/i);
    const second = planTurn({
      text: "12054",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
      lastAsked: "trainNumber",
    });
    expect(second.liveTrain).toBe("12054");
    expect(second.search).not.toBe(true);
  });

  it("G: 12919 live status intent", () => {
    const n = understand("12919 abhi kahan hai?", { now: NOW });
    expect(n.intent).toBe("LIVE_TRAIN_STATUS");
    expect(n.trainNumber).toBe("12919");
    const turn = planTurn({ text: "12919 abhi kahan hai?", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.liveTrain).toBe("12919");
  });

  it("H: meri bookings dikhao is fast-path NLU", async () => {
    process.env.RAILWAY_PROVIDER = "mock";
    const app = createApp();
    const res = await request(app).post("/api/understand").send({ text: "meri bookings dikhao" });
    expect(res.body.nlu.intent).toBe("VIEW_BOOKINGS");
    expect(res.body.source).toBe("nlu");
    expect(res.body.failureReason).toBe("fast_path");
  });

  it("missing date is not defaulted to today", () => {
    const n = understand("Mujhe Amritsar se Ludhiana jaana hai", { now: NOW });
    expect(n.date).toBeUndefined();
    const turn = planTurn({
      text: "Mujhe Amritsar se Ludhiana jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.ask).toBe("date");
    expect(turn.text).toMatch(/Kab jaana hai/i);
  });

  it("Jammu se Beas resolves JAT→BEAS and still asks date", () => {
    const n = understand("Mujhe jammu se beas jaana hai", { now: NOW });
    expect(n.from?.code).toBe("JAT");
    expect(n.to?.code).toBe("BEAS");
    expect(n.date).toBeUndefined();
    const turn = planTurn({
      text: "Mujhe jammu se beas jaana hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.ask).toBe("date");
    expect(turn.apply?.from?.code).toBe("JAT");
    expect(turn.apply?.to?.code).toBe("BEAS");
    expect(turn.text).toMatch(/Kab jaana hai/i);
  });

  it("explicit aaj allows search date=today", () => {
    const n = understand("Mujhe aaj Amritsar se Ludhiana jaana hai", { now: NOW });
    expect(n.date).toBe("2026-08-21");
  });

  it("passenger + date persist across origin/dest", () => {
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
});

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

describe("Advance-plan payload mapping", () => {
  it("maps real ASR→LDH search fields without inventing extras", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(
      failingSdk({
        searchTrainBetweenStations: async (from: string, to: string, date?: string) => {
          expect(from).toBe("ASR");
          expect(to).toBe("LDH");
          expect(date).toBe(FUTURE_DMY);
          return {
            success: true,
            data: [
              {
                train_no: "12014",
                train_name: "AMRITSAR SHTABDI",
                from_time: "04:55",
                to_time: "06:57",
                travel_time: "02:02 hrs",
                running_days: "1111111",
                from_stn_code: "ASR",
                from_stn_name: "Amritsar Jn",
                to_stn_code: "LDH",
                to_stn_name: "Ludhiana Jn",
              },
            ],
          };
        },
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    expect(res.status).toBe(200);
    expect(res.body.trains).toHaveLength(1);
    expect(res.body.trains[0].number).toBe("12014");
    expect(res.body.trains[0].name).toBe("AMRITSAR SHTABDI");
    expect(res.body.trains[0].departure).toBe("04:55");
    expect(res.body.trains[0].arrival).toBe("06:57");
    expect(res.body.trains[0].classes).toEqual([]);
  });

  it("maps Advance getAvailability calendar + fare, including quota", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(
      failingSdk({
        getAvailability: async () => ({
          success: true,
          data: {
            train: {
              trainNo: "12014",
              trainName: "AMRITSAR SHTABDI",
              from: "ASR",
              to: "LDH",
              travelClass: "CC",
              quota: "GN",
            },
            fare: { baseFare: 269, totalFare: 480 },
            availability: [
              {
                date: "23-8-2026",
                status: "AVAILABLE",
                availabilityText: "AVL 527",
                rawStatus: "AVAILABLE-0527",
              },
            ],
          },
        }),
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
    expect(res.body.availability.seats).toBe(527);
    expect(res.body.availability.fare).toBe(480);
    expect(res.body.availability.quota).toBe("GN");
    expect(res.body.bookable).toBe(true);
  });

  it("maps NOT AVAILABLE instead of inventing waitlist seats", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(
      failingSdk({
        getAvailability: async () => ({
          success: true,
          data: {
            fare: { totalFare: 180 },
            availability: [
              {
                date: "23-8-2026",
                status: "WAITLIST",
                availabilityText: "Not Available",
                rawStatus: "NOT AVAILABLE",
              },
            ],
          },
        }),
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/availability").query({
      trainNumber: "12716",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "SL",
    });
    expect(res.body.availability.status).toBe("NOT_AVAILABLE");
    expect(res.body.bookable).toBe(false);
  });

  it("fareLookup uses railway totalFare, not service fee", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(
      failingSdk({
        fareLookup: async () => ({
          success: true,
          data: { trainNo: "12014", totalFare: 480, baseFare: 269, gst: 22 },
        }),
      }) as never,
    );
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
    expect(res.body.fare.baseFare).toBe(480);
    expect(res.body.fare.serviceFee).toBeGreaterThan(0);
    expect(res.body.fare.total).toBe(480 + res.body.fare.serviceFee);
  });

  it("failed fareLookup is unavailable — not a ₹0 railway fare", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(failingSdk() as never);
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
    expect(res.body.fare.railwayAvailable).toBe(false);
    expect(res.body.fare.baseFare).toBe(0);
  });

  it("live status maps statusNote and does not invent delay", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(
      failingSdk({
        trackTrain: async (_n: string, date?: string) => {
          expect(date).toMatch(/^\d{2}-\d{2}-\d{4}$/);
          return {
            success: true,
            data: {
              trainNo: "12014",
              trainName: "AMRITSAR SHTABDI",
              statusNote: "Yet to start from its source",
              currentStationCode: "ASR",
              lastUpdate: "",
              timeline: [
                {
                  type: "stoppage",
                  status: "current",
                  stationCode: "ASR",
                  stationName: "AMRITSAR",
                  arrival: { delay: "" },
                  departure: { delay: "On Time" },
                },
                { type: "stoppage", status: "upcoming", stationCode: "BEAS", stationName: "BEAS" },
              ],
            },
          };
        },
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains/12014/live");
    expect(res.status).toBe(200);
    expect(res.body.live.trainNumber).toBe("12014");
    expect(res.body.live.status).toBe("Yet to start from its source");
    expect(res.body.live.currentStation).toBe("AMRITSAR");
    expect(res.body.live.nextStation).toBe("BEAS");
    expect(res.body.live.delayMinutes).toBe(0);
    expect(res.body.live.lastUpdatedAt).toBeNull();
  });

  it("timetable maps getTrainInfo route stops", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(
      failingSdk({
        getTrainInfo: async () => ({
          success: true,
          data: {
            trainInfo: { train_no: "19326", train_name: "ASR INDB EXP" },
            route: [
              { stnCode: "ASR", stnName: "Amritsar Jn", arrival: "--", departure: "01:50", day: "1" },
              { stnCode: "DDL", stnName: "Dhandari Kalan", arrival: "04:15", departure: "04:25", day: "1" },
            ],
          },
        }),
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains/19326/schedule");
    expect(res.status).toBe(200);
    expect(res.body.schedule.trainName).toBe("ASR INDB EXP");
    expect(res.body.schedule.stops).toHaveLength(2);
    expect(res.body.schedule.stops[1].code).toBe("DDL");
  });

  it("booking confirmation stays DEMO/MOCK", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(
      failingSdk({
        fareLookup: async () => ({ success: true, data: { totalFare: 480 } }),
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const created = await request(app).post("/api/bookings").send({
      trainNumber: "12014",
      date: "2026-08-23",
      from: "ASR",
      to: "LDH",
      classCode: "CC",
      seatPreference: "Window",
      passengers: [{ name: "Asha Kaur", age: 28, gender: "FEMALE", berthPreference: "Window" }],
    });
    expect(created.status).toBe(201);
    expect(created.body.booking.mock).toBe(true);
    const confirmed = await request(app).post(`/api/bookings/${created.body.booking.id}/confirm`);
    expect(confirmed.body.booking.mock).toBe(true);
    expect(String(confirmed.body.booking.pnr)).toMatch(/^MOCK/);
  });
});

describe("provider / NVIDIA safety", () => {
  it("RailRadar runtime files and imports are gone", () => {
    expect(existsSync("server/providers/railradar.ts")).toBe(false);
    expect(existsSync("tests/railradar.test.ts")).toBe(false);
    const files = [
      "server/providers/index.ts",
      "server/app.ts",
      "server/env.ts",
      "server/railway/railkit.ts",
      ".env.example",
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/railradar\.in|RAILRADAR_/i);
    }
  });

  it("NVIDIA defaults stay gpt-oss-20b on integrate.api.nvidia.com", () => {
    const prevModel = process.env.NVIDIA_MODEL;
    const prevBase = process.env.NVIDIA_BASE_URL;
    delete process.env.NVIDIA_MODEL;
    delete process.env.NVIDIA_BASE_URL;
    expect(env.nvidiaModel).toBe("openai/gpt-oss-20b");
    expect(env.nvidiaBaseUrl).toBe("https://integrate.api.nvidia.com/v1");
    if (prevModel != null) process.env.NVIDIA_MODEL = prevModel;
    if (prevBase != null) process.env.NVIDIA_BASE_URL = prevBase;
  });

  it("maps liveAtStation board without inventing trains", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(
      failingSdk({
        liveAtStation: async (code: string) => {
          expect(code).toBe("LDH");
          return {
            success: true,
            data: {
              summary: "2 trains at LDH",
              totalTrains: 1,
              trains: [{ trainNo: "14609", trainName: "HEMKUNT EXPRESS", platform: "4", arrival: { actual: "10:00" } }],
            },
          };
        },
      }) as never,
    );
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/stations/LDH/live");
    expect(res.status).toBe(200);
    expect(res.body.board.trains[0].trainNo).toBe("14609");
    expect(res.body.board.trains).toHaveLength(1);
  });

  it("maps cancelList without inventing extras", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
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
    expect(res.body.cancelled.fully[0].trainNo).toBe("12345");
  });

  it("NLU cancelled trains and station board intents", () => {
    expect(understand("cancelled trains dikhao", { now: NOW }).intent).toBe("CANCELLED_TRAINS");
    const board = understand("Ludhiana station board", { now: NOW });
    expect(board.intent).toBe("LIVE_AT_STATION");
    expect(board.from?.code).toBe("LDH");
  });

  it("failed SDK search returns empty trains — never invented", async () => {
    process.env.RAILWAY_PROVIDER = "railkit";
    process.env.RAILKIT_API_KEY = "rk_test";
    setRailkitSdk(failingSdk() as never);
    setProvider(null);
    const app = createApp();
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "LDH", date: FUTURE });
    expect(res.body.trains).toEqual([]);
    expect(res.body.empty).toBe(true);
  });
});
