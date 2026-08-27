import { describe, expect, it } from "vitest";
import {
  DATE_CHANGE_NOTICE,
  SEAT_RESELECT_NOTICE,
  UNAVAILABLE_NOTICE,
  blankPassenger,
  bookingReducer,
  initialBooking,
  validatePassengers,
} from "../src/booking/state";
import type { ClassAvailability, TrainResult } from "../src/types";

const station = (code: string) => ({ code, name: code, city: code });

function train(number: string, date = "2026-08-20"): TrainResult {
  return {
    number,
    name: "Test Express",
    type: "Express",
    from: station("ASR"),
    to: station("NDLS"),
    date,
    departure: "07:20",
    arrival: "13:25",
    arrivalDayOffset: 0,
    durationMinutes: 365,
    durationLabel: "6h 05m",
    runsOn: [0, 1, 2, 3, 4, 5, 6],
    classes: [
      klass("CC", "AVAILABLE", 1250),
      klass("EC", "NOT_AVAILABLE", 2150),
    ],
  };
}

function klass(
  code: "CC" | "EC" | "SL",
  status: ClassAvailability["status"],
  fare: number,
): ClassAvailability {
  return {
    code,
    label: code,
    status,
    fare,
    seats: status === "AVAILABLE" ? 12 : undefined,
  };
}

describe("booking state machine", () => {
  it("starts in SEARCHING on the home screen", () => {
    const s = initialBooking("2026-08-20");
    expect(s.flow).toBe("SEARCHING");
    expect(s.screen).toBe("home");
  });

  it("search valid route stores results and clears prior train", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12014") });
    s = bookingReducer(s, { type: "SEARCH_START" });
    expect(s.selectedTrain).toBeNull();
    s = bookingReducer(s, {
      type: "SEARCH_SUCCESS",
      trains: [train("12014"), train("12498")],
      recommendations: [
        { trainNumber: "12014", kind: "best", label: "Best for you", reason: "Fastest" },
      ],
    });
    expect(s.flow).toBe("RESULTS_FOUND");
    expect(s.trains).toHaveLength(2);
    expect(s.selectedTrain).toBeNull();
    expect(s.selectedClass).toBeNull();
  });

  it("search with no trains shows empty state and no train cards", () => {
    let s = initialBooking("2026-08-22");
    s = bookingReducer(s, { type: "SEARCH_EMPTY", date: "22 Aug" });
    expect(s.trains).toHaveLength(0);
    expect(s.selectedTrain).toBeNull();
    expect(s.emptyMessage).toContain("No trains available for 22 Aug");
  });

  it("date change clears train, class, seat and asks to reselect", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, {
      type: "SEARCH_SUCCESS",
      trains: [train("12014")],
      recommendations: [],
    });
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12014") });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: klass("CC", "AVAILABLE", 1250) });
    s = bookingReducer(s, { type: "SELECT_SEAT", seat: "Window" });
    expect(s.selectedTrain?.number).toBe("12014");
    expect(s.selectedClass?.code).toBe("CC");
    expect(s.seatPreference).toBe("Window");

    s = bookingReducer(s, { type: "SET_DATE", date: "2026-08-22" });
    expect(s.date).toBe("2026-08-22");
    expect(s.selectedTrain).toBeNull();
    expect(s.selectedClass).toBeNull();
    expect(s.seatPreference).toBe("");
    expect(s.trains).toHaveLength(0);
    expect(s.previewFare).toBeNull();
    expect(s.notice).toBe(DATE_CHANGE_NOTICE);
    expect(s.flow).toBe("SEARCHING");
  });

  it("changing train after class selection clears class and seat", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12014") });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: klass("CC", "AVAILABLE", 1250) });
    s = bookingReducer(s, { type: "SELECT_SEAT", seat: "Window" });
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12498") });
    expect(s.selectedTrain?.number).toBe("12498");
    expect(s.selectedClass).toBeNull();
    expect(s.seatPreference).toBe("");
    expect(s.notice).toBe(DATE_CHANGE_NOTICE);
    expect(s.flow).toBe("TRAIN_SELECTED");
  });

  it("changing class after a seat was chosen asks to reselect seat", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12014") });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: klass("CC", "AVAILABLE", 1250) });
    s = bookingReducer(s, { type: "SELECT_SEAT", seat: "Window" });
    s = bookingReducer(s, {
      type: "SET_PASSENGERS",
      passengers: [{ ...blankPassenger(), name: "Asha", age: "28", gender: "FEMALE", berthPreference: "Window" }],
    });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: klass("SL", "AVAILABLE", 455) });
    expect(s.selectedClass?.code).toBe("SL");
    expect(s.seatPreference).toBe("");
    expect(s.passengers[0].berthPreference).toBe("");
    expect(s.notice).toBe(SEAT_RESELECT_NOTICE);
    expect(s.screen).toBe("seat");
  });

  it("board class tap skips the extra class page and goes to seat", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, {
      type: "SEARCH_SUCCESS",
      trains: [train("12014")],
      recommendations: [],
    });
    expect(s.screen).toBe("results");
    s = bookingReducer(s, {
      type: "SELECT_TRAIN_AND_CLASS",
      train: train("12014"),
      klass: klass("CC", "AVAILABLE", 1250),
    });
    expect(s.selectedTrain?.number).toBe("12014");
    expect(s.selectedClass?.code).toBe("CC");
    expect(s.screen).toBe("seat");
    expect(s.flow).toBe("CLASS_SELECTED");
  });

  it("refuses unavailable classes", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12014") });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: klass("EC", "NOT_AVAILABLE", 2150) });
    expect(s.selectedClass).toBeNull();
    expect(s.error).toBe(UNAVAILABLE_NOTICE);
  });

  it("UNAVAILABLE returns the user to class selection", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12014") });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: klass("CC", "AVAILABLE", 1250) });
    s = bookingReducer(s, { type: "UNAVAILABLE" });
    expect(s.selectedClass).toBeNull();
    expect(s.screen).toBe("class");
    expect(s.notice).toBe(UNAVAILABLE_NOTICE);
  });

  it("supports multiple passengers", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SELECT_SEAT", seat: "Window" });
    s = bookingReducer(s, { type: "ADD_PASSENGER" });
    s = bookingReducer(s, { type: "ADD_PASSENGER" });
    expect(s.passengers).toHaveLength(3);
    expect(s.passengerCount).toBe(3);
    s = bookingReducer(s, { type: "REMOVE_PASSENGER", id: s.passengers[2].id });
    expect(s.passengers).toHaveLength(2);
  });

  it("validates passenger fields", () => {
    const bad = validatePassengers([
      { id: "1", name: "A", age: "0", gender: "", berthPreference: "" },
    ]);
    expect(bad["1"].name).toBeTruthy();
    expect(bad["1"].age).toBeTruthy();
    expect(bad["1"].gender).toBeTruthy();
    expect(bad["1"].berthPreference).toBeTruthy();

    const good = validatePassengers([
      { id: "1", name: "Asha Kaur", age: "28", gender: "FEMALE", berthPreference: "Window" },
    ]);
    expect(good).toEqual({});

    const hindi = validatePassengers([
      { id: "2", name: "राहुल शर्मा", age: "30", gender: "MALE", berthPreference: "Lower" },
    ]);
    expect(hindi).toEqual({});

    const nums = validatePassengers([
      { id: "3", name: "Rahul12", age: "28", gender: "MALE", berthPreference: "Lower" },
    ]);
    expect(nums["3"].name).toBeTruthy();
  });

  it("strips digits from spoken/typed passenger names", () => {
    let s = initialBooking("2026-08-20");
    const id = s.passengers[0].id;
    s = bookingReducer(s, { type: "UPDATE_PASSENGER", id, patch: { name: "Rahul123", age: "28a", gender: "MALE" } });
    expect(s.passengers[0].name).toBe("Rahul");
    expect(s.passengers[0].age).toBe("28");
    s = bookingReducer(s, { type: "UPDATE_PASSENGER", id, patch: { gender: "ALIEN" as never } });
    expect(s.passengers[0].gender).toBe("MALE");
  });

  it("back from results stays on the train board, not home chat", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SEARCH_START" });
    s = bookingReducer(s, {
      type: "SEARCH_SUCCESS",
      trains: [train("14632")],
      recommendations: [],
    });
    expect(s.screen).toBe("results");
    s = bookingReducer(s, { type: "BACK" });
    expect(s.screen).toBe("results");
    expect(s.trains).toHaveLength(1);
  });

  it("cancel home clears the journey and bumps session", () => {
    let s = initialBooking("2026-08-20");
    s = {
      ...s,
      from: station("ASR"),
      to: station("NDLS"),
      dateProvided: true,
    };
    s = bookingReducer(s, { type: "SEARCH_START" });
    s = bookingReducer(s, { type: "SEARCH_EMPTY", date: "2026-08-22" });
    expect(s.screen).toBe("results");
    s = bookingReducer(s, { type: "CANCEL_HOME" });
    expect(s.screen).toBe("home");
    expect(s.from).toBeNull();
    expect(s.to).toBeNull();
    expect(s.trains).toHaveLength(0);
    expect(s.emptyMessage).toBeNull();
    expect(s.sessionId).toBe(1);
  });

  it("does not carry stale fare after date change", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12014") });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: klass("CC", "AVAILABLE", 1250) });
    s = bookingReducer(s, {
      type: "GO_REVIEW",
      fare: { baseFare: 1250, serviceFee: 25, total: 1275 },
    });
    expect(s.previewFare?.total).toBe(1275);
    s = bookingReducer(s, { type: "SET_DATE", date: "2026-08-22" });
    expect(s.previewFare).toBeNull();
    expect(s.booking).toBeNull();
  });

  it("does not prefill passenger berth from seat screen", () => {
    let s = initialBooking("2026-08-20");
    s = bookingReducer(s, { type: "SELECT_TRAIN", train: train("12014") });
    s = bookingReducer(s, { type: "SELECT_CLASS", klass: klass("CC", "AVAILABLE", 1250) });
    s = bookingReducer(s, { type: "SELECT_SEAT", seat: "Lower" });
    expect(s.seatPreference).toBe("Lower");
    expect(s.passengers[0].berthPreference).toBe("");
    expect(s.passengers[0].gender).toBe("");
    s = bookingReducer(s, { type: "ADD_PASSENGER" });
    expect(s.passengers[1].berthPreference).toBe("");
  });
});
