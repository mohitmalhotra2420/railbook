/* ══ ROUND-50 (29 Sep 2026) — seat row ka cross-check: IRCTC-sourced second opinion ══
 * User: "12265 mein 2S seat availability IRCTC pe and confirmtkt pe bhi show ho rhi thi but mere app
 * mein nahi". Wajah: web chain ka pehla kaamyaab source (ConfirmTkt) apni purani cache hi deta hai —
 * status non-empty hone par chain use "success" maan leti thi, aur `stale` row waisi hi app tak chali
 * jaati thi. Ab har live probe par cross-check hota hai: chain ka row fresh nahi (ya seat nahi dikha
 * raha) to IRCTC-sourced RailYatri se second opinion — seat wali + fresh row jeetti hai (user ka
 * sawaal "confirm seat" hai), warna jo row zyada fresh ho; dono na ho to chain ka row waise hi.
 *
 * Saath me: ConfirmTkt `cacheTime` IST me likha hota hai (bina zone) → 5:30 ghante future me parse
 * hota tha, jis se purani row "fresh" lagti thi aur UI ka "last updated" aage ka chhapta tha. Ab aisa
 * future-timestamp IST maan kar correct hota hai (data ka time future me ho hi nahi sakta).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { _clearConfirmTktCache, _setConfirmTktFetchForTests, ctCacheTimeMs, parseConfirmTktBoard } from "../server/railway/confirmtkt";
import { _clearLiveRowCache } from "../server/railway/router";
import { setScrapeFetch } from "../server/railway/webscrape";
import { setProvider } from "../server/providers/index";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setRailkitSdk } from "../server/railway/railkit";

const DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const OLD = new Date(Date.now() - 17 * 3600 * 1000).toISOString();

/** CT board: 14631 ki 2S row 17 ghante purani (WL) — RY par wahi train AVAILABLE hai. */
const CT_BOARD = {
  data: {
    trainList: [
      {
        trainNumber: "14631",
        trainName: "DDN ASR EXPRESS",
        fromStnCode: "LDH",
        toStnCode: "BEAS",
        availabilityCache: {
          "2S": { availability: "RLWL9/WL1", availabilityDisplayName: "WL 1", fare: "225", cacheTime: OLD, quota: "GN", predictionPercentage: 85 },
        },
      },
    ],
  },
};

/** RailYatri live (refresh=true) — IRCTC board jaisa: 2S AVAILABLE 25. */
function railyatriMock() {
  return (async (url: string | URL) => {
    const u = String(url);
    if (!u.includes("refresh=true")) return new Response(JSON.stringify({ success: false }), { status: 200 });
    if (u.includes("/14631/") && u.includes("/2S/")) {
      const dm = u.match(/availability\/\d+\/(\d{4}-\d{2}-\d{2})\//);
      const ymd = (dm?.[1] ?? new Date().toISOString().slice(0, 10)).split("-");
      const key = `${Number(ymd[2])}-${Number(ymd[1])}-${ymd[0]}`;
      return new Response(
        JSON.stringify({
          success: true,
          data_from: "IRCTC",
          seat_availibility: [{ availablity_date: key, availablity_status: "CURR_AVBL-0025", ticket_fare: 225, last_updated_at: new Date().toISOString() }],
        }),
        { status: 200 },
      );
    }
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

describe("Round-50 · second opinion (ConfirmTkt purani cache par atka ho to)", () => {
  it("CT ki 17h purani WL row par RY (IRCTC) AVAILABLE deta hai → AVAILABLE hi dikhta hai", async () => {
    const app = createApp();
    const res = await request(app).get(`/api/availability?from=LDH&to=BEAS&date=${DATE}&trains=14631`);
    expect(res.status).toBe(200);
    const t = res.body.trains.find((x: { trainNumber: string }) => x.trainNumber === "14631");
    const two = t.classes.find((c: { code: string }) => c.code === "2S");
    expect(two).toMatchObject({ status: "AVAILABLE", seats: 25, source: "web_railyatri" });
    expect(two.stale).toBeUndefined();
    expect(two.fare).toBe(225);
  });

  it("fresh + seat wali CT row par koi extra live call nahi (kuch bhi badla nahi jaata)", async () => {
    let calls = 0;
    setScrapeFetch((async (u: unknown) => {
      calls += 1;
      return (railyatriMock() as unknown as (x: unknown) => Promise<Response>)(u);
    }) as unknown as typeof fetch);
    _setConfirmTktFetchForTests((async () =>
      new Response(
        JSON.stringify({
          data: {
            trainList: [
              {
                trainNumber: "14631",
                trainName: "DDN ASR EXPRESS",
                availabilityCache: { "2S": { availability: "AVAILABLE-0025", availabilityDisplayName: "AVL 25", fare: "225", cacheTime: new Date().toISOString(), quota: "GN" } },
              },
            ],
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch);
    _clearConfirmTktCache();
    _clearLiveRowCache();
    const app = createApp();
    const res = await request(app).get(`/api/availability?from=LDH&to=BEAS&date=${DATE}&trains=14631`);
    const t = res.body.trains.find((x: { trainNumber: string }) => x.trainNumber === "14631");
    const two = t.classes.find((c: { code: string }) => c.code === "2S");
    expect(two).toMatchObject({ status: "AVAILABLE", seats: 25, source: "web_confirmtkt" });
    expect(calls).toBe(0);
  });

  it("future-dated CT timestamp IST maan kar sudhar jata hai (5:30h aage ka 'fresh' jhooth band)", () => {
    const istLabelled = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace("Z", "");
    const fixed = ctCacheTimeMs(istLabelled);
    expect(Math.abs(fixed - Date.now())).toBeLessThan(60_000);
    /* normal (UTC) timestamp waise hi */
    expect(ctCacheTimeMs(OLD)).toBe(Date.parse(OLD));
    /* board row par: stale flag nahi (17h purani row par lagta hai) */
    const rows = parseConfirmTktBoard(
      { data: { trainList: [{ trainNumber: "14631", trainName: "DDN ASR EXPRESS", availabilityCache: { "2S": { availability: "AVAILABLE-0012", fare: "225", cacheTime: istLabelled } } }] } },
      "LDH",
      "BEAS",
      DATE,
    );
    expect(rows[0].classes[0].stale).toBeUndefined();
    expect(Date.parse(rows[0].classes[0].updatedAt!)).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
