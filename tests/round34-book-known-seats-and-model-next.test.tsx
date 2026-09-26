/* Round-34 (26 Sep 2026) — user ke do naye points:
 *
 * 1) Screenshot: seat list pehle hi dikh chuki thi (12380 · 5 classes · 5 me seat), phir "Book 12380"
 *    par AI ne phir "kitne passengers hain?" poochha aur SELECT TRAIN card dikha diya.
 *    User: "eske pass seats to pehle hi hain to fir kyu dubara pooch rha, kya AI apna brain use nhi
 *    kar raha?" → (a) "Book 12380" bhi booking hukm hai (isBookingIntent ka purana regex sirf
 *    "book … kar/krdo" pakadta tha), (b) jo seat rows ek baar dikh chuki hain wo YAAD rehti hain —
 *    form usi asli data se bharta hai, dobara check ka bahana nahi.
 *
 * 2) "Agla kadam na humesha AI hi chunne sabh sochke and suggestions bhi de user ko — agla kadam
 *    fallback pe verified data se mat aaye" → model ne [NEXT] na di ho par turn me verified data hai
 *    to ek NEXT-repair call se MODEL se hi agla kadam maanga jaata hai (data fallback aakhri upay).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isBookingIntent, pickRowForBooking, buildAutoBookSeat } from "../src/booking/autobook";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("Round-34 · 'Book 12380' bhi booking hukm hai", () => {
  it("train number ke saath seedha 'book <number>' — haan", () => {
    expect(isBookingIntent("Book 12380")).toBe(true);
    expect(isBookingIntent("book 12013")).toBe(true);
    expect(isBookingIntent("12380 book")).toBe(true);
    expect(isBookingIntent("Book 12380 krdo")).toBe(true);
    expect(isBookingIntent("12013 mein CC book krdo")).toBe(true);
  });

  it("sawaal ya train-number ke bina 'book' par trigger nahi (koi jhootha form nahi)", () => {
    expect(isBookingIntent("book karna hai?")).toBe(false);
    expect(isBookingIntent("book")).toBe(false);
    expect(isBookingIntent("booking kaise hoti hai")).toBe(false);
    expect(isBookingIntent("12013 ki seat availability batao")).toBe(false);
    expect(isBookingIntent("Book 12380?")).toBe(false);
  });

  it("server ka intent BOOK_TRAIN ho to hamesha haan", () => {
    expect(isBookingIntent("kuch bhi", "BOOK_TRAIN")).toBe(true);
  });

  it("purane patterns intact", () => {
    expect(isBookingIntent("22432 mein 3A book krdo")).toBe(true);
    expect(isBookingIntent("ticket kar do")).toBe(true);
    expect(isBookingIntent("fare kitna hai")).toBe(false);
  });
});

describe("Round-34 · pehle dikhayi gayi seat rows se hi form bharta hai", () => {
  const shown = [
    { number: "12380", name: "JALIANWALA B EX", classCode: "3A", status: "AVAILABLE", seats: 26, rac: null, waitlist: null, fare: 565, departure: "13:25" },
    { number: "12380", name: "JALIANWALA B EX", classCode: "2A", status: "AVAILABLE", seats: 18, rac: null, waitlist: null, fare: 770, departure: "13:25" },
  ];

  it("class boli ho to wahi class ki row", () => {
    expect(pickRowForBooking(shown, "12380", "2A")?.classCode).toBe("2A");
  });

  it("class na boli ho to pehli openable row (order preserve — jo dikha wahi)", () => {
    expect(pickRowForBooking(shown, "12380")?.classCode).toBe("3A");
  });

  it("seat data se hi honest auto-book seat banta hai (fare/status wahi)", () => {
    const row = pickRowForBooking(shown, "12380", "3A");
    const seat = buildAutoBookSeat({ trainNumber: "12380", classWanted: "3A", row, trainRow: null, source: "web_confirmtkt" });
    expect(seat.classCode).toBe("3A");
    expect(seat.status).toBe("AVAILABLE");
    expect(seat.seats).toBe(26);
    expect(seat.fare).toBe(565);
    expect(seat.source).toBe("web_confirmtkt");
  });

  it("rows na milein to bhi seat banta hai par status UNKNOWN (kuch invent nahi)", () => {
    const seat = buildAutoBookSeat({ trainNumber: "12380", classWanted: null, row: null, trainRow: null, source: null });
    expect(seat.status).toBe("UNKNOWN");
    expect(seat.fare).toBeNull();
  });

  it("client pichhle turn ki rows yaad rakhta hai (route/date match par hi use)", () => {
    const src = read("src/views/Concierge.tsx");
    expect(src).toContain("const lastSeatRowsRef = useRef<{");
    expect(src).toContain("lastSeatRowsRef.current = {");
    expect(src).toContain("remembered.from === routeFrom.code && remembered.to === routeTo.code && remembered.date === routeDate");
    expect(src).toContain("...(sf?.rows ?? []), ...(sf?.wlRows ?? []), ...rememberedOk");
  });
});

describe("Round-34 · agla kadam hamesha model chune (fallback aakhri upay)", () => {
  const src = read("server/agent/agentic.ts");

  it("NEXT-repair pass maujood hai (model se hi agla kadam)", () => {
    expect(src).toContain("let nextRepairReply: string | null = null;");
    expect(src).toContain("let nextRepaired = false;");
    expect(src).toContain("tumne jawab to de diya par [NEXT] lines nahi di");
    expect(src).toContain("nextRepairReply !== null");
    expect(src).toContain('failureReason: acts.length ? "next_step_from_model_repair" : "next_step_repair_empty"');
  });

  it("repair sirf tab jab is turn me kaam ka data aaya ho (khaali turn par zabardasti nahi)", () => {
    const idx = src.indexOf("if (\n      !nextActions.length &&");
    const block = src.slice(idx, idx + 320);
    expect(block).toContain("okSteps.length > 0");
    expect(block).toContain("timeLeft() > 9000");
    expect(block).toContain("step < MAX_STEPS");
  });

  it("prompt rule 26 ab kehta hai: data ho to [NEXT] ZAROOR (suggestions AI ke)", () => {
    expect(src).toContain("jab bhi is turn me koi KAAM KA data aaya ho (train/seat/fare/timing/status/plan/route), [NEXT] ZAROOR likho");
    expect(src).toContain("user ka data-derived fallback tabhi chalta hai jab tumne kuch na diya ho");
  });

  it("repair response sirf agla kadam leta hai, jawab purana hi rehta hai", () => {
    expect(src).toContain("reply: nextRepairReply,");
    expect(src).toContain("nextActions: acts.length ? acts : null,");
  });

  it("client model-first hi rehta hai (tag 'AI ne chuna') — fallback sirf [NEXT] na hone par", () => {
    const c = read("src/views/Concierge.tsx");
    const a = c.indexOf("const modelActions = agentRes.nextActions ?? [];");
    const n = c.indexOf("const ns = nextStepsFor({", a);
    expect(a).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(a);
    expect(c).toContain('source: "model"');
    expect(c).toContain('source: "data"');
  });
});
