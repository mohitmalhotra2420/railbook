import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";

describe("mock booking is disabled (no money, no mock PNR)", () => {
  const app = createApp();
  const body = {
    trainNumber: "12014",
    date: "2026-10-11",
    from: "ASR",
    to: "NDLS",
    classCode: "CC",
    seatPreference: "No Preference",
    passengers: [{ name: "Test Passenger", age: 30, gender: "MALE" }],
  };

  it("POST /api/bookings returns 410 and creates nothing", async () => {
    const res = await request(app).post("/api/bookings").send(body);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("MOCK_BOOKING_DISABLED");
    expect(res.body.booking).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/MOCK[A-Z0-9]{4,}/);
  });

  it("POST /api/bookings/:id/confirm returns 410 and does not debit", async () => {
    const before = await request(app).get("/api/wallet");
    const res = await request(app).post("/api/bookings/RB-anything/confirm").send({});
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("MOCK_BOOKING_DISABLED");
    const after = await request(app).get("/api/wallet");
    expect(after.body).toEqual(before.body);
  });

  it("no hidden legacy booking path is reachable", async () => {
    for (const p of ["/api/bookings/_disabled_legacy", "/api/bookings/x/confirm_legacy_unused"]) {
      const res = await request(app).post(p).send(body);
      expect(res.status).toBe(404);
    }
  });
});
