import { describe, expect, it } from "vitest";
import { needsSeatRefresh, nextSeatBatch, seatListKey } from "../src/views/TrainBoard";
import type { TrainResult } from "../src/types";

const base: TrainResult = {
  number: "12014",
  name: "Amritsar Shatabdi",
  type: "Shatabdi",
  from: { code: "ASR", name: "Amritsar", city: "Amritsar" },
  to: { code: "LDH", name: "Ludhiana", city: "Ludhiana" },
  date: "2026-08-24",
  departure: "04:55",
  arrival: "06:57",
  arrivalDayOffset: 0,
  durationMinutes: 122,
  durationLabel: "2h 02m",
  runsOn: [0, 1, 2, 3, 4, 5, 6],
  classes: [],
};

describe("train list seat refresh", () => {
  it("needs refresh when class list is empty", () => {
    expect(needsSeatRefresh(base)).toBe(true);
  });

  it("needs refresh when search only returned UNKNOWN stubs", () => {
    expect(
      needsSeatRefresh({
        ...base,
        classes: [{ code: "CC", label: "AC Chair Car", status: "UNKNOWN", fare: 0 }],
      }),
    ).toBe(true);
  });

  it("does not refresh after real availability arrived", () => {
    expect(
      needsSeatRefresh({
        ...base,
        classes: [{ code: "CC", label: "AC Chair Car", status: "WAITLIST", fare: 510, waitlist: 12 }],
      }),
    ).toBe(false);
  });

  it("needs refresh when fare is missing on AVAILABLE stub", () => {
    expect(
      needsSeatRefresh({
        ...base,
        classes: [{ code: "SL", label: "Sleeper", status: "AVAILABLE", fare: 0 }],
      }),
    ).toBe(true);
  });

  it("keeps pumping trains after the first batch is in-flight or done", () => {
    const list = Array.from({ length: 12 }, (_, i) => ({
      ...base,
      number: String(12000 + i),
      classes: [{ code: "SL" as const, label: "Sleeper", status: "UNKNOWN" as const, fare: 0 }],
    }));
    const first = nextSeatBatch(list, [], 5);
    expect(first.map((t) => t.number)).toEqual(["12000", "12001", "12002", "12003", "12004"]);
    const second = nextSeatBatch(list, first.map((t) => t.number), 5);
    expect(second.map((t) => t.number)).toEqual(["12005", "12006", "12007", "12008", "12009"]);
    const afterFetch = list.map((t, i) =>
      i < 5
        ? { ...t, classes: [{ code: "SL" as const, label: "Sleeper", status: "WAITLIST" as const, fare: 400, waitlist: 2 }] }
        : t,
    );
    const rest = nextSeatBatch(afterFetch, [], 8, first.map((t) => t.number));
    expect(rest).toHaveLength(7);
    expect(rest[0].number).toBe("12005");
    expect(seatListKey("2026-08-24", "GN", list)).toBe(seatListKey("2026-08-24", "GN", afterFetch));
  });
});
