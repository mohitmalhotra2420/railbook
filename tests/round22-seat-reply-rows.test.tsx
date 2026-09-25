/* Round-22 (26 Sep 2026, user screenshot 1) — "ese simple answer padhna bada mushkil hai esko thoda
 * attractive banao, agar AI seat finder se related answer de to".
 *
 * Screenshot ka asli text (ek hi paragraph, em-dash (—) separators, "… departure" suffix):
 *   "Kal 27 Sep ko Amritsar  →  Ludhiana, Subah (04:00–12:00) window mein SL class:
 *    * 12484 ASR TVCN SF EXP — SL — AVAILABLE 102 seats — ₹180 — 05:55 departure
 *    * 15708 ASR KIR EXPRESS — SL — AVAILABLE 42 seats — ₹150 — 07:40 departure
 *    21 trains check ki gayi, is window mein SL seat wali 2 trains hain."
 *
 * Verify: ye rows me tootta hai (kuch chhupta nahi), status tone sahi, aur summary line sirf text ke
 * numbers se banti hai (koi invent nahi).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ReplyText } from "../src/components/ReplyText";

const SCREENSHOT_TEXT = [
  "Kal 27 Sep ko Amritsar  →  Ludhiana, Subah (04:00–12:00) window mein SL class:",
  "* 12484 ASR TVCN SF EXP — SL — AVAILABLE 102 seats — ₹180 — 05:55 departure",
  "* 15708 ASR KIR EXPRESS — SL — AVAILABLE 42 seats — ₹150 — 07:40 departure",
  "21 trains check ki gayi, is window mein SL seat wali 2 trains hain.",
].join(" ");

describe("Round-22 · seat-related replies sundar rows me", () => {
  it("em-dash wala asli answer rows ban jaata hai (kuch chhupta nahi)", () => {
    const { container } = render(<ReplyText text={SCREENSHOT_TEXT} />);
    const rows = [...container.querySelectorAll(".rp-row")];
    expect(rows.length).toBe(2);
    const t0 = rows[0].textContent ?? "";
    expect(t0).toContain("12484");
    expect(t0).toContain("ASR TVCN SF EXP");
    expect(t0).toContain("SL");
    expect(t0).toContain("AVL 102");
    expect(t0).toContain("₹180");
    expect(t0).toContain("05:55");
    const t1 = rows[1].textContent ?? "";
    expect(t1).toContain("15708");
    expect(t1).toContain("AVL 42");
    /* Header (route + window + class) chips me, tail line neeche — kuch gayab nahi. */
    const head = container.querySelector(".rp-head")?.textContent ?? "";
    expect(head).toMatch(/Amritsar/);
    expect(head).toMatch(/Subah \(04:00–12:00\)/);
    expect(head).toMatch(/SL/);
    expect(container.querySelector(".rp-tail")?.textContent).toMatch(/21 trains check ki gayi/);
    expect(container.querySelectorAll(".rp-st.ok").length).toBe(2);
  });

  it("summary line sirf text ke numbers se banti hai (AVL count + fare range)", () => {
    const { container } = render(<ReplyText text={SCREENSHOT_TEXT} />);
    const sum = container.querySelector(".rp-sum")?.textContent ?? "";
    expect(sum).toMatch(/💺 2 me seat/);
    expect(sum).toMatch(/\(102, 42\)/);
    expect(sum).toMatch(/42/);
    expect(sum).toMatch(/₹150–₹180/);
  });

  it("WL row ka tone amber aur RAC ka apna — status ke hisaab se rang", () => {
    const text =
      "ASR → LDH 26 Sep: * 12014 AMRITSAR SHATABDI – CC AVAILABLE 410 seats ₹490, dep 04:55 * 18309 SBP JAT EXPRESS – SL WL 12 ₹150, dep 05:16";
    const { container } = render(<ReplyText text={text} />);
    expect(container.querySelector(".rp-st.ok")?.textContent).toMatch(/AVL 410/);
    expect(container.querySelector(".rp-st.wl")?.textContent).toMatch(/WL 12/);
  });

  it("seat se related na ho to paragraph hi rehta hai (kuch bigadta nahi)", () => {
    const text = "Aapki train 12014 Amritsar se Ludhiana 04:55 par nikalti hai aur 06:57 par pahunchti hai.";
    const { container } = render(<ReplyText text={text} />);
    expect(container.querySelectorAll(".rp-row").length).toBe(0);
    expect(container.querySelector("p.msg-text")?.textContent).toBe(text);
  });
});
