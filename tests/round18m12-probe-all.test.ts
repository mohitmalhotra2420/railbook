/* Round-18m-12 — user screenshot LDH→SRE "kal": board par 12588 1A AVL 2 aur
 * 14682 2S AVL 559 the, phir bhi card ne "direct mein koi seat nahi" bola.
 * Root cause ENGINE (AI nahi): planner sirf fastest 4 trains probe karta tha.
 * Ab: HAR train × HAR class probe; stale AVL = "seat nahi" NAHI; unprobed
 * trains ko honest note; RAC bhi option (classOptions mein). */
import { describe, it, expect, vi } from "vitest";

type Cls = { code: string; status: string; seats: number | null; rac: number | null; waitlist: number | null; fare: number; source: string; stale?: boolean };
const boards: Record<string, Cls[]> = {
  // fastest 4 — sab WL (fresh)
  "11111": [{ code: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 40, fare: 200, source: "railcore" }],
  "22222": [{ code: "3A", status: "WAITLIST", seats: null, rac: null, waitlist: 12, fare: 500, source: "railcore" }],
  "33333": [{ code: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 9, fare: 200, source: "railcore" }],
  "44444": [{ code: "2A", status: "WAITLIST", seats: null, rac: null, waitlist: 3, fare: 900, source: "railcore" }],
  // 5th (slowest) — RAC in SL + fresh AVL in 1A (pehle kabhi probe hi nahi hoti thi)
  "12588": [
    { code: "SL", status: "RAC", seats: null, rac: 4, waitlist: null, fare: 210, source: "railcore" },
    { code: "1A", status: "AVAILABLE", seats: 2, rac: null, waitlist: null, fare: 1500, source: "railcore" },
    { code: "2A", status: "WAITLIST", seats: null, rac: null, waitlist: 3, fare: 900, source: "railcore" },
  ],
  // 6th — sirf STALE AVL (web cache)
  "14682": [{ code: "2S", status: "AVAILABLE", seats: 559, rac: null, waitlist: null, fare: 90, source: "web_railyatri", stale: true }],
};
const mkTrain = (n: string, dur: number) => ({ number: n, name: `T${n}`, departure: "06:00", arrival: "10:00", durationMinutes: dur, classes: [], from: "LDH", to: "SRE" });

vi.mock("../server/railway/router.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/railway/router.js")>();
  return {
    ...mod,
    searchTrainsRouted: async () => ({
      trains: [mkTrain("11111", 200), mkTrain("22222", 210), mkTrain("33333", 220), mkTrain("44444", 230), mkTrain("12588", 300), mkTrain("14682", 320), mkTrain("04566", 400)],
      provider: "web_erail",
    }),
    routedClassBoard: async (tn: string) => ({ provider: boards[tn] ? "railcore" : "none", classes: boards[tn] ?? [] }),
    getTrainScheduleRouted: async () => ({ stops: [], provider: "none" }),
  };
});

const plan = async (pax: number) => {
  const { planJourney } = await import("../server/journey/engine.js");
  return planJourney({ from: "LDH", to: "SRE", date: "2030-01-13", travelClass: null, preference: "best_overall", includeConnections: false, includeAlternativeDates: false, includePartial: false, passengers: pax, aiWhy: false, expandLegs: false });
};

describe("Round-18m-12: every train × every class probed; never lie 'no direct seat'", () => {
  it("probes ALL direct trains (not just fastest 4) and finds fresh AVL in the 5th", async () => {
    const p = await plan(1);
    const opts = p.routeOptions.filter((o) => o.changes === 0);
    expect(opts.map((o) => o.trainNumbers[0]).sort()).toEqual(["04566", "11111", "12588", "14682", "22222", "33333", "44444"]);
    expect(opts.filter((o) => o.probed).length).toBe(6);
    expect(p.directUnavailable).toBe(false);
    expect(p.best?.trainNumbers[0]).toBe("12588");
    expect(p.best?.availability?.classCode).toBe("1A");
  });

  it("classOptions carries the FULL class board incl. RAC and WL rows", async () => {
    const p = await plan(1);
    const o = p.routeOptions.find((x) => x.trainNumbers[0] === "12588")!;
    const codes = (o.classOptions ?? []).map((r) => `${r.classCode}:${r.status}`).sort();
    expect(codes).toEqual(["1A:AVAILABLE", "2A:WAITLIST", "SL:RAC"]);
  });

  it("unprobed train gets an honest note, never counted as 'seat nahi'", async () => {
    const p = await plan(3); // 3 pax → 1A AVL 2 kaafi nahi; 12588 SL RAC 4 bookable (Round-18m-22)
    const o = p.routeOptions.find((x) => x.trainNumbers[0] === "04566")!;
    expect(o.probed).toBeFalsy();
    // Note sirf tab jab koi bookable train na ho; yahan RAC bookable hai → note nahi, lekin 04566 kabhi "seat nahi" nahi gina jaata.
    expect(o.availability).toBeFalsy();
    expect(p.notes.some((n) => n.includes("04566") && /seat nahi.*nahi maana/.test(n))).toBe(false);
  });

  it("stale AVL (web cache) is an 'available, not fresh — verify' tier, NOT directUnavailable", async () => {
    const p = await plan(3);
    // 3 pax: fresh rows — 1A AVL 2 (kam), 12588 SL RAC 4 (Round-18m-22: RAC = available, kisi bhi pax ke liye) → fresh best;
    // stale 14682 2S AVL 559 phir bhi stale tier mein option rehta hai.
    expect(p.directUnavailable).toBe(false);
    expect(p.best?.trainNumbers[0]).toBe("12588");
    expect(p.best?.availability?.status).toBe("RAC");
    expect(p.best?.availability?.stale).toBeFalsy();
    const stale = p.routeOptions.find((o) => o.trainNumbers[0] === "14682");
    expect(stale?.availability?.stale).toBe(true);
  });

  it("RAC counts as bookable (SL RAC in 12588 is an option; AVL preferred when enough)", async () => {
    const p = await plan(2);
    const o = p.routeOptions.find((x) => x.trainNumbers[0] === "12588")!;
    expect(o.availability?.classCode).toBe("1A"); // AVL 2 for 2 pax first
    expect((o.classOptions ?? []).some((r) => r.status === "RAC")).toBe(true);
    const { legBookable } = await import("../server/journey/engine.js");
    expect(legBookable({ classCode: "SL", status: "RAC", seats: null, rac: 4, waitlist: null, fare: 210, source: "railcore" }, 2)).toBe(true);
  });
});
