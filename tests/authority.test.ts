import { describe, expect, it } from "vitest";
import { isForbiddenMoneyTool, neverAutoBook } from "../src/ai/agent";
import { executeTool } from "../server/agent/tools";
import { runAgent } from "../server/agent/run";

describe("money and booking authority", () => {
  it("AI never auto-books, even on FARE_REVIEW", () => {
    expect(neverAutoBook("BOOK_TRAIN", "FARE_REVIEW")).toBe(true);
    expect(neverAutoBook("CONFIRM_YES", "FARE_REVIEW")).toBe(true);
    expect(neverAutoBook("haan", "PAYMENT_PENDING")).toBe(true);
  });

  it("forbids wallet and booking mutation tools", () => {
    for (const tool of ["createBooking", "confirmBooking", "addMoney", "debit", "credit", "cancelBooking", "bookTrain", "charge"]) {
      expect(isForbiddenMoneyTool(tool), tool).toBe(true);
    }
    expect(isForbiddenMoneyTool("getWallet")).toBe(false);
    expect(isForbiddenMoneyTool("getFare")).toBe(false);
    expect(isForbiddenMoneyTool("checkPNR")).toBe(false);
  });

  it("executeTool refuses money/booking mutations", async () => {
    const blocked = await executeTool("createBooking", {});
    expect(blocked.ok).toBe(false);
    expect(blocked.summary).toMatch(/Confirm & Book/i);
    const add = await executeTool("addMoney", {});
    expect(add.ok).toBe(false);
    const debit = await executeTool("debit", {});
    expect(debit.ok).toBe(false);
  });

  it("runAgent never returns confirmBook true", async () => {
    const res = await runAgent({ text: "meri bookings dikhao", bookingFlow: "FARE_REVIEW" });
    expect(res.confirmBook).toBe(false);
    expect(["getMyBookings", null]).toContain(res.tool);
  });
});
