/* Round-18m-30z (user: "12461 mein khaana milta hai? → Wikipedia ka galat page; aur web sources add karo"):
 * (1) per-train facts (pantry/catering/classes/type) erail + confirmtkt se, GET_TRAIN_INFO mein merged;
 * (2) train-type + facility sawaal ("vande bharat mein khaana") picker nahi kholta; (3) general web search
 * trusted railway sites (IRCTC/indianrail.gov.in/indiarailinfo/erail/railyatri/confirmtkt/ixigo/…) pehle. */
import { afterEach, describe, expect, it } from "vitest";
import { scrapeTrainFactsWeb, setScrapeFetch } from "../server/railway/webscrape";
import { rankTrusted, trustedSiteOf } from "../server/agent/websearch";
import { railKbAnswer } from "../server/agent/railkb";

describe("Round-18m-30z: train facts from verified sites", () => {
  afterEach(() => setScrapeFetch(null));
  it("erail sentence + confirmtkt JSON → pantry false, classes CC/EC, type", async () => {
    setScrapeFetch(async (input) => {
      const u = String(input);
      if (u.includes("erail.in/train-enquiry/12461")) return new Response("<html><body><p>12461 VANDE BHARAT EXP Train Route Abount Train 12461 VANDE BHARAT EXP 12461 VANDE BHARAT EXP, Jodhpur Jn to Sabarmati Bg  runs Except Tue, has classes CC GN EC. Pantry is not available. Fare does not include food. 12461 VANDE BHARAT EXP category type is Intercity Express. It is a Broad Gauge train.</p></body></html>", { status: 200 });
      if (u.includes("confirmtkt.com/train-schedule/12461")) return new Response(`<script>var data = '{"TrainNo":"12461","TrainName":"VANDE BHARAT EXP","TrainType":"MAIL_EXPRESS","Rating":4.2,"FoodRating":3.7,"HasPantry":false}';</script>`, { status: 200 });
      return new Response("", { status: 404 });
    });
    const f = await scrapeTrainFactsWeb("12461");
    expect(f?.pantry).toBe(false);
    expect(f?.classes).toEqual(["CC", "EC"]);
    expect(f?.trainName).toBe("VANDE BHARAT EXP");
    expect(f?.trainType).toBe("Intercity Express");
    expect(f?.foodRating).toBe(3.7);
    expect(f?.providers).toEqual(["web_erail", "web_confirmtkt"]);
  });
  it("sources conflict → both stated, no 'retry'", async () => {
    setScrapeFetch(async (input) => {
      const u = String(input);
      if (u.includes("erail")) return new Response("<p>12716 SACHKHAND EXP, Amritsar Jn to H Sahib Nanded runs Daily, has classes 1A 2A 3A SL. Pantry is available. x</p>", { status: 200 });
      if (u.includes("confirmtkt")) return new Response(`'{"HasPantry":false,"TrainType":"SUPERFAST"}'`, { status: 200 });
      return new Response("", { status: 404 });
    });
    const f = await scrapeTrainFactsWeb("12716");
    expect(f?.pantry).toBe(true);
    expect(f?.sentence).toMatch(/sources differ/i);
    expect(f?.sentence).toMatch(/Do NOT ask the user to retry/);
  });
});

describe("Round-18m-30z: trusted railway web sources", () => {
  it("official/enthusiast sites ranked before random pages, labelled", () => {
    const r = rankTrusted([
      { title: "Some blog", url: "https://random-blog.example/x", snippet: "" },
      { title: "Train 12461", url: "https://indiarailinfo.com/train/12461", snippet: "" },
      { title: "eCatering", url: "https://www.ecatering.irctc.co.in/", snippet: "" },
    ]);
    expect(r[0].url).toContain("ecatering.irctc.co.in");
    expect(r[0].title).toMatch(/^\[IRCTC eCatering\]/);
    expect(r[1].url).toContain("indiarailinfo.com");
    expect(trustedSiteOf("https://enquiry.indianrail.gov.in/mntes")?.label).toBe("NTES");
    expect(trustedSiteOf("https://example.com")).toBeNull();
  });
  it("KB answers 'vande bharat mein khaana milta hai' directly (no picker)", () => {
    const a = railKbAnswer("Kya vande bharat mein khaana milta hai?");
    expect(a).toMatch(/catering/i);
    expect(a).toMatch(/eCatering/);
  });
});
