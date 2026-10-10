import http from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { resetMockBookings } from "../server/providers/mock";
import { getWallet, resetWallet } from "../server/wallet";
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

/** Deterministic booking (12014 CC prefer, warna pehli bookable class) — race test ke liye. */
async function bookablePreferred() {
  const seatFor = (code: string) => (["CC", "EC", "2S", "EA"].includes(code) ? "Window" : "Lower");
  let fallback: { date: string; trainNumber: string; classCode: string } | null = null;
  for (const days of [30, 1, 2, 4, 9, 16]) {
    const date = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const res = await request(app).get("/api/trains").query({ from: "ASR", to: "NDLS", date });
    if (res.status !== 200) continue;
    for (const t of res.body.trains as { number: string; classes: { code: string; status: string }[] }[]) {
      const pick = (code: string) =>
        t.classes.find((x) => x.code === code && ["AVAILABLE", "RAC", "WAITLIST"].includes(x.status));
      if (t.number === "12014" && pick("CC")) return build(date, "12014", "CC");
      if (!fallback) {
        const any = t.classes.find((x) => ["AVAILABLE", "RAC", "WAITLIST"].includes(x.status));
        if (any) fallback = { date, trainNumber: t.number, classCode: any.code };
      }
    }
  }
  if (fallback) return build(fallback.date, fallback.trainNumber, fallback.classCode);
  throw new Error("No bookable mock train");

  function build(date: string, trainNumber: string, classCode: string) {
    const seat = seatFor(classCode);
    return {
      trainNumber,
      date,
      from: "ASR",
      to: "NDLS",
      classCode,
      seatPreference: seat,
      passengers: [{ name: "Asha Kaur", age: 28, gender: "FEMALE", berthPreference: seat }],
    };
  }
}

/** confirmBooking call-counting wrapper — duplicate-confirm / race regression ke liye. */
class CountingMockProvider extends MockRailwayProvider {
  confirmCalls = 0;
  async confirmBooking(id: string) {
    this.confirmCalls += 1;
    return super.confirmBooking(id);
  }
}

interface ConfirmJson {
  booking?: { id: string; status: string; pnr: string | null };
  wallet?: {
    balance: number;
    transactions: { type: string; amount: number; note: string }[];
  };
  code?: string;
  error?: string;
}

/**
 * Concurrency harness — latency sirf TEST me hai (production code untouched):
 * - `getBooking` ek shared barrier par rukta hai jab tak saari requests wahan na pahunche
 *   => deterministic asli overlap (Promise.all ke scheduling timing par bharosa nahi).
 * - `confirmBooking` me 80ms latency => winner apna claim itni der hold karta hai ki baaki
 *   concurrent requests usi window me claim try karti hain.
 */
class OverlapRaceMockProvider extends CountingMockProvider {
  peakGetBookingWaiters = 0;
  concurrentConfirm = 0;
  maxConcurrentConfirm = 0;
  private waiters = 0;
  private readonly gate: Promise<void>;
  private release!: () => void;

  constructor(private readonly expected: number) {
    super(false);
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    setTimeout(() => this.release(), 3000); // safety: barrier kabhi hang na kare
  }

  async getBooking(id: string) {
    this.waiters += 1;
    this.peakGetBookingWaiters = Math.max(this.peakGetBookingWaiters, this.waiters);
    if (this.waiters >= this.expected) this.release();
    await this.gate; // TEST-ONLY barrier (koi production delay nahi)
    return super.getBooking(id);
  }

  async confirmBooking(id: string) {
    this.concurrentConfirm += 1;
    this.maxConcurrentConfirm = Math.max(this.maxConcurrentConfirm, this.concurrentConfirm);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80)); // TEST-ONLY provider latency
      return await super.confirmBooking(id);
    } finally {
      this.concurrentConfirm -= 1;
    }
  }
}

/** Real HTTP, per-request socket (agent: false) — supertest ke single agent se alag. */
function rawPostConfirm(
  port: number,
  id: string,
): Promise<{ status: number; body: ConfirmJson; ms: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: `/api/bookings/${id}/confirm`,
        agent: false,
        headers: { "content-type": "application/json", "content-length": "0" },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let body: ConfirmJson;
          try {
            body = JSON.parse(raw) as ConfirmJson;
          } catch {
            body = { error: raw };
          }
          resolve({ status: res.statusCode ?? 0, body, ms: Date.now() - started });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
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

  /* MOCK BOOKING DISABLED: the old wallet/idempotency/concurrency flow is intentionally gone.
   * These assert the new contract: no booking, no PNR, no wallet movement, on any input. */
  it("mock booking create returns 410 and never issues a PNR or touches the wallet", async () => {
    const app = createApp();
    const before = await request(app).get("/api/wallet");
    const res = await request(app).post("/api/bookings").send({
      trainNumber: "12014",
      date: "2026-10-11",
      from: "ASR",
      to: "NDLS",
      classCode: "CC",
      seatPreference: "No Preference",
      passengers: [{ name: "Test Passenger", age: 30, gender: "MALE" }],
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("MOCK_BOOKING_DISABLED");
    expect(JSON.stringify(res.body)).not.toMatch(/MOCK[A-Z0-9]{4,}/);
    expect((await request(app).get("/api/wallet")).body).toEqual(before.body);
  });

  it("confirm returns 410 for any id (even repeated or concurrent) and never debits", async () => {
    const app = createApp();
    const before = await request(app).get("/api/wallet");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post("/api/bookings/RB-x/confirm").send({})),
    );
    expect(results.every((r) => r.status === 410)).toBe(true);
    expect((await request(app).get("/api/wallet")).body).toEqual(before.body);
  });

  it("booking list stays readable (no new bookings created)", async () => {
    const app = createApp();
    const res = await request(app).get("/api/bookings");
    expect(res.status).toBe(200);
  });

  it("does not expose provider secrets on meta", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.body.provider.id).toBe("mock");
    expect(JSON.stringify(res.body)).not.toMatch(/API_KEY|SECRET|password/i);
  });
});
