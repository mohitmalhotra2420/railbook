/* ══ ROUND-38 (27 Sep 2026) — user: "abh yeh AI ko samjhna chahiye tha … jaise chatgpt/gemini/claude/manus,
 * koi bhi trains/Indian Railway/booking/live status/stations sawaal (examples) par ek dum accurate
 * answer/outcome do" ══
 *
 * Live battery (tools/probe-r38-battery.mjs, 18 sawaal) se pakde gaye failure classes:
 *   1. "Ludhiana junction ke kitne platform hain?" → Wikipedia ka page "Raipur Haryana Junction railway
 *      station" ka aa gaya (GALAT station) — subject guard chahiye.
 *   2. "Sleeper coach me kitne berth hote hain?" → Vande Bharat ka page; "Rajdhani ki top speed" →
 *      kaam ka nahi; "Vande Bharat me khaana" → raw English — KB me ye stable facts hone chahiye.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { answerCoversSubject, subjectHitCount, subjectTokens } from "../server/agent/subject";
import { railKbAnswer } from "../server/agent/railkb";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("Round-38 · jawab ka subject match (galat station/train ka jawab user ko na jaaye)", () => {
  it("live bug: Ludhiana ke sawaal par Raipur ka page REJECT hota hai, sahi page PASS", () => {
    expect(answerCoversSubject("Ludhiana junction ke kitne platform hain?", "Raipur Haryana Junction railway station", "See trains from Hisar-Raipur to Jakhal-Bathinda")).toBe(false);
    expect(answerCoversSubject("Ludhiana junction ke kitne platform hain?", "Ludhiana Junction railway station", "Ludhiana Junction has 9 platforms")).toBe(true);
  });

  it("train number ka mismatch bhi pakda jaata hai (12054 ke sawaal par Vande Bharat ka page)", () => {
    expect(answerCoversSubject("12054 kahan pahunchi abhi", "Vande Bharat Express", "speeds up to 183 km/h")).toBe(false);
  });

  it("Hinglish fillers subject nahi bante (mujhe/batao/bhai par sahi page reject nahi hota)", () => {
    expect(subjectTokens("Mujhe Ludhiana ke bare me batao")).toEqual(["ludhiana"]);
    expect(subjectTokens("kya haal hai bhai")).toEqual([]);
    expect(answerCoversSubject("Mujhe Ludhiana ke bare me batao", "Ludhiana Junction railway station", "Ludhiana is a city in Punjab")).toBe(true);
  });

  it("generic railway shabdon par guard lagta hi nahi (sleeper/coach/berth)", () => {
    expect(subjectTokens("Sleeper coach me kitne berth hote hain?")).toEqual([]);
    expect(answerCoversSubject("Sleeper coach me kitne berth hote hain?", "Vande Bharat Sleeper", "16 coaches")).toBe(true);
  });

  it("hit count debug ke liye", () => {
    expect(subjectHitCount("Ludhiana junction platform", "Raipur Haryana Junction", "Hisar")).toBe(0);
    expect(subjectHitCount("Ludhiana junction platform", "Ludhiana Junction", "platforms 9")).toBe(1);
  });

  it("WEB_SEARCH me guard wire hai: galat page skip, sab reject → saaf 'sahi page nahi mila' (invent nahi)", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("let rejectedSubject: string | null = null;");
    expect(a).toContain("if (!answerCoversSubject(userText || q, ans.title, ans.text)) {");
    expect(a).toContain("Is sawaal ka sahi page nahi mila (mila tha: ${rejectedSubject} — alag subject)");
    /* KB/scrape ka mauka guard se PEHLE milna chahiye (warna KB wala sahi jawab chhut jaata hai). */
    const kbIdx = a.indexOf("const kb = railKbAnswer(userText || q)", a.indexOf("case \"WEB_SEARCH\""));
    const rejIdx = a.indexOf("if (rejectedSubject) {", a.indexOf("case \"WEB_SEARCH\""));
    expect(kbIdx).toBeGreaterThan(0);
    expect(rejIdx).toBeGreaterThan(kbIdx);
  });

  it("web-rescue me bhi subject match (pehla galat snippet nahi)", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("const best = (d.results ?? []).find((r) => answerCoversSubject(userText, r.title, r.snippet));");
  });
});

describe("Round-38 · KB me stable railway facts (battery me galat/aadhe jawab aa rahe the)", () => {
  it("coach berth count (SL 72 · 3A 64 · 2A 46 · 1A 22 · CC 78 · 2S 108 · EC 56)", () => {
    const a = railKbAnswer("Sleeper coach me kitne berth hote hain?") ?? "";
    expect(a).toContain("72 berths");
    expect(a).toContain("64 berths");
    expect(a).toContain("46 berths");
    expect(a).toContain("78 seats");
  });

  it("Rajdhani top speed (130 km/h MPS) + Vande Bharat (160 operational, 183 trial)", () => {
    const r = railKbAnswer("Rajdhani ki top speed kitni hoti hai?") ?? "";
    expect(r).toContain("130 km/h");
    const v = railKbAnswer("Vande Bharat ki maximum speed kya hai?") ?? "";
    expect(v).toContain("160 km/h");
    expect(v).toContain("183 km/h");
  });

  it("onboard khana/chai (IRCTC catering) aur platform count ka honest jawab", () => {
    expect(railKbAnswer("train me khana milta hai?") ?? "").toMatch(/IRCTC/);
    const p = railKbAnswer("Ludhiana junction ke kitne platform hain?") ?? "";
    expect(p).toContain("platform");
    expect(p).toMatch(/nahi hoti|nahi hota/); // honest: apna data nahi
    expect(p).toContain("indiarailinfo");
  });

  it("in topics par WB_SEARCH se pehle KB chalta hai (RULES_TOPIC_RE me words)", () => {
    const a = read("server/agent/agentic.ts");
    const re = /const RULES_TOPIC_RE = \/(.*)\/i;/s.exec(a)?.[1] ?? "";
    for (const w of ["khana", "khaana", "food", "meal", "chai", "berth", "platform", "top speed", "maximum speed"]) {
      expect(re, `${w} RULES_TOPIC_RE me hona chahiye`).toContain(w);
    }
  });
});
