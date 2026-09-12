import { describe, expect, it } from "vitest";
import { parseIrctcAvailabilityText } from "../server/railway/webscrape.js";

describe("Round-18m-17: IRCTC live text 'GNWL/AVAILABLE' is a seat, not a waitlist", () => {
  it("GNWL/AVAILABLE → AVAILABLE", () => expect(parseIrctcAvailabilityText("GNWL/AVAILABLE").status).toBe("AVAILABLE"));
  it("RLWL/AVAILABLE-0004 → AVAILABLE 4", () => expect(parseIrctcAvailabilityText("RLWL/AVAILABLE-0004")).toMatchObject({ status: "AVAILABLE", seats: 4 }));
  it("GNWL/RAC 3 → RAC 3", () => expect(parseIrctcAvailabilityText("GNWL/RAC 3")).toMatchObject({ status: "RAC", rac: 3 }));
  it("GNWL2/WL2 still WAITLIST 2", () => expect(parseIrctcAvailabilityText("GNWL2/WL2")).toMatchObject({ status: "WAITLIST", waitlist: 2 }));
  it("RLWL7/WL3 still WAITLIST 3", () => expect(parseIrctcAvailabilityText("RLWL7/WL3")).toMatchObject({ status: "WAITLIST", waitlist: 3 }));
});
