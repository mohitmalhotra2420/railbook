import { describe, expect, it } from "vitest";
import { understand } from "../src/ai/nlu";
import { planTurn } from "../src/ai/orchestrate";
import { routeRailwayIntent } from "../src/ai/toolRoute";
import { initialBooking } from "../src/booking/state";
import { capabilityReply, isCapabilityAsk, isGoesToAsk } from "../src/ai/facts";
import { formatGoesToAnswer } from "../src/ai/compare";

const NOW = new Date(2026, 7, 23);

function blank() {
  return { ...initialBooking("2026-08-23"), date: "" };
}

describe("smart railway facts", () => {
  it("bare train number looks up timetable, does not ask origin", () => {
    expect(routeRailwayIntent("12014").kind).toBe("TRAIN_SCHEDULE");
    expect(understand("12014", { now: NOW }).intent).toBe("TRAIN_SCHEDULE");
    const turn = planTurn({ text: "12014", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.trainSchedule).toBe("12014");
    expect(turn.search).not.toBe(true);
    expect(turn.text).not.toMatch(/Kahan se/i);
  });

  it("12014 kitne ghante / Delhi jaati hai uses timetable", () => {
    expect(understand("12014 kitne ghante ki hai?", { now: NOW }).intent).toBe("TRAIN_SCHEDULE");
    expect(planTurn({ text: "12014 Delhi jaati hai?", now: NOW, booking: blank(), prefs: {}, saved: [] }).trainSchedule).toBe(
      "12014",
    );
  });

  it("fare with train number probes provider, does not refuse", () => {
    const turn = planTurn({ text: "12014 ka fare kitna hai?", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.probeSeats).toBe("12014");
    expect(turn.text).not.toMatch(/pehle train aur class/i);
  });

  it("best train to Delhi without numbers asks only origin", () => {
    const turn = planTurn({
      text: "Delhi jaane ke liye better train kaunsi hai",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).not.toBe(true);
    expect(turn.compareTrains).toBeUndefined();
    expect(turn.ask).toBe("from");
    expect(turn.text).toMatch(/origin|kahan se/i);
    expect(turn.blocks?.[0]?.type).not.toBe("stations");
  });

  it("pantry question is honest and still looks up the train", () => {
    expect(isCapabilityAsk("12014 mein khana milta hai?")).toBe(true);
    expect(capabilityReply("khana milta hai")).toMatch(/Pantry/);
    const turn = planTurn({ text: "12014 mein khana milta hai?", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.trainSchedule).toBe("12014");
    expect(turn.text).toMatch(/Pantry|khana/i);
  });

  it("NVIDIA search intent does not swallow local timetable fact", () => {
    const turn = planTurn({
      text: "12014 ka route batao",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
      extraction: { intent: "SEARCH_TRAIN" },
    });
    expect(turn.trainSchedule).toBe("12014");
  });

  it("12054 Delhi jaati hai answers halt, does not start booking", () => {
    expect(isGoesToAsk("12054 delhi jaati hai ?")).toBe(true);
    const turn = planTurn({ text: "12054 delhi jaati hai ?", now: NOW, booking: blank(), prefs: {}, saved: [] });
    expect(turn.trainSchedule).toBe("12054");
    expect(turn.goesToCity).toMatch(/Delhi/i);
    expect(turn.compareDestCodes).toEqual(expect.arrayContaining(["NDLS", "DLI", "NZM"]));
    expect(turn.search).not.toBe(true);
    expect(turn.apply?.from).toBeUndefined();
    expect(turn.apply?.to).toBeUndefined();
    expect(turn.text).not.toMatch(/Kahan jana/i);
  });

  it("follow-up Delhi jaati hai ya nahi uses last train", () => {
    const turn = planTurn({
      text: "Delhi jaati hai yan nhi yeh btao",
      now: NOW,
      booking: blank(),
      prefs: {},
      saved: [],
      lastFactTrain: "12054",
    });
    expect(turn.trainSchedule).toBe("12054");
    expect(turn.goesToCity).toMatch(/Delhi/i);
    expect(turn.search).not.toBe(true);
    expect(turn.ask).not.toBe("to");
    expect(turn.text).not.toMatch(/Kahan jana/i);
  });

  it("goes-to format is yes/no from timetable stops", () => {
    const no = formatGoesToAnswer(
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
    expect(no).toMatch(/^Nahi/);
    expect(no).toMatch(/HW/);
    const yes = formatGoesToAnswer(
      {
        trainNumber: "12014",
        trainName: "Shatabdi",
        stops: [
          { code: "ASR", name: "Amritsar Jn", departure: "04:55" },
          { code: "NDLS", name: "New Delhi", arrival: "11:00" },
        ],
      },
      "12014",
      "Delhi",
      ["NDLS", "DLI", "NZM"],
    );
    expect(yes).toMatch(/^Haan/);
    expect(yes).toMatch(/NDLS/);
  });
});
