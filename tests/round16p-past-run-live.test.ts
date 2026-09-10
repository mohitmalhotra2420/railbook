/**
 * Round-16p — "kal / parson / usse pehle wali train ka live status nahi milta".
 *
 * Root cause (prod, 2026-09-09 01:00 IST, 12424 Dibrugarh Rajdhani):
 *  - Booking date-parser "kal" = TOMORROW, "7 September" (beeta) = agle saal →
 *    TRACK_TRAIN ko future date gayi → RailCore ne "aaj ka run, origin par
 *    khadi, On time" diya. User ko lagta tha kal wali train ka status nahi aata.
 *  - Bina date ke bhi multi-day train ka AAJ wala run origin par idle hota
 *    hai; asli chalti hui train KAL/PARSON wala run hota hai.
 *
 * Fix: parseStatusDate (past-only), run-state (not_started/running/completed),
 * router auto-probe pichhle 3 din, run-date label in replies, GET_TRAIN_HISTORY
 * fallback to same-date live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { setRailcoreFetch, resetRailcoreBookings } from "../server/railway/railcore";
import { setScrapeFetch } from "../server/railway/webscrape";
import { setRailkitSdk } from "../server/railway/railkit";
import { setProvider } from "../server/providers/index";
import { routedLiveStatus, liveRunState } from "../server/railway/router";
import { parseStatusDate, parseDatePhrase } from "../server/understand/legacy-dates";
import { livePositionLabel, liveRunDateLabel } from "../server/agent/tools";

const NOW = new Date("2026-09-08T19:30:00.000Z"); // 09 Sep 2026 01:00 IST
const TODAY = "2026-09-09";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** RailCore /live shapes as seen live on 2026-09-09 for 12424 (per start date). */
function rajdhaniMock() {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.includes("/live")) return jsonResponse(500, { success: false });
    const date = url.searchParams.get("date");
    const base = { train_number: "12424", train_name: "Dbrt Rajdhani", journey_date: date, total_distance_km: 2434 };
    if (date === TODAY) {
      // Aaj ka run: abhi chala nahi — origin par khadi
      return jsonResponse(200, {
        success: true,
        data: { ...base, status: "AT_STATION", status_text: "On time", current_station_code: "NDLS", current_station_name: "New Delhi", next_station_code: "CNB", previous_station_code: null, delay_minutes: 0, progress_percent: 0, distance_covered_km: 0, last_reported_at: "2026-09-08T00:05:00+05:30" },
      });
    }
    if (date === "2026-09-08") {
      return jsonResponse(200, {
        success: true,
        data: { ...base, status: "RUNNING", status_text: "Running 14 minutes early", current_station_code: "JEP", current_station_name: "Jeonathpur", next_station_code: "DDU", next_stop: { station_name: "Dd Upadhyaya Jn", station_code: "DDU" }, previous_station_code: "PRYJ", delay_minutes: -14, progress_percent: 32.1, distance_covered_km: 781.9, last_reported_at: "2026-09-09T00:52:00+05:30" },
      });
    }
    if (date === "2026-09-07") {
      return jsonResponse(200, {
        success: true,
        data: { ...base, status: "RUNNING", status_text: "Running 31 minutes late", current_station_code: "SZR", current_station_name: "Sarupathar", next_station_code: "FKG", next_stop: { station_name: "Furkating Jn", station_code: "FKG" }, previous_station_code: "DMV", delay_minutes: 31, progress_percent: 89, distance_covered_km: 2165.56, last_reported_at: "2026-09-09T00:54:00+05:30" },
      });
    }
    if (date === "2026-09-06") {
      return jsonResponse(200, {
        success: true,
        data: { ...base, status: "COMPLETED", status_text: "Journey completed", current_station_code: "DBRG", current_station_name: "DIBRUGARH", next_station_code: null, previous_station_code: "NTSK", delay_minutes: 159, progress_percent: 100, distance_covered_km: 2434, last_reported_at: "2026-09-08T08:59:00+05:30" },
      });
    }
    return jsonResponse(404, { success: false, error: { message: "no run" } });
  });
}

beforeEach(() => {
  /* Round-17: test clock pin (mock dates 06–09 Sep fixed hain; real "aaj" badalta rehta hai). */
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test";
  process.env.RAILKIT_API_KEY = "";
  process.env.NVIDIA_API_KEY = "";
  setProvider(null);
  setScrapeFetch(async () => jsonResponse(500, { success: false }));
  setRailkitSdk(null);
});

afterEach(() => {
  vi.useRealTimers();
  setRailcoreFetch(null);
  setScrapeFetch(null);
  resetRailcoreBookings();
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  setProvider(null);
});

describe("Round-16p: parseStatusDate — live/history mein 'kal' = BEETA hua kal", () => {
  it("kal / yesterday / parson / N din pehle → past dates (IST)", () => {
    expect(parseStatusDate("12430 jo kal chali thi abhi kahan hai", NOW)).toBe("2026-09-08");
    expect(parseStatusDate("kal ki 12014 kitni late thi", NOW)).toBe("2026-09-08");
    expect(parseStatusDate("yesterday 12424 status", NOW)).toBe("2026-09-08");
    expect(parseStatusDate("parson wali 12424 kahan hai", NOW)).toBe("2026-09-07");
    expect(parseStatusDate("day before yesterday 12424", NOW)).toBe("2026-09-07");
    expect(parseStatusDate("3 din pehle wali 12424", NOW)).toBe("2026-09-06");
    expect(parseStatusDate("कल वाली 12424 कहाँ है", NOW)).toBe("2026-09-08");
  });

  it("explicit past date → wahi (is saal), agle saal NAHI; 40 din se purani → undefined", () => {
    expect(parseStatusDate("12424 7 September wali kahan hai abhi", NOW)).toBe("2026-09-07");
    expect(parseStatusDate("2026-09-06 12424", NOW)).toBe("2026-09-06");
    expect(parseStatusDate("8/9 wali 12424", NOW)).toBe("2026-09-08");
    expect(parseStatusDate("12 aug wali 12424 late thi?", NOW)).toBe("2026-08-12");
    expect(parseStatusDate("1 january wali 12424", NOW)).toBeUndefined();
  });

  it("no cue / aaj / tomorrow → undefined ya aaj (server aaj ka run + auto-probe)", () => {
    expect(parseStatusDate("12424 kahan hai", NOW)).toBeUndefined();
    expect(parseStatusDate("12424 tomorrow", NOW)).toBeUndefined();
    expect(parseStatusDate("aaj ki 12014 kahan hai", NOW)).toBe(TODAY);
  });

  it("booking parser unchanged: 'kal' = tomorrow, past named date rolls to next year", () => {
    expect(parseDatePhrase("kal ki train", NOW).date).toBe("2026-09-10");
    expect(parseDatePhrase("7 september", NOW).date).toBe("2027-09-07");
  });
});

describe("Round-16p: router — run-state + pichhle din ka chalta hua run", () => {
  it("bina date: aaj ka run origin par idle → kal (08 Sep) wala RUNNING run milta hai", async () => {
    rajdhaniMock();
    const r = await routedLiveStatus("12424");
    expect(r.provider).toBe("railcore");
    const live = r.live as { journeyDate?: string; currentStation?: string; status?: string };
    expect(live.journeyDate).toBe("2026-09-08");
    expect(live.currentStation).toBe("Jeonathpur");
    expect(liveRunState(r.live)).toBe("running");
  });

  it("date di gayi (parson 07 Sep) → wahi run, auto-probe nahi", async () => {
    rajdhaniMock();
    const r = await routedLiveStatus("12424", "2026-09-07");
    const live = r.live as { journeyDate?: string; currentStation?: string; delayMinutes?: number };
    expect(live.journeyDate).toBe("2026-09-07");
    expect(live.currentStation).toBe("Sarupathar");
    expect(live.delayMinutes).toBe(31);
  });

  it("completed run (06 Sep) → 'completed' state, final delay preserved (invent nahi)", async () => {
    rajdhaniMock();
    const r = await routedLiveStatus("12424", "2026-09-06");
    expect(liveRunState(r.live)).toBe("completed");
    expect((r.live as { delayMinutes?: number }).delayMinutes).toBe(159);
  });

  it("aaj ka run sach mein chal raha ho → auto-probe NAHI (single call, aaj wala hi)", async () => {
    let calls = 0;
    setRailcoreFetch(async (input) => {
      calls++;
      const url = new URL(String(input));
      return jsonResponse(200, {
        success: true,
        data: { train_number: "12014", train_name: "Amritsar Shtabdi", journey_date: url.searchParams.get("date"), status: "RUNNING", status_text: "Running 5 minutes late", current_station_name: "Ludhiana Jn", next_station_code: "UMB", previous_station_code: "JUC", delay_minutes: 5, progress_percent: 40, distance_covered_km: 180 },
      });
    });
    const r = await routedLiveStatus("12014");
    expect(calls).toBe(1);
    expect(liveRunState(r.live)).toBe("running");
  });

  it("purane sab not-started/404 → aaj wala hi wapas (crash nahi)", async () => {
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      const date = url.searchParams.get("date");
      if (date !== TODAY) return jsonResponse(404, { success: false, error: { message: "no run" } });
      return jsonResponse(200, {
        success: true,
        data: { train_number: "12014", train_name: "Amritsar Shtabdi", journey_date: date, status: "AT_STATION", status_text: "On time", current_station_name: "Amritsar Jn", next_station_code: "BEAS", previous_station_code: null, delay_minutes: 0, progress_percent: 0, distance_covered_km: 0 },
      });
    });
    const r = await routedLiveStatus("12014");
    expect(r.live).not.toBeNull();
    expect(liveRunState(r.live)).toBe("not_started");
  });
});

describe("Round-16p: labels", () => {
  it("livePositionLabel run-state aware; liveRunDateLabel kal/parson", () => {
    expect(livePositionLabel({ status: "Journey completed", currentStation: "DIBRUGARH", runState: "completed" })).toBe("DIBRUGARH pahunch chuki (journey complete)");
    expect(livePositionLabel({ status: "On time", currentStation: "New Delhi", runState: "not_started" })).toBe("abhi New Delhi se chali nahi (origin par)");
    expect(livePositionLabel({ status: "Running 5 minutes late", currentStation: "Beas" })).toBe("current status Beas");
    // relative to real today — sirf format check
    expect(liveRunDateLabel(null)).toBe("");
    expect(liveRunDateLabel("not-a-date")).toBe("");
  });
});

describe("Round-16p: /api/agent deterministic path (no LLM key)", () => {
  it("'12424 jo kal chali thi abhi kahan hai' → 08 Sep wala run, Jeonathpur, run-date label", async () => {
    rajdhaniMock();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({ text: "12424 jo kal chali thi abhi kahan hai", now: NOW.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("Jeonathpur");
    expect(res.body.reply).toMatch(/kal \(08 Sep\)/);
    expect(res.body.reply).not.toMatch(/New Delhi/);
  });

  it("'12424 parson wali kahan hai' → 07 Sep run (Sarupathar, 31 min late)", async () => {
    rajdhaniMock();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({ text: "12424 parson wali kahan hai", now: NOW.toISOString() });
    expect(res.body.reply).toContain("Sarupathar");
    expect(res.body.reply).toMatch(/parson \(07 Sep\)/);
    expect(res.body.reply).toMatch(/31 minutes late/);
  });

  it("'12424 kahan hai' (bina din) → aaj wala origin-idle skip, chalta hua 08 Sep run", async () => {
    rajdhaniMock();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({ text: "12424 kahan hai", now: NOW.toISOString() });
    expect(res.body.reply).toContain("Jeonathpur");
    expect(res.body.reply).not.toMatch(/abhi New Delhi/);
  });

  it("'6 september wali 12424 kitni late pahunchi' → completed run, 159 min, 'pahunch chuki'", async () => {
    rajdhaniMock();
    const app = createApp();
    const res = await request(app).post("/api/agent").send({ text: "6 september wali 12424 kitni late pahunchi live status", now: NOW.toISOString() });
    expect(res.body.reply).toMatch(/Journey completed/);
    expect(res.body.reply).toMatch(/pahunch chuki/);
    expect(res.body.reply).toMatch(/159/);
    expect(res.body.reply).not.toMatch(/next /);
  });
});

/* ── Round-16p-2: station-wise history of a past run (RailKit → RailCore → RailRadar) ── */
import { routedTrainHistory } from "../server/railway/router";
import { setRailradarFetch } from "../server/railway/railradar";

describe("Round-16p-2: routedTrainHistory + /api/history — RailKit fail par RailCore stations[] / RailRadar route[]", () => {
  it("RailCore /live?date= stations[] → station-wise actual arr/dep + delay, runState completed", async () => {
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.includes("/live")) return jsonResponse(500, { success: false });
      return jsonResponse(200, {
        success: true,
        data: {
          train_number: "12424", train_name: "Dbrt Rajdhani", journey_date: url.searchParams.get("date"), status: "COMPLETED", status_text: "Journey completed", distance_covered_km: 2434,
          stations: [
            { station_code: "NDLS", station_name: "New Delhi", scheduled_departure: "2026-09-06T16:20:00+05:30", actual_departure: "2026-09-06T16:24:00+05:30", delay_departure_minutes: 4, has_arrived: true, has_departed: true, is_stopping: true },
            { station_code: "CNB", station_name: "Kanpur Central", scheduled_arrival: "2026-09-06T21:00:00+05:30", actual_arrival: "2026-09-06T21:05:00+05:30", delay_arrival_minutes: 5, actual_departure: "2026-09-06T21:12:00+05:30", has_arrived: true, has_departed: true, is_stopping: true },
            { station_code: "XYZ", station_name: "Pass-thru", is_stopping: false, has_arrived: true, has_departed: true },
            { station_code: "DBRG", station_name: "Dibrugarh", scheduled_arrival: "2026-09-08T06:20:00+05:30", actual_arrival: "2026-09-08T09:00:00+05:30", delay_arrival_minutes: 160, has_arrived: true, has_departed: false, is_stopping: true },
          ],
        },
      });
    });
    const h = await routedTrainHistory("12424", "2026-09-06");
    expect(h?.provider).toBe("railcore");
    expect(h?.runState).toBe("completed");
    expect(h?.stops.map((s) => s.code)).toEqual(["NDLS", "CNB", "DBRG"]);
    expect(h?.stops[2].arrival).toBe("09:00 (08/09)");
    expect(h?.stops[2].delay).toBe(160);
  });

  it("RailCore bhi down → RailRadar route[] (halts, departed = done; upcoming = pending)", async () => {
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    process.env.RAILRADAR_API_KEY = "rg_test";
    setRailradarFetch(async () =>
      jsonResponse(200, {
        success: true,
        data: {
          trainNumber: "12424", trainName: "Rajdhani", startDate: "2026-09-07", status: "running",
          route: [
            { stationCode: "NDLS", stationName: "New Delhi", isHalt: true, status: "departed", scheduledDeparture: "2026-09-07T16:20:00+05:30", actualDeparture: "2026-09-07T16:23:00+05:30", delayDeparture: 3 },
            { stationCode: "CNB", stationName: "Kanpur", isHalt: true, status: "departed", scheduledArrival: "2026-09-07T21:00:00+05:30", actualArrival: "2026-09-07T20:52:00+05:30", delayArrival: 0 },
            { stationCode: "DBRG", stationName: "Dibrugarh", isHalt: true, status: "upcoming", scheduledArrival: "2026-09-09T06:20:00+05:30", actualArrival: "2026-09-09T06:42:00+05:30", delayArrival: 22 },
          ],
        },
      }),
    );
    try {
      const h = await routedTrainHistory("12424", "2026-09-07");
      expect(h?.provider).toBe("railradar");
      expect(h?.runState).toBe("running");
      expect(h?.stops.filter((s) => s.done).map((s) => s.code)).toEqual(["NDLS", "CNB"]);
      expect(h?.stops[2].done).toBe(false);
      expect(h?.stops[2].arrival).toBeNull(); // upcoming — projected time ko actual mat dikhao
    } finally {
      setRailradarFetch(null);
      process.env.RAILRADAR_API_KEY = "";
    }
  });

  it("/api/history endpoint ab sirf RailKit par depend nahi — RailCore se 200", async () => {
    setRailcoreFetch(async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.includes("/live")) return jsonResponse(500, { success: false });
      return jsonResponse(200, { success: true, data: { train_number: "12014", train_name: "Shatabdi", journey_date: "2026-09-08", status: "COMPLETED", status_text: "Journey completed", stations: [{ station_code: "ASR", station_name: "Amritsar", actual_departure: "2026-09-08T05:00:00+05:30", has_departed: true, is_stopping: true }, { station_code: "NDLS", station_name: "New Delhi", actual_arrival: "2026-09-08T11:10:00+05:30", delay_arrival_minutes: -4, has_arrived: true, is_stopping: true }] } });
    });
    const app = createApp();
    const res = await request(app).get("/api/history?number=12014&date=2026-09-08");
    expect(res.status).toBe(200);
    expect(res.body.history.stops).toHaveLength(2);
    expect(res.body.history.runState).toBe("completed");
  });

  it("sab provider down → 404 (invent nahi)", async () => {
    setRailcoreFetch(async () => jsonResponse(500, { success: false }));
    const app = createApp();
    const res = await request(app).get("/api/history?number=12014&date=2026-09-08");
    expect(res.status).toBe(404);
  });
});
