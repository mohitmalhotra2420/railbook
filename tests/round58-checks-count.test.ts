/* Round-58 (user screenshot: "Seat checks… 18/6 checks completed"): progress ginti ka ulta number.
 * Ab total kabhi done se chhota nahi hota — turnScope me safety net (aur router.getAvailability me
 * har asli provider check par addChecks(1)/checkDone()). */
import { describe, expect, it } from "vitest";
import { runTurnScope, checkDone, addChecks } from "../server/perf/turnScope";

describe("Round-58 · checks ginti (done ≤ total)", () => {
  it("bina announce kiye check done hone par bhi total done ke barabar ho jaata hai", async () => {
    const seen = await runTurnScope(async (scope) => {
      /* jaise asli turn: 1 check announce hua, par 3 chale */
      addChecks(1);
      checkDone();
      checkDone();
      checkDone();
      return { done: scope.checksDone, total: scope.checksTotal };
    });
    expect(seen.done).toBe(3);
    expect(seen.total).toBe(3);
    expect(seen.done).toBeLessThanOrEqual(seen.total);
  });

  it("announce kiye gaye checks ke saath bhi count seedha rehta hai", async () => {
    const seen = await runTurnScope(async (scope) => {
      addChecks(2);
      checkDone();
      checkDone();
      return { done: scope.checksDone, total: scope.checksTotal };
    });
    expect(seen.done).toBe(2);
    expect(seen.total).toBe(2);
  });

  it("progress event me bhi total >= done jaata hai (UI line isi se banti hai)", async () => {
    const events: { done?: number; total?: number }[] = [];
    await runTurnScope(
      async () => {
        addChecks(1);
        checkDone();
        checkDone();
      },
      (e) => events.push({ done: e.done, total: e.total }),
    );
    for (const e of events) {
      if (typeof e.done === "number" && typeof e.total === "number") {
        expect(e.total).toBeGreaterThanOrEqual(e.done);
      }
    }
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});
