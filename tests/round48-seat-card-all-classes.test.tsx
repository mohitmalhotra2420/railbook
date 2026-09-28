/* ══ ROUND-48 (29 Sep 2026) — "card mein saari classes show nahi ho rahi" ══════════════════════════
 * User (2 screenshots): green line me har train ki SAARI classes sahi likhi thi, par neeche ke cards me
 * kam classes dikh rahi thin:
 *   12054 → 2S + CC (text) … card "1 class" (sirf 2S)
 *   15015 → 3E+SL+2A+1A (text) … card "3 classes"
 * Root cause (parser, UI-only): server ki compact seat line me train ka naam nahi hota —
 *   "💺 sab class me seat wali 19 trains — 12054 2S AVL 660 ₹150 · CC AVL 17 ₹480 | …"
 * Purana ROW_RE naam maangta tha, isliye "2S AVL 660 ₹150" ko NAME maan leta tha aur agla class chip
 * (CC) hi asli row ban jaata tha; baaki classes/rows gayab. Saath me pehla segment (lead-in wala) aur
 * na-parse hone wale rows "rest" me chale jaate the (12030, 12204 waghera card hote hi nahi).
 * Round-48 fix: compact row (number ke turant baad class code) + naam me ank nahi + lead-in
 * ("… trains — 12054 …") ko head chip me alag karna. Koi data invent/mutate nahi — jo text me hai
 * wahi rows banti hain (R26/R27/R29 ka standing rule: ek train ki SAARI classes ek card me).
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReplyText, parseReply, groupReplyRowsByTrain } from "../src/components/ReplyText";

/* Screenshot 1 ki green line — bilkul waisi (server ki compact seat line). */
const SCREENSHOT_LINE =
  "💺 sab class me seat wali 19 trains — 12054 2S AVL 660 ₹150 · CC AVL 17 ₹480 | 12498 2S AVL 486 ₹130 | " +
  "14680 2S AVL 328 ₹115 · CC AVL 48 ₹410 | 12014 CC AVL 320 ₹805 · EC AVL 13 ₹1,245 | 22488 CC AVL 307 ₹820 · EC AVL 2 ₹1,520 | " +
  "15015 3E AVL 227 ₹520 · SL AVL 147 ₹190 · 2A AVL 26 ₹725 · 1A AVL 6 ₹1,190 | 12030 CC AVL 96 ₹955 | " +
  "11058 3E AVL 85 ₹530 · 2A AVL 18 ₹805 | 18104 3A AVL 76 ₹520 · 3E AVL 21 ₹520 · 2A AVL 8 ₹725 | " +
  "12204 3A AVL 67 ₹435 | 14624 SL AVL 64 ₹190 · 3A AVL 29 ₹520 | 15708 3E AVL 39 ₹520 · SL AVL 29 ₹190 · 2A AVL 10 ₹725 · 3A AVL 10 ₹520. " +
  "(ASR → UMB · live board)";

describe("Round-48 · seat card me SAARI classes (naam-rahit compact line bhi)", () => {
  it("screenshot ka text: 12 cards, aur har train ki saari classes (kuch chhupta nahi)", () => {
    const parsed = parseReply(SCREENSHOT_LINE);
    const groups = groupReplyRowsByTrain(parsed.rows);
    const map = new Map(groups.map((g) => [g.number, g.rows.map((r) => `${r.cls} ${r.status} ${r.count}`)]));
    expect(groups.map((g) => g.number)).toEqual([
      "12054", "12498", "14680", "12014", "22488", "15015", "12030", "11058", "18104", "12204", "14624", "15708",
    ]);
    expect(map.get("12054")).toEqual(["2S AVAILABLE 660", "CC AVAILABLE 17"]);   /* pehle sirf 2S dikhta tha */
    expect(map.get("14680")).toEqual(["2S AVAILABLE 328", "CC AVAILABLE 48"]);
    expect(map.get("12014")).toEqual(["CC AVAILABLE 320", "EC AVAILABLE 13"]);
    expect(map.get("22488")).toEqual(["CC AVAILABLE 307", "EC AVAILABLE 2"]);
    expect(map.get("15015")).toEqual(["3E AVAILABLE 227", "SL AVAILABLE 147", "2A AVAILABLE 26", "1A AVAILABLE 6"]);
    expect(map.get("15708")).toEqual(["3E AVAILABLE 39", "SL AVAILABLE 29", "2A AVAILABLE 10", "3A AVAILABLE 10"]);
    expect(map.get("12030")).toEqual(["CC AVAILABLE 96"]);   /* pehle card hi nahi banta tha */
    expect(map.get("12204")).toEqual(["3A AVAILABLE 67"]);
    /* fare bhi wahi jo text me tha (kuch invent nahi) */
    expect(map.get("12054")?.length).toBe(2);
    expect(parsed.rows.map((r) => r.fare)).toContain("₹1,190");
  });

  it("render: cards ki class-count text se match karti hai (count mismatch nahi)", () => {
    const { container } = render(<ReplyText text={SCREENSHOT_LINE} />);
    const cards = [...container.querySelectorAll(".rp-row")].map((c) => ({
      num: c.querySelector(".rp-no")?.textContent ?? "",
      badge: c.querySelector(".rp-gcount")?.textContent ?? "",
      rows: c.querySelectorAll(".rp-crow").length,
    }));
    expect(cards).toHaveLength(12);
    expect(cards.find((c) => c.num === "12054")?.rows).toBe(2);
    expect(cards.find((c) => c.num === "15015")?.rows).toBe(4);
    expect(cards.find((c) => c.num === "15708")?.rows).toBe(4);
    /* total class rows = text me likhi classes (26) */
    expect(container.querySelectorAll(".rp-crow")).toHaveLength(26);
    /* lead-in head chip me, prose me nahi */
    expect(container.querySelector(".rp-headchip")?.textContent).toContain("sab class me seat wali 19 trains");
  });

  it("naam-wali rows waise hi chalti hain (purane formats par koi asar nahi)", () => {
    const named =
      "12013 AMRITSAR SHTABDI — CC AVL 444 ₹675 · 3A AVL 71 ₹520 · EC AVL 23 ₹1,015 — 06:10 departure";
    const rows = parseReply(named).rows;
    expect(rows.map((r) => `${r.train} ${r.cls}`)).toEqual(["12013 CC", "12013 3A", "12013 EC"]);
    expect(rows[0].name).toBe("AMRITSAR SHTABDI");
    expect(rows[2].dep).toBe("06:10");
    const bullet = "* 12014 AMRITSAR SHATABDI – CC AVAILABLE 475 seats ₹510, dep 04:55";
    const b = parseReply(bullet).rows[0];
    expect(b).toMatchObject({ train: "12014", name: "AMRITSAR SHATABDI", cls: "CC", status: "AVAILABLE", count: 475, fare: "₹510" });
  });

  it("dono sections me same row ho (AI lines + compact seat line) to class card me do baar nahi", () => {
    const text = [
      "* 12054 HW JANSHATABDI — 2S AVL 660 ₹150 · CC AVL 17 ₹480 — 06:50 departure",
      "* 12498 SHANE PUNJAB — 2S AVL 486 ₹130 — 15:10 departure",
      "💺 sab class me seat wali 2 trains — 12054 2S AVL 660 ₹150 · CC AVL 17 ₹480 | 12498 2S AVL 486 ₹130. (ASR → UMB · live board)",
    ].join("\n");
    const groups = groupReplyRowsByTrain(parseReply(text).rows);
    expect(groups.map((g) => `${g.number}:${g.rows.length}`)).toEqual(["12054:2", "12498:1"]);
    /* dep bhi bacha rahta hai (pehli line se) */
    expect(groups[0].rows.find((r) => r.cls === "CC")?.dep).toBe("06:50");
  });

  it("adhoora match safety: aadhe shabd par text nahi kaatta (R29 wala case)", () => {
    const text = "22432 SFG MCTM SF EXP, SVDK → LDH ke liye 3A ki availability check karne ke liye journey date chahiye. Kis date ka availability chahiye?";
    const { container } = render(<ReplyText text={text} />);
    expect(container.querySelectorAll(".rp-row")).toHaveLength(0);
    expect(String(container.textContent).replace(/\s+/g, "")).toContain(text.replace(/\s+/g, "").slice(0, 60));
  });
});
