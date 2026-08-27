import { describe, expect, it } from "vitest";
import { compactScheduleEvidence, shouldGroundFact } from "../server/understand/ground";
import { formatGoesToAnswer } from "../src/ai/compare";

describe("grounded RailCore answers", () => {
  it("grounds named-train facts, not booking sentences", () => {
    expect(shouldGroundFact("12054 delhi jaati hai")?.train).toBe("12054");
    expect(shouldGroundFact("12014 kitne ghante ki hai")?.train).toBe("12014");
    expect(shouldGroundFact("Delhi jaati hai yan nahi", "12054")?.train).toBe("12054");
    expect(shouldGroundFact("Mujhe Amritsar se Delhi jaana hai")).toBeNull();
    expect(shouldGroundFact("Kal 2 ticket chahiye")).toBeNull();
  });

  it("compacts timetable so NVIDIA can only see real stops", () => {
    const ev = compactScheduleEvidence({
      trainNumber: "12054",
      trainName: "HW JANSHATABDI",
      stops: [
        { code: "ASR", name: "Amritsar Jn", departure: "06:50" },
        { code: "HW", name: "Haridwar Jn", arrival: "13:50" },
      ],
    }) as { last: { code: string }; stops: { code: string }[] };
    expect(ev.last.code).toBe("HW");
    expect(ev.stops.map((s) => s.code)).toEqual(["ASR", "HW"]);
    expect(compactScheduleEvidence(null)).toBeNull();
  });

  it("deterministic fallback still says Nahi when Delhi is not a halt", () => {
    const text = formatGoesToAnswer(
      {
        trainNumber: "12054",
        trainName: "HW JANSHATABDI",
        stops: [
          { code: "ASR", name: "Amritsar Jn", departure: "06:50" },
          { code: "HW", name: "Haridwar Jn", arrival: "13:50" },
        ],
      },
      "12054",
      "Delhi",
      ["NDLS", "DLI", "NZM"],
    );
    expect(text).toMatch(/^Nahi/);
  });
});
