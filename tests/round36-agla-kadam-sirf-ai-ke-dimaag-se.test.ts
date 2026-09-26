/* Round-36 (26 Sep 2026) — user: "agla kadam AI se aaye, wo khud ka dimaag lagaye jaise ChatGPT ya Gemini
 * lagata hai waisa hi next question poochhe aur soche kya poochhna hai, fallback pe verified data se na
 * aaye, aur AI har baar apna brain use kare."
 *
 * Yahan verify hota hai ki:
 *   1) client me "Agla kadam" card SIRF model ke validated nextActions se banta hai — koi data-derived
 *      fallback chip nahi (nextStepsFor UI se poora hata),
 *   2) server model se agla kadam lene ke liye DO koshish karta hai (pehli "apna dimaag lagao, jaise
 *      ChatGPT/Gemini" wali; doosri sakht sirf-[NEXT]) — aur dono fail par koi fallback nahi, saaf code,
 *   3) prompt rule 26 me likha hai ki fallback gone hai aur model har baar agla kadam khud soche,
 *   4) data-derived module maujood rehta hai (delete nahi) par UI me use nahi hota.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { extractNextActions } from "../server/agent/agentic";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const concierge = read("src/views/Concierge.tsx");
const agentic = read("server/agent/agentic.ts");

describe("Round-36 · 'Agla kadam' sirf AI ke dimaag se", () => {
  it("client me data-fallback branch aur import dono gaye", () => {
    expect(concierge).not.toContain('import { nextStepsFor }');
    expect(concierge).not.toContain('const ns = nextStepsFor({');
    expect(concierge).not.toContain('source: "data"');
  });

  it("model ke actions ho to hi card banta hai (source: model)", () => {
    expect(concierge).toContain("const modelActions = agentRes.nextActions ?? [];");
    expect(concierge).toMatch(/if \(modelActions\.length\) \{/);
    expect(concierge).toContain('source: "model"');
  });

  it("data-se-labels module delete nahi hua (sirf UI se hata) — purane tests safe", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/ai/nextstep.ts"))).toBe(true);
    expect(read("src/ai/nextstep.ts")).toContain("export function nextStepsFor");
  });
});

describe("Round-36 · model se agla kadam — do koshish, phir bhi fallback nahi", () => {
  it("counter 2 attempts tak chalta hai (ek boolean nahi)", () => {
    expect(agentic).toContain("let nextRepairAttempts = 0;");
    expect(agentic).toContain("nextRepairAttempts < 2 &&");
    expect(agentic).toContain("nextRepairAttempts += 1;");
  });

  it("pehli koshish: 'apna dimaag lagao — jaise ChatGPT/Gemini' (sawaal bhi suggest kar sakta hai)", () => {
    expect(agentic).toContain("Ab tum apna dimaag lagao — jaise ChatGPT/Gemini karte hain");
    expect(agentic).toContain("sawaal bhi ho sakta hai, jaise 'kaunsi class?' ya 'kis date ko?'");
  });

  it("doosri koshish: sakht, sirf ek [NEXT] line (warning-free)", () => {
    expect(agentic).toContain("AAKHRI KOSHISH: sirf EK line likho, format bilkul: [NEXT] <label> => <utterance>.");
  });

  it("dono fail → koi data fallback nahi, saaf failure code", () => {
    expect(agentic).toContain('"next_step_repair_empty_no_fallback"');
    expect(agentic).toContain('nextRepairAttempts > 1 ? "2" : ""');
  });

  it("Round-36b: dedicated chhota NEXT call (budget khatam hone par bhi model se hi agla kadam)", () => {
    expect(agentic).toContain("export async function nextStepFromModelOnly(");
    expect(agentic).toContain("AI_NEXT_STEP_TIMEOUT_MS ?? 12000");
    /* chhota/fast model (chain ka aakhri) — reasoning model ka time waste nahi */
    expect(agentic).toContain("transport.models.length > 1 ? transport.models[transport.models.length - 1] : transport.primaryModel");
    /* sirf tool data se, aur na mile to kuch nahi */
    expect(agentic).toContain("if (!data) return [];");
    expect(agentic).toContain('"next_step_from_dedicated_call"');
    expect(agentic).toContain('"next_step_dedicated_empty_no_fallback"');
    /* dedicated jawab bhi evidence se validate hota hai */
    expect(agentic).toContain("const val = dedicated.filter((a) => groundingCheck(`${a.label} ${a.utterance}`, steps, evidenceAll).grounded);");
  });

  it("grounded turn me hi repair (ungrounded replies ka apna treatment hai)", () => {
    const idx = agentic.indexOf("!nextActions.length &&");
    const block = agentic.slice(idx, idx + 420);
    expect(block).toContain("nextRepairAttempts < 2");
    expect(block).toContain("check.grounded");
    expect(block).toContain("okSteps.length > 0");
    expect(block).toContain("timeLeft() > 9000");
  });
});

describe("Round-36 · prompt rule 26 (AI har baar apna brain use kare)", () => {
  it("rule me saaf likha hai: fallback gone, [NEXT] na do to card dikhega hi nahi", () => {
    expect(agentic).toContain("Ab koi data-derived fallback nahi hai: [NEXT] nahi diya to user ko agla kadam dikhega hi nahi");
    expect(agentic).toContain("Isliye apna dimaag lagao jaise ChatGPT/Gemini lagate hain");
    expect(agentic).toContain("ya koi saaf sawaal ('kaunsi class me book karun?')");
  });

  it("teenon naye rules saath hain (27/28 upar, 26 neeche — purana order waisa hi)", () => {
    const i27 = agentic.indexOf("27. SAARE TOOLS KHULE HAIN");
    const i28 = agentic.indexOf("28. SAWAAL KA MATLAB PEHLE");
    const i26 = agentic.indexOf("26. AGLA KADAM");
    expect(i27).toBeGreaterThan(0);
    expect(i28).toBeGreaterThan(i27);
    expect(i26).toBeGreaterThan(i28);
  });
});

describe("Round-36 · parsing contract wahi rehta hai (model ka [NEXT])", () => {
  it("model ka NEXT-repair jawab bhi normal [NEXT] parsing se guzarta hai", () => {
    const content = "[NEXT] 12013 · CC (AVL 650 ₹675) => 12013 mein CC book krdo";
    const { text, actions } = extractNextActions(content);
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toContain("12013");
    expect(actions[0].primary).toBe(true);
    expect(text).not.toContain("[NEXT]");
  });

  it("[NEXT] NONE ko koi action nahi samjha jaata (model saaf mana kar sake)", () => {
    const { actions } = extractNextActions("[NEXT] NONE");
    expect(actions.length).toBe(0);
  });
});
