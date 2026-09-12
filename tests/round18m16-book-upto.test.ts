/* Round-18m-16 (user ConfirmTkt screenshot, LDH→INDB 12920 Malwa Exp):
 * direct LDH→INDB WL; earlier JAT→INDB WL; upto LDH→DADN WL; JAT→DADN 1A AVL
 * → "Same Train Confirmed Alternate Option": Book From JAT · Boarding LDH · Deboarding INDB · Book Upto DADN. */
import { describe, expect, it, vi } from "vitest";

const WL = (cls: string, wl: number, fare: number) => ({ code: cls, status: "WAITLIST", seats: null, rac: null, waitlist: wl, fare, source: "railcore", stale: false });
const AVL = (cls: string, n: number, fare: number) => ({ code: cls, status: "AVAILABLE", seats: n, rac: null, waitlist: null, fare, source: "railcore", stale: false });

const boards: Record<string, unknown[]> = {
  "LDH>INDB": [WL("3A", 40, 2035), WL("2A", 18, 2280), WL("1A", 3, 3830)],
  "JAT>INDB": [WL("2A", 20, 2500), WL("1A", 2, 4295)],
  "LDH>DADN": [WL("2A", 17, 2300), WL("1A", 1, 3830)],
  "JAT>DADN": [WL("2A", 5, 2585), AVL("1A", 1, 4345)],
};
const stops = [
  { code: "JAT", name: "Jammu Tawi", departure: "10:30", day: 1 },
  { code: "PTKC", name: "Pathankot Cantt", departure: "12:40", day: 1 },
  { code: "JRC", name: "Jalandhar Cantt", departure: "14:10", day: 1 },
  { code: "LDH", name: "Ludhiana Jn", departure: "15:15", day: 1 },
  { code: "UMB", name: "Ambala Cantt", departure: "17:40", day: 1 },
  { code: "NDLS", name: "New Delhi", departure: "22:10", day: 1 },
  { code: "INDB", name: "Indore Jn Bg", arrival: "13:35", departure: "13:45", day: 2 },
  { code: "DADN", name: "Dr Ambedkar Nagar", arrival: "14:25", day: 2 },
];
const calls: string[] = [];
vi.mock("../server/railway/router.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/railway/router.js")>();
  return {
    ...mod,
    searchTrainsRouted: async (q: { from: string; to: string }) => ({ trains: [{ number: "12920", name: "MALWA EXPRESS", departure: q.from === "UMB" ? "17:40" : "15:15", arrival: q.to === "UMB" ? "17:35" : "13:35", durationMinutes: 1340, classes: [{ code: "3A" }, { code: "2A" }, { code: "1A" }], from: { code: q.from, name: q.from }, to: { code: q.to, name: q.to } }], provider: "railcore" }),
    routedClassBoard: async (_tn: string, _d: string, from: string, to: string) => { calls.push(`${from}>${to}`); const b = boards[`${from}>${to}`]; return { provider: b ? "railcore" : "none", classes: b ?? [] }; },
    routedSchedule: async () => ({ schedule: { trainNumber: "12920", stops }, provider: "railcore" }),
    getTrainScheduleRouted: async () => ({ stops, provider: "railcore" }),
  };
});

describe("Round-18m-16: ConfirmTkt-style 'Book Upto' (ticket beyond destination) when nothing else has a seat", () => {
  it("finds JAT→DADN 1A AVL and reports book-from JAT, board LDH, deboard INDB, book-upto DADN", async () => {
    const { planJourney } = await import("../server/journey/engine.js");
    const p = await planJourney({ from: "LDH", to: "INDB", date: "2030-01-13", travelClass: null, preference: "best_overall", includeConnections: false, includeAlternativeDates: false, includePartial: false, includeAlternateStations: false, passengers: 1, aiWhy: false, expandLegs: false });
    expect(p.directUnavailable).toBe(true);
    const bfe = p.recovery?.boardFromEarlier ?? [];
    expect(bfe.length).toBeGreaterThan(0);
    const pick = bfe[0];
    expect(pick.trainNumber).toBe("12920");
    expect(pick.bookFrom).toBe("JAT");
    expect(pick.boardAt).toBe("LDH");
    expect(pick.destination).toBe("INDB");
    expect(pick.bookUpto).toBe("DADN");
    expect(pick.availability.classCode).toBe("1A");
    expect(pick.availability.status).toBe("AVAILABLE");
    expect(pick.availability.fare).toBe(4345);
    // Scan order: earlier stops first (JRC/PTKC/JAT → INDB), then LDH→beyond, then combos.
    expect(calls).toContain("LDH>INDB");
    expect(calls).toContain("JAT>INDB");
    expect(calls).toContain("LDH>DADN");
    expect(calls).toContain("JAT>DADN");
    expect(p.notes.some((n) => /Book-upto scan/.test(n))).toBe(true);
  });
});

describe("Round-18m-18: connecting leg rescue (train origin / 1-2 stops beyond) + full-class probe on legs", () => {
  it("expandLegPlan: leg-2 train WL on hub→dest but AVL from its origin → leg listed with ticketFrom", async () => {
    const { expandLegPlan } = await import("../server/journey/engine.js");
    // reuse mocked router: only 12920 exists; UMB→INDB not in boards → no seat; JAT→INDB not in boards either.
    // Add boards dynamically for this case:
    boards["UMB>INDB"] = [WL("1A", 6, 3595)];
    boards["JAT>INDB"] = [WL("2A", 20, 2500), WL("1A", 2, 4295)];
    boards["PTKC>INDB"] = [AVL("2A", 2, 2450)];
    boards["LDH>UMB"] = [AVL("SL", 9, 150)];
    const r = await expandLegPlan({ from: "LDH", to: "INDB", hub: "UMB", hubName: "Ambala Cantt", date: "2030-01-13", travelClass: null, pax: 1 });
    expect(r.plan).not.toBeNull();
    const l2 = r.plan!.leg2.find((l) => l.trainNumber === "12920");
    expect(l2).toBeTruthy();
    expect(l2!.availability?.status).toBe("AVAILABLE");
    expect(l2!.availability?.classCode).toBe("2A");
    expect(l2!.ticketFrom).toBe("PTKC");
  });
});
