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

  it("re-confirming the same booking id never debits twice (idempotent, same PNR, provider called once)", async () => {
    const provider = new CountingMockProvider(false);
    setProvider(provider);
    resetWallet();
    getWallet().balance = 10000; // spec scenario: wallet ₹10,000

    const created = await request(app).post("/api/bookings").send(await bookablePreferred());
    expect(created.status).toBe(201);
    const id = created.body.booking.id as string;
    const fare = created.body.booking.fare.total as number;
    expect(fare).toBeGreaterThan(0);
    const debitsFor = (w: { transactions: { type: string; note: string }[] }) =>
      w.transactions.filter((t) => t.type === "DEBIT" && t.note === `Booking ${id}`).length;

    const first = await request(app).post(`/api/bookings/${id}/confirm`);
    expect(first.status).toBe(200);
    expect(first.body.booking.status).toBe("CONFIRMED");
    expect(first.body.booking.pnr).toMatch(/^MOCK/);
    expect(first.body.wallet.balance).toBe(10000 - fare);
    expect(debitsFor(first.body.wallet)).toBe(1);
    const pnr = first.body.booking.pnr as string;

    const second = await request(app).post(`/api/bookings/${id}/confirm`);
    expect(second.status).toBe(200);
    expect(second.body.booking.id).toBe(id);
    expect(second.body.booking.pnr).toBe(pnr);
    expect(second.body.wallet.balance).toBe(10000 - fare);

    const third = await request(app).post(`/api/bookings/${id}/confirm`);
    expect(third.status).toBe(200);
    expect(third.body.booking.pnr).toBe(pnr);

    const finalWallet = (await request(app).get("/api/wallet")).body.wallet;
    expect(finalWallet.balance).toBe(10000 - fare);
    expect(debitsFor(finalWallet)).toBe(1);
    expect(provider.confirmCalls).toBe(1);
  });

  it("10 concurrent confirms: exactly one confirmation, baaki 409 CONFIRM_IN_PROGRESS, koi double debit nahi", async () => {
    const STORM = 10;
    const provider = new OverlapRaceMockProvider(STORM);
    setProvider(provider);
    resetWallet();
    getWallet().balance = 10000; // spec scenario: wallet ₹10,000

    const created = await request(app).post("/api/bookings").send(await bookablePreferred());
    expect(created.status).toBe(201);
    const id = created.body.booking.id as string;
    const fare = created.body.booking.fare.total as number;

    /* Real HTTP server + server-side in-flight counter: sirf Promise.all scheduling nahi,
     * balki actual concurrent requests measure hote hain. */
    const server = http.createServer(app);
    let inFlight = 0;
    let maxInFlight = 0;
    server.on("request", (_req, res) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          inFlight -= 1;
        }
      };
      res.once("finish", done);
      res.once("close", done);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    let responses: { status: number; body: ConfirmJson; ms: number }[] = [];
    try {
      responses = await Promise.all(Array.from({ length: STORM }, () => rawPostConfirm(port, id)));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    /* Asli overlap ka proof: saari 10 requests ek waqt me server par thi aur sab ne booking
     * ko ek saath DRAFT dekha (barrier). */
    expect(maxInFlight).toBeGreaterThanOrEqual(STORM);
    expect(provider.peakGetBookingWaiters).toBeGreaterThanOrEqual(STORM);

    const ok = responses.filter((r) => r.status === 200);
    const busy = responses.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(busy).toHaveLength(STORM - 1);
    for (const r of busy) {
      expect(r.body.code).toBe("CONFIRM_IN_PROGRESS");
      expect(String(r.body.error)).toContain("already in progress");
    }

    /* Sirf ek confirmation hua — provider bhi ek hi baar chala. */
    expect(provider.confirmCalls).toBe(1);
    expect(provider.maxConcurrentConfirm).toBe(1);
    expect(ok[0].body.booking?.status).toBe("CONFIRMED");
    const pnr = ok[0].body.booking?.pnr as string;
    expect(pnr).toMatch(/^MOCK/);
    expect(ok[0].body.wallet?.balance).toBe(10000 - fare);

    /* Poore storm me exactly ek hi PNR dikha (koi duplicate booking/PNR nahi). */
    const pnrs = new Set(
      responses.map((r) => r.body.booking?.pnr).filter((p): p is string => Boolean(p)),
    );
    expect(pnrs.size).toBe(1);
    expect([...pnrs][0]).toBe(pnr);

    const finalWallet = (await request(app).get("/api/wallet")).body.wallet;
    expect(finalWallet.balance).toBe(10000 - fare);
    const debits = finalWallet.transactions.filter((t) => t.type === "DEBIT");
    expect(debits).toHaveLength(1);
    expect(debits[0].amount).toBe(fare);
    expect(debits[0].note).toBe(`Booking ${id}`);
    expect(
      finalWallet.transactions.filter((t) => t.type === "CREDIT" && t.note.includes("Refund")),
    ).toHaveLength(0);

    const record = await request(app).get(`/api/bookings/${id}`);
    expect(record.body.booking.status).toBe("CONFIRMED");
    expect(record.body.booking.pnr).toBe(pnr);

    /* Race ke BAAD naya sequential confirm: idempotent 200, wahi PNR, koi naya debit /
     * provider call nahi. */
    const after = await request(app).post(`/api/bookings/${id}/confirm`);
    expect(after.status).toBe(200);
    expect(after.body.booking.pnr).toBe(pnr);
    expect(after.body.wallet.balance).toBe(10000 - fare);
    expect(provider.confirmCalls).toBe(1);
    const walletEnd = (await request(app).get("/api/wallet")).body.wallet;
    expect(walletEnd.transactions.filter((t) => t.type === "DEBIT")).toHaveLength(1);
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
