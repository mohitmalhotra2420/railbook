import { describe, expect, it } from "vitest";
import { formatScheduleCompare, isNamedTrainCompare, spokenTrainNumbers } from "../src/ai/compare";

describe("named train compare", () => {
  it("detects screenshot-style recommend + yan", () => {
    const text = "Tum muje recommend kroge ke ki better train kon si delhi jaane ke liye 12014 yan 12498";
    expect(spokenTrainNumbers(text)).toEqual(["12014", "12498"]);
    expect(isNamedTrainCompare(text)).toBe(true);
  });

  it("formats only provider timetable fields", () => {
    const text = formatScheduleCompare(
      {
        trainNumber: "12014",
        trainName: "Amritsar Shatabdi",
        durationMinutes: 365,
        classes: ["CC", "EC"],
        stops: [
          { code: "ASR", name: "Amritsar Junction", departure: "04:55" },
          { code: "NDLS", name: "New Delhi", arrival: "11:00" },
        ],
      },
      {
        trainNumber: "12498",
        trainName: "Shane Punjab",
        durationMinutes: 450,
        stops: [
          { code: "ASR", name: "Amritsar Junction", departure: "15:10" },
          { code: "NDLS", name: "New Delhi", arrival: "22:40" },
        ],
      },
      ["12014", "12498"],
      ["NDLS", "DLI", "NZM"],
    );
    expect(text).toMatch(/12014/);
    expect(text).toMatch(/12498/);
    expect(text).toMatch(/Full-run time: 12014/);
    expect(text).toMatch(/New Delhi \(NDLS\)/);
    expect(text).toMatch(/Fare\/seats invent nahi/);
    expect(text).not.toMatch(/₹/);
  });

  it("says honestly when a timetable is missing", () => {
    const text = formatScheduleCompare(null, null, ["12014", "12498"]);
    expect(text).toMatch(/12014: timetable provider se nahi mili/);
    expect(text).toMatch(/12498: timetable provider se nahi mili/);
  });
});
