/* 24 Sep 2026 (user screenshot: ConfirmTkt app ne 20986 MCTM KOTA EXP ke liye "Same Train Confirmed
 * Alternate Option — Book From Jammu Tawi (JAT 19:48) → Board LDH 00:40 → MTJ 07:55, 2A RAC 10 ₹1610"
 * dikhaya; RailBook ne kuch nahi dikhaya). User ka sawaal: "AI ne acha se check kyu nahi kiya?"
 *
 * Do asli bugs mile (dono fix ho gaye):
 *  A) Provider rows (web_railyatri/railkit/railradar/indianrailapi/railcore) sirf `code` bhejti thi,
 *     `classCode` nahi — journey ka earlier-stop scan `r.classCode` padhta hai → `need.includes(undefined)`
 *     false → saari rows filter (isliye 20986 ka RAC option kabhi surface hi nahi hota).
 *  B) Schedule me `day` field aksar nahi aata (module schedule me sab stops day=1) → earlier stop ka
 *     segDate GALAT (boarding ka din) ban jaata tha. 20986 ka JAT leg 24 Sep ka hai, hum 25 Sep poochh
 *     rahe the → board khaali. Ab din clock-time se infer hote hain (departure peeche chala = agla din).
 *
 * Ye test exactly wahi shape banata hai: schedule bina `day`, boards jisme sirf `code` hai, aur board
 * sirf PREVIOUS din ki date par maujood hai (jaise asli me tha).
 */
import { describe, expect, it, vi } from "vitest";
import * as router from "../server/railway/router";

/** Asli schedule (20986): MCTM 18:45 → JAT 19:48 → … → LDH 00:40 (agle din) → … → MTJ 07:55. `day` NAHI. */
const stops20986 = [
  { code: "MCTM", name: "MCTM", departure: "18:45" },
  { code: "JAT", name: "Jammu Tawi", arrival: "19:42", departure: "19:48" },
  { code: "MSKT", name: "MC Sunil Kathua", arrival: "20:50", departure: "20:52" },
  { code: "PTKC", name: "Pathankot Cantt", arrival: "21:32", departure: "21:37" },
  { code: "JRC", name: "Jalandhar Cantt", arrival: "23:25", departure: "23:30" },
  { code: "LDH", name: "Ludhiana Jn", arrival: "00:30", departure: "00:40" },
  { code: "DUI", name: "Dhuri", arrival: "01:30", departure: "01:32" },
  { code: "NDLS", name: "New Delhi", arrival: "05:55", departure: "06:10" },
  { code: "NZM", name: "Hazrat Nizamuddin", arrival: "06:21", departure: "06:23" },
  { code: "MTJ", name: "Mathura Jn", arrival: "07:55", departure: "08:00" },
];

/** Provider row shape (web_railyatri): sirf `code` — `classCode` nahi (yahi bug A tha). */
const row = (code: string, status: string, bits: { rac?: number; waitlist?: number; seats?: number }, fare: number) => ({
  code,
  status,
  seats: bits.seats ?? null,
  rac: bits.rac ?? null,
  waitlist: bits.waitlist ?? null,
  fare,
  source: "web_railyatri",
  stale: false,
});

describe("same-train alternate option (20986 JAT→MTJ 2A RAC 10) ab milta hai", () => {
  it("schedule me `day` na ho + rows me `classCode` na ho — phir bhi train-origin ka option surface hota hai", async () => {
    const calls: { train: string; date: string; from: string; to: string }[] = [];
    const spySched = vi.spyOn(router, "routedSchedule").mockResolvedValue({
      schedule: { trainNumber: "20986", trainName: "MCTM KOTA EXP", stops: stops20986 },
      provider: "web_confirmtkt",
    } as never);
    const spyBoard = vi.spyOn(router, "routedClassBoard").mockImplementation(async (tn: string, date: string, from: string, to: string) => {
      calls.push({ train: tn, date, from, to });
      /* Sirf 24 Sep (pichhla din) ke JAT→MTJ board par RAC 10 hai — jaise asli data me tha.
       * 25 Sep wale board par 20986 hai hi nahi (isliye khaali). */
      if (date === "2026-09-24" && from === "JAT" && to === "MTJ") {
        return { classes: [row("2A", "RAC", { rac: 10 }, 1610), row("3A", "WAITLIST", { waitlist: 4 }, 1150)], provider: "web_railyatri" } as never;
      }
      return { classes: [], provider: "none" } as never;
    });

    const { findBoardFromEarlier } = await import("../server/journey/engine.js");
    const r = await findBoardFromEarlier({
      trains: [{ number: "20986", name: "MCTM KOTA EXP", classes: ["1A", "2A", "3A", "3E", "SL"], needClasses: ["2A", "3A", "3E", "SL"], directWl: { "2A": 1, "3A": 5, "3E": 1, SL: 13 }, durationMinutes: 435 }] as never,
      origin: "LDH",
      destination: "MTJ",
      date: "2026-09-25",
      travelClass: null,
      limitTrains: 20,
      passengers: 1,
      mode: "earlier",
    });

    const jat = r.options.find((o) => o.bookFrom === "JAT");
    expect(jat, "JAT se option milna chahiye (ConfirmTkt jaisa)").toBeTruthy();
    expect(jat!.availability.status).toBe("RAC");
    expect(jat!.availability.rac).toBe(10);
    expect(jat!.availability.fare).toBe(1610);
    /* Boarding/deboarding user ke hi stations par — passenger LDH par chadhta hai, MTJ utarta hai. */
    expect(jat!.boardAt).toBe("LDH");
    expect(jat!.destination).toBe("MTJ");
    expect(jat!.stopsBefore).toBe(4); // JAT index 1 → LDH index 5 (beech ke stops bhi count hote hain)
    /* Sabse zaroori: JAT ka board PREVIOUS din (24 Sep) ka poochha gaya — 25 Sep ka nahi. */
    expect(calls.some((c) => c.from === "JAT" && c.date === "2026-09-24")).toBe(true);
    expect(calls.some((c) => c.from === "JAT" && c.date === "2026-09-25")).toBe(false);
    spySched.mockRestore();
    spyBoard.mockRestore();
  });

  it("classCode ke bina rows (sirf `code`) par bhi need-classes filter kaam karta hai", async () => {
    const spySched = vi.spyOn(router, "routedSchedule").mockResolvedValue({
      schedule: { trainNumber: "1", trainName: "T", stops: [{ code: "AAA", departure: "10:00" }, { code: "LDH", departure: "12:00" }, { code: "MTJ", arrival: "18:00" }] },
      provider: "mock",
    } as never);
    const spyBoard = vi.spyOn(router, "routedClassBoard").mockResolvedValue({
      classes: [row("2A", "RAC", { rac: 7 }, 900), row("SL", "WAITLIST", { waitlist: 40 }, 300)],
      provider: "web_railyatri",
    } as never);
    const { findBoardFromEarlier } = await import("../server/journey/engine.js");
    const r = await findBoardFromEarlier({
      trains: [{ number: "1", name: "T", classes: ["2A", "SL"], needClasses: ["2A"], directWl: { "2A": 3 }, durationMinutes: 360 }] as never,
      origin: "LDH",
      destination: "MTJ",
      date: "2026-09-25",
      limitTrains: 1,
      passengers: 1,
      mode: "earlier",
    });
    expect(r.options.length).toBe(1);
    /* Sirf 2A (need class) — SL row skip (wo need me nahi thi). */
    expect((r.options[0].classOptions ?? []).every((c) => (c.classCode ?? (c as { code?: string }).code) === "2A")).toBe(true);
    spySched.mockRestore();
    spyBoard.mockRestore();
  });

  it("nearest stop par seat mile to bhi SAARE earlier stops probe hote hain (JAT bhi list me) — user ki explicit demand", async () => {
    const probed: string[] = [];
    const spySched = vi.spyOn(router, "routedSchedule").mockResolvedValue({
      schedule: { trainNumber: "20986", trainName: "MCTM KOTA EXP", stops: stops20986 },
      provider: "web_confirmtkt",
    } as never);
    /* ConfirmTkt jaisa: JRC (nearest) par bhi RAC hai AUR JAT par bhi RAC 10 ₹1610 — dono dikhne chahiye. */
    const spyBoard = vi.spyOn(router, "routedClassBoard").mockImplementation(async (_tn: string, date: string, from: string, to: string) => {
      if (date !== "2026-09-24" || to !== "MTJ") return { classes: [], provider: "none" } as never;
      probed.push(from);
      if (from === "JRC") return { classes: [row("2A", "RAC", { rac: 8 }, 1290)], provider: "web_railyatri" } as never;
      if (from === "JAT") return { classes: [row("2A", "RAC", { rac: 10 }, 1610)], provider: "web_railyatri" } as never;
      return { classes: [], provider: "none" } as never;
    });
    const { findBoardFromEarlier } = await import("../server/journey/engine.js");
    const r = await findBoardFromEarlier({
      trains: [{ number: "20986", name: "MCTM KOTA EXP", classes: ["2A"], needClasses: ["2A"], directWl: { "2A": 1 }, durationMinutes: 435 }] as never,
      origin: "LDH",
      destination: "MTJ",
      date: "2026-09-25",
      limitTrains: 1,
      passengers: 1,
      mode: "earlier",
    });
    const jat = r.options.find((o) => o.bookFrom === "JAT");
    expect(jat, "JRC par seat hone ke baad bhi JAT probe hona chahiye").toBeTruthy();
    expect(jat!.availability.rac).toBe(10);
    expect(jat!.availability.fare).toBe(1610);
    /* Train origin (MCTM, 5 stop pehle) tak saare stops probe hue — JRC aur JAT dono. */
    expect(probed).toContain("JRC");
    expect(probed).toContain("JAT");
    expect(probed).toContain("MCTM");
    spySched.mockRestore();
    spyBoard.mockRestore();
  });
});
