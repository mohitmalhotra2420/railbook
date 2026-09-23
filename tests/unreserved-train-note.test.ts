/**
 * 23 Sep 2026 — MEMU/unreserved trains (64551 LDH-CIA MEMU) ka honest label.
 *
 * User feedback: 64551 jaisi rows hamesha "Seat data provider se nahi aayi ·
 * check karo" par atki rehti thin — kyunki unreserved train ka reserved seat
 * data kahin hota hi nahi. Ab erail train-enquiry title se naam/type nikaal kar
 * honest note milta hai (guess nahi), aur ye note ek hi route-level call me
 * client ko chala jata hai (trains= param).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { _clearConfirmTktCache, _setConfirmTktFetchForTests } from "../server/railway/confirmtkt";
import { _clearTrainTypeCache, parseErailTrainEnquiryTitle, setScrapeFetch } from "../server/railway/webscrape";
import { setProvider } from "../server/providers/index";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setRailkitSdk } from "../server/railway/railkit";

const ERAl_MEMU_HTML = `<!DOCTYPE html><html><head><title>\n\t64551 LDH-CIA MEMU Train Route\n</title></head><body>route…</body></html>`;
const ERAIL_UNKNOWN_HTML = `<!DOCTYPE html><html><head><title>\n\tTrain Enquiry Indian Railways\n</title></head><body></body></html>`;

const CT_BOARD = {
  data: {
    trainList: [
      {
        trainNumber: "14653",
        trainName: "HSR ASR EXPRESS",
        fromStnCode: "LDH",
        toStnCode: "BEAS",
        availabilityCache: {
          SL: { availability: "AVAILABLE-0009", availabilityDisplayName: "AVL 9", fare: "150", cacheTime: new Date().toISOString(), quota: "GN" },
        },
      },
    ],
  },
};

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILKIT_API_KEY = "";
  _clearConfirmTktCache();
  _clearTrainTypeCache();
  setProvider(null);
  /* Providers block — sirf web board/type path test karna hai. */
  setRailcoreFetch((async () => new Response("blocked", { status: 500 })) as unknown as typeof fetch);
  setRailkitSdk(null);
  _setConfirmTktFetchForTests((async () => new Response(JSON.stringify(CT_BOARD), { status: 200 })) as unknown as typeof fetch);
  /* erail: train-enquiry 64551 → MEMU title; baaki sab block. */
  setScrapeFetch((async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/train-enquiry/64551")) return new Response(ERAl_MEMU_HTML, { status: 200 });
    if (u.includes("/train-enquiry/18327")) return new Response(ERAIL_UNKNOWN_HTML, { status: 200 });
    return new Response("blocked", { status: 500 });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  setScrapeFetch(null);
  setRailcoreFetch(null);
  setRailkitSdk(null);
  _setConfirmTktFetchForTests(null);
  setProvider(null);
});

describe("erail train-enquiry title parser", () => {
  it("MEMU title → naam + unreserved flag", () => {
    const t = parseErailTrainEnquiryTitle(ERAl_MEMU_HTML, "64551");
    expect(t?.trainName).toBe("LDH-CIA MEMU");
    expect(t?.unreserved).toBe(true);
    expect(t?.kind).toBe("MEMU");
  });
  it("generic title → null (koi guess nahi)", () => {
    expect(parseErailTrainEnquiryTitle(ERAIL_UNKNOWN_HTML, "18327")).toBeNull();
  });
  it("galat number → null", () => {
    expect(parseErailTrainEnquiryTitle(ERAl_MEMU_HTML, "14653")).toBeNull();
  });
  it("reserved train (Express) title → unreserved false", () => {
    const html = `<head><title>\n\t14653 HSR ASR EXPRESS Train Route\n</title></head>`;
    const t = parseErailTrainEnquiryTitle(html, "14653");
    expect(t?.unreserved).toBe(false);
    expect(t?.kind).toBeNull();
  });
});

describe("unreserved train honest note (API)", () => {
  it("route-level: trains=64551 → empty classes + note (ek hi call me)", async () => {
    const app = createApp();
    const res = await request(app).get("/api/availability?from=LDH&to=BEAS&date=2026-09-24&trains=64551,18327");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("web_confirmtkt");
    const memu = res.body.trains.find((t: { trainNumber: string }) => t.trainNumber === "64551");
    expect(memu.classes).toEqual([]);
    expect(String(memu.note)).toContain("unreserved MEMU");
    /* 18327 ka koi type nahi mila → invent nahi, list me add bhi nahi. */
    expect(res.body.trains.find((t: { trainNumber: string }) => t.trainNumber === "18327")).toBeUndefined();
  });

  it("per-train 64551 → 200 + note (kabhi 500 nahi, atki row nahi)", async () => {
    const app = createApp();
    const res = await request(app).get("/api/availability?trainNumber=64551&date=2026-09-24&from=LDH&to=BEAS&quota=GN");
    expect(res.status).toBe(200);
    expect(res.body.classes).toEqual([]);
    expect(String(res.body.note)).toContain("LDH-CIA MEMU");
  });

  it("reserved train (14653) → note nahi, live seat data hi (CT board)", async () => {
    const app = createApp();
    const res = await request(app).get("/api/availability?from=LDH&to=BEAS&date=2026-09-24&trains=14653");
    expect(res.status).toBe(200);
    const t = res.body.trains.find((x: { trainNumber: string }) => x.trainNumber === "14653");
    expect(t.classes[0]).toMatchObject({ code: "SL", status: "AVAILABLE", seats: 9 });
    expect(t.note).toBeUndefined();
  });
});
