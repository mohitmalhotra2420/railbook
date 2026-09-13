/* Round-18m-30 (user screenshots LDH→BSB 14 Sept, 2 pax): RailBook ne 12238 ko 3A WL 3 / 2A WL 2 dikhaya
 * jabki ConfirmTkt JAT(train origin)→BSB par 3A RAC 19 / 2A RAC 12 dikhata tha. Wajah: 12238 mein 1A AVL
 * thi → "direct available" → earlier-stop/book-upto scan skip. User rule (non-negotiable): HAR direct
 * train ki HAR class jo boarding se WL/N-A hai → train origin→boarding ke stops se wahi class, phir
 * destination ke 2–3 stops aage — chahe doosri class/train mein seat ho ya na ho. */
import { describe, expect, it, vi } from "vitest";

const WL = (cls: string, wl: number, fare: number) => ({ code: cls, status: "WAITLIST", seats: null, rac: null, waitlist: wl, fare, source: "railcore", stale: false });
const RAC = (cls: string, n: number, fare: number) => ({ code: cls, status: "RAC", seats: null, rac: n, waitlist: null, fare, source: "railcore", stale: false });
const AVL = (cls: string, n: number, fare: number) => ({ code: cls, status: "AVAILABLE", seats: n, rac: null, waitlist: null, fare, source: "railcore", stale: false });
const NA = (cls: string) => ({ code: cls, status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, fare: 0, source: "railcore", stale: false });

const boards: Record<string, unknown[]> = {
  /* 12238 LDH→BSB: 1A AVL (isliye pehle scan skip hota tha), 3A/2A WL. */
  "12238:LDH>BSB": [AVL("1A", 4, 3100), WL("2A", 2, 1900), WL("3A", 3, 1300)],
  "12238:JRC>BSB": [WL("2A", 1, 1950), WL("3A", 2, 1350)],
  "12238:PTKC>BSB": [WL("2A", 1, 2000), WL("3A", 1, 1400)],
  "12238:JAT>BSB": [RAC("2A", 12, 2100), RAC("3A", 19, 1500)],
  /* 13152: LDH se sab N-A, kisi earlier stop se bhi nahi; destination ke aage (BSB→MGS) 3A AVL. */
  "13152:LDH>BSB": [NA("SL"), NA("3A"), NA("2A")],
  "13152:JRC>BSB": [NA("SL"), NA("3A"), NA("2A")],
  "13152:JAT>BSB": [NA("SL"), NA("3A"), NA("2A")],
  "13152:LDH>MGS": [NA("SL"), AVL("3A", 63, 1350), WL("2A", 10, 1950)],
};
const stops12238 = [
  { code: "JAT", name: "Jammu Tawi", departure: "18:25", day: 1 },
  { code: "PTKC", name: "Pathankot Cantt", departure: "20:30", day: 1 },
  { code: "JRC", name: "Jalandhar Cantt", departure: "22:05", day: 1 },
  { code: "LDH", name: "Ludhiana Jn", departure: "23:20", day: 1 },
  { code: "UMB", name: "Ambala Cantt", departure: "01:30", day: 2 },
  { code: "LKO", name: "Lucknow", departure: "12:30", day: 2 },
  { code: "BSB", name: "Varanasi Jn", arrival: "18:00", day: 2 },
];
const stops13152 = [
  { code: "JAT", name: "Jammu Tawi", departure: "20:30", day: 1 },
  { code: "JRC", name: "Jalandhar Cantt", departure: "23:50", day: 1 },
  { code: "LDH", name: "Ludhiana Jn", departure: "01:15", day: 2 },
  { code: "CNB", name: "Kanpur Central", departure: "15:00", day: 2 },
  { code: "BSB", name: "Varanasi Jn", arrival: "21:30", day: 2 },
  { code: "MGS", name: "Mughal Sarai", arrival: "22:45", day: 2 },
  { code: "PNBE", name: "Patna Jn", arrival: "02:30", day: 3 },
  { code: "KOAA", name: "Kolkata", arrival: "10:00", day: 3 },
];
const calls: string[] = [];
const T = (number: string, name: string, dep: string, arr: string, dur: number, cls: string[]) => ({ number, name, departure: dep, arrival: arr, durationMinutes: dur, classes: cls.map((code) => ({ code })), from: { code: "LDH", name: "Ludhiana Jn" }, to: { code: "BSB", name: "Varanasi Jn" }, runsOn: [], source: "railcore", days: 1 });

vi.mock("../server/railway/router.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/railway/router.js")>();
  return {
    ...mod,
    searchTrainsRouted: async (q: { from: string; to: string }) => {
      if (q.from === "LDH" && q.to === "BSB") return { trains: [T("12238", "BEGAMPURA EXP", "23:20", "18:00", 1120, ["1A", "2A", "3A"]), T("13152", "KOLKATA EXPRESS", "01:15", "21:30", 1215, ["SL", "3A", "2A"])], provider: "railcore" };
      return { trains: [], provider: "railcore" };
    },
    routedClassBoard: async (tn: string, _d: string, from: string, to: string, _q: string, hint: string[]) => {
      const k = `${tn}:${from}>${to}`;
      calls.push(`${k}:${[...hint].sort().join(",")}`);
      const b = (boards[k] ?? []) as { code: string }[];
      return { provider: b.length ? "railcore" : "none", classes: hint?.length ? b.filter((c) => hint.includes(c.code)) : b };
    },
    routedSchedule: async (tn: string) => ({ schedule: { trainNumber: tn, stops: tn === "12238" ? stops12238 : stops13152 }, provider: "railcore" }),
    getTrainScheduleRouted: async (tn: string) => ({ stops: tn === "12238" ? stops12238 : stops13152, provider: "railcore" }),
  };
});

describe("Round-18m-30: per-class earlier-stop / book-upto rescue runs even when another class/train has a seat", () => {
  it("12238 3A RAC 19 / 2A RAC 12 from JAT and 13152 3A AVL 63 (book upto MGS) surface for 2 pax", async () => {
    const { planJourney } = await import("../server/journey/engine.js");
    const p = await planJourney({ from: "LDH", to: "BSB", date: "2030-01-14", travelClass: null, preference: "best_overall", includeConnections: false, includeAlternativeDates: false, includePartial: false, includeAlternateStations: false, passengers: 2 });
    /* 1A AVL hai → direct "available" hi rahega (koi jhooth nahi) … */
    expect(p.directUnavailable).toBe(false);
    /* … lekin WL classes ke liye origin tak scan phir bhi chala (sirf WL/N-A classes probe hui, 1A dobara nahi). */
    expect(calls.some((c) => c.startsWith("12238:JAT>BSB:") && c.endsWith("2A,3A"))).toBe(true);
    expect(calls.some((c) => c.startsWith("12238:JRC>BSB:"))).toBe(true);
    expect(calls.some((c) => /^12238:(JAT|PTKC|JRC)>/.test(c) && c.includes("1A"))).toBe(false);
    const o12238 = p.routeOptions.find((o) => o.trainNumbers[0] === "12238")!;
    const alt = o12238.earlierStopOptions ?? [];
    expect(alt.length).toBeGreaterThan(0);
    const jat = alt.find((a) => a.bookFrom === "JAT")!;
    expect(jat).toBeTruthy();
    expect(jat.boardAt).toBe("LDH");
    expect(jat.destination).toBe("BSB");
    const rows = jat.classOptions ?? [jat.availability];
    expect(rows.find((r) => r.classCode === "3A")).toMatchObject({ status: "RAC", rac: 19 });
    expect(rows.find((r) => r.classCode === "2A")).toMatchObject({ status: "RAC", rac: 12 });
    /* 13152: earlier stops se kuch nahi → destination ke aage (MGS) 3A AVL 63 book-upto. */
    const o13152 = p.routeOptions.find((o) => o.trainNumbers[0] === "13152")!;
    const upto = (o13152.earlierStopOptions ?? []).find((a) => a.bookUpto === "MGS")!;
    expect(upto).toBeTruthy();
    expect(upto.bookFrom).toBe("LDH");
    expect((upto.classOptions ?? [upto.availability]).find((r) => r.classCode === "3A")).toMatchObject({ status: "AVAILABLE", seats: 63 });
    /* AI candidate sheet / hero ko bhi ye dikhe: recovery.boardFromEarlier populated. */
    expect((p.recovery?.boardFromEarlier ?? []).some((b) => b.trainNumber === "12238" && b.bookFrom === "JAT")).toBe(true);
    expect(p.audit?.bfeStopsChecked ?? 0).toBeGreaterThan(0);
    expect(p.notes.some((n) => /Class-wise scan/.test(n))).toBe(true);
  });
});
