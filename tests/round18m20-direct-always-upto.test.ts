/* Round-18m-20 (user rule): DIRECT train mein seat na mile → (a) train origin se boarding tak SAARE
 * pichhle stops × har class, (b) destination ke aage 2–3 stops × har class — HAMESHA, chahe
 * connecting route mil bhi gaya ho. Pehle book-upto sirf tab chalta tha jab connecting bhi fail ho. */
import { describe, expect, it, vi } from "vitest";

const WL = (cls: string, wl: number, fare: number) => ({ code: cls, status: "WAITLIST", seats: null, rac: null, waitlist: wl, fare, source: "railcore", stale: false });
const AVL = (cls: string, n: number, fare: number) => ({ code: cls, status: "AVAILABLE", seats: n, rac: null, waitlist: null, fare, source: "railcore", stale: false });

/* 12920 (train origin JAT) LDH→INDB: user segment WL, har earlier stop WL, LDH→DADN (1 aage) SL AVL.
 * Connecting via UMB: 12920 LDH→UMB AVL + 19326 UMB→INDB AVL → connecting mil jaata hai. */
const boards: Record<string, unknown[]> = {
  "12920:LDH>INDB": [WL("3A", 40, 2035), WL("SL", 60, 700)],
  "12920:JRC>INDB": [WL("3A", 30, 2100), WL("SL", 50, 720)],
  "12920:PTKC>INDB": [WL("3A", 25, 2200), WL("SL", 45, 760)],
  "12920:JAT>INDB": [WL("3A", 20, 2500), WL("SL", 40, 800)],
  "12920:LDH>DADN": [WL("3A", 38, 2050), AVL("SL", 12, 715)],
  "12920:LDH>UMB": [AVL("3A", 20, 500), AVL("SL", 40, 150)],
  "19326:UMB>INDB": [AVL("3A", 9, 1600), AVL("SL", 30, 500)],
};
const stops12920 = [
  { code: "JAT", name: "Jammu Tawi", departure: "10:30", day: 1 },
  { code: "PTKC", name: "Pathankot Cantt", departure: "12:40", day: 1 },
  { code: "JRC", name: "Jalandhar Cantt", departure: "14:10", day: 1 },
  { code: "LDH", name: "Ludhiana Jn", departure: "15:15", day: 1 },
  { code: "UMB", name: "Ambala Cantt", arrival: "17:35", departure: "17:40", day: 1 },
  { code: "NDLS", name: "New Delhi", departure: "22:10", day: 1 },
  { code: "INDB", name: "Indore Jn Bg", arrival: "13:35", departure: "13:45", day: 2 },
  { code: "DADN", name: "Dr Ambedkar Nagar", arrival: "14:25", day: 2 },
];
const stops19326 = [
  { code: "ASR", name: "Amritsar Jn", departure: "12:00", day: 1 },
  { code: "UMB", name: "Ambala Cantt", arrival: "18:30", departure: "18:40", day: 1 },
  { code: "INDB", name: "Indore Jn Bg", arrival: "12:00", day: 2 },
];
const calls: string[] = [];
const T = (number: string, name: string, from: string, to: string, dep: string, arr: string, dur: number) => ({ number, name, departure: dep, arrival: arr, durationMinutes: dur, classes: [{ code: "3A" }, { code: "SL" }], from: { code: from, name: from }, to: { code: to, name: to } });
vi.mock("../server/railway/router.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/railway/router.js")>();
  return {
    ...mod,
    searchTrainsRouted: async (q: { from: string; to: string }) => {
      const k = `${q.from}>${q.to}`;
      if (k === "LDH>INDB") return { trains: [T("12920", "MALWA EXPRESS", "LDH", "INDB", "15:15", "13:35", 1340)], provider: "railcore" };
      if (k === "LDH>UMB") return { trains: [T("12920", "MALWA EXPRESS", "LDH", "UMB", "15:15", "17:35", 140)], provider: "railcore" };
      if (k === "UMB>INDB") return { trains: [T("19326", "ASR INDB EXP", "UMB", "INDB", "18:40", "12:00", 1040)], provider: "railcore" };
      return { trains: [], provider: "railcore" };
    },
    routedClassBoard: async (tn: string, _d: string, from: string, to: string) => { const k = `${tn}:${from}>${to}`; calls.push(k); const b = boards[k]; return { provider: b ? "railcore" : "none", classes: b ?? [] }; },
    routedSchedule: async (tn: string) => ({ schedule: { trainNumber: tn, stops: tn === "19326" ? stops19326 : stops12920 }, provider: "railcore" }),
    getTrainScheduleRouted: async (tn: string) => ({ stops: tn === "19326" ? stops19326 : stops12920, provider: "railcore" }),
  };
});

describe("Round-18m-20: direct WL → origin→boarding all stops AND destination+2–3 stops, even when a connecting route exists", () => {
  it("scans every earlier stop up to train origin, then book-upto; keeps the connecting option too", async () => {
    const { planJourney, JOURNEY_CONFIG } = await import("../server/journey/engine.js");
    expect(JOURNEY_CONFIG.bookUptoStops).toBeLessThanOrEqual(3);
    const p = await planJourney({ from: "LDH", to: "INDB", date: "2030-01-13", travelClass: null, preference: "best_overall", includeConnections: true, includeAlternativeDates: false, includePartial: false, includeAlternateStations: false, passengers: 1, aiWhy: false, expandLegs: false });
    expect(p.directUnavailable).toBe(true);
    // Connecting via UMB seat-proven hai — phir bhi neeche ke scans chalne chahiye.
    expect((p.connections ?? []).length).toBeGreaterThan(0);
    // (a) train origin tak har pichhla stop checked (JRC, PTKC, JAT).
    expect(calls).toContain("12920:JRC>INDB");
    expect(calls).toContain("12920:PTKC>INDB");
    expect(calls).toContain("12920:JAT>INDB");
    // (b) destination ke aage ka stop bhi checked — connecting mil jaane ke bawajood.
    expect(calls).toContain("12920:LDH>DADN");
    const bfe = p.recovery?.boardFromEarlier ?? [];
    const upto = bfe.find((b) => b.trainNumber === "12920" && b.bookUpto === "DADN");
    expect(upto).toBeTruthy();
    expect(upto?.boardAt).toBe("LDH");
    expect(upto?.destination).toBe("INDB");
    expect(upto?.availability.classCode).toBe("SL");
    expect(upto?.availability.status).toBe("AVAILABLE");
    expect(p.notes.some((n) => /Book-upto scan/.test(n))).toBe(true);
  });
});
