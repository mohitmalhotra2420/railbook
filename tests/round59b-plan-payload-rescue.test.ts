/* ══ ROUND-59b (29 Sep 2026, prod verification se mila) ════════════════════════════════════════════════
 * Playwright se prod par dekha: "…ka poora plan banao — connecting trains aur leg-wise seat bhi dikhao
 * (1 passenger ke liye)" par model ne kabhi kabhi **sirf text** (ek markdown table: "Leg 1 | Leg 2 | …")
 * diya aur koi plan payload nahi — us waqt card hi nahi banta tha, isliye Leg 1/Leg 2 dikhte hi nahi the
 * (yahi user ka screenshot tha).
 *
 * Fix: `isPlanAsk()` + AI-first branch me rescue — model payload na de to wahi planJourney engine chalta
 * hai (R45 ka usool: deterministic sirf rescue). Ye test:
 *   • phrase detection (kitne bhi naye sawaalon par chale — per-question rule nahi),
 *   • control: normal sawaal par rescue trigger na ho.
 */
import { describe, expect, it } from "vitest";
import { isPlanAsk } from "../server/agent/run";

describe("Round-59b · plan ka sawaal pehchanna (payload rescue ka trigger)", () => {
  it("client ke plan-page ka text aur user ke apne shabd — dono pakadta hai", () => {
    expect(isPlanAsk("ASR se LDH 2026-09-30 ka poora plan banao — connecting trains aur leg-wise seat bhi dikhao (1 passenger ke liye)")).toBe(true);
    expect(isPlanAsk("LDH se JAT kal ka poora plan banao")).toBe(true);
    expect(isPlanAsk("poori journey ka plan bana do")).toBe(true);
    expect(isPlanAsk("plan banao ASR se LDH")).toBe(true);
    expect(isPlanAsk("Amritsar se Ludhiana plan banado")).toBe(true);
    expect(isPlanAsk("kal ke liye pura plan bna do")).toBe(true);
  });

  it("aam sawaalon par nahi (control) — rescue sirf plan par", () => {
    expect(isPlanAsk("Ludhiana se amritsar ki confirm trains btana kal ke liye")).toBe(false);
    expect(isPlanAsk("ASR se LDH kal 3A me seat batao")).toBe(false);
    expect(isPlanAsk("inme se best train kaunsi hai")).toBe(false);
    expect(isPlanAsk("12013 ki seat availability")).toBe(false);
    expect(isPlanAsk("")).toBe(false);
  });
});
