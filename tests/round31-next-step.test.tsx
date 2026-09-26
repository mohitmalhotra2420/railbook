/* Round-31 (26 Sep 2026, user): "maine specific train ki availability poochi aur AI ne sahi answer bhi
 * diya — ab AI ko passenger ko next step pe leke jaana chahiye na… do not specific to seat availability
 * but any question asked and answered — answer karne ke baad AI ko next uske question ke hisaab se next
 * question poochhna chahiye na? To AI khud ka dimaag kyu nahi lagata?"
 *
 * Round-31 ka jawab: jawab ke neeche ek chhota "Agla kadam" card — 1-2 tappable chips jo **usi turn ke
 * verified data** se bante hain (kuch invent nahi), aur tap karne par wahi utterance jaati hai jo pehle
 * se chalte flows ko trigger karti hai (Book → Round-29 ka auto passenger form). Data na ho to koi chip
 * nahi — jhoothi suggestion se behtar kuch na kehna.
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { nextStepsFor, seatStatusLabel } from "../src/ai/nextstep";
import { NextStepCard } from "../src/views/Concierge";

const seat = (number: string, classCode: string, status: string, extra: Record<string, unknown> = {}) => ({
  number,
  name: "AMRITSAR SHTABDI",
  classCode,
  status,
  seats: status === "AVAILABLE" ? 354 : null,
  rac: status === "RAC" ? 6 : null,
  waitlist: status === "WAITLIST" ? 22 : null,
  fare: 675,
  ...extra,
});

describe("Round-31 · agla kadam — sirf verified data se", () => {
  it("seat ka jawab aane par seedha booking chip (jo dikha wahi) + honest hint", () => {
    const ns = nextStepsFor({ seats: [seat("12013", "CC", "AVAILABLE")], focus: ["12013"] });
    expect(ns.options[0].primary).toBe(true);
    expect(ns.options[0].label).toBe("Book 12013 · CC (AVL 354 ₹675)");
    expect(ns.options[0].utterance).toBe("12013 mein CC book krdo");
    expect(ns.hint).toContain("passenger form");
    /* koi fake number/naam nahi — label me wahi AVL jo row me tha */
    expect(ns.options[0].label).toContain("354");
  });

  it("user ne jis train ki baat ki wahi pehle, aur uske saath doosri classes ka chip", () => {
    const ns = nextStepsFor({
      seats: [seat("11057", "3E", "AVAILABLE", { seats: 38 }), seat("12013", "CC", "AVAILABLE"), seat("12013", "EC", "AVAILABLE", { seats: 23, fare: 1015 })],
      focus: ["12013"],
    });
    expect(ns.options[0].label).toContain("12013");
    expect(ns.options[0].label).toContain("AVL 354");
    expect(ns.options[1].label).toContain("doosri classes");
    expect(ns.options[1].label).toContain("EC");
    expect(ns.options[1].utterance).toBe("12013 ki saari classes batao");
  });

  it("focus na ho (generic list) → sabse achhi seat wali train (AVL > RAC > WL), baaki trains ka chip", () => {
    const ns = nextStepsFor({
      seats: [seat("11057", "SL", "WAITLIST", { waitlist: 1, seats: null }), seat("14631", "SL", "AVAILABLE", { seats: 101, fare: 150 }), seat("22487", "CC", "AVAILABLE", { seats: 139, fare: 790 })],
    });
    /* sabse zyada available seats wali train (139 > 101 > WL) — jo data me tha wahi */
    expect(ns.options[0].label).toContain("22487");
    expect(ns.options[0].label).toContain("AVL 139");
    expect(ns.options[1].label).toContain("Baaki trains bhi (2)");
    expect(ns.options[1].utterance).toBe("saari seat wali trains batao");
  });

  it("sirf WL ho to WL ka sach likhta hai (jhootha 'available' nahi) aur bhi doosri classes chip", () => {
    const ns = nextStepsFor({ seats: [seat("12357", "3E", "WAITLIST", { seats: null, waitlist: 9 })], focus: ["12357"] });
    expect(ns.options[0].label).toContain("WL 9");
    expect(ns.hint).toContain("waitlist");
    expect(ns.hint).not.toMatch(/available/i);
  });

  it("kisi class me seat nahi (N/A/Regret) → 'jahan seat hai wahi dikhao'", () => {
    const ns = nextStepsFor({ seats: [seat("18237", "2A", "NOT_AVAILABLE", { seats: null, fare: 725 })], focus: ["18237"] });
    expect(ns.options[0].label).toBe("Jahan seat hai wahi dikhao");
    expect(ns.options[0].utterance).toBe("sirf available trains batao");
    expect(ns.hint).toContain("nahi");
  });

  it("train list aayi (seat data nahi) → agla kadam: kis train me seat hai", () => {
    const ns = nextStepsFor({ trains: [{ number: "12013", name: "AMRITSAR SHTABDI", classes: ["CC", "EC"] }] });
    expect(ns.options[0].label).toBe("Kis train me seat hai?");
    expect(ns.options[0].utterance).toBe("saari trains ki seat availability batao");
  });

  it("journey plan me bookable leg → usi leg ka booking chip", () => {
    const ns = nextStepsFor({
      journey: {
        routeOptions: [
          { trainNumbers: ["12013"], changes: 0, availability: { classCode: "CC", status: "AVAILABLE", seats: 354, fare: 675 } },
          { trainNumbers: ["12345"], changes: 1, availability: null },
        ],
      },
    });
    expect(ns.options[0].label).toContain("12013");
    expect(ns.options[0].label).toContain("AVL 354");
    expect(ns.options[0].utterance).toBe("12013 mein CC book krdo");
  });

  it("plan me kuch bookable nahi → doosri date (koi jhootha booking chip nahi)", () => {
    const ns = nextStepsFor({
      journey: { routeOptions: [{ trainNumbers: ["18237"], changes: 0, availability: { classCode: "2A", status: "NOT_AVAILABLE" } }] },
    });
    expect(ns.options[0].label).toBe("Doosri date dekho");
    expect(ns.options[0].utterance).toBe("1 day later");
  });

  it("live status/schedule jaise jawab (sirf train number pata) → seat availability ka kadam", () => {
    const ns = nextStepsFor({ trainHint: "12013" });
    expect(ns.options[0].label).toBe("12013 ki seat availability");
    expect(ns.options[0].utterance).toBe("12013 ki seat availability batao");
  });

  it("kuch bhi verified nahi → koi chip nahi (jhoothi suggestion nahi)", () => {
    expect(nextStepsFor({}).options).toEqual([]);
    expect(nextStepsFor({ seats: [] }).options).toEqual([]);
    expect(nextStepsFor({ seats: [], trains: [], journey: { routeOptions: [] }, trainHint: null }).options).toEqual([]);
  });

  it("max 2 chips — chat me chip ki bharmaar nahi", () => {
    const ns = nextStepsFor({
      seats: [seat("12013", "CC", "AVAILABLE"), seat("12013", "EC", "AVAILABLE", { seats: 23 }), seat("22487", "CC", "AVAILABLE", { seats: 139 })],
      focus: ["12013"],
    });
    expect(ns.options.length).toBeLessThanOrEqual(2);
  });

  it("status label wahi shabd jo app use karti hai", () => {
    expect(seatStatusLabel({ status: "AVAILABLE", seats: 354 })).toBe("AVL 354");
    expect(seatStatusLabel({ status: "RAC", rac: 6 })).toBe("RAC 6");
    expect(seatStatusLabel({ status: "WAITLIST", waitlist: 22 })).toBe("WL 22");
    expect(seatStatusLabel({ status: "NOT_AVAILABLE" })).toBe("N/A");
    expect(seatStatusLabel({ status: "UNKNOWN" })).toBe("status nahi mila");
  });
});

describe("Round-31 · 'Agla kadam' card UI", () => {
  const block = {
    type: "nextstep" as const,
    options: [
      { id: "book", label: "Book 12013 · CC (AVL 354 ₹675)", utterance: "12013 mein CC book krdo", primary: true },
      { id: "classes", label: "12013 ki doosri classes (EC)", utterance: "12013 ki saari classes batao" },
    ],
    hint: "Tap karne par usi train/class ka passenger form khulega.",
  };

  it("label + chips + hint render hote hain, primary pehle", () => {
    const { container } = render(<NextStepCard block={block} onChip={() => undefined} />);
    expect(container.querySelector(".ns-label")?.textContent).toContain("Agla kadam");
    const chips = [...container.querySelectorAll(".ns-chip")];
    expect(chips.length).toBe(2);
    expect(chips[0].className).toContain("primary");
    expect(container.querySelector(".ns-hint")?.textContent).toContain("passenger form");
  });

  it("chip tap par wahi utterance jaati hai (jo Round-29 ka passenger form trigger karti hai)", () => {
    const onChip = vi.fn();
    const { container } = render(<NextStepCard block={block} onChip={onChip} />);
    fireEvent.click(container.querySelectorAll(".ns-chip")[0]);
    expect(onChip).toHaveBeenCalledWith("12013 mein CC book krdo");
    fireEvent.click(container.querySelectorAll(".ns-chip")[1]);
    expect(onChip).toHaveBeenCalledWith("12013 ki saari classes batao");
  });

  it("hint na ho to hint line nahi (khaali box nahi)", () => {
    const { container } = render(<NextStepCard block={{ ...block, hint: null }} onChip={() => undefined} />);
    expect(container.querySelector(".ns-hint")).toBeNull();
  });
});

describe("Round-31 · Concierge wiring + CSS", () => {
  it("har jawab ke baad nextstep block banta hai (verified inputs se) aur chip → wahi flow", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/views/Concierge.tsx"), "utf8");
    expect(src).toContain("import { nextStepsFor } from \"../ai/nextstep\";");
    expect(src).toContain("const ns = nextStepsFor({");
    expect(src).toContain("seats: [...(agentRes.seatFilter?.rows ?? []), ...(agentRes.seatFilter?.wlRows ?? [])],");
    expect(src).toContain("trains: agentRes.trains?.rows ?? null,");
    expect(src).toContain("journey: agentRes.journey ?? null,");
    expect(src).toContain('if (ns.options.length) blocks.push({ type: "nextstep", options: ns.options, hint: ns.hint });');
    /* render branch + component */
    expect(src).toContain('if (block.type === "nextstep") {');
    expect(src).toContain("<NextStepCard block={block} onChip={onChip} />");
    expect(src).toContain("export function NextStepCard(");
  });

  it("block type Block union me hai (orchestrate) + CSS maujood", () => {
    const orch = fs.readFileSync(path.join(process.cwd(), "src/ai/orchestrate.ts"), "utf8");
    expect(orch).toContain('| { type: "nextstep"; options: { id: string; label: string; utterance: string; primary?: boolean }[]; hint?: string | null }');
    const css = fs.readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toContain(".ns-card");
    expect(css).toContain(".ns-chip.primary");
  });

  it("kuch fake nahi: nextstep module koi number/naam khud nahi banata (sirf data se label)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/ai/nextstep.ts"), "utf8");
    /* koi hard-coded train number / fare nahi */
    expect(src).not.toMatch(/"[1-9]\d{4}"/);
    /* module ka apna contract likha hua hai: sirf verified data se */
    expect(src).toMatch(/sirf usi verified data se/);
    expect(src).toMatch(/Koi andaza nahi/);
  });
});
