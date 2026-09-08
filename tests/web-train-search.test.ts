/* Round-16n: RailCore daily limit + RailKit down → train search falls back to
 * erail.in trains-between list (web), with exact boarding codes and running
 * day filter. Before this, the search returned [] ("No trains") even though
 * a web-scrape layer existed for other lookups. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRailcoreFetch } from "../server/railway/railcore";
import { clearScheduleCache, searchTrainsRouted } from "../server/railway/router";
import { setProvider } from "../server/providers/index";
import { parseErailTrainList, setScrapeFetch } from "../server/railway/webscrape";

const ERAIL =
  "~LDH~Ludhiana Jn~DLI~Delhi~~2026-8-6-12-24-5~~~^" +
  "12414~GALTADHAM POOJA~Jammu Tawi~JAT~Ajmer Jn~AII~Ludhiana Jn~LDH~Delhi~DLI~22.55~03.50~04.55~1111111~~~~~~~~111001011000000~10~25~1~5~18.15~12.15~8~1111111~22.45~04.15~SUPERFAST~1985~2~0~DATASOURCE_IR~2026-08-06~2031-08-07~311~63~x~0~0~~60~1~2414~~~Super Fast~~1~NR~~BG~~~100000000100~,,En:SLRD~0~1~1A:::::::::::|2A:::::::::::|3A:::::::::::|SL:::::::::::|~~~~~~~1~3~GALTADHAM POOJA~2414~~~~1~^" +
  "22488~VANDE BHARAT EXP~Amritsar Jn~ASR~Delhi~DLI~Ludhiana Jn~LDH~Delhi~DLI~10.18~13.50~03.32~1111011~~~~~~~~000100001010000~10~0~0~9~07.00~16.55~17~1111011~10.16~Last~SHATABDI~16639~1~0~DATASOURCE_IR~2026-08-06~2031-08-06~311~61~x~0~0~~30~1~~~~VB~~1~NR~~BG~~~1~,,En~0~1~CC:::::::::::|EC:::::::::::|~~~~~~~1~^" +
  "12014~AMRITSAR SHTABDI~Amritsar Jn~ASR~New Delhi~NDLS~Ludhiana Jn~LDH~New Delhi~NDLS~07.02~11.02~04.00~1111111~~~~~~~~000100000010000~10~0~1~4~04.00~13.25~22~1111111~06.57~Last~SHATABDI~1458~1~0~DATASOURCE_IR~2026-08-06~2031-08-06~376~46~x~0~0~~30~1~~~~S~~1~NR~~BG~~~1~,,En~0~1~CC:::::::::::|EC:::::::::::|~~~~~~~1~^" +
  "13152~KOLKATA EXPRESS~Jammu Tawi~JAT~Kolkata~KOAA~Ludhiana Jn~LDH~Kolkata~KOAA~01.55~15.40~37.45~1111111~~~~~~~~1~10~0~1~4~04.00~13.25~22~1111111~01.45~Last~MAIL_EXPRESS~1~1~0~DATASOURCE_IR~2026-08-06~2031-08-06~1~1~x~0~0~~30~1~~~~S~~1~NR~~BG~~~1~,,En~0~1~2A:::::::::::|3A:::::::::::|SL:::::::::::|~~~~~~~1~^";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test_secret";
  process.env.RAILKIT_API_KEY = "";
  setProvider(null);
  clearScheduleCache();
});
afterEach(() => {
  setRailcoreFetch(null);
  setScrapeFetch(null);
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  setProvider(null);
});

describe("Round-16n: erail trains-between parser", () => {
  it("parses number/name/codes/times/duration/days/classes", () => {
    const rows = parseErailTrainList(ERAIL);
    expect(rows.map((r) => r.number)).toEqual(["12414", "22488", "12014", "13152"]);
    const vb = rows[1];
    expect(vb).toMatchObject({ fromCode: "LDH", toCode: "DLI", departure: "10:18", arrival: "13:50", durationMinutes: 212, classes: ["CC", "EC"] });
    // mask 1111011 = Mon..Sun, Friday off → JS days without 5 (matches RailCore: MON,TUE,WED,THU,SAT,SUN)
    expect([...vb.runsOn].sort()).toEqual([0, 1, 2, 3, 4, 6]);
    expect(rows[3].durationMinutes).toBe(37 * 60 + 45);
  });
});

describe("Round-16n: RailCore daily limit → web (erail) train search fallback", () => {
  it("returns exact-code trains for the date, running-day filtered, with +1d and source label", async () => {
    setRailcoreFetch(async () =>
      jsonResponse(429, { success: false, error: { code: "RATE_LIMITED", message: "Daily rate limit exceeded" } }, {
        "x-railcore-ratelimit-day-remaining": "0",
        "x-railcore-ratelimit-day-reset": String(Math.floor(Date.now() / 1000) + 3600),
      }),
    );
    setScrapeFetch(async (input) => {
      const url = String(input);
      if (url.includes("erail.in/rail/getTrains.aspx") && url.includes("Station_From=LDH") && url.includes("Station_To=DLI")) {
        return new Response(ERAIL, { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      return new Response("", { status: 404 });
    });
    // 2026-09-12 is a Saturday → 22488 (no Fri) runs; 12014 goes to NDLS (excluded); 13152 goes to KOAA (excluded)
    const sat = await searchTrainsRouted({ from: "LDH", to: "DLI", date: "2026-09-12" });
    expect(sat.provider).toBe("web_erail");
    expect(sat.trains.map((t) => t.number)).toEqual(["22488", "12414"]);
    const gp = sat.trains.find((t) => t.number === "12414")!;
    expect(gp.arrivalDayOffset).toBe(1);
    expect(gp.durationLabel).toBe("4h 55m");
    expect(gp.classes.map((c) => c.code)).toEqual(["1A", "2A", "3A", "SL"]);
    // 2026-09-11 is a Friday → 22488 does not run
    const fri = await searchTrainsRouted({ from: "LDH", to: "DLI", date: "2026-09-11" });
    expect(fri.trains.map((t) => t.number)).toEqual(["12414"]);
  });

  it("web also down → [] with provider none (honest unavailable, never invented)", async () => {
    setRailcoreFetch(async () => jsonResponse(429, { success: false, error: { message: "Too many requests" } }, { "retry-after": "1" }));
    setScrapeFetch(async () => new Response("", { status: 503 }));
    const res = await searchTrainsRouted({ from: "LDH", to: "DLI", date: "2026-09-12" });
    expect(res.trains).toEqual([]);
    expect(res.provider).toBe("none");
  });
});
