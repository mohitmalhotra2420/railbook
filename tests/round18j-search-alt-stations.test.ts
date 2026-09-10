/**
 * Round-18j — SEARCH_TRAINS with 0 direct trains proactively lists same-city
 * sibling stations (§8) from REAL search results, and tells the model to
 * confirm with the user instead of silently switching origin/destination.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../server/railway/router.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/railway/router.js")>();
  return {
    ...mod,
    searchTrainsRouted: async (q: { from: string; to: string }) => {
      if (q.from === "LDH" && q.to === "BDTS") {
        return { trains: [{ number: "12926", name: "PASCHIM EXP", classes: [], durationMinutes: 1500 }], provider: "railradar" };
      }
      return { trains: [], provider: "web_erail" };
    },
    routedClassBoard: async () => ({ provider: "none", classes: [] }),
  };
});

describe("Round-18j SEARCH_TRAINS → sibling station suggestions", () => {
  it("summary carries YOU MAY ALSO CONSIDER with the real sibling pair and a confirm instruction", async () => {
    process.env.NVIDIA_API_KEY ||= "test";
    const { executeApprovedTool } = await import("../server/agent/agentic.js");
    const r = await executeApprovedTool("SEARCH_TRAINS", { origin: "LDH", destination: "BCT", date: "2026-09-20" }, { userText: "Ludhiana se Mumbai" } as never);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/koi direct train nahi mili/);
    expect(r.summary).toMatch(/YOU MAY ALSO CONSIDER/);
    expect(r.summary).toMatch(/LDH→BDTS \(1 trains: 12926\)/);
    expect(r.summary).toMatch(/user se confirm karo, khud mat badlo/);
    const data = r.data as { alternate_stations: Array<{ to: string; count: number }> };
    expect(data.alternate_stations).toEqual([expect.objectContaining({ to: "BDTS", count: 1 })]);
  }, 30000);
});
