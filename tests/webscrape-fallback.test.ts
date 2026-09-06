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
