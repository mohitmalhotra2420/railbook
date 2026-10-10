/* ══ ROUND-40 (27 Sep 2026) — user (3rd time, raat bhar): "AI khud kyu nhi samajhke sahi se outcome deta?
 * jaise chatgpt/gemini/claude/manus — koi bhi sawaal par ek dum accurate answer/outcome do."
 *
 * LIVE root cause (code): final answer ka `groundingCheck` HAR 3+ digit number / uppercase token ko
 * tool-evidence se match karta tha — model ka sahi general-knowledge jawab ("1969", "23 platforms")
 * bhi reject ho kar "verified data nahi mila" ban jaata tha.
 * Fix: KNOWLEDGE mode (general sawaal) me model ka jawab accept; LIVE mode (seat/fare/status/PNR/
 * booking) me strict grounding waisa hi. + typo/ASR normalisation + prompt rule 30.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { liveClaimCheck, liveDataQuestion, normalizeRailText } from "../server/agent/answerMode";
import { railKbAnswer } from "../server/agent/railkb";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("Round-40 · LIVE vs KNOWLEDGE mode (jadi fix)", () => {
  it("LIVE: khaas train ka seat/fare/status/PNR/platform/booking", () => {
    for (const q of [
      "12054 me kal ki seat availability",
      "12054 ka live status batao",
      "12054 ka 2S fare kitna hai kal ka",
      "12054 ka platform number kya hai",
      "mera PNR 4561237890 check karo",
      "12054 me 2S book krdo",
      "kal ke liye ticket book kar do",
      "bhai 12054 ki statsu batao",
    ]) {
      expect(liveDataQuestion(q), q).toBe(true);
    }
  });

  it("KNOWLEDGE: general railway sawaal (inme model apne knowledge se jawab de sakta hai)", () => {
    for (const q of [
      "Rajdhani ki top speed kitni hai?",
      "India me kitne railway station hain?",
      "3 saal ke bachche ka ticket chahiye kya?",
      "tatkal me ticket kaise book kare?",
      "sabse lambi train route kaunsi hai?",
      "Ludhiana station pe kitne platform hain?",
      "tum kya kya kar sakte ho?",
    ]) {
      expect(liveDataQuestion(q), q).toBe(false);
    }
  });

  it("finalization me: knowledge mode → live-claim check, live mode → strict grounding", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("const knowledgeMode = !liveDataQuestion(input.text);");
    expect(a).toContain("const check = knowledgeMode ? liveClaimCheck(clean, evidenceText) : groundingCheck(clean, steps, evidenceAll);");
    expect(a).toContain("const nextEvidence = knowledgeMode ? [...evidenceAll, clean] : evidenceAll;");
  });

  it("KB authoritative: knowledge mode + koi tool data nahi → curated KB jawab", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("if (knowledgeMode) {");
    expect(a).toContain('failureReason: "kb_authoritative"');
  });

  it("liveClaimCheck: fake ₹999 evidence me na ho to ungrounded", () => {
    const r = liveClaimCheck("CC fare sirf ₹999 hai", "12014 CC 675");
    expect(r.grounded).toBe(false);
    expect(r.evidence).toContain("999");
    const ok = liveClaimCheck("Platform 7 par hai", "TRACK_TRAIN result: platform 7");
    expect(ok.grounded).toBe(true);
  });

  it("NEXT chips knowledge mode me reply ke text se bhi validate hote hain (live me sirf tool evidence)", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("const nextActions = extracted.actions.filter((a) => groundingCheck(`${a.label} ${a.utterance}`, steps, nextEvidence).grounded);");
    expect(a).toContain("const val = dedicated.filter((a) => groundingCheck(`${a.label} ${a.utterance}`, steps, nextEvidence).grounded);");
  });
});

describe("Round-40 · typo/ASR samajhna (spelling ke bahane sawaal dobara nahi)", () => {
  it("common railway typos normalise hote hain", () => {
    expect(normalizeRailText("bhai 12054 ki statsu batao")).toContain("status");
    expect(normalizeRailText("gaadi 12054 kaha pahunchi")).toContain("train");
    expect(normalizeRailText("vande bharat ki spid")).toContain("vande bharat");
    expect(normalizeRailText("shatabadi ka time")).toContain("shatabdi");
    expect(normalizeRailText("availablity batao")).toContain("availability");
  });

  it("prompt me rule 30 (do modes + typo + 'sawaal ka jawab do, sawaal nahi')", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("30. DO MODES");
    expect(a).toContain("KNOWLEDGE sawaal par 'data nahi mila' bolna MANA hai jab jawab tumhe pata hai");
    expect(a).toContain("Spelling galat/adhoori ho sakti hai");
  });
});

describe("Round-40 · general knowledge KB (battery ke sawaal)", () => {
  it("pehli train 1853 Bori Bunder → Thane", () => {
    const a = railKbAnswer("India ki pehli train kab chali thi?") ?? "";
    expect(a).toContain("16 April 1853");
    expect(a).toContain("Bori Bunder");
    expect(a).toContain("Thane");
  });

  it("18 zonal railways (17 + Kolkata Metro; 19 ka counting-fark bhi bataya)", () => {
    const a = railKbAnswer("Indian Railways me kitne zones hain?") ?? "";
    expect(a).toMatch(/18 zonal railways/);
    expect(a).toContain("Kolkata Metro");
    expect(a).toContain("19");
  });

  it("kitne station (~7,300+) hedged", () => {
    const a = railKbAnswer("India me total kitne railway station hain?") ?? "";
    expect(a).toMatch(/7,3\d\d/);
  });

  it("sabse tez train = Vande Bharat 160 (Gatimaan saath)", () => {
    const a = railKbAnswer("India ki sabse tez train kaunsi hai?") ?? "";
    expect(a).toContain("Vande Bharat");
    expect(a).toContain("160 km/h");
  });

  it("RULES_TOPIC_RE me GK words (KB web se pehle)", () => {
    const a = read("server/agent/agentic.ts");
    const re = /const RULES_TOPIC_RE = \/(.*)\/i;/s.exec(a)?.[1] ?? "";
    for (const w of ["kitne zone", "pehli train", "sabse puran", "kitne railway station", "sabse tez train"]) {
      expect(re, w).toContain(w);
    }
  });
});
