/* Round-60 · classes grid (user: "screenshot mein jo classes hai uska layout sahi krdo")
 * — leg ki seat pehle ("Best"), baaki classes usi shakal me, har chip par Book; class code dobara nahi. */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClassGrid } from "../src/components/JourneyOptions";
import type { AgentRouteLeg } from "../src/ai/agent";

const leg = {
  trainNumber: "14680",
  trainName: "ASR DLI EXP",
  from: "ASR",
  to: "UMB",
  departure: "06:15",
  arrival: "10:40",
  availability: { classCode: "CC", status: "AVAILABLE", seats: 16, rac: null, waitlist: null, fare: 370 },
  classOptions: [
    { classCode: "CC", status: "AVAILABLE", seats: 16, rac: null, waitlist: null, fare: 370 },
    { classCode: "2A", status: "AVAILABLE", seats: 12, rac: null, waitlist: null, fare: 1180 },
    { classCode: "SL", status: "WAITLIST", seats: null, rac: null, waitlist: 14, fare: 320 },
  ],
} as unknown as AgentRouteLeg;

describe("Round-60 · leg classes ka layout", () => {
  it("leg ki seat pehle + 'Best', class code dobara nahi", () => {
    const { container } = render(<ClassGrid leg={leg} depDay={0} bookable onBook={() => undefined} />);
    const chips = [...container.querySelectorAll(".jx-classgrid .jx-cchip")];
    expect(chips.length).toBe(3);
    expect(chips[0].textContent).toContain("Best");
    expect(chips[0].textContent).toContain("AVL 16");
    /* "CC CC AVL" jaisa duplicate nahi */
    expect(chips[0].textContent).not.toMatch(/CC\s+CC/);
    expect(chips[2].textContent).toContain("WL 14");
  });

  it("har chip par Book aur tap → wahi class", () => {
    const onBook = vi.fn();
    render(<ClassGrid leg={leg} depDay={0} bookable onBook={onBook} />);
    expect(screen.getAllByText("Book").length).toBe(3);
    fireEvent.click(screen.getAllByText("Book")[1]);
    expect(onBook).toHaveBeenCalledTimes(1);
    expect(onBook.mock.calls[0][0].classCode).toBe("2A");
  });

  it("booking off ho to koi Book nahi (jhooth nahi), chips phir bhi dikhein", () => {
    render(<ClassGrid leg={leg} depDay={0} bookable={false} />);
    expect(screen.queryByText("Book")).toBeNull();
    expect(screen.getByText(/AVL 16/)).toBeTruthy();
  });
});
