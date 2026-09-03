import { describe, expect, it } from "vitest";
import { bookingReducer, initialBooking } from "../src/booking/state";
import { todayYmdFrom as clientToday } from "../src/ai/dates";
import { todayYmdFrom as serverToday } from "../server/understand/legacy-dates";
import { todayYmd as serverTodayUtil, isPastDate } from "../server/util";
import { addDays as clientAddDays, todayYmd as clientTodayUtil } from "../src/format";

/**
 * IST regression: at 00:43 IST on 2026-09-04 the UTC clock still reads
 * 2026-09-03T19:13Z. "Kal" must be 2026-09-05 (IST), never 2026-09-04.
 */
const JUST_PAST_MIDNIGHT_IST = new Date("2026-09-03T19:13:00Z");

describe("IST-pinned today (server UTC + client)", () => {
  it("server understand date parser counts 00:43 IST as the next IST day", () => {
    expect(serverToday(JUST_PAST_MIDNIGHT_IST)).toBe("2026-09-04");
    // kal from there is Sep 5, not Sep 4
    const [y, m, d] = serverToday(JUST_PAST_MIDNIGHT_IST).split("-").map(Number);
    expect(new Date(y, m - 1, d + 1).toISOString().slice(0, 10)).toBe("2026-09-05");
  });

  it("client date parser agrees with the server", () => {
    expect(clientToday(JUST_PAST_MIDNIGHT_IST)).toBe("2026-09-04");
    expect(clientToday(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01"); // 00:00 IST 2027
  });

  it("server util todayYmd() is IST-based", () => {
    expect(serverTodayUtil()).toBe(clientToday(new Date()));
  });

  it("client format todayYmd() is IST-based", () => {
    expect(clientTodayUtil()).toBe(clientToday(new Date()));
  });

  it("isPastDate stays sane around the IST boundary", () => {
    expect(isPastDate("2001-01-01")).toBe(true);
    expect(isPastDate("2099-01-01")).toBe(false);
  });
});

describe("searched date stays in sync with the board", () => {
  it("SEARCH_START adopts the searched date so chips/cards never disagree", () => {
    let state = initialBooking("2026-09-05");
    state = { ...state, date: "2026-09-05", trains: [], dateProvided: true };
    // Concierge searched for Sep 4 (e.g. spoken 'kal' resolved there) — the board must follow.
    state = bookingReducer(state, { type: "SEARCH_START", date: "2026-09-04" });
    expect(state.date).toBe("2026-09-04");
    expect(state.dateProvided).toBe(true);
    expect(state.trains).toEqual([]);
    expect(state.searching).toBe(true);
  });

  it("SEARCH_START without a date keeps the current date", () => {
    let state = initialBooking("2026-09-05");
    state = bookingReducer(state, { type: "SEARCH_START" });
    expect(state.date).toBe("2026-09-05");
  });

  it("addDays stays calendar-pure across month ends", () => {
    expect(clientAddDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(clientAddDays("2026-09-30", 1)).toBe("2026-10-01");
  });
});
