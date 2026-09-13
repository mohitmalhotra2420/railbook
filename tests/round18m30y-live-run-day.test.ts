/* Round-18m-30y (user: "14632 ka live status yesterday ka — app 'abhi start nahi hui' bol raha, railyatri par sahi"):
 * RailYatri SSR page hamesha AAJ ki run deta hai. Date di ho to RailYatri LTS API (train_eta_data/{n}/{daysBack})
 * se USI run-day ka data; purani run ka data na mile to aaj wali run kabhi nahi lautani. */
import { afterEach, describe, expect, it } from "vitest";
import { ryDaysBack, scrapeLiveStatusWeb, setScrapeFetch } from "../server/railway/webscrape";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

describe("Round-18m-30y: live status honours the run day", () => {
  afterEach(() => setScrapeFetch(null));
  it("ryDaysBack: today → 0, yesterday → 1, future/old → null", () => {
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    expect(ryDaysBack(ymd(ist))).toBe(0);
    expect(ryDaysBack(ymd(new Date(ist.getTime() - 86400000)))).toBe(1);
    expect(ryDaysBack(ymd(new Date(ist.getTime() + 86400000)))).toBeNull();
    expect(ryDaysBack("2020-01-01")).toBeNull();
  });
  it("yesterday's run comes from the LTS API with daysBack=1 (not today's SSR 'not started')", async () => {
    const urls: string[] = [];
    setScrapeFetch(async (input) => {
      const u = String(input); urls.push(u);
      if (u.includes("/train_eta_data/14632/1.json")) return json({ success: true, train_number: "14632", train_name: "Amritsar - Dehradun Express", train_start_date: "2026-09-13", status: "T", current_station_name: "KHAMANON~", current_station_code: "KMNN", delay: 7, update_time: "2026-09-14 01:25:00 +0530", upcoming_stations: [{ station_code: "NMDA", station_name: "NEW MORINDA", eta: "01:31" }] });
      return new Response("<html></html>", { status: 200 });
    });
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000); const yest = new Date(ist.getTime() - 86400000).toISOString().slice(0, 10);
    const r = await scrapeLiveStatusWeb("14632", null, yest);
    expect(r?.currentStation).toBe("KHAMANON");
    expect(r?.delayMinutes).toBe(7);
    expect(r?.journeyDate).toBe("2026-09-13");
    expect(urls.some((u) => u.includes("/train_eta_data/14632/1.json"))).toBe(true);
  });
  it("old run requested but API has nothing → null (never today's run)", async () => {
    setScrapeFetch(async (input) => String(input).includes("train_eta_data") ? json({ success: false }) : new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { ltsData: { success: true, train_number: "14632", train_name: "X", title: "Train starts at 21:35", new_message: "Train hasn't started yet.", train_start_date: "2026-09-14", at_src: true } } } })}</script>`, { status: 200 }));
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000); const yest = new Date(ist.getTime() - 86400000).toISOString().slice(0, 10);
    expect(await scrapeLiveStatusWeb("14632", null, yest)).toBeNull();
  });
});
