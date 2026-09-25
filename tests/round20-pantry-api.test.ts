/* Round-20 (25 Sep, user: "jis train mein catering hai usmein catering rakho").
 *
 * Passenger form me food choice sirf tab dikhta hai jab train me pantry/catering ho. Us data ke liye
 * ek naya READ-ONLY endpoint juda: GET /api/trains/:number/pantry — andar wahi maujooda function
 * (scrapeTrainFactsWeb) chalta hai jo AI ka TRAIN_FACTS tool pehle se use karta hai. Koi naya source
 * nahi, koi guess nahi: provider se jo aata hai wahi jaata hai (na aaye to null + note).
 */
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import * as webscrape from "../server/railway/webscrape";

const app = createApp();

describe("Round-20 · /api/trains/:number/pantry", () => {
  it("pantry data provider se aata hai (aisa hi jaisa scrapeTrainFactsWeb deta hai)", async () => {
    const spy = vi.spyOn(webscrape, "scrapeTrainFactsWeb").mockResolvedValue({
      trainNumber: "12926",
      trainName: "PASCHIM EXPRESS",
      pantry: true,
      providers: ["erail"],
    } as unknown as Awaited<ReturnType<typeof webscrape.scrapeTrainFactsWeb>>);

    const res = await request(app).get("/api/trains/12926/pantry");
    expect(res.status).toBe(200);
    expect(res.body.trainNumber).toBe("12926");
    expect(res.body.pantry).toBe(true);
    expect(res.body.providers).toContain("erail");
    spy.mockRestore();
  });

  it("data na aaye to null + honest note (jhooth nahi)", async () => {
    const spy = vi.spyOn(webscrape, "scrapeTrainFactsWeb").mockResolvedValue(null as unknown as Awaited<ReturnType<typeof webscrape.scrapeTrainFactsWeb>>);
    const res = await request(app).get("/api/trains/12014/pantry");
    expect(res.status).toBe(200);
    expect(res.body.pantry).toBeNull();
    expect(String(res.body.note)).toMatch(/nahi aayi/i);
    spy.mockRestore();
  });

  it("train number na ho to 400", async () => {
    const res = await request(app).get("/api/trains/ab/pantry");
    expect(res.status).toBe(400);
  });
});
