/* ══ ROUND-39 (27 Sep 2026) — 24-naye-sawaal live battery ke natije:
 *   node tools/probe-r39-battery.mjs (24 sawaal, 8 category)
 *
 * Battery me jo weak nikle (asli live app par):
 *   • "Ludhiana se Amritsar kitni doori hai?" → Delhi–Amritsar–Katra EXPRESSWAY (sadak) ka jawab
 *   • "Kutta train me le ja sakte hain?" / "smoking allowed?" / "charging point?" / "AC kharab refund?"
 *     / "3A vs 2A fare fark?" → "verified data nahi mila" (KB me nahi the)
 *   • "Indian Railways ka sabse bada station?" → kuch nahi; "Konkan Railway kahan se kahan?" → galat page
 *   • "Tum kya nahi kar sakte?" → AI ne BOOKING FLOW shuru kar diya ("Kahan se jaana hai?") 😑
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { railKbAnswer } from "../server/agent/railkb";
import { capabilityReply } from "../src/ai/facts";
import { runAgent } from "../server/agent/run";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("Round-39 · capability/meta sawaal (battery me booking flow shuru ho gaya tha)", () => {
  it("'Tum kya nahi kar sakte?' → fixed honest jawab, koi booking sawaal nahi", async () => {
    const r: any = await runAgent({ text: "Tum kya nahi kar sakte?", history: [], known: {}, now: new Date().toISOString() } as any);
    expect(r.failureReason).toBe("capability_meta_answer");
    expect(String(r.reply)).toContain("Main RailBook AI hoon");
    expect(String(r.reply)).toContain("Continue to IRCTC");
    expect(String(r.reply)).not.toMatch(/Kahan se jaana hai/);
  });

  it("'Tum kya kya kar sakte ho?' + 'aap kaun ho?' bhi wahi jawab", async () => {
    for (const q of ["Tum kya kya kar sakte ho?", "aap kaun ho?"]) {
      const r: any = await runAgent({ text: q, history: [], known: {}, now: new Date().toISOString() } as any);
      expect(r.failureReason, q).toBe("capability_meta_answer");
    }
  });

  it("train number wale sawaal par capability handler nahi chalta", async () => {
    const src = read("server/agent/run.ts");
    expect(src).toContain("if (capabilityQ && !/\\b(\\d{4,5})\\b/.test(t)) {");
  });
});

describe("Round-39 · amenities ab sach bolte hain (client path)", () => {
  it("charging point: reserved coaches me hota hai, general me nahi (pehle 'gadh ke nahi bataunga')", () => {
    const a = capabilityReply("train me charging point hota hai?");
    expect(a).toMatch(/reserved coaches/i);
    expect(a).toMatch(/General/);
  });

  it("khana: pantry/catering ka asli jawab (IRCTC) — tests ka Pantry word bhi intact", () => {
    const a = capabilityReply("12014 mein khana milta hai?");
    expect(a).toMatch(/Pantry/);
    expect(a).toMatch(/IRCTC/);
    expect(a).toMatch(/number batao/);
  });

  it("blanket: AC me milti hai, SL me nahi", () => {
    const a = capabilityReply("blanket milti hai?");
    expect(a).toMatch(/AC classes/);
    expect(a).toMatch(/Sleeper/);
  });

  it("platform number: guess nahi, live status se", () => {
    const a = capabilityReply("platform number kya hai?");
    expect(a).toMatch(/live status|chart/);
    expect(a).toMatch(/guess/i);
  });
});

describe("Round-39 · general railway knowledge KB me (battery me khaali/galat aaya tha)", () => {
  it("sabse bada station = Howrah Jn (23 platforms) + top list", () => {
    const a = railKbAnswer("Indian Railways ka sabse bada station kaunsa hai?") ?? "";
    expect(a).toContain("Howrah");
    expect(a).toContain("23 platforms");
    expect(a).toContain("Sealdah");
  });

  it("sabse lambi route = Vivek Express (Dibrugarh → Kanyakumari, 4,286 km)", () => {
    const a = railKbAnswer("Sabse lambi train route kaunsi hai?") ?? "";
    expect(a).toContain("Vivek Express");
    expect(a).toMatch(/4,154|4,286/);
    expect(a).toContain("Kanyakumari");
  });

  it("Konkan Railway = Roha → Thokur (~741 km, 1998)", () => {
    const a = railKbAnswer("Konkan Railway kahan se kahan tak hai?") ?? "";
    expect(a).toContain("Roha");
    expect(a).toContain("Thokur");
    expect(a).toContain("741");
  });

  it("RULES_TOPIC_RE me in sawaalon ke words hain (KB pehle chalta hai)", () => {
    const a = read("server/agent/agentic.ts");
    const re = /const RULES_TOPIC_RE = \/(.*)\/i;/s.exec(a)?.[1] ?? "";
    for (const w of ["doori", "distance", "kutta", "pet", "smoking", "charging", "ac kharab", "bachch"]) {
      expect(re, `${w} RULES_TOPIC_RE me hona chahiye`).toContain(w);
    }
  });
});
