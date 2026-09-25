/* Round-21b (25 Sep 2026) — user (screenshot: RailBook form me "Food choice" dikh raha tha, IRCTC ke
 * booking page par nahi):
 *
 *   "es train mein food choice hai hi nahi to fir kyu dikha rha? kuch bhi fake mat rakho — jo real
 *    provider se aaye wahi dikhao, aur wo map bhi ho RailBook se IRCTC pe."
 *
 * Server ab merged `pantry` ke saath per-source sach bhejta hai (erail vs confirmtkt), conflict
 * batata hai, aur `foodChoiceExpected` sirf tab true hota hai jab data saaf ho — warna UI honest
 * line dikhata hai (guess nahi). Ye test usi gate ko lock karta hai. AI/server logic ko chhua nahi.
 */
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import * as webscrape from "../server/railway/webscrape";

const app = createApp();

function mockFacts(over: Record<string, unknown>) {
  return {
    trainNumber: "12716",
    trainName: "SACHKHAND EXP",
    trainType: null,
    pantry: null,
    pantrySources: { erail: null, confirmtkt: null },
    classes: [],
    providers: [],
    sourceUrls: [],
    ...over,
  } as unknown as Awaited<ReturnType<typeof webscrape.scrapeTrainFactsWeb>>;
}

describe("Round-21b · pantry sources + food-choice gate", () => {
  it("12716 case: erail haan + confirmtkt na → food choice NAHI, honest note ke saath", async () => {
    const spy = vi.spyOn(webscrape, "scrapeTrainFactsWeb").mockResolvedValue(
      mockFacts({ pantry: true, pantrySources: { erail: true, confirmtkt: false }, providers: ["web_erail", "web_confirmtkt"] }),
    );
    const res = await request(app).get("/api/trains/12716/pantry");
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual({ erail: true, confirmtkt: false });
    expect(res.body.conflict).toBe(true);
    expect(res.body.foodChoiceExpected).toBe(false);
    expect(String(res.body.note)).toMatch(/sources alag-alag/i);
    expect(res.body.evidence.join(" ")).toMatch(/erail \(IR timetable\): pantry available/i);
    expect(res.body.evidence.join(" ")).toMatch(/confirmtkt:\s*HasPantry false/i);
    spy.mockRestore();
  });

  it("dono sources haan → food choice dikhta hai (koi conflict nahi)", async () => {
    const spy = vi.spyOn(webscrape, "scrapeTrainFactsWeb").mockResolvedValue(
      mockFacts({ pantry: true, pantrySources: { erail: true, confirmtkt: true } }),
    );
    const res = await request(app).get("/api/trains/12716/pantry");
    expect(res.body.conflict).toBe(false);
    expect(res.body.foodChoiceExpected).toBe(true);
    expect(res.body.note).toBeNull();
    spy.mockRestore();
  });

  it("Shatabdi/Rajdhani (catering fare me included): sources alag hon tab bhi food choice", async () => {
    const spy = vi.spyOn(webscrape, "scrapeTrainFactsWeb").mockResolvedValue(
      mockFacts({ trainNumber: "12014", trainName: "AMRITSAR SHATABDI", trainType: "Shatabdi", pantrySources: { erail: false, confirmtkt: true } }),
    );
    const res = await request(app).get("/api/trains/12014/pantry");
    expect(res.body.premiumCatering).toBe(true);
    expect(res.body.foodChoiceExpected).toBe(true);
    expect(res.body.evidence.join(" ")).toMatch(/fare me included/i);
    spy.mockRestore();
  });

  it("Jan Shatabdi ko premium nahi maana jaata (shatabdi substring ka jhooth nahi)", async () => {
    const spy = vi.spyOn(webscrape, "scrapeTrainFactsWeb").mockResolvedValue(
      mockFacts({ trainNumber: "12055", trainName: "JAN SHATABDI EXP", trainType: "Jan Shatabdi", pantrySources: { erail: false, confirmtkt: false } }),
    );
    const res = await request(app).get("/api/trains/12055/pantry");
    expect(res.body.premiumCatering).toBe(false);
    expect(res.body.foodChoiceExpected).toBe(false);
    spy.mockRestore();
  });

  it("dono sources na → field nahi, aur line me dono sources ka jawaab", async () => {
    const spy = vi.spyOn(webscrape, "scrapeTrainFactsWeb").mockResolvedValue(
      mockFacts({ trainNumber: "14631", trainName: "DDN ASR EXP", pantry: false, pantrySources: { erail: false, confirmtkt: false } }),
    );
    const res = await request(app).get("/api/trains/14631/pantry");
    expect(res.body.foodChoiceExpected).toBe(false);
    expect(res.body.conflict).toBe(false);
    expect(String(res.body.note)).toMatch(/pantry\/catering nahi mili/i);
    spy.mockRestore();
  });

  it("purana caller-safe: merged pantry aur providers waise hi aate hain", async () => {
    const spy = vi.spyOn(webscrape, "scrapeTrainFactsWeb").mockResolvedValue(
      mockFacts({ pantry: true, pantrySources: { erail: true, confirmtkt: false }, providers: ["web_erail"] }),
    );
    const res = await request(app).get("/api/trains/12716/pantry");
    expect(res.body.pantry).toBe(true);
    expect(res.body.providers).toContain("web_erail");
    spy.mockRestore();
  });
});
