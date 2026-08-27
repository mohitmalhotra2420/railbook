import { describe, expect, it } from "vitest";
import {
  bookingReducer,
  initialBooking,
  persist,
  restore,
} from "../src/booking/state";
import type { TrainResult } from "../src/types";

const train: TrainResult = {
  number: "12014",
  name: "Amritsar Shatabdi",
  type: "Shatabdi",
  from: { code: "ASR", name: "Amritsar Junction", city: "Amritsar" },
  to: { code: "NDLS", name: "New Delhi", city: "Delhi" },
  date: "2026-08-20",
  departure: "07:20",
  arrival: "13:25",
  arrivalDayOffset: 0,
  durationMinutes: 365,
  durationLabel: "6h 05m",
  runsOn: [0, 1, 2, 3, 4, 5, 6],
  classes: [
    { code: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 1250, seats: 20 },
  ],
};

describe("refresh during booking", () => {
  it("restores the in-progress booking from session storage", () => {
    let s = initialBooking("2026-08-20");
    s = {
      ...s,
      from: train.from,
      to: train.to,
    };
    s = bookingReducer(s, { type: "SELECT_TRAIN", train });
    persist(s);
    const again = restore("2026-08-20");
    expect(again?.selectedTrain?.number).toBe("12014");
    expect(again?.screen).toBe("class");
    expect(again?.flow).toBe("TRAIN_SELECTED");
  });
});
