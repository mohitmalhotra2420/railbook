/* ══ ROUND-16o (2026-09-08) ══
 * (A) Prod screenshot: "India ki sabse longest route ki train?" / "Vivek
 *     express kahan se kahan chalti hai?" → "provider se nahi mil pa rahi".
 *     RailCore daily-limit → TRAIN_NAME_SEARCH fail → model ne WEB_SEARCH ke
 *     bina apni memory se likha → ungrounded → 0 ok steps. Ab: web rescue.
 * (B) Extra API providers (RailRadar, Indian Rail API) as ADDITIONAL
 *     fallbacks — RailCore → RailKit → RailRadar → IndianRailAPI → web-scrape.
 *     Keys optional; unset = skipped (existing behaviour unchanged). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setRailradarFetch, railradarSearchTrains, railradarAvailability, railradarLive } from "../server/railway/railradar";
import { setIndianRailApiFetch } from "../server/railway/indianrailapi";
import {
  clearScheduleCache,
  getFallbackProvider,
  routedCoachPosition,
  routedLiveStatus,
  routedSchedule,
  routedStationSearch,
  routedTrainNameSearch,
  searchTrainsRouted,
  resetFallbackProvider,
} from "../server/railway/router";
import { setProvider } from "../server/providers/index";
import { _setErailTrainsCacheForTests, parseErailTrainNameList, scrapeTrainNameSearchWeb, setScrapeFetch, webSourceLabel } from "../server/railway/webscrape";
import { executeApprovedTool, runAgenticTurn, setAgenticNvidiaFetch, webRescueEligible } from "../server/agent/agentic";
import { setWebFetch } from "../server/agent/websearch";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
const DAILY_LIMIT = () =>
  jsonResponse(429, { success: false, error: { code: "RATE_LIMITED", message: "Daily rate limit exceeded" } }, {
    "x-railcore-ratelimit-day-remaining": "0",
    "x-railcore-ratelimit-day-reset": String(Math.floor(Date.now() / 1000) + 3600),
  });

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test_secret";
  process.env.RAILKIT_API_KEY = "";
  process.env.RAILRADAR_API_KEY = "";
  process.env.INDIANRAILAPI_KEY = "";
  setProvider(null);
  resetFallbackProvider();
  clearScheduleCache();
  setScrapeFetch(async () => new Response("", { status: 404 }));
});
afterEach(() => {
  setRailcoreFetch(null);
  setRailradarFetch(null);
  setIndianRailApiFetch(null);
  setScrapeFetch(async () => new Response("", { status: 404 }));
  setWebFetch(null);
  _setErailTrainsCacheForTests(null);
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  process.env.RAILRADAR_API_KEY = "";
  process.env.INDIANRAILAPI_KEY = "";
  setProvider(null);
  resetFallbackProvider();
});

/* ── RailRadar mock (docs response shapes) ─────────────────────────────── */
function railradarMock(calls: string[] = []) {
  setRailradarFetch(async (input, init) => {
    const url = String(input);
    calls.push(url);
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    if (!auth.startsWith("Bearer rr_live_")) return jsonResponse(401, { success: false, error: { code: "UNAUTHORIZED", message: "API Key is required" } });
    const u = new URL(url);
    if (u.pathname.endsWith("/trains/between/LDH/DLI")) {
      return jsonResponse(200, {
        success: true,
        data: {
          from: { code: "LDH", name: "Ludhiana Junction" },
          to: { code: "DLI", name: "Old Delhi Junction" },
          count: 2,
          trains: [
            { train: { number: "12414", name: "GALTADHAM POOJA", type: "Superfast", runDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }, from: { departure: "22:55", day: 1 }, to: { arrival: "03:50", day: 2 }, distance: 311, duration: 295 },
            { train: { number: "22488", name: "VANDE BHARAT EXP", type: "Vande Bharat", runDays: ["mon", "tue", "wed", "thu", "sat", "sun"] }, from: { departure: "10:18", day: 1 }, to: { arrival: "13:50", day: 1 }, distance: 311, duration: 212 },
          ],
        },
      });
    }
    if (u.pathname.endsWith("/trains/12414/seats")) {
      expect(u.searchParams.get("journeyDate")).toBe("2026-09-12");
      expect(u.searchParams.get("classCode")).toBe("3A");
      return jsonResponse(200, {
        success: true,
        data: {
          trainNumber: "12414",
          classCode: "3A",
          quotaCode: "GN",
          avlDayList: [
            { availablityDate: "2026-09-12", availablityStatus: "GNWL24/WL11" },
            { availablityDate: "2026-09-13", availablityStatus: "AVAILABLE-0042" },
          ],
        },
      });
    }
    if (u.pathname.endsWith("/trains/12414/fare")) {
      return jsonResponse(200, { success: true, data: { trainNumber: "12414", classCode: "3A", totalFare: 745, breakdown: { baseFare: 640 } } });
    }
    if (u.pathname.endsWith("/trains/12414/live")) {
      return jsonResponse(200, {
        success: true,
        data: {
          trainNumber: "12414",
          trainName: "GALTADHAM POOJA",
          startDate: "2026-09-08",
          lastUpdatedAt: "2026-09-08T23:40:00+05:30",
          status: "running",
          delayMinutes: 12,
          currentLocation: { stationCode: "UMB", status: "departed" },
          nextHalt: { stationCode: "DLI", stationName: "Old Delhi Junction" },
          route: [{ stationCode: "UMB", stationName: "Ambala Cantt" }, { stationCode: "DLI", stationName: "Old Delhi Junction" }],
        },
      });
    }
    if (u.pathname.endsWith("/trains/12414/coaches")) {
      return jsonResponse(200, {
        success: true,
        data: { trainNumber: "12414", coaches: [{ position: 1, code: "ENG", classType: "ENG" }, { position: 2, code: "B1", classType: "3A" }, { position: 3, code: "S1", classType: "SL" }] },
      });
    }
    if (u.pathname.endsWith("/trains/12414")) {
      return jsonResponse(200, {
        success: true,
        data: {
          train: { number: "12414", name: "GALTADHAM POOJA", runDays: ["mon", "tue"], duration: 1140 },
          route: [
            { sequence: 1, station: { code: "JAT", name: "Jammu Tawi" }, arrival: null, departure: "18:00", arrivalDay: 1, departureDay: 1 },
            { sequence: 2, station: { code: "LDH", name: "Ludhiana Jn" }, arrival: "22:45", departure: "22:55", arrivalDay: 1, departureDay: 1 },
            { sequence: 3, station: { code: "DLI", name: "Delhi" }, arrival: "03:50", departure: null, arrivalDay: 2, departureDay: 2 },
          ],
        },
      });
    }
    if (u.pathname.endsWith("/lookup/search/stations")) {
      return jsonResponse(200, { success: true, data: [{ code: "KGM", name: "Kathgodam", city: "Haldwani" }] });
    }
    if (u.pathname.endsWith("/lookup/search/trains")) {
      return jsonResponse(200, { success: true, data: [{ number: "15906", name: "Vivek Express", source: "CAPE", destination: "DBRG" }, { number: "15905", name: "Vivek Express", source: "DBRG", destination: "CAPE" }] });
    }
    return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "Resource not found" } });
  });
}

describe("Round-16o: RailRadar provider — skipped without key, used after RailCore/RailKit fail", () => {
  it("no key → no network call, returns null (chain unchanged)", async () => {
    const calls: string[] = [];
    railradarMock(calls);
    expect(await railradarSearchTrains({ from: "LDH", to: "DLI", date: "2026-09-12" })).toBeNull();
    expect(await railradarLive("12414")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("train search: RailCore daily limit → RailRadar trains-between (day-aware, running-day filtered) BEFORE erail web", async () => {
    process.env.RAILRADAR_API_KEY = "rr_live_test";
    setRailcoreFetch(async () => DAILY_LIMIT());
    const calls: string[] = [];
    railradarMock(calls);
    let erailHit = false;
    setScrapeFetch(async (input) => {
      if (String(input).includes("erail.in")) erailHit = true;
      return new Response("", { status: 500 });
    });
    // 2026-09-11 = Friday → 22488 (Fri off) filtered out
    const res = await searchTrainsRouted({ from: "LDH", to: "DLI", date: "2026-09-11" });
    expect(res.provider).toBe("railradar");
    expect(res.trains.map((t) => t.number)).toEqual(["12414"]);
    expect(res.trains[0]).toMatchObject({ departure: "22:55", arrival: "03:50", arrivalDayOffset: 1, durationMinutes: 295 });
    expect(erailHit).toBe(false);
    // Saturday → both
    const sat = await searchTrainsRouted({ from: "LDH", to: "DLI", date: "2026-09-12" });
    expect(sat.trains.map((t) => t.number)).toEqual(["22488", "12414"]);
  });

  it("availability + fare: RailCore fail → RailRadar row (labeled source), railyatri web NOT hit", async () => {
    process.env.RAILRADAR_API_KEY = "rr_live_test";
    setRailcoreFetch(async () => DAILY_LIMIT());
    railradarMock();
    let webHit = false;
    setScrapeFetch(async () => {
      webHit = true;
      return new Response("", { status: 500 });
    });
    const p = getFallbackProvider();
    const row = await p.getAvailability("12414", "2026-09-12", "LDH", "DLI", "3A", "GN");
    expect(row).toMatchObject({ status: "WAITLIST", waitlist: 11, source: "railradar" });
    const fare = await p.getFare("12414", "2026-09-12", "LDH", "DLI", "3A", 2);
    expect(fare).toMatchObject({ railwayAvailable: true, baseFare: 1490, total: 1490, source: "railradar" });
    expect(webHit).toBe(false);
    expect(webSourceLabel("railradar")).toMatch(/RailRadar API/);
  });

  it("live / schedule / coach / station / train-name: RailRadar served with provider label", async () => {
    process.env.RAILRADAR_API_KEY = "rr_live_test";
    setRailcoreFetch(async () => DAILY_LIMIT());
    railradarMock();
    const live = await routedLiveStatus("12414");
    expect(live.provider).toBe("railradar");
    expect(live.live).toMatchObject({ trainNumber: "12414", delayMinutes: 12, currentStation: "Ambala Cantt (UMB)", nextStation: "Old Delhi Junction (DLI)" });
    const sched = await routedSchedule("12414");
    expect(sched.provider).toBe("railradar");
    expect(sched.schedule?.stops.map((s) => s.code)).toEqual(["JAT", "LDH", "DLI"]);
    expect(sched.schedule?.stops[2].day).toBe(2);
    const coach = await routedCoachPosition("12414");
    expect(coach.provider).toBe("railradar");
    expect(coach.coachPosition?.coaches.map((c) => c.name)).toEqual(["ENG", "B1", "S1"]);
    const st = await routedStationSearch("kathgodam");
    expect(st.provider).toBe("railradar");
    expect(st.stations[0].code).toBe("KGM");
    const named = await routedTrainNameSearch("vivek express");
    expect(named.provider).toBe("railradar");
    expect(named.trains.map((t) => t.number)).toEqual(["15906", "15905"]);
    expect(named.trains[0]).toMatchObject({ from: "CAPE", to: "DBRG" });
  });

  it("RailRadar 429 (monthly quota) → circuit-break, next call no network", async () => {
    process.env.RAILRADAR_API_KEY = "rr_live_test";
    let n = 0;
    setRailradarFetch(async () => {
      n++;
      return jsonResponse(429, { success: false, error: { code: "RATE_LIMITED", message: "quota" } });
    });
    expect(await railradarAvailability("12414", "2026-09-12", "LDH", "DLI", "3A")).toBeNull();
    expect(await railradarAvailability("12414", "2026-09-12", "LDH", "DLI", "3A")).toBeNull();
    expect(n).toBe(1);
  });
});

/* ── Indian Rail API mock (indianrailapi.com v2 shapes) ─────────────────── */
function indianRailMock(calls: string[] = []) {
  setIndianRailApiFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (!url.includes("/apikey/ira_test/")) return jsonResponse(200, { ResponseCode: "201", Message: "Authentication Required." });
    if (url.includes("/TrainSchedule/")) {
      return jsonResponse(200, {
        ResponseCode: "200",
        Status: "SUCCESS",
        TrainName: "BIHAR S KRANTI",
        Route: [
          { SerialNo: "1", StationCode: "DBG", StationName: "DARBHANGA JN", ArrivalTime: "08:35:00", DepartureTime: "08:35:00" },
          { SerialNo: "2", StationCode: "SPJ", StationName: "SAMASTIPUR J", ArrivalTime: "09:25:00", DepartureTime: "09:45:00" },
        ],
      });
    }
    if (url.includes("/livetrainstatus/")) {
      return jsonResponse(200, {
        ResponseCode: "200",
        TrainNumber: "12565",
        CurrentStation: { StationName: "Gorakhpur", StationCode: "GKP", DelayInArrival: "25 M" },
        TrainRoute: [{ StationCode: "GKP", StationName: "Gorakhpur" }, { StationCode: "LKO", StationName: "Lucknow" }],
        Message: "SUCCESS",
      });
    }
    if (url.includes("/TrainFare/")) {
      return jsonResponse(200, { ResponseCode: "200", Status: "SUCCESS", Fares: [{ Code: "3A", Fare: "1320" }, { Code: "SL", Fare: "500" }] });
    }
    if (url.includes("/CoachPosition/")) {
      return jsonResponse(200, { ResponseCode: "200", TrainNumber: "12565", Coaches: [{ SerialNo: "1", Code: "ENG", Number: "ENG" }, { SerialNo: "2", Code: "SL", Number: "S1" }] });
    }
    if (url.includes("/AutoCompleteStation/")) {
      return jsonResponse(200, { ResponseCode: "200", Status: "SUCCESS", Station: [{ NameEn: "HAJIPUR JN", StationCode: "HJP" }] });
    }
    if (url.includes("/AutoCompleteTrainInformation/")) {
      return jsonResponse(200, { ResponseCode: "200", Status: "SUCCESS", Trains: [{ TrainNo: "12565", TrainName: "BIHAR SAMPAR", Source: { Code: "DBG" }, Destination: { Code: "NDLS" } }, { TrainNo: "12565", TrainName: "BIHAR SAMPAR" }] });
    }
    return jsonResponse(200, { ResponseCode: "404", Status: "FAILED", Message: "no" });
  });
}

describe("Round-16o: Indian Rail API provider — after RailRadar, before web-scrape", () => {
  it("no key → skipped entirely", async () => {
    const calls: string[] = [];
    indianRailMock(calls);
    setRailcoreFetch(async () => DAILY_LIMIT());
    const live = await routedLiveStatus("12565");
    expect(live.provider).toBe("none");
    expect(calls).toEqual([]);
  });

  it("key set (RailRadar unset) → schedule/live/fare/coach/station/name from Indian Rail API, labeled", async () => {
    process.env.INDIANRAILAPI_KEY = "ira_test";
    setRailcoreFetch(async () => DAILY_LIMIT());
    indianRailMock();
    const sched = await routedSchedule("12565");
    expect(sched.provider).toBe("indianrailapi");
    expect(sched.schedule).toMatchObject({ trainName: "BIHAR S KRANTI" });
    expect(sched.schedule?.stops[1]).toMatchObject({ code: "SPJ", arrival: "09:25", departure: "09:45" });
    const live = await routedLiveStatus("12565");
    expect(live.provider).toBe("indianrailapi");
    expect(live.live).toMatchObject({ delayMinutes: 25, currentStation: "Gorakhpur (GKP)", nextStation: "Lucknow (LKO)" });
    const p = getFallbackProvider();
    const fare = await p.getFare("12565", "2026-09-12", "SEE", "NDLS", "3A", 1);
    expect(fare).toMatchObject({ railwayAvailable: true, baseFare: 1320, source: "indianrailapi" });
    const coach = await routedCoachPosition("12565");
    expect(coach.provider).toBe("indianrailapi");
    expect(coach.coachPosition?.coaches.map((c) => c.name)).toEqual(["ENG", "S1"]);
    const st = await routedStationSearch("hajipur");
    expect(st.provider).toBe("indianrailapi");
    expect(st.stations[0]).toMatchObject({ code: "HJP", name: "HAJIPUR JN" });
    const named = await routedTrainNameSearch("bihar sampark");
    expect(named.provider).toBe("indianrailapi");
    expect(named.trains).toHaveLength(1); // duplicate 12565 collapsed
    expect(webSourceLabel("indianrailapi")).toMatch(/Indian Rail API/);
  });

  it("ResponseCode 201 (bad key) → 1h block, single network call", async () => {
    process.env.INDIANRAILAPI_KEY = "wrong";
    setRailcoreFetch(async () => DAILY_LIMIT());
    const calls: string[] = [];
    indianRailMock(calls);
    await routedSchedule("12565");
    await routedLiveStatus("12565");
    expect(calls).toHaveLength(1);
  });
});

/* ── erail train-list (web) for TRAIN_NAME_SEARCH ─────────────────────── */
const IRTRAINS = JSON.stringify([
  "19027 - JAT VIVEK EXP",
  "19567 - VIVEK EXPRESS",
  "22504 - VIVEK EXPRESS",
  "22503 - DBRG VIVEK EXP",
  "12014 - AMRITSAR SHTABDI",
  "12002 - BHOPAL SHATABDI",
  "12951 - MUMBAI RAJDHANI",
  "junk",
]);

describe("Round-16o: TRAIN_NAME_SEARCH chain — RailCore limited → erail train-list web fallback", () => {
  it("parses erail IRTrains.js list", () => {
    const list = parseErailTrainNameList(IRTRAINS);
    expect(list).toHaveLength(7);
    expect(list[0]).toEqual({ number: "19027", name: "JAT VIVEK EXP" });
  });

  it("name search scores word matches; number query exact", async () => {
    _setErailTrainsCacheForTests(Array.from({ length: 1001 }, (_, i) => ({ number: String(60000 + i), name: `LOCAL ${i}` })).concat(parseErailTrainNameList(IRTRAINS)));
    const vivek = await scrapeTrainNameSearchWeb("vivek express");
    expect(vivek.map((t) => t.number).sort()).toEqual(["19027", "19567", "22503", "22504"]);
    const sh = await scrapeTrainNameSearchWeb("shatabdi");
    expect(sh.map((t) => t.number)).toEqual(["12002"]); // "SHTABDI" spelling erail ki — exact/prefix match hi (invent nahi)
    const num = await scrapeTrainNameSearchWeb("12951");
    expect(num).toEqual([{ number: "12951", name: "MUMBAI RAJDHANI", provider: "web_erail" }]);
  });

  it("routedTrainNameSearch: RailCore daily-limit + no extra keys → web_erail list (route blank, honest)", async () => {
    setRailcoreFetch(async () => DAILY_LIMIT());
    setScrapeFetch(async (input) => {
      if (String(input).includes("erail.in/js5/IRTrains.js")) return new Response(IRTRAINS, { status: 200 });
      return new Response("", { status: 404 });
    });
    _setErailTrainsCacheForTests(null);
    // cache threshold is 1000 → list is small so no cache, but the fetch still returns rows
    const res = await routedTrainNameSearch("vivek express");
    expect(res.provider).toBe("web_erail");
    expect(res.trains.map((t) => t.number).sort()).toEqual(["19027", "19567", "22503", "22504"]);
    expect(res.trains[0].from).toBe("");
  });

  it("TRAIN_NAME_SEARCH tool: total fail → summary instructs WEB_SEARCH (not memory)", async () => {
    setRailcoreFetch(async () => DAILY_LIMIT());
    const r = await executeApprovedTool("TRAIN_NAME_SEARCH", { query: "vivek express" });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/ABHI WEB_SEARCH tool call karo/);
    expect(r.summary).toMatch(/apni memory se jawab MAT/);
  });
});

/* ── (A) web rescue on ungrounded / no-ok-steps ────────────────────────── */
function vivekWikiMock() {
  setWebFetch(async (input: any) => {
    const url = String(input);
    if (url.includes("duckduckgo.com")) return jsonResponse(200, {});
    const u = new URL(url);
    if (u.searchParams.get("action") === "parse") return jsonResponse(200, { parse: { title: "", wikitext: { "*": "" } } });
    if (u.searchParams.get("list") === "search") {
      return jsonResponse(200, { query: { search: [{ title: "Vivek Express" }] } });
    }
    if (u.searchParams.get("prop") === "extracts") {
      const extract =
        "The Vivek Express is a series of four express trains operated by Indian Railways, introduced in 2011 to commemorate the 150th birth anniversary of Swami Vivekananda. " +
        "The Dibrugarh–Kanyakumari Vivek Express runs from Dibrugarh in Assam to Kanyakumari in Tamil Nadu, covering 4,189 km in about 76 hours, making it the longest train route in India.";
      return jsonResponse(200, { query: { pages: { "1": { title: "Vivek Express", extract: u.searchParams.get("exintro") === "1" ? extract.slice(0, 300) : extract } } } });
    }
    return jsonResponse(404, {});
  });
}

describe("Round-16o (A): general question + RailCore limited → web rescue instead of 'provider se nahi mil pa rahi'", () => {
  beforeEach(() => {
    process.env.NVIDIA_API_KEY = "nvapi_test_key_not_real";
  });
  afterEach(() => {
    setAgenticNvidiaFetch(null as never);
    process.env.NVIDIA_API_KEY = "";
  });

  it("webRescueEligible: general Qs yes; booking-critical / already-web / ok-steps no", () => {
    const failStep = { step: 1, tool: "TRAIN_NAME_SEARCH", args: {}, ok: false, source: "railcore", summary: "x", latencyMs: 1 };
    expect(webRescueEligible("Vivek express kahan se kahan chlti hai?", [failStep])).toBe(true);
    expect(webRescueEligible("India ki sabse longest route ki train kon si hai?", [failStep])).toBe(true);
    expect(webRescueEligible("12014 mein seat available hai kya", [failStep])).toBe(false);
    expect(webRescueEligible("12014 ka fare kitna hai", [failStep])).toBe(false);
    expect(webRescueEligible("Amritsar se Delhi airport Saturday ko trains batao", [failStep])).toBe(false);
    expect(webRescueEligible("ludhiana se delhi kal jaana hai kaunsi train", [failStep])).toBe(false);
    expect(webRescueEligible("Vivek express kahan se kahan chlti hai?", [{ ...failStep, tool: "WEB_SEARCH" }])).toBe(false);
    expect(webRescueEligible("Vivek express kahan se kahan chlti hai?", [{ ...failStep, ok: true }])).toBe(false);
  });

  it("model answers from memory after TRAIN_NAME_SEARCH fail → ungrounded → auto WEB_SEARCH → Wikipedia answer", async () => {
    setRailcoreFetch(async () => DAILY_LIMIT());
    vivekWikiMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return jsonResponse(200, {
          model: "meta/muse-glimmer-30b",
          choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "TRAIN_NAME_SEARCH", arguments: JSON.stringify({ query: "vivek express" }) } }] } }],
        });
      }
      // Model ignores the hint and answers from its own memory (the prod failure)
      return jsonResponse(200, {
        model: "meta/muse-glimmer-30b",
        choices: [{ message: { content: "Vivek Express 15906 Dibrugarh se Kanyakumari tak 4273 km chalti hai, 82 ghante lagte hain." } }],
      });
    });
    const turn = await runAgenticTurn({ text: "Vivek express kahan se kahan chlti hai?", now: "2026-09-08T16:20:00+05:30" });
    expect(turn.ok).toBe(true);
    expect(turn.grounded).toBe(true);
    expect(turn.failureReason).toMatch(/^ungrounded_rescued_by_web/);
    expect(turn.steps.map((s) => `${s.tool}${s.ok ? "✓" : "✗"}`)).toEqual(["TRAIN_NAME_SEARCH✗", "WEB_SEARCH✓"]);
    const reply = String(turn.reply);
    expect(reply).toMatch(/Web se mila \(Wikipedia — Vivek Express\)/);
    expect(reply).toMatch(/Dibrugarh/);
    expect(reply).toMatch(/4,189 km/);
    expect(reply).not.toMatch(/provider se nahi mil/);
    expect(reply).not.toMatch(/4273/); // model's invented number never shown
  });

  it("booking-critical question stays honest (no web rescue for seats)", async () => {
    setRailcoreFetch(async () => DAILY_LIMIT());
    vivekWikiMock();
    setAgenticNvidiaFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const toolMsgs = body.messages.filter((m: any) => m.role === "tool").length;
      if (toolMsgs === 0) {
        return jsonResponse(200, {
          model: "meta/muse-glimmer-30b",
          choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "TRAIN_NAME_SEARCH", arguments: JSON.stringify({ query: "vivek express" }) } }] } }],
        });
      }
      return jsonResponse(200, { model: "meta/muse-glimmer-30b", choices: [{ message: { content: "15906 mein 3A me 42 seats available hain." } }] });
    });
    const turn = await runAgenticTurn({ text: "vivek express mein seat available hai kya", now: "2026-09-08T16:20:00+05:30" });
    expect(turn.steps.map((s) => s.tool)).toEqual(["TRAIN_NAME_SEARCH"]);
    expect(String(turn.reply)).toMatch(/provider se nahi mil/);
    expect(String(turn.reply)).not.toMatch(/42 seats/);
  });
});
