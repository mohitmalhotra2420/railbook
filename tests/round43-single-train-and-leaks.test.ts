/* ══ ROUND-43 (27 Sep 2026) — user ke 3 screenshots ne 3 asli bug dikhaye:
 *   1. "12054 ki seat availability btana" → poora 16-train board khul gaya, us train ka jawab nahi
 *      (jabki ChatGPT 27/28/29 Sep ki saaf date-wise availability deta hai)
 *   2. reply me tool ke INTERNAL instructions user ko dikh gaye ("Jawab me SAARI trains ki lines likho…
 *      mat likho… SEAT rows me hain", "(0 ka alag board check kiya)")
 *   3. seat card ka "Book" tap par passenger form nahi khula (client state khaali → chupke chat message)
 * Fix: single-train availability deterministic handler (aaj+kal date-wise, per class, ChatGPT-style) ·
 * scrubInternalNotes (reply se internal notes/noise) · Book button route/date har verified source se.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { asksSingleTrainAvailability, scrubInternalNotes } from "../server/agent/answerMode";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("Round-43 · khaas train ki seat availability (poora board nahi)", () => {
  it("single-train sawaal pehchano; route-level sawaal board hi rahe", () => {
    for (const q of ["12054 ki seat availability btana", "12054 me 3A me seat hai kya", "15906 me berth milega kya", "12054 ki availability kal ki"]) {
      expect(asksSingleTrainAvailability(q), q).toBe(true);
    }
    for (const q of ["ASR se NDLS kal 2A me kaunsi train me seat hai", "sabse sasti seat wali train batao", "12054 ke alawa aur trains batao", "aaj ki trains batao"]) {
      expect(asksSingleTrainAvailability(q), q).toBe(false);
    }
  });

  it("run.ts me deterministic handler hai — CHECK_AVAILABILITY, aaj+kal, date-wise blocks", () => {
    const r = read("server/agent/run.ts");
    expect(r).toContain("(asksSingleTrainAvailability(t) || resumeTrain) && !isBookingMutation(req)");
    /* Round-43b: multi-turn resume — train pehle select ho chuki ho to date/class wale follow-up
     * ("Date aaj ki ludhiana se hw ki", "CC") par bhi wahi train ka date-wise jawab. */
    expect(r).toContain("ctxResume.selectedTrainNumber");
    expect(r).toContain("resumeBareClass");
    expect(r).toContain('failureReason: "single_train_availability_deterministic"');
    expect(r).toContain("const dates = given ? [given] : [ymd(baseMs), ymd(baseMs + 86400000)]");
    expect(r).toContain('train cancelled');
    expect(r).toContain("seat availability:");
  });

  it("awaaz/labels: aaj/kal + month label + per-class status ₹", () => {
    const r = read("server/agent/run.ts");
    expect(r).toContain('const label = (d: string) => (d === ymd(baseMs) ? "aaj" : d === ymd(baseMs + 86400000) ? "kal" : "")');
    expect(r).toContain("Jan\",\"Feb\",\"Mar");
    expect(r).toContain("AVAILABLE ${c.seats ?? \"?\"}");
  });
});

describe("Round-43 · internal notes user tak nahi (screenshot leak)", () => {
  it("instruction lines poori tarah scrub", () => {
    const dirty = `12054 ASR→HW.
Jawab me SAARI trains ki lines likho (jo SEAT rows me hain) — 'baaki trains kisi card me hain' jaisi baat kabhi mat likho.
(Source: web_confirmtkt · 2 trains dekhe (0 ka alag board check kiya).)
2S AVAILABLE 294 ₹205.`;
    const clean = scrubInternalNotes(dirty);
    expect(clean).not.toMatch(/SAARI|mat likho|SEAT rows|card me hain|board check kiya|trains dekhe/i);
    expect(clean).toContain("2S AVAILABLE 294 ₹205");
  });

  it("scrubber khaali/punctuation-only lines chhodta nahi", () => {
    const clean = scrubInternalNotes("Jawab me SAARI lines likho (jo SEAT rows me hain).\n\n• Kal: 2S AVAILABLE 294");
    expect(clean).toBe("• Kal: 2S AVAILABLE 294");
  });

  it("agentic pipeline me scrubber lagi hai (model reply + deterministic summary dono)", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("const clean = scrubInternalNotes(scrubProactiveOffers(extracted.text));");
    expect(a).toContain("return scrubInternalNotes(deterministicSummaryRaw(steps));");
  });
});

describe("Round-43 · seat card ka Book → passenger form", () => {
  it("client handler route/date har verified source se leta hai (state → ctx → seat rows → picker)", () => {
    const c = read("src/views/Concierge.tsx");
    expect(c).toContain("const ctxB = agentCtxRef.current;");
    expect(c).toContain("const remembered = lastSeatRowsRef.current;");
    expect(c).toContain("const pickedB = lastPickedTrainRef.current;");
    expect(c).toContain("state.date || remembered?.date || pickedB?.date || ctxB?.date");
    expect(c).toContain("if (!from || !to || !date) {");
  });
});
