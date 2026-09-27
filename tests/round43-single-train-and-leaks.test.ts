/* ══ ROUND-43 (27 Sep 2026) — user ke 3 screenshots ne 3 asli bug dikhaye:
 *   1. "12054 ki seat availability btana" → poora 16-train board khul gaya, us train ka jawab nahi
 *      (jabki ChatGPT 27/28/29 Sep ki saaf date-wise availability deta hai)
 *   2. reply me tool ke INTERNAL instructions user ko dikh gaye ("Jawab me SAARI trains ki lines likho…
 *      mat likho… SEAT rows me hain", "(0 ka alag board check kiya)")
 *   3. seat card ka "Book" tap par passenger form nahi khula (client state khaali → chupke chat message)
 * Fix: single-train availability deterministic handler (aaj+kal date-wise, per class, ChatGPT-style) ·
 * scrubInternalNotes (reply se internal notes/noise) · Book button route/date har verified source se.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { asksSingleTrainAvailability, scrubInternalNotes } from "../server/agent/answerMode";
import { candidateStationTokens, checkStationsOnRoute, normalizeRouteSegment, routeMismatchMessage } from "../server/agent/routeCheck";
import { runAgent } from "../server/agent/run";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setScrapeFetch } from "../server/railway/webscrape";
import { setProvider } from "../server/providers/index";
import { afterEach, beforeEach, vi } from "vitest";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("Round-43 · khaas train ki seat availability (poora board nahi)", () => {
  it("single-train sawaal pehchano; route-level sawaal board hi rahe", () => {
    for (const q of ["12054 ki seat availability btana", "12054 me 3A me seat hai kya", "15906 me berth milega kya", "12054 ki availability kal ki"]) {
      expect(asksSingleTrainAvailability(q), q).toBe(true);
    }
    for (const q of ["ASR se NDLS kal 2A me kaunsi train me seat hai", "sabse sasti seat wali train batao", "12054 ke alawa aur trains batao", "aaj ki trains batao"]) {
      expect(asksSingleTrainAvailability(q), q).toBe(false);
    }
  });

  it("run.ts me deterministic handler hai — CHECK_AVAILABILITY, aaj+kal, date-wise blocks", () => {
    const r = read("server/agent/run.ts");
    expect(r).toContain("(asksSingleTrainAvailability(t) || resumeTrain) && !isBookingMutation(req)");
    /* Round-43b: multi-turn resume — train pehle select ho chuki ho to date/class wale follow-up
     * ("Date aaj ki ludhiana se hw ki", "CC") par bhi wahi train ka date-wise jawab. */
    expect(r).toContain("ctxResume.selectedTrainNumber");
    expect(r).toContain("resumeBareClass");
    expect(r).toContain('failureReason: "single_train_availability_deterministic"');
    expect(r).toContain("const dates = given ? [given] : [ymd(baseMs), ymd(baseMs + 86400000)]");
    expect(r).toContain('train cancelled');
    expect(r).toContain("seat availability:");
  });

  it("awaaz/labels: aaj/kal + month label + per-class status ₹", () => {
    const r = read("server/agent/run.ts");
    expect(r).toContain('const label = (d: string) => (d === ymd(baseMs) ? "aaj" : d === ymd(baseMs + 86400000) ? "kal" : "")');
    expect(r).toContain("Jan\",\"Feb\",\"Mar");
    expect(r).toContain("AVAILABLE ${c.seats ?? \"?\"}");
  });
});

describe("Round-43 · internal notes user tak nahi (screenshot leak)", () => {
  it("instruction lines poori tarah scrub", () => {
    const dirty = `12054 ASR→HW.
Jawab me SAARI trains ki lines likho (jo SEAT rows me hain) — 'baaki trains kisi card me hain' jaisi baat kabhi mat likho.
(Source: web_confirmtkt · 2 trains dekhe (0 ka alag board check kiya).)
2S AVAILABLE 294 ₹205.`;
    const clean = scrubInternalNotes(dirty);
    expect(clean).not.toMatch(/SAARI|mat likho|SEAT rows|card me hain|board check kiya|trains dekhe/i);
    expect(clean).toContain("2S AVAILABLE 294 ₹205");
  });

  it("scrubber khaali/punctuation-only lines chhodta nahi", () => {
    const clean = scrubInternalNotes("Jawab me SAARI lines likho (jo SEAT rows me hain).\n\n• Kal: 2S AVAILABLE 294");
    expect(clean).toBe("• Kal: 2S AVAILABLE 294");
  });

  it("agentic pipeline me scrubber lagi hai (model reply + deterministic summary dono)", () => {
    const a = read("server/agent/agentic.ts");
    expect(a).toContain("const clean = scrubInternalNotes(scrubProactiveOffers(extracted.text));");
    expect(a).toContain("return scrubInternalNotes(deterministicSummaryRaw(steps));");
  });
});

describe("Round-43 · seat card ka Book → passenger form", () => {
  it("client handler route/date har verified source se leta hai (state → ctx → seat rows → picker)", () => {
    const c = read("src/views/Concierge.tsx");
    expect(c).toContain("const ctxB = agentCtxRef.current;");
    expect(c).toContain("const remembered = lastSeatRowsRef.current;");
    expect(c).toContain("const pickedB = lastPickedTrainRef.current;");
    expect(c).toContain("state.date || remembered?.date || pickedB?.date || ctxB?.date");
    expect(c).toContain("if (!from || !to || !date) {");
  });
});

/* ── Round-43d: aaj ka live status seedha (battery me "12054 late hai kya" par model date poochh kar
 * ruk gaya tha — ChatGPT jaisa sawaal nahi poochhna chahiye). */
function liveMockRunning(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.includes("/live")) {
      return new Response(JSON.stringify({ success: false }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    const body = {
      success: true,
      data: {
        train_number: "12054",
        train_name: "JAN SHATABDI EXPRESS",
        journey_date: url.searchParams.get("date") ?? "2026-09-27",
        total_distance_km: 315,
        status: "RUNNING",
        status_text: "Running 12 minutes late",
        current_station_code: "JEP",
        current_station_name: "Jeonathpur",
        next_station_code: "HW",
        next_station_name: "Haridwar Jn",
        previous_station_code: "LDH",
        delay_minutes: 12,
        progress_percent: 55,
        distance_covered_km: 180,
        last_reported_at: "2026-09-27T14:35:00+05:30",
      },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

describe("Round-43d · aaj ka live status seedha (bina date ke)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-27T09:10:00.000Z"), toFake: ["Date"] }); // 27 Sep 2026, 14:40 IST
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    process.env.NVIDIA_API_KEY = "";
    setProvider(null);
    setScrapeFetch(async () => new Response(JSON.stringify({ success: false }), { status: 500, headers: { "Content-Type": "application/json" } }));
  });

  afterEach(() => {
    vi.useRealTimers();
    setRailcoreFetch(null);
    setScrapeFetch(null);
    process.env.RAILWAY_PROVIDER = "mock";
    process.env.RAILCORE_API_KEY = "";
    setProvider(null);
  });

  it("'12054 late hai kya' → deterministic live status, koi date sawaal nahi", async () => {
    liveMockRunning();
    const r = await runAgent({ text: "12054 late hai kya", known: {} });
    const reply = String(r.reply ?? "");
    expect(r.engine, reply).toBe("deterministic");
    expect(reply, reply).toMatch(/Jeonathpur|12/);
    expect(reply, reply).not.toMatch(/kaunse din|kaunsi date|kis din|kaunsi run/i);
  });

  it("'12054 abhi kaha pahunchi' → wahi deterministic live jawab", async () => {
    liveMockRunning();
    const r = await runAgent({ text: "12054 abhi kaha pahunchi", known: {} });
    const reply = String(r.reply ?? "");
    expect(r.engine, reply).toBe("deterministic");
    expect(reply, reply).not.toMatch(/kaunse din|kaunsi date|kis din/i);
  });

  it("date di ho ('parson wali') to ye fast-path chalta hi nahi (past-run flow hi rahe)", () => {
    const r = read("server/agent/run.ts");
    expect(r).toContain("const anyDate = /\\b(aaj|kal|parso|parson|");
    expect(r).toContain("const liveQ = /\\b(kahan hai|");
  });
});

/* ── Round-43e (user screenshot 27 Sep): "19326 hw ke liye seat check krna" — 19326 Haridwar jaati hi
 * nahi, phir bhi poora route-board (saari classes N/A) dikha diya tha. ChatGPT ne sahi kaha "route me
 * Haridwar nahi hai". Ab: station train ke timetable me nahi → saaf correction + sahi destination sawaal;
 * aur agar train me koi class hi available nahi (N/A) → date-wise honest jawab (53s model board nahi). */
function inRouteMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const sched = p.match(/\/trains\/(\d+)\/schedule$/);
    if (sched) {
      const num = sched[1];
      const stops = num === "19326"
        ? [
            { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "01:50", day: 1 },
            { station_code: "SRE", station_name: "SAHARANPUR JN", arrival_time: "09:20", departure_time: "09:25", day: 1 },
            { station_code: "MB", station_name: "MORADABAD", arrival_time: "12:00", departure_time: "12:10", day: 1 },
            { station_code: "INDB", station_name: "INDORE JN", arrival_time: "00:55", departure_time: null, day: 2 },
          ]
        : [
            { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "06:50", day: 1 },
            { station_code: "DDL", station_name: "DHANDARI KALAN", arrival_time: "09:15", departure_time: "09:20", day: 1 },
            { station_code: "UMB", station_name: "AMBALA CANTT JN", arrival_time: "10:55", departure_time: "11:04", day: 1 },
            { station_code: "HW", station_name: "HARIDWAR JN", arrival_time: "13:50", departure_time: null, day: 1 },
          ];
      return json(200, { success: true, data: { train_number: num, train_name: num === "19326" ? "ASR INDB EXP" : "HW JANSHATABDI", running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], classes: ["1A", "2A", "3A", "SL"], stops } });
    }
    if (p.endsWith("/availability/seats")) {
      const date = url.searchParams.get("date");
      return json(200, {
        success: true,
        data: {
          train_number: url.searchParams.get("train_number"),
          journey_date: date,
          quota: "GN",
          /* 19326 jaisa "koi seat nahi" — sab classes N/A (fares ke saath, jaise provider deta hai). */
          classes: [
            { class_code: "1A", status: "NOT_AVAILABLE", availability_text: "NOT AVAILABLE", total_fare: 3920 },
            { class_code: "2A", status: "NOT_AVAILABLE", availability_text: "NOT AVAILABLE", total_fare: 2340 },
            { class_code: "SL", status: "NOT_AVAILABLE", availability_text: "NOT AVAILABLE", total_fare: 650 },
          ],
        },
      });
    }
    if (p.endsWith("/stations/search")) {
      const q = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").toLowerCase();
      const LUDHIANA = [
        { station_code: "LDH", station_name: "LUDHIANA JN", city: "Ludhiana", confidence: 1 },
        { station_code: "DDL", station_name: "DHANDARI KALAN", city: "Ludhiana", confidence: 0.8 },
      ];
      const results =
        q === "hw" || q === "haridwar"
          ? [{ station_code: "HW", station_name: "HARIDWAR JN", city: "Haridwar", confidence: 1 }]
          : q === "ldh" || q === "ludhiana" || q === "ludhiana jn"
            ? LUDHIANA
            : [];
      return json(200, { success: true, data: { results } });
    }
    return json(404, { success: false, error: { message: "unknown endpoint" } });
  });
}

describe("Round-43e · station route me nahi → honest correction (board nahi) + all-N/A par clean jawab", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-27T09:10:00.000Z"), toFake: ["Date"] });
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    process.env.NVIDIA_API_KEY = "";
    setProvider(null);
    setScrapeFetch(async () => new Response(JSON.stringify({ success: false }), { status: 500, headers: { "Content-Type": "application/json" } }));
  });

  afterEach(() => {
    vi.useRealTimers();
    setRailcoreFetch(null);
    setScrapeFetch(null);
    process.env.RAILWAY_PROVIDER = "mock";
    process.env.RAILCORE_API_KEY = "";
    setProvider(null);
  });

  it("'19326 hw ke liye seat check krna' → 'Haridwar route me nahi' (koi N/A board nahi)", async () => {
    inRouteMock();
    const r = await runAgent({ text: "19326 hw ke liye seat check krna", known: {} });
    const reply = String(r.reply ?? "");
    expect(r.failureReason, reply).toBe("single_train_station_not_in_route");
    expect(r.engine, reply).toBe("deterministic");
    expect(reply, reply).toMatch(/19326/);
    expect(reply, reply).toMatch(/HW/);
    expect(reply, reply).toMatch(/ASR → INDB/);
    expect(reply, reply).toMatch(/nahi/i);
    /* Jhoothi seat rows kabhi nahi. */
    expect(reply, reply).not.toMatch(/N\/A|AVAILABLE|WL ?\d/i);
    expect((r as unknown as { trains?: unknown }).trains ?? null).toBeNull();
  });

  it("train me koi class available nahi → date-wise honest jawab (model/board path nahi)", async () => {
    inRouteMock();
    const r = await runAgent({ text: "19326 indore ke liye seat check krna", known: {} });
    const reply = String(r.reply ?? "");
    expect(r.failureReason, reply).toBe("single_train_availability_deterministic");
    expect(reply, reply).toMatch(/19326 \(ASR → INDB\)/);
    expect(reply, reply).toMatch(/27 Sep \(aaj\):/);
    expect(reply, reply).toMatch(/koi class available nahi/i);
    expect(reply, reply).toMatch(/N\/A/);
  });

  it("provider ka route data ho tab hi 'nahi milta' claim (warna normal flow)", () => {
    const r = read("server/agent/run.ts");
    expect(r).toContain("single_train_station_not_in_route");
    /* Round-43k (user: 'ese kitne rules fix kroge?'): verification EK jagah — run.ts apna stop-word list
     * ya route check DUPLICATE nahi rakhta, shared checker use karta hai (wahi jo tool ke andar chalta hai). */
    expect(r).toContain("checkStationsOnRoute");
    expect(r).toContain("normalizeRouteSegment");
    const routeCheck = read("server/agent/routeCheck.ts");
    expect(r).not.toContain("const stopWords = new Set(");
    expect(routeCheck).toContain("ROUTE_ASK_STOPWORDS");
    expect(read("server/agent/agentic.ts")).toContain("checkStationsOnRoute");
  });
});

/* ── Round-43k: general verification — kisi bhi train × station par, aur false-positive ka koi mauka nahi.
 * User: "ese kitne rules fix kroge? AI ko khud verify karna chahiye." Isliye ye tests tool ke ANDAR ki
 * shared verification ke hain: (a) postposition/class/booking shabd station nahi bante, (b) route ka
 * pehla/aakhri stop redundant arg nahi banta (12054 'HW→HW' provider-bug), (c) asli station route me
 * nahi to honest fail — general, kisi ek train/station par hardcoded nahi. */
describe("Round-43k · shared route verification (tool ke andar, kisi bhi train × station par)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-27T09:10:00.000Z"), toFake: ["Date"] });
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    /* Deterministic: web-scrape (doosra source) band — mock route/timetable hi source hai. */
    setScrapeFetch(async () => new Response(JSON.stringify({ success: false }), { status: 500, headers: { "Content-Type": "application/json" } }));
  });
  afterEach(() => {
    vi.useRealTimers();
    setRailcoreFetch(null);
    setScrapeFetch(null);
    process.env.RAILWAY_PROVIDER = "mock";
    process.env.RAILCORE_API_KEY = "";
    setProvider(null);
  });

  it("model ke marker tokens user ko na dikhein ([END] / (done)) — par [NEXT] chips bache rahein", () => {
    expect(scrubInternalNotes("12054 (Hw Janshatabdi) ASR → HW. [END]")).toBe("12054 (Hw Janshatabdi) ASR → HW.");
    expect(scrubInternalNotes("Jawab: 28 Sep CC WL16 · 2S AVL 235 (done)")).toBe("Jawab: 28 Sep CC WL16 · 2S AVL 235");
    expect(scrubInternalNotes("Seat status neeche hai.\n[NEXT] Book 12054 · CC => 12054 mein CC book krdo")).toContain("[NEXT]");
  });

  it("station tokens: postposition / class / booking shabd nikaal do", () => {
    const toks = candidateStationTokens("12138 mein SL 2026-10-02 ko LDH se CSMT 1 passenger ke liye seat hai?", "12138");
    expect(toks).toContain("ldh");
    expect(toks).toContain("csmt");
    for (const bad of ["ko", "se", "mein", "sl", "passenger", "seat", "ke", "liye", "hai", "12138"]) expect(toks, `${bad} station token nahi hona chahiye`).not.toContain(bad);
    /* Train ke naam wale shabd bhi station nahi (12951 mumbai RAJDHANI haridwar). */
    expect(candidateStationTokens("12951 mumbai rajdhani haridwar ke liye seat check krna", "12951")).toEqual(["mumbai", "haridwar"]);
  });

  it("station ka SHEHAR route me hai to wahi station bataye (Ludhiana → DDL)", async () => {
    inRouteMock();
    const c = await checkStationsOnRoute("12054", {}, "12054 ludhiana se haridwar tak chalti hai?");
    expect(c.bad?.code).toBe("LDH");
    expect(c.bad?.nearby?.code).toBe("DDL");
    const msg = routeMismatchMessage("12054", c.bad!);
    expect(msg).toMatch(/LDH par stop NAHI karti/);
    expect(msg).toMatch(/DDL/);
    expect(msg, "user-facing message me model-instruction nahi honi chahiye").not.toMatch(/user ko/i);
    expect(routeMismatchMessage("12054", c.bad!, true)).toMatch(/User ko yahi exact baat batao/);
  }, 25000);

  it("redundant segment arg drop: aakhri stop = poori route, aur 'X→X' par koi claim nahi", () => {
    const stops = [{ code: "ASR" }, { code: "UMB" }, { code: "HW" }];
    expect(normalizeRouteSegment(stops, { destination: "HW" })).toEqual({});            /* == last stop */
    expect(normalizeRouteSegment(stops, { origin: "ASR" })).toEqual({});                /* == first stop */
    expect(normalizeRouteSegment(stops, { origin: "HW", destination: "HW" })).toEqual({});
    expect(normalizeRouteSegment(stops, { origin: "UMB", destination: "HW" })).toEqual({ origin: "UMB" });
    expect(normalizeRouteSegment(stops, { origin: "ASR", destination: "UMB" })).toEqual({ destination: "UMB" });
  });

  it("19326 par Haridwar nahi (mock route) — fail + exact route bataye; 'HW' code aur naam dono", async () => {
    inRouteMock();
    const byCode = await checkStationsOnRoute("19326", { destination: "HW" }, "19326 hw ke liye seat check krna");
    expect(byCode.bad?.code).toBe("HW");
    expect(byCode.bad?.first).toBe("ASR");
    expect(byCode.bad?.last).toBe("INDB");
    const byName = await checkStationsOnRoute("19326", {}, "19326 haridwar ke liye seat check krna");
    expect(byName.bad?.code).toBe("HW");
    /* Route wala station (Indore = aakhri stop) par koi mismatch nahi — sirf redundant arg drop. */
    const ok = await checkStationsOnRoute("19326", {}, "19326 indore ke liye seat check krna");
    expect(ok.bad).toBeUndefined();
    expect(ok.destination).toBe("INDB");
  }, 25000 /* mock schedule + station-search calls — suite load par 5s kaafi nahi tha */);
});

/* ── Round-43f/g (user screenshot 27 Sep): "Book 12054" chip par app BLANK ho gaya (white screen) —
 * client ne bina class ke passenger form khola aur Passengers me BERTH_BY_CLASS[undefined].map crash
 * kar gaya. Aur cancelled date (27 Sep) par booking dead-end thi — ab agla din (28 Sep) ka verified
 * data offer hota hai. */
describe("Round-43f/g · Book tap crash-proof + dead date par agla din", () => {
  it("client form sirf VERIFIED class par kholta hai (crash-proof)", () => {
    const c = read("src/views/Concierge.tsx");
    expect(c).toContain("const verifiedClass = String(openRowB?.classCode ?? clsWanted ?? \"\")");
    expect(c).toContain("if (verifiedClass) {");
    expect(c).toContain("if (!uniqClasses.length) return;");
    const p = read("src/views/Passengers.tsx");
    expect(p).toContain("BERTH_BY_CLASS[state.selectedClass.code] ?? []");
  });

  it("booking: boli hui date par kuch bookable nahi → agla din ka real data + chips usi date ke", () => {
    const r = read("server/agent/run.ts");
    expect(r).toContain("bDateUsed");
    expect(r).toContain("par koi class bookable nahi");
  });
});
