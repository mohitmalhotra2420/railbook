/* Round-18m-39 (user: "ASR→LDH ke liye leg-1 ASR→NDLS, leg-2 NDLS→LDH — Delhi kya karne jaunga?"): connecting
 * hubs SIRF origin–destination ke BEECH ke junctions (route se derived); fixed hub-list sirf tab jab direct
 * train hi na ho; aur har connection par detour cap (fastest direct × 1.6 + 45 min). */
import { describe, expect, it, vi } from "vitest";
import { findConnections } from "../server/journey/engine";

describe("Round-18m-39: no absurd detour connections", () => {
  it("maxTotalMinutes drops a via-NDLS connection that takes 3× the direct time", async () => {
    const router = await import("../server/railway/router");
    const mk = (n: string, from: string, to: string, dep: string, arr: string, dur: number) => ({ number: n, name: `T${n}`, type: "EXP", from: { code: from, name: from, city: from }, to: { code: to, name: to, city: to }, date: "2026-09-14", departure: dep, arrival: arr, arrivalDayOffset: 0, durationMinutes: dur, durationLabel: `${dur}m`, runsOn: [0,1,2,3,4,5,6], classes: [] });
    const spy = vi.spyOn(router, "searchTrainsRouted").mockImplementation(async (q: { from: string; to: string }) => {
      if (q.from === "ASR" && q.to === "NDLS") return { trains: [mk("12014", "ASR", "NDLS", "05:00", "11:00", 360)], provider: "mock" } as never;
      if (q.from === "NDLS" && q.to === "LDH") return { trains: [mk("12013", "NDLS", "LDH", "16:30", "21:00", 270)], provider: "mock" } as never;
      return { trains: [], provider: "mock" } as never;
    });
    const withCap = await findConnections("ASR", "LDH", "2026-09-14", { hubs: ["NDLS"], maxHubs: 1, maxTotalMinutes: Math.round(120 * 1.6 + 45) });
    expect(withCap.connections.length).toBe(0);
    const noCap = await findConnections("ASR", "LDH", "2026-09-14", { hubs: ["NDLS"], maxHubs: 1 });
    expect(noCap.connections.length).toBeGreaterThan(0); // sanity: only the cap removed it
    spy.mockRestore();
  });
});
