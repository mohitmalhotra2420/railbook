/* ══ ROUND-47 (28 Sep 2026) — chat UI: lamba prose jawab padhne-layak sections me ═══════════════════
 * User (screenshot 28 Sep): "etna lamba chat padhna kitna mushkil ho rha hai, thoda attractive banao
 * so that readable ho, clean UI ho, response ko clear cards, larger text, spacing, status chip aur
 * timetable sections me divide kiya jaaye" + header se payment ka sign hata kar naye buttons.
 *
 * Ye PURE UI hai — server/AI/API/architecture ko haath nahi lagaya. Text waisa hi rehta hai; AnswerCard
 * usi text ko sections me baantta hai (chips/timetable sirf jab wo baat text me maujood ho — kuch
 * invent nahi hota).
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AnswerCard, answerChips, answerTimes, answerStation } from "../src/components/AnswerCard";
import { ReplyText } from "../src/components/ReplyText";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

/* Screenshot 1 ka asli jawab (28 Sep) — 6 line ka ek hi paragraph tha. */
const SCREENSHOT_REPLY =
  "12013 Amritsar Shatabdi ka timetable ke hisaab se Ludhiana Jn LDH par scheduled arrival **20:16** hai, departure 20:19. " +
  "Aaj 2026-09-28 ke live run ki baat karein to provider ka last update 2026-09-28 22:47 +0530 ka hai aur train us samay MANANWALA ke paas dikh rahi hai, next Amritsar Jn. " +
  "Update stale hai, isliye Ludhiana par actual pahunchne ka confirmed real-time time abhi verify nahi ho pa raha. " +
  "Overall delay 0m dikh raha hai.";

const SECOND_REPLY =
  "12013 Amritsar Shtabdi — 28 Sep 2026 ki run ke liye timetable ke hisaab se: Ludhiana Jn (LDH): arrival 20:16, departure 20:19. " +
  "(Source: confirmtkt.com — railway API se nahi, verified web site se.)";

describe("Round-47 · AnswerCard — prose jawab sections me", () => {
  it("status chips sirf text me likhi baaton se (stale / delay 0 / scheduled / date)", () => {
    const chips = answerChips(SCREENSHOT_REPLY).map((c) => c.text);
    expect(chips).toContain("UPDATE STALE");
    expect(chips).toContain("ON TIME · DELAY 0");
    expect(chips).toContain("SCHEDULED");
    expect(chips).toContain("2026-09-28");
    /* chips me wo baat nahi aani chahiye jo text me nahi hai */
    expect(answerChips("Sirf itna ki train chal rahi hai.")).toEqual([]);
  });

  it("timetable section: arrival/departure waqt + station (dono shakal)", () => {
    expect(answerTimes(SCREENSHOT_REPLY)).toEqual([
      { label: "Arrival", value: "20:16" },
      { label: "Departure", value: "20:19" },
    ]);
    expect(answerStation(SCREENSHOT_REPLY)).toEqual({ name: "Ludhiana Jn", code: "LDH" });
    expect(answerStation(SECOND_REPLY)).toEqual({ name: "Ludhiana Jn", code: "LDH" });
  });

  it("screenshot ka jawab: headline + timetable card + chips + source, aur poora text bacha rehta hai", () => {
    const { container } = render(<AnswerCard text={SCREENSHOT_REPLY} />);
    /* 1) headline pehla jumla (bada), poora */
    expect(container.querySelector(".ac-head")?.textContent).toContain("12013 Amritsar Shatabdi ka timetable ke hisaab se");
    /* 2) timetable board: LDH + 20:16 + 20:19 */
    const board = container.querySelector(".ac-board");
    expect(board?.textContent).toContain("LDH");
    expect(board?.textContent).toContain("20:16");
    expect(board?.textContent).toContain("20:19");
    /* 3) markdown ke ** user ko nahi dikhte */
    expect(container.textContent).not.toContain("**");
    /* 4) koi lafz chhupta nahi — har jumla render me maujood hai (sections ke darmiyan board aata
     * hai, isliye jumla-wise check; whitespace-insensitive). */
    const rendered = String(container.textContent).replace(/\s+/g, "");
    for (const sentence of SCREENSHOT_REPLY.replace(/\*\*/g, "").split(/(?<=\.)\s+/)) {
      expect(rendered, sentence).toContain(sentence.replace(/\s+/g, ""));
    }
  });

  it("source alag footer me (chhota, muted) — body ke andar nahi", () => {
    const { container } = render(<AnswerCard text={SECOND_REPLY} />);
    expect(container.querySelector(".ac-src")?.textContent).toContain("confirmtkt.com");
    expect(container.querySelector(".ac-head")?.textContent).not.toContain("Source");
    expect(container.querySelector(".ac-time-v")?.textContent).toBe("20:16");
  });

  it("tool-line (⚙️ …) chips ban jaati hai, prose me nahi milti", () => {
    const { container } = render(<AnswerCard text={"Train 12054 chal rahi hai.\n\n⚙️ Route/schedule dekha → Live position dekhi"} />);
    expect(container.querySelector(".ac-stepchip")?.textContent).toContain("Route/schedule dekha");
    expect(container.querySelector(".ac-head")?.textContent).not.toContain("Route/schedule");
  });

  it("ReplyText ab prose par bhi AnswerCard deta hai (classes wahi, text wahi)", () => {
    const { container } = render(<ReplyText text={SCREENSHOT_REPLY} />);
    expect(container.querySelector(".ac")).toBeTruthy();
    expect(container.querySelector(".msg-text")).toBeNull();
    expect(String(container.textContent).replace(/\s+/g, "")).toContain("LudhianaJnLDHparscheduledarrival20:16hai");
  });

  it("header: ₹ (wallet) hata, naye SVG icons lagaye (purane glyphs nahi)", () => {
    const src = read("src/views/Concierge.tsx");
    expect(src).not.toMatch(/>₹</); /* wallet ka ₹ header me nahi */
    expect(src).toMatch(/<IconChat \/>/);
    expect(src).toMatch(/<IconBoard \/>/);
    expect(src).toMatch(/<IconTicket \/>/);
    /* purane text-glyph buttons wapas na aayein */
    expect(src).not.toMatch(/icon-btn" title="Nayi chat"[^>]*>✚</);
    expect(src).not.toMatch(/icon-btn" title="RailKit tools"[^>]*>▦</);
  });

  it("stepper ab dots + labels (naya markup)", () => {
    const src = read("src/views/Concierge.tsx");
    expect(src).toMatch(/className=\{`ai-step/);
    const css = read("src/styles.css");
    expect(css).toMatch(/\.ai-step \{/);
    expect(css).toMatch(/\.ac-board \{/);
    expect(css).toMatch(/\.ac-chip\.ok \{/);
  });
});
