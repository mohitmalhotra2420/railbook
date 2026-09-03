import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { resetMockBookings } from "../server/providers/mock";
import { resetWallet } from "../server/wallet";
import { setProvider } from "../server/providers/index";
import { MockRailwayProvider } from "../server/providers/mock";

const app = createApp();
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

async function bookable() {
  const res = await request(app).get("/api/trains").query({
    from: "ASR",
    to: "NDLS",
    date: FUTURE,
  });
  for (const t of res.body.trains) {
    const c = t.classes.find((x: { status: string }) =>
      ["AVAILABLE", "RAC", "WAITLIST"].includes(x.status),
    );
    if (c) {
      return {
        trainNumber: t.number as string,
        date: FUTURE,
        from: "ASR",
        to: "NDLS",
        classCode: c.code as string,
        seatPreference: ["CC", "EC", "2S", "EA"].includes(c.code) ? "Window" : "Lower",
        passengers: [
          {
            name: "Asha Kaur",
            age: 28,
            gender: "FEMALE",
            berthPreference: ["CC", "EC", "2S", "EA"].includes(c.code) ? "Window" : "Lower",
          },
        ],
      };
    }
  }
  throw new Error("No bookable mock train");
}

describe("HTTP API", () => {
  beforeEach(() => {
    resetMockBookings();
    resetWallet();
    setProvider(new MockRailwayProvider(false));
  });

  it("searches trains", async () => {
    const res = await request(app).get("/api/trains").query({
      from: "LDH",
      to: "NDLS",
      date: FUTURE,
    });
    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBeGreaterThan(0);
    expect(res.body.empty).toBe(false);
  });

  it("returns a clean empty payload when no trains run", async () => {
    const res = await request(app).get("/api/trains").query({
      from: "LDH",
      to: "TVC",
      date: FUTURE,
    });
    expect(res.status).toBe(200);
    expect(res.body.trains).toEqual([]);
    expect(res.body.empty).toBe(true);
  });

  it("rejects past dates", async () => {
    const res = await request(app).get("/api/trains").query({
      from: "ASR",
      to: "NDLS",
      date: "2020-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("blocks confirmation when the wallet is short", async () => {
    resetWallet();
    const { addMoney, getWallet } = await import("../server/wallet");
    // drain wallet
    const w = getWallet();
    w.balance = 10;

    const created = await request(app).post("/api/bookings").send(await bookable());
    expect(created.status).toBe(201);

    const confirm = await request(app).post(`/api/bookings/${created.body.booking.id}/confirm`);
    expect(confirm.status).toBe(402);
    expect(confirm.body.code).toBe("INSUFFICIENT_FUNDS");

    addMoney(5000);
    const ok = await request(app).post(`/api/bookings/${created.body.booking.id}/confirm`);
    expect(ok.status).toBe(200);
    expect(ok.body.booking.status).toBe("CONFIRMED");
    expect(ok.body.booking.pnr).toMatch(/^MOCK/);
  });

  it("does not confirm when the mock provider fails, and refunds the wallet", async () => {
    setProvider(new MockRailwayProvider(true));
    const created = await request(app).post("/api/bookings").send(await bookable());
    const before = await request(app).get("/api/wallet");
    const confirm = await request(app).post(`/api/bookings/${created.body.booking.id}/confirm`);
    expect(confirm.body.booking.status).toBe("FAILED");
    expect(confirm.body.booking.pnr).toBeNull();
    const after = await request(app).get("/api/wallet");
    expect(after.body.wallet.balance).toBe(before.body.wallet.balance);
  });

  it("retrieves a booking by mock PNR", async () => {
    const created = await request(app).post("/api/bookings").send(await bookable());
    const confirmed = await request(app).post(
      `/api/bookings/${created.body.booking.id}/confirm`,
    );
    const pnr = confirmed.body.booking.pnr;
    const found = await request(app).get(`/api/bookings/${pnr}`);
    expect(found.status).toBe(200);
    expect(found.body.booking.id).toBe(created.body.booking.id);
  });

  it("rejects invalid passenger payloads", async () => {
    const res = await request(app).post("/api/bookings").send({
      trainNumber: "12014",
      date: FUTURE,
      from: "ASR",
      to: "NDLS",
      classCode: "CC",
      seatPreference: "Window",
      passengers: [{ name: "1", age: 0, gender: "MALE", berthPreference: "Window" }],
    });
    expect(res.status).toBe(400);
  });

  it("does not expose provider secrets on meta", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.body.provider.id).toBe("mock");
    expect(JSON.stringify(res.body)).not.toMatch(/API_KEY|SECRET|password/i);
  });
});
