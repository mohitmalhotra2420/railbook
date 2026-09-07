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

describe("Round-16d: compare questions never grounded from ONE schedule (user screenshot 2026-09-08)", () => {
  it("2 train numbers → null (agent handles)", () => {
    expect(shouldGroundFact("12053 better hai yan 12014 ?", null)).toBeNull();
    expect(shouldGroundFact("12053 better hai ludhiana jaane ke liye yan 12014?", "12053")).toBeNull();
    expect(shouldGroundFact("12053 vs 12014", null)).toBeNull();
  });
  it("single train fact still grounds", () => {
    expect(shouldGroundFact("12053 ludhiana rukti hai?", null)).toEqual({ train: "12053" });
    expect(shouldGroundFact("ye ludhiana rukti hai?", "12053")).toEqual({ train: "12053" });
  });
});
