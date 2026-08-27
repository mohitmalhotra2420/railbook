import { beforeEach, describe, expect, it } from "vitest";
import { MockRailwayProvider, resetMockBookings } from "../server/providers/mock";
import { recommend } from "../server/recommend";
import { isBookable } from "../server/providers/types";

describe("mock railway provider", () => {
  const p = new MockRailwayProvider(false);

  beforeEach(() => {
    resetMockBookings();
    p.forceFail = false;
  });

  it("searches a valid Punjab–Delhi route", async () => {
    const trains = await p.searchTrains({ from: "ASR", to: "NDLS", date: "2026-08-20" });
    expect(trains.length).toBeGreaterThan(0);
    expect(trains.every((t) => t.from.code === "ASR" && t.to.code === "NDLS")).toBe(true);
    expect(trains.every((t) => t.date === "2026-08-20")).toBe(true);
    const shatabdi = trains.find((t) => t.number === "12014");
    expect(shatabdi?.name).toMatch(/Shatabdi/i);
    expect(shatabdi?.classes.some((c) => c.code === "CC")).toBe(true);
  });

  it("returns no trains for a route that is not served", async () => {
    const trains = await p.searchTrains({ from: "LDH", to: "TVC", date: "2026-08-20" });
    expect(trains).toEqual([]);
  });

  it("does not invent trains on a day the service does not run", async () => {
    // 12032 is not scheduled on Sunday.
    const sunday = await p.searchTrains({ from: "ASR", to: "NDLS", date: "2026-08-23" });
    expect(sunday.some((t) => t.number === "12032")).toBe(false);
    const monday = await p.searchTrains({ from: "ASR", to: "NDLS", date: "2026-08-24" });
    expect(monday.some((t) => t.number === "12032")).toBe(true);
  });

  it("availability is deterministic per train/date/class and can be NOT_AVAILABLE", async () => {
    const a = await p.getAvailability("12014", "2026-08-20", "ASR", "NDLS", "CC");
    const b = await p.getAvailability("12014", "2026-08-20", "ASR", "NDLS", "CC");
    expect(a).toEqual(b);
    expect(["AVAILABLE", "RAC", "WAITLIST", "NOT_AVAILABLE", "UNKNOWN"]).toContain(a.status);
  });

  it("recommendations use only bookable result data", async () => {
    const trains = await p.searchTrains({ from: "ASR", to: "NDLS", date: "2026-08-20" });
    const recs = recommend(trains);
    for (const rec of recs) {
      const t = trains.find((x) => x.number === rec.trainNumber);
      expect(t).toBeTruthy();
      expect(t!.classes.some((c) => isBookable(c.status))).toBe(true);
    }
    expect(recs.some((r) => r.kind === "best")).toBe(true);
  });

  async function bookablePayload() {
    const trains = await p.searchTrains({ from: "ASR", to: "NDLS", date: "2026-08-24" });
    for (const t of trains) {
      const c = t.classes.find((x) => isBookable(x.status));
      if (c) {
        const seat = ["CC", "EC", "2S", "EA"].includes(c.code) ? "Window" : "Lower";
        return {
          trainNumber: t.number,
          date: "2026-08-24",
          from: "ASR",
          to: "NDLS",
          classCode: c.code,
          seatPreference: seat,
          passengers: [{ name: "Asha Kaur", age: 28, gender: "FEMALE" as const, berthPreference: seat }],
        };
      }
    }
    throw new Error("No bookable mock train");
  }

  it("creates and confirms a mock booking with a mock PNR", async () => {
    const draft = await p.createBooking(await bookablePayload());
    expect(draft.mock).toBe(true);
    expect(draft.pnr).toBeNull();
    expect(draft.status).toBe("DRAFT");

    const done = await p.confirmBooking(draft.id);
    expect(done.status).toBe("CONFIRMED");
    expect(done.pnr?.startsWith("MOCK")).toBe(true);
    const fetched = await p.getBooking(done.pnr!);
    expect(fetched?.id).toBe(draft.id);
  });

  it("failed booking never issues a PNR", async () => {
    p.forceFail = true;
    const draft = await p.createBooking(await bookablePayload());
    const done = await p.confirmBooking(draft.id);
    expect(done.status).toBe("FAILED");
    expect(done.pnr).toBeNull();
  });

  it("rejects booking an unavailable class", async () => {
    const trains = await p.searchTrains({ from: "ASR", to: "NDLS", date: "2026-08-20" });
    const blocked = trains
      .flatMap((t) => t.classes.map((c) => ({ t, c })))
      .find((x) => x.c.status === "NOT_AVAILABLE");
    if (!blocked) return;
    await expect(
      p.createBooking({
        trainNumber: blocked.t.number,
        date: "2026-08-20",
        from: "ASR",
        to: "NDLS",
        classCode: blocked.c.code,
        seatPreference: "Window",
        passengers: [{ name: "Asha Kaur", age: 28, gender: "FEMALE", berthPreference: "Window" }],
      }),
    ).rejects.toThrow(/no longer available/i);
  });
});
