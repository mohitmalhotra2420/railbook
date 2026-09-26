/* Round-25 (26 Sep 2026, user screenshot) — "Yeh baki trains seat finder card mein kyu le jaata?
 * last line dekho".
 *
 * Problem do hisson me thi:
 *   1) `server/agent/seatFilter.ts` ki summary line sirf top 4 rows likhti thi aur baaki ko
 *      "(Seat Finder card me)" bhej deti thi — us card ko Round-21c me chat se hata diya gaya tha,
 *      isliye pointer jhootha tha. AI wahi line copy karke "…Seat Finder card mein hain" likh deta tha.
 *   2) Us aadhe-adhure jawab ke baad baaki trains kahin dikhti hi nahi thi.
 *
 * Ab: (a) summary/prompt line saari rows likhti hai (koi card pointer nahi),
 *     (b) `missingSeatLines()` se jo trains AI ke jawab me chhoot gayi wo usi jawab me jod di jaati hain
 *         (format wahi jo chat ka ReplyText parser rows me todta hai),
 *     (c) client par safety net `stripSeatCardPointer()` — kabhi model phir bhi "card" likhe to
 *         screen par woh jhoothi baat nahi jaati.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { missingSeatLines, seatSummaryLine, type SeatFilterRow } from "../server/agent/seatFilter";
import { stripSeatCardPointer } from "../src/chatText";
import { ReplyText } from "../src/components/ReplyText";

const row = (n: string, name: string, cls: string, status: string, extra: Partial<SeatFilterRow> = {}): SeatFilterRow => ({
  number: n,
  name,
  classCode: cls,
  status,
  seats: status === "AVAILABLE" ? 50 : null,
  rac: status === "RAC" ? 9 : null,
  waitlist: status === "WAITLIST" ? 21 : null,
  fare: 150,
  departure: "06:10",
  durationMinutes: 300,
  ...extra,
});

describe("Round-25 · seat jawab me SAARI trains (koi 'Seat Finder card' pointer nahi)", () => {
  it("summary line saari rows likhti hai — pehle ki tarah top-4 par nahi rukti", () => {
    const rows = [
      row("19611", "All ASR EXP", "SL", "AVAILABLE", { seats: 174 }),
      row("14615", "LKU ASR EXP", "SL", "AVAILABLE", { seats: 50 }),
      row("14631", "DDN ASR EXPRESS", "SL", "AVAILABLE", { seats: 26 }),
      row("14663", "AMRIT BHARAT EXP", "SL", "AVAILABLE", { seats: 22, fare: 170 }),
      row("13005", "HWH ASR MAIL", "SL", "AVAILABLE", { seats: 7 }),
      row("13006", "ASR HWH MAIL", "SL", "AVAILABLE", { seats: 9 }),
    ];
    const line = seatSummaryLine(
      { seat: rows, wl: [], missingClass: 0, unknownTime: 0 },
      { classCodes: ["SL"], classGroup: null, sortBy: null, departAfterMinute: null },
      { from: "LDH", to: "ASR" },
    );
    for (const r of rows) expect(line).toContain(r.number);
    expect(line).toContain("6 trains"); /* count bhi sahi */
    expect(line).not.toMatch(/seat\s*finder/i); /* koi card pointer nahi */
    expect(line).not.toContain("+0 aur");
  });

  it("bahut zyada rows hon to honest tail (aur kisi card ka zikr nahi)", () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(`13${String(i).padStart(3, "0")}`, `TRAIN ${i}`, "SL", "AVAILABLE"));
    const line = seatSummaryLine(
      { seat: rows, wl: [], missingClass: 0, unknownTime: 0 },
      { classCodes: ["SL"], classGroup: null, sortBy: null, departAfterMinute: null },
      { from: "LDH", to: "ASR" },
    );
    expect(line).toContain("+3 aur bhi hain");
    expect(line).not.toMatch(/card/i);
  });

  it("missingSeatLines(): jo trains jawab me nahi aayi unki asli lines banati hai", () => {
    const rows = [
      row("19611", "All ASR EXP", "SL", "AVAILABLE", { seats: 174 }),
      row("14615", "LKU ASR EXP", "SL", "AVAILABLE", { seats: 50 }),
      row("13005", "HWH ASR MAIL", "SL", "WAITLIST", { waitlist: 21 }),
    ];
    /* AI ne sirf 19611 likha — baaki do chhoot gayi */
    const lines = missingSeatLines("19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150", rows);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("14615");
    expect(lines[0]).toContain("AVAILABLE 50 seats");
    expect(lines[0]).toContain("₹150");
    expect(lines[1]).toContain("WL 21");
    /* Saari trains pehle se likhi hon to kuch nahi jodte (duplicate nahi) */
    expect(missingSeatLines("19611, 14615, 13005 sab", rows)).toEqual([]);
  });

  it("jawab ke saath jodi gayi lines chat me rows ban jaati hain (ReplyText)", () => {
    const rows = [row("19611", "All ASR EXP", "SL", "AVAILABLE", { seats: 174 }), row("14615", "LKU ASR EXP", "SL", "AVAILABLE", { seats: 50 })];
    const reply = "27 Sep 2026, SL class, seat wali 2 trains mili hain:\n" + missingSeatLines("", rows).join("\n");
    const { container } = render(<ReplyText text={reply} />);
    const cards = [...container.querySelectorAll(".rp-row")].map((el) => el.textContent ?? "");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("19611");
    expect(cards[0]).toContain("AVL 174");
    expect(cards[1]).toContain("14615");
    expect(cards[1]).toContain("AVL 50");
  });

  it("client safety net: 'Seat Finder card' pointer screen par nahi jaata", () => {
    const aiText =
      "27 Sep 2026, SL class, 1 passenger ke liye seat wali 10 trains mili hain. Top trains: 19611 …\n" +
      "+5 aur SL available trains Seat Finder card mein hain.";
    const clean = stripSeatCardPointer(aiText);
    expect(clean).not.toMatch(/seat\s*finder/i);
    expect(clean).toContain("+5 aur SL available trains hain.");
    /* baaki text jaisa tha waisa (kuch chhupta nahi) */
    expect(clean).toContain("27 Sep 2026, SL class, 1 passenger ke liye seat wali 10 trains mili hain.");
    /* purana bracket-form bhi saaf hota hai */
    expect(stripSeatCardPointer("💺 SL me seat — 19611 SL AVL 174 ₹150 · +5 aur (Seat Finder card me).")).not.toMatch(/card/i);
    /* jis text me zikr hi nahi, wo bilkul waisa hi rehta hai */
    const plain = "19611 All ASR EXP — SL — AVAILABLE 174 seats — ₹150";
    expect(stripSeatCardPointer(plain)).toBe(plain);
  });
});

/* ── Turn-level (server/app.ts assembly): "baki trains" ab usi jawab me aati hain ─────────────── */
import request from "supertest";
import { createApp } from "../server/app.js";
import { vi } from "vitest";

const runAgentMock = vi.fn();
const seatFilterForMock = vi.fn();
vi.mock("../server/agent/run.js", () => ({ runAgent: (...args: unknown[]) => runAgentMock(...args) }));
vi.mock("../server/agent/seatFilter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/agent/seatFilter.js")>();
  return { ...actual, seatFilterFor: (...args: unknown[]) => seatFilterForMock(...args) };
});

const srow = (n: string, name: string, seats: number): SeatFilterRow => row(n, name, "SL", "AVAILABLE", { seats });

describe("Round-25 · /api/agent turn assembly — saari trains isi jawab me", () => {
  const KNOWN = { from: { code: "LDH" }, to: { code: "ASR" }, date: "2026-09-26", passengerCount: 1 };

  it("AI ne 3 me se 1 train likhi → baaki 2 ki asli lines usi jawab me jud jaati hain", async () => {
    runAgentMock.mockResolvedValue({
      reply: "Seat wali 3 trains mili hain: 19611 All ASR EXP — SL AVAILABLE 174 seats.",
      nlu: null,
      source: "ai",
      tool: "FIND_SEATS",
      toolOk: true,
      journey: null,
      alternatives: null,
      toolTrace: [{ tool: "FIND_SEATS" }],
    });
    seatFilterForMock.mockResolvedValue({
      line: "💺 SL me seat wali 3 trains — 19611 SL AVL 174 ₹150 · 14615 SL AVL 50 ₹150 · 13005 SL AVL 7 ₹150. (LDH → ASR · live board)",
      rows: [srow("19611", "All ASR EXP", 174), srow("14615", "LKU ASR EXP", 50), srow("13005", "HWH ASR MAIL", 7)],
      wlRows: [],
      trainsSeen: 10,
      source: "web_railyatri",
    });

    const res = await request(createApp()).post("/api/agent").send({ text: "SL me seat wali trains batao", known: KNOWN }).expect(200);

    /* jo AI ne likha wo waisa hi (kuch badla nahi) */
    expect(res.body.reply).toContain("19611 All ASR EXP");
    /* aur baaki do trains ki asli lines usi jawab me */
    expect(res.body.reply).toContain("14615 LKU ASR EXP — SL — AVAILABLE 50 seats");
    expect(res.body.reply).toContain("13005 HWH ASR MAIL — SL — AVAILABLE 7 seats");
    /* 19611 ki line dobara nahi (duplicate nahi) */
    expect((res.body.reply.match(/19611/g) ?? []).length).toBe(1);
    /* koi jhootha card pointer nahi */
    expect(res.body.reply).not.toMatch(/seat\s*finder/i);
  });

  it("AI ka jawab fail → sirf compact seat line (jisme saari trains hain), duplicate rows nahi", async () => {
    runAgentMock.mockResolvedValue({ reply: "", nlu: null, source: "ai", tool: null, toolOk: null, journey: null, alternatives: null, toolTrace: [] });
    seatFilterForMock.mockResolvedValue({
      line: "💺 SL me seat wali 2 trains — 19611 SL AVL 174 ₹150 · 14615 SL AVL 50 ₹150. (LDH → ASR · live board)",
      rows: [srow("19611", "All ASR EXP", 174), srow("14615", "LKU ASR EXP", 50)],
      wlRows: [],
      trainsSeen: 10,
      source: "web_railyatri",
    });
    const res = await request(createApp()).post("/api/agent").send({ text: "SL me seat wali trains batao", known: KNOWN }).expect(200);
    expect(res.body.reply).toBe("💺 SL me seat wali 2 trains — 19611 SL AVL 174 ₹150 · 14615 SL AVL 50 ₹150. (LDH → ASR · live board)");
    expect(res.body.seatFilterFallback).toBe(true);
  });
});
