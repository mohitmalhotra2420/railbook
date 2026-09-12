/* Round-18m-27 (user screenshot 12426 JAT→NDLS 3A): railyatri site "8 RAC ₹1520", app "RAC 63 ₹1,705".
 * IRCTC text "RAC  63/RAC   8" = booking-time RAC 63, CURRENT RAC 8 → current lo. Fare = ticket_fare (IRCTC),
 * total_fare mein catering judi hai. */
import { describe, expect, it } from "vitest";
import { parseIrctcAvailabilityText } from "../server/railway/webscrape";

describe("Round-18m-27: current RAC position + IRCTC ticket fare", () => {
  it('"RAC  63/RAC   8" → RAC 8 (current), "GNWL2/RAC26" → RAC 26, "RAC 12" → RAC 12', () => {
    expect(parseIrctcAvailabilityText("RAC  63/RAC   8")).toEqual({ status: "RAC", seats: null, rac: 8, waitlist: null });
    expect(parseIrctcAvailabilityText("GNWL2/RAC26")).toEqual({ status: "RAC", seats: null, rac: 26, waitlist: null });
    expect(parseIrctcAvailabilityText("RAC 12")).toEqual({ status: "RAC", seats: null, rac: 12, waitlist: null });
    expect(parseIrctcAvailabilityText("GNWL9/WL6")).toEqual({ status: "WAITLIST", seats: null, rac: null, waitlist: 6 });
    expect(parseIrctcAvailabilityText("AVAILABLE-0287")).toEqual({ status: "AVAILABLE", seats: 287, rac: null, waitlist: null });
  });
});
