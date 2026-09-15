/* Round-18m-40 (user: "hubs bhi AI decide kare khud"): change-over hubs AI chunta hai — candidates (route
 * junctions + majors) se sirf allowed codes, origin/destination kabhi nahi, max 4; AI fail → route-derived. */
import { afterEach, describe, expect, it } from "vitest";
import { decideHubsWithAI, setHubFetch } from "../server/journey/hubs";

const cands = [
  { code: "JUC", name: "Jalandhar City", onRouteIndex: 1, routeLength: 4, fromFixedList: true },
  { code: "PGW", name: "Phagwara Jn", onRouteIndex: 2, routeLength: 4, fromFixedList: false },
  { code: "NDLS", name: null, onRouteIndex: null, routeLength: null, fromFixedList: true },
];
describe("Round-18m-40: AI-chosen hubs", () => {
  afterEach(() => { setHubFetch(null); delete process.env.VITEST_ALLOW; process.env.NVIDIA_API_KEY = ""; });
  it("under VITEST (no AI) → route-derived fallback, never fixed-list-only hubs", async () => {
    const d = await decideHubsWithAI({ from: "ASR", to: "LDH", fastestDirectMinutes: 95, candidates: cands });
    expect(d.source).toBe("rules");
    expect(d.hubs).toEqual(["JUC", "PGW"]);
    expect(d.hubs).not.toContain("NDLS");
  });
  it("AI answer is validated: only candidate codes, no origin/destination, max 4", async () => {
    const saved = process.env.VITEST; delete process.env.VITEST; process.env.NVIDIA_API_KEY = "nvapi-test";
    setHubFetch(async () => new Response(JSON.stringify({ model: "meta/muse-glimmer-30b", choices: [{ message: { content: '{"hubs":["NDLS","ASR","PGW","XXX"],"reason":"test"}' } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const d = await decideHubsWithAI({ from: "ASR", to: "LDH", fastestDirectMinutes: 95, candidates: cands });
    process.env.VITEST = saved;
    expect(d.source).toBe("ai");
    expect(d.hubs).toEqual(["NDLS", "PGW"]);
    expect(d.reason).toBe("test");
  });
});
