/* ── WEB-SCRAPE FALLBACK tests (user request 2026-09-06: "pehle API, fail par
 * verified site se scraping — har informational cheez ke liye").
 * Mocked scrape-fetch (setScrapeFetch) — koi live network nahi. */
import { describe, it, expect, beforeEach } from "vitest";
import { setScrapeFetch, scrapeCoachPositionWeb, webSourceLabel, type ScrapedCoachPosition } from "../server/railway/webscrape";
import { routedCoachPosition, routedTrainInfo } from "../server/railway/router";
import { runAgent } from "../server/agent/run";

/* trainspnrstatus coach-position page ka SSR snippet (live-verified
 * 2026-09-06: aria-label + text-lg + type span + Pos number). */
const COACH_HTML = `<!DOCTYPE html><html><body>
<h1>AMRITSAR SHTABDI</h1>
<div><span class="font-extrabold tracking-wider">ENGINE</span></div>
<button aria-label="Select coach LPR"><span class="text-lg">LPR</span><span class="text-[10px] uppercase font-semibold mt-0.5 tracking-wider text-slate-400">UNRESERVED</span></button><div>Pos <!-- -->1</div></button>
<button aria-label="Select coach E1"><span class="text-lg">E1</span><span class="text-[10px] uppercase font-semibold mt-0.5 tracking-wider text-slate-400">EC</span></button><div>Pos <!-- -->2</div></button>
<button aria-label="Select coach C2"><span class="text-lg">C2</span><span class="text-[10px] uppercase font-semibold mt-0.5 tracking-wider text-slate-400">CC</span></button><div>Pos <!-- -->3</div></button>
<button aria-label="Select coach C1"><span class="text-lg">C1</span><span class="text-[10px] uppercase font-semibold mt-0.5 tracking-wider text-slate-400">CC</span></button><div>Pos <!-- -->4</div></button>
</body></html>`;

const htmlResponse = (body: string) =>
  ({ ok: true, status: 200, text: async () => body, json: async () => ({}) }) as unknown as Response;

beforeEach(() => {
  setScrapeFetch(async (url: any) => {
    const u = String(url);
    if (u.includes("train-coach-position/12014")) return htmlResponse(COACH_HTML);
    return ({ ok: false, status: 404, text: async () => "", json: async () => ({}) }) as unknown as Response;
  });
});

describe("WEB-SCRAPE fallback (API-first policy, user 2026-09-06)", () => {
  it("scrapeCoachPositionWeb: trainspnrstatus SSR boxes parse (name/class/pos)", async () => {
    const cp: ScrapedCoachPosition | null = await scrapeCoachPositionWeb("12014");
    expect(cp).not.toBeNull();
    expect(cp!.provider).toBe("web_trainspnrstatus");
    expect(cp!.trainName).toMatch(/AMRITSAR SHTABDI/i);
    expect(cp!.coaches.map((c) => c.name)).toEqual(["LPR", "E1", "C2", "C1"]);
    expect(cp!.coaches[0]).toMatchObject({ name: "LPR", classCode: "UR", positionFromEngine: 1, sequence: 1 });
    expect(cp!.coaches[1]).toMatchObject({ name: "E1", classCode: "EC", positionFromEngine: 2 });
  });

  it("scrapeCoachPositionWeb: bad number / missing page → honest null", async () => {
    expect(await scrapeCoachPositionWeb("abc")).toBeNull();
    expect(await scrapeCoachPositionWeb("99999")).toBeNull();
  });

  it("routedCoachPosition: API nahi (no key) → web-scrape last-resort, labeled provider", async () => {
    /* setup.ts: RAILWAY_PROVIDER=mock, keys empty → railcore branch skip →
     * "no_railcore → web-scrape" — API-first, fail par verified site. */
    const r = await routedCoachPosition("12014");
    expect(r.provider).toBe("web_trainspnrstatus");
    expect(r.coachPosition).not.toBeNull();
    expect(r.coachPosition!.coaches.length).toBe(4);
    expect(r.coachPosition!.coaches[0].name).toBe("LPR");
  });

  it("routedTrainInfo: API fail → schedule-scrape se naam, web provider", async () => {
    /* train-schedule mock nahi diya (404) → railkit bhi nahi → scrape bhi 404
     * = honest null. (Live mein confirmtkt 200 deta hai — provider web_*.) */
    const r = await routedTrainInfo("99999");
    expect(r.info).toBeNull();
  });

  it("webSourceLabel: har web provider ka saaf source label, API providers par khali", () => {
    expect(webSourceLabel("web_confirmtkt")).toContain("confirmtkt.com");
    expect(webSourceLabel("web_trainspnrstatus")).toContain("trainspnrstatus.com");
    expect(webSourceLabel("web_ixigo")).toContain("ixigo.com");
    expect(webSourceLabel("railcore")).toBe("");
    expect(webSourceLabel("railkit")).toBe("");
  });

  it("runAgent: 'coach position batao' → labeled web reply (fake layout nahi)", async () => {
    const r = await runAgent({ text: "12014 ki coach position batao", now: "2026-09-06T12:00:00+05:30" });
    expect(String(r.reply)).toMatch(/18|coaches/i);
    expect(String(r.reply)).toMatch(/LPR.*C1/);
    expect(String(r.reply)).toContain("trainspnrstatus.com");
  });
});

/* ── LIVE-STATUS SCRAPE tests (user request 2026-09-06: booking-critical bhi
 * authorize — live/fare/availability). RailYatri SSR __NEXT_DATA__.ltsData —
 * mocked HTML, live network nahi. (fare/availability ke liye koi accessible
 * SSR source nahi — sirf live-status RailYatri se scrape hota hai.) */

import { parseRailYatriLive, scrapeLiveStatusWeb } from "../server/railway/webscrape";

const ltsPage = (lts: object) =>
  `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { ltsData: lts } },
  })}</script></body></html>`;

describe("RailYatri live-status scrape (booking-critical, user-authorized 2026-09-06)", () => {
  it("running train: delay + current station + upcoming next", () => {
    const html = ltsPage({
      success: true,
      train_number: "12054",
      train_name: "Jan Shatabdi Express",
      status: "T",
      delay: 0,
      current_station_code: "SRE",
      current_station_name: "SAHARANPUR~",
      ahead_distance_text: "4 kms ahead",
      update_time: "2026-09-06 12:06:00 +0530",
      train_start_date: "2026-09-06",
      upcoming_stations: [{ station_code: "RKSH", station_name: "ROORKEE~", eta: "12:50" }],
    });
    const r = parseRailYatriLive(html, "12054", "https://www.railyatri.in/live-train-status/12054-x");
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("web_railyatri");
    expect(r!.status).toMatch(/Running — near SAHARANPUR/);
    expect(r!.currentStation).toBe("SAHARANPUR");
    expect(r!.nextStation).toBe("ROORKEE (12:50)");
    expect(r!.delayMinutes).toBe(0);
  });

  it("completed journey: at_dstn → Journey completed", () => {
    const r = parseRailYatriLive(
      ltsPage({ success: true, train_number: "12014", train_name: "Amritsar Shatabdi", at_dstn: true, delay: 8, current_station_name: "NEW DELHI" }),
      "12014",
      "u",
    );
    expect(r!.status).toBe("Journey completed");
    expect(r!.delayMinutes).toBe(8);
  });

  it("not-started train: title/new_message (12951 'Train starts at 17:00')", () => {
    const r = parseRailYatriLive(
      ltsPage({
        success: true,
        train_number: "12951",
        train_name: "Mumbai Central - New Delhi Rajdhani Express",
        at_src: true,
        title: "Train starts at 17:00",
        new_message: "Train hasn't started yet. But all looks good.",
        next_station_name: "BORIVALI~",
      }),
      "12951",
      "u",
    );
    expect(r!.status).toMatch(/Train starts at 17:00/);
    expect(r!.nextStation).toBe("BORIVALI");
    expect(r!.delayMinutes).toBeNull();
  });

  it("success:false / empty payload → null (honest, koi fake nahi)", () => {
    expect(parseRailYatriLive(ltsPage({ success: false }), "1", "u")).toBeNull();
    expect(parseRailYatriLive("<html>no next data</html>", "1", "u")).toBeNull();
    expect(parseRailYatriLive(ltsPage({ success: true, train_number: "9", train_name: "X" }), "9", "u")).toBeNull();
  });

  it("scrapeLiveStatusWeb: naam ke bina null; naam ke saath URL mein slug", async () => {
    expect(await scrapeLiveStatusWeb("12054", null)).toBeNull();
    expect(await scrapeLiveStatusWeb("abc", "Some Train")).toBeNull();
    setScrapeFetch(async (url: any) => {
      if (String(url).includes("/live-train-status/12054-Jan-Shatabdi-Express")) {
        return htmlResponse(
          ltsPage({ success: true, train_number: "12054", status: "T", delay: 3, current_station_name: "UMB~" }),
        );
      }
      return ({ ok: false, status: 404, text: async () => "", json: async () => ({}) }) as unknown as Response;
    });
    const r = await scrapeLiveStatusWeb("12054", "Jan Shatabdi Express");
    expect(r!.trainNumber).toBe("12054");
    expect(r!.delayMinutes).toBe(3);
    expect(r!.provider).toBe("web_railyatri");
  });
});
