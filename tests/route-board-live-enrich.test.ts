/**
 * 23 Sep 2026 (user 21:35 screenshots): do shikayatein —
 *  1. "14631 me 3A UNKNOWN bta raha jabki IRCTC par seat available hai" — ConfirmTkt
 *     board us class ka data nahi deta, par RailYatri ka LIVE IRCTC pull deta hai.
 *  2. "kuch data stale aa raha, live nahi" — CT board apni ghanton/din purani cache
 *     serve karta hai (17 ghante / 17 din). Visible rows par ab live probe chalta hai.
 *
 * Ye test: stale/UNKNOWN CT rows live source se replace hoti hain, fresh CT rows
 * waise hi rehti hain, cancel-note authoritative rehta hai, aur live fail par CT
 * row (apne honest label ke saath) bachi rehti hai.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { _clearConfirmTktCache, _setConfirmTktFetchForTests } from "../server/railway/confirmtkt";
import { _clearLiveRowCache } from "../server/railway/router";
import { setScrapeFetch } from "../server/railway/webscrape";
import { setProvider } from "../server/providers/index";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setRailkitSdk } from "../server/railway/railkit";

const DATE = "2026-09-24";
const OLD = new Date(Date.now() - 17 * 3600 * 1000).toISOString(); // 17 ghante purana (CT)

/** ConfirmTkt board: 3A ka data hi nahi (UNKNOWN), SL 17 ghante purana, ek train cancelled. */
const CT_BOARD = {
  data: {
    trainList: [
      {
        trainNumber: "14631",
        trainName: "DDN ASR EXPRESS",
        fromStnCode: "LDH",
        toStnCode: "BEAS",
        availabilityCache: {
          "3A": { availability: null, availabilityDisplayName: null, fare: "520", cacheTime: OLD, quota: "GN" },
          SL: { availability: "AVAILABLE-0226", availabilityDisplayName: "AVL 226", fare: "150", cacheTime: OLD, quota: "GN" },
        },
      },
      {
        trainNumber: "18309",
        trainName: "SBP JAT EXPRESS",
        availabilityCache: {
          SL: { availability: "TRAIN CANCELLED", availabilityDisplayName: "Train Cancelled", fare: "150", cacheTime: OLD, quota: "GN" },
        },
      },
      {
        trainNumber: "19613",
        trainName: "AII ASR EXP",
        availabilityCache: {
          "2A": { availability: "AVAILABLE-0001", availabilityDisplayName: "AVL 1", fare: "725", cacheTime: new Date().toISOString(), quota: "GN" },
        },
      },
    ],
  },
};

/** RailYatri live (refresh=true) — IRCTC board jaisa. */
function railyatriMock() {
  return (async (url: string | URL) => {
    const u = String(url);
    /* URL: /api/v3/seat/availability/<train>/<YYYY-MM-DD>/<from>/<to>/<cls>/<quota>.json */
    const dm = u.match(/availability\/\d+\/(\d{4}-\d{2}-\d{2})\//);
    const ymd = (dm?.[1] ?? new Date().toISOString().slice(0, 10)).split("-");
    const key = `${Number(ymd[2])}-${Number(ymd[1])}-${ymd[0]}`;
    const live = (status: string, fare: number, extra: Record<string, unknown> = {}) =>
      new Response(JSON.stringify({ success: true, data_from: "IRCTC", seat_availibility: [{ availablity_date: key, availablity_status: status, ticket_fare: fare, last_updated_at: new Date().toISOString(), ...extra }] }), { status: 200 });
    if (!u.includes("refresh=true")) return new Response(JSON.stringify({ success: false }), { status: 200 });
    if (u.includes("/14631/") && u.includes("/3A/")) return live("CURR_AVBL-0019", 520);
    if (u.includes("/14631/") && u.includes("/SL/")) return live("CURR_AVBL-0160", 150);
    if (u.includes("/19613/")) return live("CURR_AVBL-0001", 725);
    if (u.includes("/18309/")) return live("NOT AVAILABLE", 150);
    return new Response(JSON.stringify({ success: false, error: "no data" }), { status: 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILKIT_API_KEY = "";
  _clearConfirmTktCache();
  _clearLiveRowCache();
  setProvider(null);
  setRailcoreFetch((async () => new Response("blocked", { status: 500 })) as unknown as typeof fetch);
  setRailkitSdk(null);
  _setConfirmTktFetchForTests((async () => new Response(JSON.stringify(CT_BOARD), { status: 200 })) as unknown as typeof fetch);
  setScrapeFetch(railyatriMock());
});

afterEach(() => {
  setScrapeFetch(null);
  setRailcoreFetch(null);
  setRailkitSdk(null);
  _setConfirmTktFetchForTests(null);
  setProvider(null);
});

describe("route board: stale/UNKNOWN rows live ho jati hain", () => {
  it("UNKNOWN class (3A) live probe se bhar jati hai — IRCTC ke numbers ke saath", async () => {
    const app = createApp();
    const res = await request(app).get(`/api/availability?from=LDH&to=BEAS&date=${DATE}&trains=14631`);
    expect(res.status).toBe(200);
    const t = res.body.trains.find((x: { trainNumber: string }) => x.trainNumber === "14631");
    const threeA = t.classes.find((c: { code: string }) => c.code === "3A");
    expect(threeA).toMatchObject({ status: "AVAILABLE", seats: 19, source: "web_railyatri" });
    expect(threeA.stale).toBeUndefined();
  });

  it("17 ghante purani SL row bhi live ho jati hai (stale label chala jata hai)", async () => {
    const app = createApp();
    const res = await request(app).get(`/api/availability?from=LDH&to=BEAS&date=${DATE}&trains=14631`);
    const t = res.body.trains.find((x: { trainNumber: string }) => x.trainNumber === "14631");
    const sl = t.classes.find((c: { code: string }) => c.code === "SL");
    expect(sl).toMatchObject({ status: "AVAILABLE", seats: 160, source: "web_railyatri" });
    expect(sl.stale).toBeUndefined();
  });

  it("cancel-note authoritative — live 'NOT AVAILABLE' usko override nahi karta", async () => {
    const app = createApp();
    const res = await request(app).get(`/api/availability?from=LDH&to=BEAS&date=${DATE}&trains=18309`);
    const t = res.body.trains.find((x: { trainNumber: string }) => x.trainNumber === "18309");
    expect(t.classes[0].note).toBe("Train Cancelled");
    expect(t.classes[0].source).toBe("web_confirmtkt");
  });

  it("fresh CT row (aaj ka cacheTime) par live probe nahi lagta", async () => {
    let railyatriCalls = 0;
    const base = railyatriMock();
    setScrapeFetch((async (u: unknown) => {
      railyatriCalls += 1;
      return (base as unknown as (x: unknown) => Promise<Response>)(u);
    }) as unknown as typeof fetch);
    const app = createApp();
    const res = await request(app).get(`/api/availability?from=LDH&to=BEAS&date=${DATE}&trains=19613`);
    const t = res.body.trains.find((x: { trainNumber: string }) => x.trainNumber === "19613");
    expect(t.classes[0].source).toBe("web_confirmtkt");
    expect(railyatriCalls).toBe(0);
  });

  it("live fail → CT row (honest stale label ke saath) bachi rehti hai, invent nahi", async () => {
    setScrapeFetch((async () => new Response(JSON.stringify({ success: false, error: "maintenance" }), { status: 200 })) as unknown as typeof fetch);
    _clearLiveRowCache();
    const app = createApp();
    const res = await request(app).get(`/api/availability?from=LDH&to=BEAS&date=${DATE}&trains=14631`);
    const t = res.body.trains.find((x: { trainNumber: string }) => x.trainNumber === "14631");
    const sl = t.classes.find((c: { code: string }) => c.code === "SL");
    expect(sl.source).toBe("web_confirmtkt");
    expect(sl.seats).toBe(226); // CT ka data, guess nahi
  });
});
