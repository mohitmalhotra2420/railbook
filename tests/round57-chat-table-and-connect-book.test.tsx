/* ══ ROUND-57 (29 Sep 2026, user ka Google/ChatGPT screenshot) ═══════════════════════════════════════
 * User ki teen baatein:
 *   1. "layout ui sahi kro connecting trains ka"
 *   2. "automatically ui table form mein yan bullet form mein aaye" (screenshot me ChatGPT ne "Esmein se
 *      best kon si rahegi" ka jawab TABLE me diya tha: LDH departure | ASR arrival | Journey)
 *   3. "available mein connecting ka option jo next page pe open ho and alternate trains ka options bhi
 *      dikhe and connecting trains mein booking ka option and alternate mein bhi"
 *
 * Ye test UI (presentation) ko lock karta hai:
 *   - 2+ train rows → TABLE default (rows wahi jo text se parse hui; kuch invent nahi) + row tappable
 *   - 1 row / prose → pehle jaisa card / bullets
 *   - prose jawab bullets me (heading + bullet list)
 *   - seat board par do next-page buttons (Connecting, Alternative) jo route/date ke saath callback dete hain
 *   - connecting leg par Book button (verified class ho to) — aur bina class data ke koi jhootha button nahi
 *   - leg ka Book → onBookLeg me wahi segment/class/date jaata hai (ticket segment, boarding/destination sahi)
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReplyText } from "../src/components/ReplyText";
import { AnswerCard } from "../src/components/AnswerCard";
import { SeatListBlock } from "../src/views/Concierge";
import { JourneyOptions } from "../src/components/JourneyOptions";
import type { AgentJourneyPlan, AgentRouteLeg } from "../src/ai/agent";

const SEAT_TEXT = [
  "ASR → LDH, 2026-09-30 — 3A seat availability:",
  "* 12926 PASCHIM EXPRESS — 3A AVL 204 ₹565 — 07:20 departure",
  "* 18104 ASR TATA EXP — 3A AVL 64 ₹520 — 12:45 departure",
  "* 12706 SACHKHAND EXP — 3A N/A ₹565 — 05:30 departure",
].join("\n");

describe("Round-57 · (a) chat jawab apne aap TABLE me", () => {
  it("2+ rows → table columns (Train · Class · Status · Fare) + Table/Cards toggle", () => {
    const { container } = render(<ReplyText text={SEAT_TEXT} />);
    expect(container.querySelector("table.rp-table")).toBeTruthy();
    expect(container.querySelectorAll("table.rp-table tbody tr").length).toBe(3);
    /* 3 alag trains → teen rows, jisme totals ke numbers text ke hi hain */
    expect(container.textContent).toContain("12926");
    expect(container.textContent).toContain("204");
    expect(container.textContent).toContain("12706");
    /* toggle mojood hai */
    expect(screen.getByText("Table")).toBeTruthy();
    expect(screen.getByText("Cards")).toBeTruthy();
  });

  it("'Cards' par switch karne se purane cards wapas (data wahi)", () => {
    const { container } = render(<ReplyText text={SEAT_TEXT} />);
    fireEvent.click(screen.getByText("Cards"));
    const rows = container.querySelector(".rp-rows") as HTMLElement;
    expect(rows.style.display).not.toBe("none");
    expect(container.querySelector(".rp-row")).toBeTruthy();
  });

  it("row tap → usi train/class ka booking callback (jaise class chip ka tha)", () => {
    const onBook = vi.fn();
    const { container } = render(<ReplyText text={SEAT_TEXT} onBook={onBook} />);
    const tr = container.querySelector("table.rp-table tbody tr.rp-tr") as HTMLElement;
    fireEvent.click(tr);
    expect(onBook).toHaveBeenCalledTimes(1);
    expect(onBook.mock.calls[0][0].train).toBe("12926");
  });

  it("control: sirf 1 row → table nahi (card hi rehta hai, toggle bhi nahi)", () => {
    const one = "* 12926 PASCHIM EXPRESS — 3A AVL 204 ₹565 — 07:20 departure";
    const { container } = render(<ReplyText text={one} />);
    expect(container.querySelector("table.rp-table")).toBeNull();
  });
});

describe("Round-57 · (b) prose jawab bullets me", () => {
  it("\"Label: text\" wale jumle bullets + bold label", () => {
    const { container } = render(
      <AnswerCard
        text={
          "Tatkal booking subah khulti hai.\nAC classes: 10:00 AM IST (departure se 1 din pehle).\nNon-AC: 11:00 AM IST."
        }
      />,
    );
    const lis = container.querySelectorAll("ul.ac-bullets li");
    expect(lis.length).toBe(2);
    expect(container.querySelectorAll("ul.ac-bullets li strong").length).toBe(2);
    expect(container.textContent).toContain("10:00 AM IST");
  });
});

describe("Round-57 · (c) seat board se Connecting / Alternative ka next page", () => {
  const block = {
    type: "seatlist",
    from: "ASR",
    to: "LDH",
    toName: "Ludhiana Jn",
    date: "2026-09-30",
    source: "web_confirmtkt",
    rows: [
      { number: "12926", name: "PASCHIM EXPRESS", classCode: "3A", status: "AVAILABLE", seats: 204, rac: null, waitlist: null, fare: 565, departure: "07:20", durationMinutes: null },
    ],
  } as unknown as Parameters<typeof SeatListBlock>[0]["block"];

  it("do buttons (Connecting + Alternative) route/date ke saath callback dete hain", () => {
    const onOpenPage = vi.fn();
    render(<SeatListBlock block={block} onPick={() => undefined} onOpenPage={onOpenPage} />);
    fireEvent.click(screen.getByText("Connecting trains · Leg 1 → Leg 2"));
    expect(onOpenPage).toHaveBeenLastCalledWith("connect", "ASR", "LDH", "2026-09-30");
    fireEvent.click(screen.getByText(/Alternative trains/));
    expect(onOpenPage).toHaveBeenLastCalledWith("alt", "ASR", "LDH", "2026-09-30");
  });

  it("callback na ho to koi jhootha button nahi (silently nahi dikhata)", () => {
    render(<SeatListBlock block={block} onPick={() => undefined} />);
    expect(screen.queryByText("Connecting trains · Leg 1 → Leg 2")).toBeNull();
  });
});

describe("Round-57 · (d) connecting leg par BOOK option", () => {
  const leg = (over: Partial<AgentRouteLeg> = {}): AgentRouteLeg => ({
    trainNumber: "15098",
    trainName: "AMARNATH EXP",
    from: "LDH",
    to: "UMB",
    fromName: "Ludhiana Jn",
    toName: "Ambala Cantt",
    departure: "03:30",
    arrival: "05:17",
    arrivalDayOffset: 0,
    durationMinutes: 107,
    availability: { classCode: "3A", status: "AVAILABLE", seats: 12, rac: null, waitlist: null, fare: 520, source: "confirmtkt" },
    ...over,
  });
  const plan = {
    provenance: { sources: [], freshness: "fresh" },
    query: { from: "LDH", to: "JAT", date: "2026-09-30", travelClass: null, passengers: 1, preference: "best_overall" },
    best: null,
    routeOptions: [],
    connections: [
      { legs: [leg(), leg({ trainNumber: "15651", trainName: "LOHIT EXPRESS", from: "UMB", to: "JAT", departure: "05:50", arrival: "13:00", availability: { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 21, fare: 380, source: "confirmtkt" } })], layoverMinutes: 33, totalDurationMinutes: 570, hub: "UMB" },
    ],
    alternativeDates: [],
    directUnavailable: false,
    sources: [],
    audit: { directProbed: 0, directTrains: 0, connLeg1Checked: 1, connLeg2Checked: 1, bfeStopsChecked: 0, bfeTrains: 0, connHubs: ["UMB"], passengers: 1 },
  } as unknown as AgentJourneyPlan;

  it("dono legs par Book button — class ke saath; click par segment/ticket/date sahi jaata hai", () => {
    const onBookLeg = vi.fn();
    render(<JourneyOptions plan={plan} initialPage="connect" onBookLeg={onBookLeg} onPickLeg={() => undefined} />);
    const btns = screen.getAllByText(/Book Leg/);
    expect(btns.length).toBe(2);
    expect(btns[0].textContent).toContain("3A");
    fireEvent.click(btns[0]);
    expect(onBookLeg).toHaveBeenCalledTimes(1);
    const arg = onBookLeg.mock.calls[0][0];
    expect(arg.trainNumber).toBe("15098");
    expect(arg.from).toBe("LDH");
    expect(arg.classCode).toBe("3A");
    expect(arg.date).toBe("2026-09-30");
    /* doosra leg (WL) bhi bookable — amber tone */
    expect(btns[1].textContent).toContain("SL");
  });

  it("availability.classCode na ho to Book button nahi (jhootha booking nahi)", () => {
    const p2 = JSON.parse(JSON.stringify(plan)) as AgentJourneyPlan;
    delete (p2.connections[0].legs[0] as { availability?: unknown }).availability;
    delete (p2.connections[0].legs[1] as { availability?: unknown }).availability;
    render(<JourneyOptions plan={p2} initialPage="connect" onBookLeg={vi.fn()} onPickLeg={() => undefined} />);
    expect(screen.queryAllByText(/Book Leg/).length).toBe(0);
  });
});
