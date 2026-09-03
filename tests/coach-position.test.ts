import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { coachPosition, resetRailcoreBookings, setRailcoreFetch } from "../server/railway/railcore";
import { routedCoachPosition } from "../server/railway/router";
import { setProvider } from "../server/providers/index";

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

const REAL_SHAPE = {
  success: true,
  data: {
    train_number: "12014",
    coach_position: [
      { sequence: 3, coach_name: "E1", class_code: "EC", position_from_engine: 3 },
      { sequence: 2, coach_name: "E2", class_code: "EC", position_from_engine: 2 },
      { sequence: 4, coach_name: "C14", class_code: "CC", position_from_engine: 4 },
      { sequence: 5, coach_name: "C13", class_code: "CC", position_from_engine: 5 },
    ],
  },
  meta: { api_version: "v1" },
};

describe("RailCore coach position", () => {
  it("adapter parses the payload, sorts engine-first, drops junk rows", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async (input) => {
      const url = String(input);
      expect(url).toContain("https://ir.railcore.tech/v1/trains/12014/coach-position");
      expect(url).toContain("stationCode=LDH");
      return jsonResponse(200, REAL_SHAPE);
    });
    const out = await coachPosition("12014", "LDH");
    expect(out).not.toBeNull();
    expect(out?.trainNumber).toBe("12014");
    expect(out?.stationCode).toBe("LDH");
    expect(out?.coaches.map((c) => c.name)).toEqual(["E2", "E1", "C14", "C13"]);
    expect(out?.coaches[0]).toMatchObject({ classCode: "EC", positionFromEngine: 2, sequence: 2 });
  });

  it("adapter returns null on HTTP failure or empty composition (never invents)", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async () => jsonResponse(200, { success: true, data: { train_number: "1", coach_position: [] } }));
    expect(await coachPosition("1")).toBeNull();
    setRailcoreFetch(async () => jsonResponse(500, { success: false, error: { message: "boom" } }));
    expect(await coachPosition("12014")).toBeNull();
  });

  it("API endpoint serves coach position with provider identity and no key leak", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async () => jsonResponse(200, REAL_SHAPE));
    const app = createApp();
    // Flat route — Vercel serverless only routes 1-segment /api/* paths.
    const res = await request(app).get("/api/coach-position").query({ number: "12014", station: "LDH" });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("railcore");
    expect(res.body.coachPosition.trainNumber).toBe("12014");
    expect(res.body.coachPosition.coaches).toHaveLength(4);
    expect(JSON.stringify(res.body)).not.toMatch(/rk_live_test_secret|RAILCORE_API_KEY/i);
  });

  it("flat route rejects an invalid train number", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    const app = createApp();
    const res = await request(app).get("/api/coach-position").query({ number: "12AB" });
    expect(res.status).toBe(400);
  });

  it("deep route (local dev) serves the same payload", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async () => jsonResponse(200, REAL_SHAPE));
    const app = createApp();
    const res = await request(app).get("/api/trains/12014/coach-position").query({ station: "LDH" });
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("railcore");
  });

  it("API endpoint answers 404 honestly when provider has no composition", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async () => jsonResponse(404, { success: false, error: { message: "no data" } }));
    const app = createApp();
    const res = await request(app).get("/api/trains/99999/coach-position").query({ station: "LDH" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/coach position/i);
    expect(JSON.stringify(res.body)).not.toMatch(/rk_live_test_secret/i);
  });

  it("endpoint rejects malformed station codes instead of forwarding them", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    let seenStation = "";
    setRailcoreFetch(async (input) => {
      seenStation = new URL(String(input)).searchParams.get("stationCode") ?? "";
      return jsonResponse(200, REAL_SHAPE);
    });
    const app = createApp();
    await request(app).get("/api/trains/12014/coach-position").query({ station: "LDH; DROP" });
    expect(seenStation).toBe("");
  });

  it("router stays honestly 'none' without a RailCore key", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "";
    setRailcoreFetch(async () => {
      throw new Error("network must not be touched without a key");
    });
    const routed = await routedCoachPosition("12014", "LDH");
    expect(routed.coachPosition).toBeNull();
    expect(routed.provider).toBe("none");
  });
});
