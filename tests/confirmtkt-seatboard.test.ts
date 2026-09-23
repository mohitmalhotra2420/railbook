/**
 * 23 Sep 2026 — "chat screen me seats fetch nahi ho rahi, cards me ho rahi".
 *
 * Covers the fix:
 *  - ConfirmTkt board parsing (AVL/WL/RAC/Regret/TRAIN CANCELLED/null) — bina guess.
 *  - Route-level board cache (ek call, phir 90s tak memory se).
 *  - Wikipedia facts picker (number match > generic express page).
 *  - Route-level API `/api/availability?from&to&date` (ek request, saare trains).
 *  - Per-train `/api/availability?trainNumber=...` KABHI 500 na de — khaali board
 *    bhi 200 ho (warna app row ko error maan ke retry chhod deti hai).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import {
  _clearConfirmTktCache,
  _setConfirmTktFetchForTests,
  confirmTktRouteBoard,
  parseConfirmTktAvailability,
  parseConfirmTktBoard,
  CONFIRMTKT_STALE_MS,
} from "../server/railway/confirmtkt";
import { _clearWikipediaCache, _setWikipediaFetchForTests, pickWikiTitle, wikipediaTrainFacts } from "../server/railway/wikitrain";
import { setProvider } from "../server/providers/index";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setRailkitSdk } from "../server/railway/railkit";
import { setScrapeFetch } from "../server/railway/webscrape";

beforeEach(() => {
  /* setup.ts default "mock" hai → railcoreIsPrimary() false ho jaata; is suite me
   * real production path (RailCore primary → web fallbacks) test karna hai. */
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILKIT_API_KEY = "";
  _clearConfirmTktCache();
  _clearWikipediaCache();
  setProvider(null);
});

afterEach(() => {
  setScrapeFetch(null);
  _setConfirmTktFetchForTests(null);
  _setWikipediaFetchForTests(null);
  setProvider(null);
});

/* ── 1. status parsing (live strings jo 23 Sep 2026 ko dekhe gaye) ────────── */
describe("ConfirmTkt availability parsing", () => {
  it("AVAILABLE-0009 → AVAILABLE + 9 seats", () => {
    const p = parseConfirmTktAvailability("AVAILABLE-0009", "AVL 9");
    expect(p.status).toBe("AVAILABLE");
    expect(p.seats).toBe(9);
  });
  it("CURR_AVBL-0226 → AVAILABLE + 226 seats", () => {
    const p = parseConfirmTktAvailability("CURR_AVBL-0226", "CURR_AVL 226");
    expect(p.status).toBe("AVAILABLE");
    expect(p.seats).toBe(226);
  });
  it("RLWL5/WL5 → WAITLIST 5 (current WL, not the RLWL number)", () => {
    const p = parseConfirmTktAvailability("RLWL5/WL5", "WL 5");
    expect(p.status).toBe("WAITLIST");
    expect(p.waitlist).toBe(5);
  });
  it("RAC 12 → RAC 12", () => {
    const p = parseConfirmTktAvailability("RAC 12", "RAC 12");
    expect(p.status).toBe("RAC");
    expect(p.rac).toBe(12);
  });
  it("TRAIN CANCELLED → NOT_AVAILABLE + honest note", () => {
    const p = parseConfirmTktAvailability("TRAIN CANCELLED", "Train Cancelled");
    expect(p.status).toBe("NOT_AVAILABLE");
    expect(p.note).toBe("Train Cancelled");
  });
  it("REGRET / NOT AVAILABLE → NOT_AVAILABLE", () => {
    expect(parseConfirmTktAvailability("REGRET", "Regret").status).toBe("NOT_AVAILABLE");
    expect(parseConfirmTktAvailability("NOT AVAILABLE ", "Not Available").status).toBe("NOT_AVAILABLE");
  });
  it("null/NA → UNKNOWN (koi guess nahi)", () => {
    const p = parseConfirmTktAvailability(null, "");
    expect(p.status).toBe("UNKNOWN");
    expect(p.seats).toBeNull();
  });
});

/* ── 2. board parse + freshness ──────────────────────────────────────────── */
const board = () => ({
  data: {
    trainList: [
      {
        trainNumber: "14653",
        trainName: "HSR ASR EXPRESS",
        fromStnCode: "LDH",
        toStnCode: "BEAS",
        departureTime: "04:35",
        arrivalTime: "06:33",
        availabilityCache: {
          SL: { availability: "AVAILABLE-0009", availabilityDisplayName: "AVL 9", fare: "150", cacheTime: new Date().toISOString(), quota: "GN" },
        },
      },
      {
        trainNumber: "18309",
        trainName: "SBP JAT EXPRESS",
        fromStnCode: "LDH",
        toStnCode: "BEAS",
        availabilityCache: {
          "2A": { availability: "TRAIN CANCELLED", availabilityDisplayName: "Train Cancelled", fare: "725", cacheTime: new Date().toISOString() },
          SL: { availability: "TRAIN CANCELLED", availabilityDisplayName: "Train Cancelled", fare: "150", cacheTime: new Date().toISOString() },
        },
      },
      {
        trainNumber: "13005",
        trainName: "HWH ASR MAIL",
        availabilityCache: {
          "2A": { availability: "RLWL5/WL5", availabilityDisplayName: "WL 5", fare: "725", cacheTime: new Date(Date.now() - CONFIRMTKT_STALE_MS - 60_000).toISOString(), predictionPercentage: 80 },
        },
      },
    ],
  },
});

describe("ConfirmTkt board", () => {
  it("parses per-class rows with fare, note aur stale flag", () => {
    const rows = parseConfirmTktBoard(board(), "LDH", "BEAS", "2026-09-24");
    expect(rows.map((r) => r.trainNumber)).toEqual(["14653", "18309", "13005"]);
    const t1 = rows[0].classes[0];
    expect(t1.code).toBe("SL");
    expect(t1.status).toBe("AVAILABLE");
    expect(t1.seats).toBe(9);
    expect(t1.fare).toBe(150);
    expect(t1.source).toBe("web_confirmtkt");
    const t2 = rows[1].classes.find((c) => c.code === "SL")!;
    expect(t2.note).toBe("Train Cancelled");
    const t3 = rows[2].classes[0];
    expect(t3.stale).toBe(true);
    expect(t3.waitlist).toBe(5);
    expect(String(t3.webNote)).toContain("confirm chance");
  });

  it("route board ek hi network call karta hai (90s cache)", async () => {
    let calls = 0;
    _setConfirmTktFetchForTests((async () => {
      calls += 1;
      return new Response(JSON.stringify(board()), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch);
    const a = await confirmTktRouteBoard("LDH", "BEAS", "2026-09-24");
    const b = await confirmTktRouteBoard("LDH", "BEAS", "2026-09-24");
    expect(a?.trains.length).toBe(3);
    expect(b?.trains.length).toBe(3);
    expect(calls).toBe(1);
  });

  it("API fail → null (khaali/invent nahi)", async () => {
    _setConfirmTktFetchForTests((async () => new Response("nope", { status: 500 })) as unknown as typeof fetch);
    expect(await confirmTktRouteBoard("LDH", "BEAS", "2026-09-24")).toBeNull();
  });
});

/* ── 3. Wikipedia facts ─────────────────────────────────────────────────── */
describe("Wikipedia train facts", () => {
  it("number wale title ko prefer karta hai", () => {
    const title = pickWikiTitle("18309", [
      { title: "Indian Railways" },
      { title: "Sambalpur–Jammu Tawi Express", snippet: "The 18309 / 18310 ..." },
    ]);
    expect(title).toBe("Sambalpur–Jammu Tawi Express");
  });

  it("summary fetch karke facts deta hai; fail par null", async () => {
    _setWikipediaFetchForTests((async (url: string | URL) => {
      const u = String(url);
      if (u.includes("api.php")) {
        return new Response(JSON.stringify({ query: { search: [{ title: "Sambalpur–Jammu Tawi Express", snippet: "18309 / 18310" }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ title: "Sambalpur–Jammu Tawi Express", extract: "An express train of Indian Railways.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Sambalpur–Jammu_Tawi_Express" } } }), { status: 200 });
    }) as unknown as typeof fetch);
    const facts = await wikipediaTrainFacts("18309");
    expect(facts?.source).toBe("web_wikipedia");
    expect(facts?.title).toContain("Sambalpur");
    _clearWikipediaCache();
    _setWikipediaFetchForTests((async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    expect(await wikipediaTrainFacts("99999")).toBeNull();
  });
});

/* ── 4. HTTP endpoints ──────────────────────────────────────────────────── */
describe("seat-board API", () => {
  beforeEach(() => {
    /* Providers ko block karo taaki sirf web board ka behaviour test ho. */
    setRailcoreFetch((async () => new Response("blocked", { status: 500 })) as unknown as typeof fetch);
    setRailkitSdk(null);
    /* Saare purane web-scrape sources block — sirf ConfirmTkt board ka test. */
    setScrapeFetch((async () => new Response("blocked", { status: 500 })) as unknown as typeof fetch);
    _setConfirmTktFetchForTests((async () => new Response(JSON.stringify(board()), { status: 200 })) as unknown as typeof fetch);
  });

  it("route-level: ek call me saare trains × classes", async () => {
    const app = createApp();
    const res = await request(app).get("/api/availability?from=LDH&to=BEAS&date=2026-09-24");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("web_confirmtkt");
    const t1 = res.body.trains.find((t: { trainNumber: string }) => t.trainNumber === "14653");
    const cancelled = res.body.trains.find((t: { trainNumber: string }) => t.trainNumber === "18309");
    /* UI rows `classCode` padhti hain — dono fields bhejna zaroori hai (warna
     * "undefined AVL 9" — user screenshot 23 Sep 21:09). */
    expect(t1.classes[0]).toMatchObject({ code: "SL", classCode: "SL", status: "AVAILABLE", seats: 9 });
    expect(cancelled.classes[0].note).toBe("Train Cancelled");
  });

  it("per-train: cancelled train bhi honest data deti hai (aur 200 hi rehta hai)", async () => {
    const app = createApp();
    const res = await request(app).get("/api/availability?trainNumber=18309&date=2026-09-24&from=LDH&to=BEAS&quota=GN");
    expect(res.status).toBe(200);
    const [first] = res.body.classes;
    expect(first.note).toBe("Train Cancelled");
    expect(first.source).toBe("web_confirmtkt");
  });

  it("sab provider fail → 200 + khaali board (kabhi 500 nahi)", async () => {
    _setConfirmTktFetchForTests((async () => new Response("down", { status: 503 })) as unknown as typeof fetch);
    const app = createApp();
    const res = await request(app).get("/api/availability?trainNumber=64551&date=2026-09-24&from=LDH&to=BEAS&quota=GN");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.classes)).toBe(true);
  });

  it("facts endpoint wikipedia se (ya honest none)", async () => {
    _setWikipediaFetchForTests((async () => new Response("nope", { status: 404 })) as unknown as typeof fetch);
    const app = createApp();
    const res = await request(app).get("/api/trains/18309/facts");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("none");
  });
});
