/* Round-18m-23 (user LDH→BSB screenshot 23:54 IST): (1) "Fare reference: 2A ₹3000, SL ₹815" = 13152 ka
 * JAT→Kolkata POORA route fare, segment ka nahi — effectively fake. erail ?from&to segment fare deta hai
 * (LDH→BSB 2A 1960 / SL 530). (2) IRCTC maintenance window mein railyatri refresh=true fail → cached
 * endpoint se asli data (cache_text ke saath). (3) Saari classes UNKNOWN → agent ko FAIL, koi "reference". */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { erailPageIsForSegment, parseErailFare, scrapeSeatAvailabilityWeb, scrapeTrainFareWeb, setScrapeFetch } from "../server/railway/webscrape.js";

const ROUTE_HTML = `<html><head><title>13152 KOLKATA EXPRESS Jammu Tawi to Kolkata Fare</title></head><body>
<select name='from'><option value='JAT' selected='selected'>Jammu Tawi</option><option value='LDH'>Ludhiana Jn</option></select>
<select name='to'><option value='BSB'>Varanasi Jn</option><option value='KOAA' selected='selected'>Kolkata</option></select>
<table><tr><th></th><th>2A</th><th>3A</th><th>SL</th></tr><tr><td>General</td><td>3,000</td><td>2,090</td><td>815</td></tr></table>Total fare for 1 Adult</body></html>`;
const SEG_HTML = ROUTE_HTML.replace("value='JAT' selected='selected'", "value='JAT'").replace("value='LDH'>", "value='LDH' selected='selected'>").replace("value='BSB'>", "value='BSB' selected='selected'>").replace("value='KOAA' selected='selected'", "value='KOAA'").replace("3,000", "1,960").replace("2,090", "1,380").replace("815", "530");

describe("Round-18m-23: segment-verified fare only; no invented 'reference fare'", () => {
  it("erailPageIsForSegment reads the selected from/to", () => {
    expect(erailPageIsForSegment(SEG_HTML, "LDH", "BSB")).toBe(true);
    expect(erailPageIsForSegment(ROUTE_HTML, "LDH", "BSB")).toBe(false);
    expect(parseErailFare(SEG_HTML, "13152", "x")?.classes.find((c) => c.code === "SL")?.general).toBe(530);
  });
  it("scrapeTrainFareWeb(train, from, to) hits ?from&to and returns segment fare; falls to null when erail ignores the segment", async () => {
    const urls: string[] = [];
    setScrapeFetch(async (u: unknown) => { urls.push(String(u)); return new Response(String(u).includes("from=LDH&to=BSB") ? SEG_HTML : ROUTE_HTML, { status: 200, headers: { "Content-Type": "text/html" } }); });
    try {
      const seg = await scrapeTrainFareWeb("13152", "LDH", "BSB");
      expect(urls[0]).toBe("https://erail.in/train-fare/13152?from=LDH&to=BSB");
      expect(seg?.from).toBe("LDH");
      expect(seg?.classes.find((c) => c.code === "2A")?.general).toBe(1960);
      // erail did not honour the segment (default route page) → null, never the route fare
      const bad = await scrapeTrainFareWeb("13152", "XYZ", "BSB");
      expect(bad).toBeNull();
      // no segment → whole-route fare, explicitly unmarked
      const route = await scrapeTrainFareWeb("13152");
      expect(route?.from).toBeUndefined();
      expect(route?.classes.find((c) => c.code === "2A")?.general).toBe(3000);
    } finally { setScrapeFetch(null); }
  });
  it("railyatri: refresh=true maintenance failure → cached endpoint (real IRCTC data, cache_text kept)", async () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} 23:12:11 +0530`;
    const d = new Date(Date.now() + 2 * 86400000);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const key = `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
    const calls: string[] = [];
    setScrapeFetch(async (u: unknown) => {
      calls.push(String(u));
      if (String(u).includes("refresh=true")) return new Response(JSON.stringify({ success: false, error: "Currently services are not available due to daily maintenance downtime. Services will resume at 00:20 hrs.", seat_availibility: [] }), { status: 200 });
      return new Response(JSON.stringify({ success: true, data_from: "CACHED", seat_availibility: [{ availablity_date: key, availablity_status: "RLWL58/WL45", ticket_fare: 530, last_updated_at: stamp, cache_text: "As of 1 hour ago" }] }), { status: 200 });
    });
    try {
      const sa = await scrapeSeatAvailabilityWeb("13152", ymd, "LDH", "BSB", "SL", "GN");
      expect(calls.length).toBe(2);
      expect(calls[1]).not.toContain("refresh=true");
      expect(sa?.status).toBe("WAITLIST");
      expect(sa?.waitlist).toBe(45);
      expect(sa?.ticketFare).toBe(530);
      expect(sa?.cacheText).toBe("As of 1 hour ago");
    } finally { setScrapeFetch(null); }
  });
  it("router passes from/to to erail fare helpers; agent never emits a 'reference fare' when every class is UNKNOWN", () => {
    const router = readFileSync("server/railway/router.ts", "utf8");
    expect(router).toContain("scrapeTrainFareWeb(trainNumber, from, to)");
    expect(router).not.toMatch(/erailFareForClass\(trainNumber, classCode, quotaCode\)/);
    expect(router).not.toMatch(/erailFareBreakdown\(trainNumber, date, classCode, passengerCount\)/);
    const ag = readFileSync("server/agent/agentic.ts", "utf8");
    expect(ag).toContain('if (board.classes.every((c) => c.status === "UNKNOWN")) {');
    expect(ag).toContain("ye seat status NAHI hai");
    expect(ag).not.toContain("poore route ka fare, railway API down tha");
  });
});
