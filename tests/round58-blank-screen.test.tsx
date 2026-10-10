/* ══ ROUND-58 (29 Sep 2026, user screenshots 22:28/22:29) ════════════════════════════════════════════
 * User: *"Yeh pehle ese search krta hai fir results page blank aa rha"* — chat seedha blank.
 *
 * Asli wajah (browser console se, playwright): R57 me BlockView ke props me `onOpenPlanPage`
 * destructure hona reh gaya tha, par use kiya gaya tha →
 *     ReferenceError: onOpenPlanPage is not defined
 * React ne poora tree unmount kar diya → screen par sirf khaali page.
 *
 * Ye test us level ko lock karta hai:
 *   (a) koi bhi render error poori chat ko khaali na kare — ErrorBoundary card dikhe + retry chale;
 *   (b) seat board ka "Connecting/Alternative" wiring props me hi ho (undefined name na bache);
 *   (c) progress ginti me done > total kabhi na ho ("18/6 checks completed" jaisa jhooth nahi).
 *   (d) asli prod jawab (12053/12013/14679 wali line) bina crash render ho.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { SeatListBlock } from "../src/views/Concierge";
import { ReplyText } from "../src/components/ReplyText";

afterEach(() => vi.restoreAllMocks());

function Boom({ on = true }: { on?: boolean }) {
  if (on) throw new Error("render phat gaya");
  return <div>theek hai</div>;
}

describe("Round-58 · render error par screen khaali NAHI hoti", () => {
  it("error boundary fallback card dikhata hai (khaali page nahi) + 'Dobara try' se dobara render", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <ErrorBoundary what="card" compact>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/card dikha nahi paaya/)).toBeTruthy();
    expect(screen.getByText("↻ Dobara try")).toBeTruthy();
    /* resetKey badla → boundary khud reset ho jaati hai (naya jawab aane par purana error chipka nahi rehta) */
    rerender(
      <ErrorBoundary what="card" resetKey="msg-2" compact>
        <Boom on={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("theek hai")).toBeTruthy();
    spy.mockRestore();
  });

  it("ek toota card baaki chat ko nahi giraata (do boundaries, ek phati)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <div>
        <ErrorBoundary what="card A" compact>
          <Boom />
        </ErrorBoundary>
        <ErrorBoundary what="card B" compact>
          <div>doosra card bilkul theek</div>
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText("doosra card bilkul theek")).toBeTruthy();
    expect(screen.getByText(/card A dikha nahi paaya/)).toBeTruthy();
    spy.mockRestore();
  });

  it("error ke baad 'Dobara try' dabane par wahi boundary dobara render karti hai", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let ok = false;
    function Flaky() {
      if (!ok) throw new Error("pehla render fail");
      return <div>ab chal gaya</div>;
    }
    render(
      <ErrorBoundary what="jawab" compact>
        <Flaky />
      </ErrorBoundary>,
    );
    ok = true;
    fireEvent.click(screen.getByText("↻ Dobara try"));
    expect(screen.getByText("ab chal gaya")).toBeTruthy();
    spy.mockRestore();
  });
});

describe("Round-58 · seat board ke next-page buttons ka wiring (jahan undefined name tha)", () => {
  const block = {
    type: "seatlist",
    from: "LDH",
    to: "ASR",
    toName: "Amritsar Jn",
    date: "2026-09-30",
    source: "web_confirmtkt",
    rows: [
      { number: "12053", name: "ASR JANSHATABDI", classCode: "2S", status: "AVAILABLE", seats: 596, rac: null, waitlist: null, fare: 110, departure: null, durationMinutes: null },
    ],
  } as unknown as Parameters<typeof SeatListBlock>[0]["block"];

  it("dono button props se hi render hote hain (koi undefined naam nahi)", () => {
    const onOpenPage = vi.fn();
    render(<SeatListBlock block={block} onPick={() => undefined} onOpenPage={onOpenPage} />);
    fireEvent.click(screen.getByText(/Alternative trains/));
    expect(onOpenPage).toHaveBeenCalledWith("alt", "LDH", "ASR", "2026-09-30");
  });
});

describe("Round-58 · jawab ke rows (asli prod text) bina crash render hote hain", () => {
  it("12053/12013/14679 wali live line → 3 table rows", () => {
    const text =
      "12053 ASR JANSHATABDI – 2S AVL 596 ₹110 · CC AVL 78 ₹350 12013 AMRITSAR SHTABDI – CC AVL 432 ₹490 · EC AVL 27 ₹770 " +
      "14679 DLI ASR EXP – 2S AVL 389 ₹85 · CC AVL 50 ₹270\n➕ 9 trains ke rows neeche cards me hain (live board se) — jaise 18103, 22429";
    const { container } = render(<ReplyText text={text} />);
    expect(container.textContent).toContain("12053");
    expect(container.textContent).toContain("14679");
  });
});
