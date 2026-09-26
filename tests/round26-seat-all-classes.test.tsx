/* Round-26 (26 Sep 2026, user screenshot) — do shikayatein:

 *   1) "trains total 10 hai lekin mere ko 9 show kar rhi" — AI ne pehli train ko hi intro line me likh
 *      diya tha ("… seat available wali trains: 19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150"),
 *      aur `ReplyText` ka label-match sirf 40 akshar tak tha → wo row head me chali gayi, isliye
 *      summary "9 me seat" ginnti thi jabki 10 trains thi.
 *   2) "SL ho ya koi bhi class, usmein sirf available mat show karo — W/L trains bhi show karo, kyunki
 *      user ne specifically nahi bola ki available dikhao" — pehle har seat-sawaal par `onlyAvailable`
 *      true ho jaata tha. Ab default **false** (AVL/RAC + WL/N-A dono), aur filter sirf tab jab user
 *      khud "available / khali / vacant / sirf available / confirmed" maange.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { parseSeatIntent } from "../server/understand/seatIntent";
import { seatSummaryLine, type SeatFilterRow } from "../server/agent/seatFilter";
import { ReplyText } from "../src/components/ReplyText";

const mk = (number: string, name: string, status: string, extra: Partial<SeatFilterRow> = {}): SeatFilterRow => ({
  number,
  name,
  classCode: "SL",
  status,
  seats: status === "AVAILABLE" ? 50 : null,
  rac: status === "RAC" ? 9 : null,
  waitlist: status === "WAITLIST" ? 14 : null,
  fare: 150,
  departure: "06:10",
  durationMinutes: 300,
  ...extra,
});

describe("Round-26 · 'available' filter sirf explicit maangne par", () => {
  it("simple seat sawaal → saari trains (WL/N-A bhi), filter nahi", () => {
    for (const q of [
      "SL class me seat wali trains batao",
      "2A me seat hai kya",
      "raat 9 ke baad sleeper me seat",
      "AC trains dikhao",
    ]) {
      const s = parseSeatIntent(q);
      expect(s.seatIntent, q).toBe(true);
      expect(s.onlyAvailable, q).toBe(false);
    }
    /* Bina seat-shabd wali simple trains query par filter lagta hi nahi (purana rule waisa hi). */
    const plain = parseSeatIntent("Ludhiana se Amritsar SL trains");
    expect(plain.seatIntent).toBe(false);
    expect(plain.onlyAvailable).toBe(false);
  });

  it("user ne saaf 'available/khali/confirmed' maanga → tabhi filter", () => {
    for (const q of [
      "sirf available SL trains dikhao",
      "available seats wali trains batao",
      "khali seat wali trains",
      "confirmed seat wali trains dikhao",
      "sirf confirmed tickets",
    ]) {
      expect(parseSeatIntent(q).onlyAvailable, q).toBe(true);
    }
    expect(parseSeatIntent("SL trains dikhao").matched ?? []).not.toContain("available-only");
  });

  it("summary line: all-mode me saari trains ek hi line me + saaf count (seat vs WL)", () => {
    const pick = {
      seat: [mk("19611", "All ASR EXP", "AVAILABLE", { seats: 174 }), mk("14615", "LKU ASR EXP", "AVAILABLE", { seats: 50 })],
      wl: [mk("14617", "JANSEWA EXP", "WAITLIST", { waitlist: 14 }), mk("18237", "CHATTISGARH EXP", "NOT_AVAILABLE")],
      missingClass: 0,
      unknownTime: 0,
    };
    const line = seatSummaryLine(
      pick,
      { classCodes: ["SL"], classGroup: null, onlyAvailable: false, sortBy: null, departAfterMinute: null },
      { from: "LDH", to: "ASR" },
    );
    expect(line).toContain("4 trains");
    expect(line).toContain("2 me seat (AVL/RAC), 2 me WL/N-A");
    for (const n of ["19611", "14615", "14617", "18237"]) expect(line).toContain(n);
    expect(line).toContain("WL 14");
    expect(line).not.toMatch(/seat\s*finder/i);
  });

  it("sirf-available maanga gaya ho to purana behaviour (WL alag branch me)", () => {
    const pick = { seat: [mk("19611", "All ASR EXP", "AVAILABLE", { seats: 174 })], wl: [mk("14617", "JANSEWA EXP", "WAITLIST")], missingClass: 0, unknownTime: 0 };
    const line = seatSummaryLine(
      pick,
      { classCodes: ["SL"], classGroup: null, onlyAvailable: true, sortBy: null, departAfterMinute: null },
      { from: "LDH", to: "ASR" },
    );
    expect(line).toContain("seat wali 1 train");
    expect(line).not.toContain("14617"); /* all-mode wali combined line nahi */
  });
});

describe("Round-26 · count mismatch (10 trains par '9 me seat') fix", () => {
  const intro =
    "27 Sep 2026, SL class, 1 passenger ke liye seat wali trains: 19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150";
  const bullets = [
    "* 14615 LKU ASR EXP — SL — AVAILABLE 50 seats — ₹150 — 06:10 departure",
    "* 14631 DDN ASR EXPRESS — SL — AVAILABLE 26 seats — ₹150 — 06:10 departure",
    "* 14663 AMRIT BHARAT EXP — SL — AVAILABLE 22 seats — ₹170 — 06:10 departure",
    "* 13005 HWH ASR MAIL — SL — AVAILABLE 7 seats — ₹150 — 06:10 departure",
    "* 12903 GOLDEN TEMPLE — SL — AVAILABLE 5 seats — ₹180 — 06:10 departure",
    "* 14653 HSR ASR EXPRESS — SL — AVAILABLE 4 seats — ₹150 — 06:10 departure",
    "* 20807 HIRAKUD EXPRESS — SL — AVAILABLE 4 seats — ₹180 — 06:10 departure",
    "* 11057 CSMT ASR EXPRESS — SL — AVAILABLE 3 seats — ₹150 — 06:10 departure",
    "* 15707 KIR ASR EXPRESS — SL — AVAILABLE 1 seats — ₹150 — 06:10 departure",
  ];

  it("intro line me chhipi pehli train bhi row banti hai — 10 trains = 10 rows", () => {
    const { container } = render(<ReplyText text={[intro, ...bullets].join("\n")} />);
    const nums = [...container.querySelectorAll(".rp-row .rp-no")].map((el) => el.textContent);
    expect(nums).toHaveLength(10);
    expect(nums[0]).toBe("19611");
    expect(nums).toContain("15707");
    /* summary bhi wahi 10 ginti hai (pehle 9 tha) */
    expect(container.querySelector(".rp-sum")?.textContent).toMatch(/10 me seat/);
  });

  it("WL row ke saath summary total + seat/WL ka farq batati hai", () => {
    const text = [intro, bullets[0], "* 12357 DURGIANA EXP — SL — WL 10 — ₹180 — 06:10 departure"].join("\n");
    const { container } = render(<ReplyText text={text} />);
    const sum = container.querySelector(".rp-sum")?.textContent ?? "";
    expect(sum).toMatch(/3 trains:/);
    expect(sum).toMatch(/2 me seat/);
    expect(sum).toMatch(/1 WL\/N-A/);
    expect(sum).toMatch(/₹150–₹180/);
    /* row bhi WL ke saath dikhti hai (chhupti nahi) */
    expect(container.querySelectorAll(".rp-row").length).toBe(3);
    expect(container.querySelector(".rp-st.wl")?.textContent).toMatch(/WL 10/);
  });
});
