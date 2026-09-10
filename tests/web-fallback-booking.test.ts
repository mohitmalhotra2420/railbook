/* ══ ROUND-16 (2026-09-07): "agar api fail ho jaaye to seat availability,
 * fare, station lookup aur live status web se scrape ho — verified sites".
 *
 * - Seat availability + fare: RailYatri SA JSON (IRCTC-sourced, cached,
 *   last_updated ke saath) — pehle sirf erail fare-only row aati thi.
 * - Station lookup: NAME query par erail.in ki full station list
 *   (railenquiry sirf code accept karta tha).
 * - Live status: pehle se railyatri/railenquiry — regression guard yahan.
 * Sab web-sourced rows `source`/`(Source: …)` label ke saath aate hain. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseIrctcAvailabilityText,
  scrapeSeatAvailabilityWeb,
  scrapeStationSearchWeb,
  scrapeStationLookupWeb,
  setScrapeFetch,
  _setErailStationsCacheForTests,
} from "../server/railway/webscrape";
import { getFallbackProvider, resetFallbackProvider, routedStationSearch, routedClassBoard } from "../server/railway/router";
import { setRailcoreFetch } from "../server/railway/railcore";
import { executeApprovedTool } from "../server/agent/agentic";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function textResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

function ymd(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000 + 5.5 * 3600000);
  return d.toISOString().slice(0, 10);
}
function ryKey(y: string): string {
  const [Y, M, D] = y.split("-");
  return `${Number(D)}-${Number(M)}-${Y}`;
}
const D1 = ymd(1);
const D2 = ymd(2);
const D3 = ymd(3);
const FRESH = new Date(Date.now() - 3 * 3600000 + 5.5 * 3600000).toISOString().slice(0, 19).replace("T", " ") + " +0530";

const SA_JSON = {
  success: true,
  error: null,
  data_from: "CACHED",
  train_number: "12014",
  seat_availibility: [
    { availablity_date: ryKey(D1), availablity_status: "AVAILABLE-0288", seat_avl: 288, ticket_fare: 1000, catering_charge: 125, total_fare: 1125, last_updated_at: FRESH, cache_text: "As of 3 hours ago" },
    { availablity_date: ryKey(D2), availablity_status: "GNWL45/WL20", seat_avl: 0, ticket_fare: 1000, total_fare: 1125, last_updated_at: FRESH, cache_text: "As of 3 hours ago" },
    { availablity_date: ryKey(D3), availablity_status: "RAC 12", seat_avl: 0, ticket_fare: 1000, total_fare: 1125, last_updated_at: "2026-08-01 10:00:00 +0530", cache_text: "As of 16 days ago" },
  ],
};

/** Web mock: railyatri SA JSON + erail stations list + erail fare 404. */
function webMock(opts: { saDown?: boolean } = {}): void {
  setScrapeFetch(async (input: any) => {
    const url = String(input);
    if (url.includes("sa.railyatri.in/api/v3/seat/availability/")) {
      if (opts.saDown) return jsonResponse(500, {});
      if (url.includes("/12014/")) return jsonResponse(200, SA_JSON);
      return jsonResponse(200, { success: true, error: "Station <NDLS> not an Intermediate Station of Train", seat_availibility: [] });
    }
    if (url.includes("erail.in/js/cmp/stations.js")) {
      return textResponse(200, 'var StationsData="BIGN,10510461,PGW,Phagwara Jn,JRC,Jalandhar Cant,JUC,Jalandhar City,LDH,Ludhiana Jn,NDLS,New Delhi";');
    }
    return textResponse(404, "");
  });
}

/** RailCore = 402 credits exhausted (real prod failure mode). */
function railcoreDown(): void {
  setRailcoreFetch(async () => jsonResponse(402, { success: false, error: { code: "CREDITS_EXHAUSTED", message: "credits" } }));
}

describe("ROUND-16: booking-critical web fallback (API fail → verified sites)", () => {
  const savedCore = process.env.RAILCORE_API_KEY;
  const savedKit = process.env.RAILKIT_API_KEY;
  beforeEach(() => {
    process.env.RAILCORE_API_KEY = "rk_live_test_key";
    process.env.RAILKIT_API_KEY = "";
    process.env.RAILWAY_PROVIDER = "railcore";
    resetFallbackProvider();
    _setErailStationsCacheForTests(null);
    railcoreDown();
    webMock();
  });
  afterEach(() => {
    process.env.RAILCORE_API_KEY = savedCore;
    process.env.RAILKIT_API_KEY = savedKit;
    setScrapeFetch(null);
    setRailcoreFetch(null as never);
    resetFallbackProvider();
  });

  it("parseIrctcAvailabilityText: AVAILABLE / GNWL / RAC / REGRET sab samajhta hai", () => {
    expect(parseIrctcAvailabilityText("AVAILABLE-0288")).toEqual({ status: "AVAILABLE", seats: 288, rac: null, waitlist: null });
    expect(parseIrctcAvailabilityText("GNWL45/WL20")).toEqual({ status: "WAITLIST", seats: null, rac: null, waitlist: 20 });
    expect(parseIrctcAvailabilityText("RAC 12")).toEqual({ status: "RAC", seats: null, rac: 12, waitlist: null });
    expect(parseIrctcAvailabilityText("REGRET")).toEqual({ status: "NOT_AVAILABLE", seats: 0, rac: null, waitlist: null });
    expect(parseIrctcAvailabilityText("TRAIN DEPARTED").status).toBe("NOT_AVAILABLE");
    expect(parseIrctcAvailabilityText("").status).toBe("UNKNOWN");
  });

  it("scrapeSeatAvailabilityWeb: maangi date ki row (WL wali bhi) + fare + last-updated", async () => {
    const a = await scrapeSeatAvailabilityWeb("12014", D1, "ASR", "NDLS", "CC");
    expect(a?.status).toBe("AVAILABLE");
    expect(a?.seats).toBe(288);
    expect(a?.totalFare).toBe(1125);
    expect(a?.cacheText).toBe("As of 3 hours ago");
    expect(a?.provider).toBe("web_railyatri");
    const wl = await scrapeSeatAvailabilityWeb("12014", D2, "ASR", "NDLS", "CC");
    expect(wl?.status).toBe("WAITLIST");
    expect(wl?.waitlist).toBe(20);
    /* Route par station nahi — honest null (invent nahi). */
    expect(await scrapeSeatAvailabilityWeb("12904", D1, "ASR", "NDLS", "SL")).toBeNull();
  });

  it("FRESHNESS: 24h se purana cached row → stale:true (Round-18m: dikhta hai, lekin ⚠ last-known label ke saath; fresh nahi maana jaata)", async () => {
    const old = await scrapeSeatAvailabilityWeb("12014", D3, "ASR", "NDLS", "CC");
    expect(old?.stale).toBe(true);
    /* fresh rows carry no stale flag */
    const fresh = await scrapeSeatAvailabilityWeb("12014", D1, "ASR", "NDLS", "CC");
    expect(fresh?.stale).toBeUndefined();
  });

  it("provider.getAvailability: RailCore 402 → railyatri se AVAILABLE 288 seats, source label", async () => {
    const row = await getFallbackProvider().getAvailability("12014", D1, "ASR", "NDLS", "CC", "GN");
    expect(row.status).toBe("AVAILABLE");
    expect(row.seats).toBe(288);
    expect(row.fare).toBe(1125);
    expect(row.source).toBe("web_railyatri");
    expect(row.webNote).toMatch(/railyatri\.in/);
  });

  it("provider.getFare: RailCore 402 → railyatri segment fare × passengers", async () => {
    const fare = await getFallbackProvider().getFare("12014", D1, "ASR", "NDLS", "CC", 2);
    expect(fare.railwayAvailable).toBe(true);
    expect(fare.baseFare).toBe(1125);
    expect(fare.total).toBe(2250);
    expect(fare.source).toBe("web_railyatri");
  });

  it("railyatri bhi down → UNKNOWN row (guess nahi), fare unavailable", async () => {
    webMock({ saDown: true });
    const row = await getFallbackProvider().getAvailability("12014", D1, "ASR", "NDLS", "CC", "GN");
    expect(row.status).toBe("UNKNOWN");
    expect(row.seats).toBeUndefined();
  });

  it("routedClassBoard: sab classes web se → provider 'web_railyatri'", async () => {
    const board = await routedClassBoard("12014", D1, "ASR", "NDLS", "GN", ["CC"]);
    expect(board.provider).toBe("web_railyatri");
    expect(board.classes[0].status).toBe("AVAILABLE");
  });

  it("CHECK_AVAILABILITY tool: web row par summary mein '(Source: railyatri.in — IRCTC data…)' aur WL/seats", async () => {
    const r = await executeApprovedTool("CHECK_AVAILABILITY", { train_number: "12014", date: D1, origin: "ASR", destination: "NDLS", class_code: "CC" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/AVAILABLE, 288 seats/);
    expect(r.summary).toMatch(/Source: railyatri\.in — IRCTC data/);
    expect(r.summary).toMatch(/as of 3 hours ago/i);
    const wl = await executeApprovedTool("CHECK_AVAILABILITY", { train_number: "12014", date: D2, origin: "ASR", destination: "NDLS", class_code: "CC" });
    expect(wl.summary).toMatch(/WAITLIST, WL 20/);
  });

  it("GET_FARE tool: web fare par source label", async () => {
    const r = await executeApprovedTool("GET_FARE", { train_number: "12014", date: D1, origin: "ASR", destination: "NDLS", class_code: "CC", passengers: 2 });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/total ₹2250/);
    expect(r.summary).toMatch(/Source: railyatri\.in — IRCTC fare/);
  });

  it("station NAME lookup: local DB miss + API down → erail station list (Phagwara → PGW)", async () => {
    const hits = await scrapeStationSearchWeb("phagwara");
    expect(hits[0]).toMatchObject({ code: "PGW", name: "Phagwara Jn", provider: "web_erail" });
    const multi = await scrapeStationSearchWeb("jalandhar");
    expect(multi.map((h) => h.code).sort()).toEqual(["JRC", "JUC"]);
    const routed = await routedStationSearch("phagwara");
    expect(routed.stations[0].code).toBe("PGW");
    expect(routed.provider).toBe("web_erail");
    expect(routed.needChoice).toBe(false);
    const routedMulti = await routedStationSearch("jalandhar");
    expect(routedMulti.needChoice).toBe(true);
    expect(routedMulti.stations.length).toBe(2);
  });

  it("Round-16b: station CODE lookup — railenquiry blocked (404) → erail station list se exact code", async () => {
    setScrapeFetch(async () => ({ ok: false, status: 404, text: async () => "", json: async () => ({}) }) as unknown as Response);
    _setErailStationsCacheForTests([
      { code: "PGW", name: "Phagwara Jn" },
      { code: "LDH", name: "Ludhiana Jn" },
    ]);
    const hit = await scrapeStationLookupWeb("pgw");
    expect(hit).not.toBeNull();
    expect(hit!.code).toBe("PGW");
    expect(hit!.name).toBe("Phagwara Jn");
    expect(hit!.city).toBe("Phagwara");
    expect(hit!.provider).toBe("web_erail");
    expect(await scrapeStationLookupWeb("ZZZZ")).toBeNull();
  });
});
