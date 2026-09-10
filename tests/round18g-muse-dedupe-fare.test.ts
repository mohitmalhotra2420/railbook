/**
 * Round-18g — (1) duplicate tool_calls from the model (Muse sends WEB_SEARCH ×3)
 * execute once and every tool_call_id still gets a tool message; (2) seat rows
 * from RailRadar/IndianRailAPI (fare 0) get fare filled from a separate fare
 * source with its own provenance (never mixed into seats).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("Round-18g agentic duplicate tool_calls", () => {
  const src = readFileSync("server/agent/agentic.ts", "utf8");
  it("dedupes same name+args tool calls and relays results to duplicate ids", () => {
    expect(src).toContain("const seenCalls = new Set<string>()");
    expect(src).toContain("for (const d of dupIds)");
    expect(src).toMatch(/tool_call_id: d\.id/);
  });
});

describe("Round-18g fare fill for extra-API seat rows", () => {
  const src = readFileSync("server/railway/router.ts", "utf8");
  it("fills fare via railradarFare → erail and records fareSource separately", () => {
    expect(src).toContain("async function withFareFilled(");
    expect(src).toMatch(/fareSource: "railradar"/);
    expect(src).toMatch(/fareSource: "web_erail"/);
    expect(src).toMatch(/if \(row\.fare > 0\) return row;/);
  });
});

describe("Round-18g concept questions never open the train-name picker", () => {
  it("CONCEPT_QUESTION_RE matches comparison/superlative phrasing", async () => {
    const { CONCEPT_QUESTION_RE } = await import("../server/agent/context.js");
    for (const q of ["Rajdhani aur Shatabdi mein kya fark hai", "India mein sabse lambi train journey kaunsi hai", "vande bharat kya hoti hai", "Bharat ka sabse bada railway station kaunsa hai"]) expect(CONCEPT_QUESTION_RE.test(q), q).toBe(true);
    expect(CONCEPT_QUESTION_RE.test("Amritsar Shatabdi ka time kya hai?")).toBe(false);
  });
});

describe("Round-18h client: knowledge questions never classified as list-pick", () => {
  it("'Bharat ki pehli train kab chali thi' is not train_pick; '12014 wali' still is", async () => {
    const { classifyFollowUp } = await import("../src/ai/agent");
    expect(classifyFollowUp("Bharat ki pehli train kab chali thi")).not.toBe("train_pick");
    expect(classifyFollowUp("India ki first train kab shuru hui")).not.toBe("train_pick");
    expect(classifyFollowUp("12014 wali")).toBe("train_pick");
    expect(classifyFollowUp("pehli wali")).toBe("train_pick");
  });
});

describe("Round-18i: rules questions answer from KB (tatkal timing), fact questions still go to web", () => {
  it("WEB_SEARCH for 'IRCTC tatkal booking kab shuru hoti hai' returns kb with 10:00 AM timing", async () => {
    const { executeApprovedTool } = await import("../server/agent/agentic");
    const r = await executeApprovedTool("WEB_SEARCH", { query: "IRCTC tatkal booking timing" }, { userText: "IRCTC tatkal booking kab shuru hoti hai" } as never);
    expect(r.ok).toBe(true);
    expect(r.source).toBe("kb");
    expect(r.summary).toMatch(/10:00 AM/);
  });
  it("railKbAnswer resolves 'RAC ka matlab kya hai'", async () => {
    const { railKbAnswer } = await import("../server/agent/railkb");
    expect(railKbAnswer("RAC ka matlab kya hai")).toMatch(/Reservation Against Cancellation/);
  });
});
