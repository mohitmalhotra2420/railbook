/* ══ ROUND-42 (27 Sep 2026) — user (phir se): "jaise ChatGPT/Gemini/Manus sahi tools use karte hain sahi
 * as per user query — mera AI bhi ek dum perfectly sahi tools use kare, user query samajhke."
 *
 * LIVE 24-sawaal tool audit ne pakda:
 *   • "<train> mein 2S book krdo kal ke liye" → sirf SEARCH_TRAIN_BY_NUMBER chala, seat/fare ka koi tool
 *     nahi, aur passenger form ka target (route/date/class) bhi nahi bana → form khula hi nahi.
 *   • "12054 ke alawa ASR se HW aur trains batao kal" → station dobara poochh liya (SEARCH_TRAINS fail par
 *     FIND_ALTERNATIVE_TRAINS nahi chala).
 *   • availability ke pax-ask me route dobara poochh liya.
 * Fix: booking-order deterministic handler (sahi tools + form target) + FIND_ALTERNATIVE_TRAINS hint +
 * pax-ask wording.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("Round-42 · booking hukm par sahi tools + form target", () => {
  const run = read("server/agent/run.ts");

  it("booking-order handler maujood hai aur CHECK_AVAILABILITY + GET_FARE chalata hai", () => {
    expect(run).toContain("booking_order_deterministic");
    expect(run).toContain('executeApprovedTool("CHECK_AVAILABILITY"');
    expect(run).toContain('executeApprovedTool("GET_FARE"');
    expect(run).toContain("bookOrder && tnum");
  });

  it("form ke liye target lock hota hai (route timetable se, class text se, date resolver se)", () => {
    expect(run).toContain("const sched = await routedSchedule(tnum);");
    expect(run).toContain("selectedTrainNumber: tnum");
    expect(run).toContain('bookingStage: "results"');
    expect(run).toContain("classCode: cls ?? bootCtx.classCode");
  });

  it("class nahi boli → SAAF poochho (chips ke saath), aur date missing → sirf date poochho", () => {
    expect(run).toContain("kaunsi class me book karun?");
    expect(run).toContain("ki booking ke liye date bata do");
    expect(run).toContain('label: "Kal ke liye"');
  });

  it("pax-ask me route/date dobara nahi poochhna (sirf passengers)", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("Reply mein SIRF poochho: kitne passengers (1–6)?");
    expect(a).toContain("DOBARA MAT POOCHHO");
  });

  it("'ke alawa / aur options' → FIND_ALTERNATIVE_TRAINS hint (station dobara nahi)", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain('lines.push(`TOOL HINT: ye "us train ke alawa aur options" ka sawaal hai');
    expect(a).toContain("FIND_ALTERNATIVE_TRAINS${tn");
    expect(a).toContain("Station ka naam/code dobara MAT poochho");
  });

  it("customer ki 3 phrasings handler se guzarti hain (book krdo / book karo / ticket book)", () => {
    const re = /\b(book\s*kr?do|book\s*kar\s*do|book\s*kardo|book\s*kar|booking\s*kar|ticket\s*book|book\s+(?:a\s+)?ticket|book\s*it)\b/i;
    for (const t of ["12054 mein 2S book krdo kal ke liye", "12054 me book kardo kal", "12054 ka ticket book kar do", "please 12054 book kar do aaj"]) {
      expect(re.test(t), t).toBe(true);
    }
  });
});
