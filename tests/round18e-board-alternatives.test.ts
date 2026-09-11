/**
 * Round-18e — user bug: "sidha card open kar deta, alternatives nahi dikhte".
 * (1) /api/journey/alternatives accepts a client-verified knownRow so the
 *     TrainBoard WL/RAC/low tap gets the right reason without re-probing.
 * (2) Concierge no longer auto-opens the TrainBoard when the agent reply
 *     carries a journey / alternatives / trainpicker block (source-level guard).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { findAlternativeTrains } from "../server/journey/engine.js";
import { setScrapeFetch } from "../server/railway/webscrape.js";

describe("Round-18e §6 knownRow reason", () => {
  it("uses the verified WL row for the reason even when no provider answers", async () => {
    setScrapeFetch((async () => new Response("", { status: 503 })) as unknown as typeof fetch);
    const r = await findAlternativeTrains({ trainNumber: "12138", origin: "FZR", destination: "CSMT", date: "2099-01-05", travelClass: "SL", knownRow: { status: "WAITLIST", waitlist: 24, source: "railradar" } });
    expect(r.reason).toBe("waitlist");
    expect(r.selected.waitlist).toBe(24);
    expect(r.alternatives).toEqual([]); // nothing verified → nothing invented
  }, 30_000);
});

describe("Round-18e UI guard (source-level)", () => {
  const concierge = readFileSync("src/views/Concierge.tsx", "utf8");
  it("does not auto-open TrainBoard when a smart block is present", () => {
    expect(concierge).toMatch(/hasSmartBlock = blocks\.some\(\(b\) => b\.type === "journey" \|\| b\.type === "alternatives" \|\| b\.type === "trainpicker"\)/);
    /* Round-18m-7: board auto-open is fully disabled (AUTO_BOARD=false) — chat journey card is the planner. */
    expect(concierge).toMatch(/const AUTO_BOARD = false;/);
    expect(concierge).toMatch(/if \(AUTO_BOARD && !hasSmartBlock && wantBooking/);
  });
  it("BEST FOR YOU card exposes an explicit book CTA (no auto-booking)", () => {
    const jo = readFileSync("src/components/JourneyOptions.tsx", "utf8");
    expect(jo).toContain("Sabhi trains · Book →");
  });
  it("TrainBoard opens YOU MAY ALSO CONSIDER on WL/RAC/low class tap", () => {
    const tb = readFileSync("src/views/TrainBoard.tsx", "utf8");
    expect(tb).toContain("journeyAlternativesApi");
    expect(tb).toMatch(/cell\.status === "WAITLIST" \|\| cell\.status === "RAC"/);
  });
});

describe("Round-18f — regression guards from real-browser E2E", () => {
  it("BlockView receives onOpenBoard (was ReferenceError → blank reply after date)", () => {
    const c = readFileSync("src/views/Concierge.tsx", "utf8");
    expect(c).toMatch(/onBookings,\n\s*onOpenBoard,\n\}: \{/);
    // openBoardFor must be defined at component scope, not nested inside handleText
    const idxOpen = c.indexOf("async function openBoardFor(");
    const idxHandle = c.indexOf("async function handleText(");
    expect(idxOpen).toBeGreaterThan(0);
    expect(idxOpen).toBeLessThan(idxHandle);
  });
  it("release gate rejects undefined client names", () => {
    const r = readFileSync("scripts/release.sh", "utf8");
    expect(r).toContain('grep -E "error TS(2304|2552)"');
  });
});
