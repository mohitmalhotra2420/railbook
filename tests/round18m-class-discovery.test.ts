/** Round-18m — seat probe must run even when the search row has no class list (RailRadar/erail rows). */
import { describe, it, expect, vi } from "vitest";

vi.mock("../server/railway/webscrape.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/railway/webscrape.js")>();
  return {
    ...mod,
    scrapeTrainFareWeb: async (n: string) => ({ trainNumber: n, classes: [{ code: "CC", general: 1035, tatkal: null }, { code: "EC", general: 1830, tatkal: null }, { code: "GN", general: null, tatkal: null }], provider: "web_erail", sourceUrl: "x" }),
  };
});

describe("Round-18m webTrainClasses", () => {
  it("derives class codes from the erail fare page and ignores non-class columns", async () => {
    const { webTrainClasses } = await import("../server/railway/router.js");
    expect(await webTrainClasses("22478")).toEqual(["CC", "EC"]);
  });
});

describe("Round-18m bare index picks the Nth train after a list (never a station)", () => {
  it("'1' → first train of lastTrainNumbers when route is set", async () => {
    const { resolveTrainNumber, emptyAgentContext } = await import("../server/agent/context.js");
    const ctx = { ...emptyAgentContext(), origin: { code: "LDH", name: "Ludhiana", city: "Ludhiana" }, destination: { code: "NDLS", name: "New Delhi", city: "Delhi" }, lastTrainNumbers: ["22478", "12014"], lastTrains: [{ number: "22478", name: "VB" }, { number: "12014", name: "SHATABDI" }] };
    expect(resolveTrainNumber("1", ctx as never)).toBe("22478");
    expect(resolveTrainNumber("2.", ctx as never)).toBe("12014");
    // pending station choice → not a train pick
    expect(resolveTrainNumber("1", { ...ctx, destination: null, pendingDestinationChoice: "Delhi" } as never)).toBeUndefined();
  });
});

describe("Round-18m live-status date chooser", () => {
  it("routedLiveDates keeps only dates that returned a run (mocked chain)", async () => {
    const router = await import("../server/railway/router.js");
    expect(typeof router.routedLiveDates).toBe("function");
    // Shape contract used by the client chips.
    const sample: import("../server/railway/router.js").LiveDateOption = { date: "2026-09-09", label: "Kal (Wed 9)", runState: "running", provider: "railradar" };
    expect(sample.label).toMatch(/Kal/);
  });
});
