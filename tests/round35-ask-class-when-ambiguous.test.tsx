/* Round-35 (26 Sep 2026) — user: "mainay bola vaishno devi se ludhiana ki seat availability btao, AI ne
 * bta di; uske baad maine 19028 train mein multiple class mein seats available thi to maine bola
 * '19028 mein book krdo' … to AI ne yeh nahi poocha kaunsi class mein book karun … AI khud kyu nahi
 * soch raha, kya sahi logic se poochhna chahiye, khud kyu nahi dimag laga raha."
 *
 * Fix: class ambiguous ho (ek se zyada class me seat khuli ho aur user ne class na boli ho) to booking
 * se pehle USER se poochho — chips sirf un classes ke jo board par sach me khuli hain (AVL/RAC),
 * fare/status ke saath. Chip tap → wahi class wala booking sentence → passenger form.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { pickRowForBooking, isOpenableStatus } from "../src/booking/autobook";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const concierge = read("src/views/Concierge.tsx");
const orchestrate = read("src/ai/orchestrate.ts");
const agentic = read("server/agent/agentic.ts");

describe("Round-35 · block type 'classchoice'", () => {
  it("Block union me classchoice maujood hai (train + date + options)", () => {
    expect(orchestrate).toContain('type: "classchoice";');
    expect(orchestrate).toContain("trainNumber: string;");
    expect(orchestrate).toContain("utterance: string;");
    expect(orchestrate).toContain("fare?: number | null;");
  });

  it("card render hoti hai aur chip tap par utterance bhejti hai", () => {
    expect(concierge).toContain('if (block.type === "classchoice") {');
    expect(concierge).toContain("export function ClassChoiceCard(");
    expect(concierge).toContain('id="class-choice"');
    expect(concierge).toContain("onClick={() => onChip(o.utterance)}");
    expect(concierge).toContain("— kaunsi class me book karun?");
  });

  it("chip ka utterance wahi class wala booking hukm hai (jo form kholta hai)", () => {
    expect(concierge).toContain("utterance: `${tno} mein ${String(r.classCode ?? \"\").toUpperCase()} book krdo`");
  });
});

describe("Round-35 · gate: class ambiguous ho to form se pehle poochho", () => {
  it("do ya zyada seat-wali class par form RUK jaata hai (class-choice card)", () => {
    expect(concierge).toContain("const withSeat = thisTrain.filter((r) => /^(AVAILABLE|RAC)$/i.test(String(r.status ?? \"\")));");
    expect(concierge).toContain("if (!clsWanted && uniqClasses.length >= 2) {");
    expect(concierge).toContain("Kaunsi class me book karun? Neeche chip par tap karo.");
  });

  it("gate sirf tab jab user ne class na boli ho (clsWanted khaali)", () => {
    const idx = concierge.indexOf("if (!clsWanted && uniqClasses.length >= 2) {");
    const block = concierge.slice(idx, idx + 2600);
    expect(block).toContain('type: "classchoice"');
    expect(block).toContain("return;"); // form hold
  });

  it("ek hi class khuli ho to seedha wahi (poochhna nahi)", () => {
    /* >= 2 par hi poochhte hain — 1 class par purana seedha-form behaviour chalta rehta hai. */
    expect(concierge).toContain("uniqClasses.length >= 2");
    expect(concierge).not.toContain("uniqClasses.length >= 1");
  });

  it("class boli gayi ho to gate skip (user ki marzi chalti hai)", () => {
    expect(concierge).toContain("const clsWanted = (/\\b(1A|2A|3A|3E|2S|SL|CC|EC|EA|FC|GN)\\b/i.exec(trimmed)?.[1] ?? \"\").toUpperCase();");
  });
});

describe("Round-35 · class na boli ho to seat-wali class pehle (WL se pehle)", () => {
  const rows = [
    { number: "19028", classCode: "SL", status: "WAITLIST", seats: 0, waitlist: 73, rac: null, fare: 150, departure: "19:48" },
    { number: "19028", classCode: "3A", status: "AVAILABLE", seats: 26, waitlist: null, rac: null, fare: 565, departure: "19:48" },
    { number: "19028", classCode: "2A", status: "AVAILABLE", seats: 18, waitlist: null, rac: null, fare: 770, departure: "19:48" },
  ];

  it("list me SL (WL) pehle ho par form 3A (seat wali) ka khulta hai", () => {
    expect(pickRowForBooking(rows, "19028")?.classCode).toBe("3A");
  });

  it("koi seat nahi to purana behaviour — pehli openable (WL) row", () => {
    const wlOnly = rows.filter((r) => r.status !== "AVAILABLE");
    const picked = pickRowForBooking(wlOnly, "19028");
    expect(picked?.classCode).toBe("SL");
    expect(isOpenableStatus(picked?.status)).toBe(true);
  });

  it("class boli gayi ho to wahi (seat-wali preference usi class me lagti hai)", () => {
    expect(pickRowForBooking(rows, "19028", "2A")?.classCode).toBe("2A");
  });

  it("N/A/REGRET wali class kabhi nahi chunti", () => {
    const na = [{ number: "19028", classCode: "CC", status: "NOT_AVAILABLE", seats: null, rac: null, waitlist: null, fare: 270, departure: "19:48" }];
    expect(pickRowForBooking(na, "19028")).toBeNull();
  });
});

describe("Round-35 · model ko bhi sikhaya gaya (AI khud poochhe)", () => {
  it("rule 28 me class ambiguous par pehle poochhne ka rule hai", () => {
    expect(agentic).toContain("CLASS AMBIGUOUS HO TO PEHLE POOCHHO");
    expect(agentic).toContain("'kaunsi class me book karun?'");
    expect(agentic).toContain("'[NEXT] 19028 · 3A (AVL 26 ₹565) => 19028 mein 3A book krdo'");
    expect(agentic).toContain("ek hi class khuli ho to seedha wahi class bata do");
  });

  it("rule me user ki shikayat ka reference hai (trace ke liye)", () => {
    expect(agentic).toContain("har cheez thodi btani padegi");
  });
});

describe("Round-35 · honest data hi chips me jaata hai", () => {
  it("chip label me status + seats + fare (jo provider ne diya) — koi andaza nahi", () => {
    expect(concierge).toContain("label: `${String(r.classCode ?? \"\").toUpperCase()} · ${r.status}${r.seats != null ? ` ${r.seats}` : \"\"}${r.fare != null ? ` · ₹${r.fare}` : \"\"}`");
    expect(concierge).toContain("seats: r.seats ?? null,");
    expect(concierge).toContain("fare: r.fare ?? null,");
  });

  it("rows route+date se match hoti hain (purani journey ka data nayi par nahi)", () => {
    expect(concierge).toContain("const rememberedOk =");
    expect(concierge).toContain("remembered.from === routeFrom.code && remembered.to === routeTo.code && remembered.date === routeDate");
  });
});
