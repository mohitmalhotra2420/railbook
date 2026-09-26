/* Round-33 (26 Sep 2026) — user:
 *   "AI ko jitne bhi tools available hai wo sabh provide kro I mean no restriction on using any tool
 *    bss AI continue to IRCTC pe click nhi karega na hi passenger details khud se fill krega, don't
 *    fake anything sabh real and live data hona chahiye, first use confirm tkt, then rail yatri,
 *    then e rail on API fallback to fetch relevant data, like fare, seat availability, timings,
 *    route, station codes, live status, etc. depends on user question AI should handle everything
 *    without restriction on any tool."
 *
 * Is round me: (1) web fallback ka order central (confirmtkt → railyatri → erail),
 * (2) train list me timings + fare, (3) plan/alternative sawaal ka sahi tool,
 * (4) SEARCH_TRAINS ko passengers ki zaroorat nahi, (5) "Kal,1" jaisa jawab seed hota hai.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { WEB_PROVIDER_ORDER, WEB_CAPABILITY_SUPPORT, webChain, webRank, orderWebRows, pickWebSource, webSiteName } from "../server/railway/webOrder";
import { boardRowsToTrainResults } from "../server/railway/router";
import { userStatedPax } from "../server/agent/agentic";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("Round-33 · provider order: confirmtkt → railyatri → erail", () => {
  it("global order wahi hai jo user ne bola", () => {
    expect([...WEB_PROVIDER_ORDER]).toEqual(["web_confirmtkt", "web_railyatri", "web_erail"]);
  });

  it("har capability ka chain global order follow karta hai (aur sirf supported sites)", () => {
    for (const cap of Object.keys(WEB_CAPABILITY_SUPPORT) as (keyof typeof WEB_CAPABILITY_SUPPORT)[]) {
      const chain = webChain(cap);
      const expected = [...WEB_PROVIDER_ORDER].filter((p) => (WEB_CAPABILITY_SUPPORT[cap] as readonly string[]).includes(p));
      expect(chain).toEqual(expected);
      /* Chain global order me hi hai (kabhi ulta nahi). */
      expect([...chain].sort((a, b) => webRank(a) - webRank(b))).toEqual(chain);
    }
  });

  it("availability me confirmtkt pehle, erail aakhir me (fare-only)", () => {
    expect(webChain("availability")[0]).toBe("web_confirmtkt");
    expect(webChain("availability")[1]).toBe("web_railyatri");
    expect(webChain("availability").at(-1)).toBe("web_erail");
  });

  it("trains-between me confirmtkt pehle (timings+fare), erail aakhir (railyatri ke paas ye endpoint nahi)", () => {
    expect(webChain("trains-between")).toEqual(["web_confirmtkt", "web_erail"]);
  });

  it("live status railyatri se (asli ETA data), station codes erail list se — jhootha source nahi", () => {
    expect(webChain("live")).toEqual(["web_railyatri"]);
    expect(webChain("station")).toEqual(["web_erail"]);
  });

  it("rows ka order preference se sort hota hai (stable)", () => {
    const rows = [
      { id: "e1", source: "web_erail" },
      { id: "r1", source: "web_railyatri" },
      { id: "c1", source: "web_confirmtkt" },
      { id: "c2", source: "web_confirmtkt" },
      { id: "api", source: "railradar" },
    ];
    expect(orderWebRows(rows).map((r) => r.id)).toEqual(["c1", "c2", "r1", "e1", "api"]);
  });

  it("pickWebSource sirf available me se pehla preference wala deta hai", () => {
    expect(pickWebSource("availability", ["web_erail", "web_railyatri"])).toBe("web_railyatri");
    expect(pickWebSource("availability", ["web_erail"])).toBe("web_erail");
    expect(pickWebSource("availability", [])).toBeNull();
  });

  it("site ke insaani naam honest hain", () => {
    expect(webSiteName("web_confirmtkt")).toBe("confirmtkt.com");
    expect(webSiteName("web_railyatri")).toBe("railyatri.in");
    expect(webSiteName("web_erail")).toBe("erail.in");
    expect(webSiteName("railradar")).toBeNull();
  });
});

describe("Round-33 · router chains isi order me chalte hain", () => {
  const src = read("server/railway/router.ts");

  it("availability dono branches me webChain loop (railyatri pehle nahi)", () => {
    expect(src).toContain('for (const src of webChain("availability"))');
    expect(src.includes('logServed("web_railyatri", "availability", started, true, "railcore_failed → web-scrape")')).toBe(false);
  });

  it("fare chain (confirmtkt → railyatri → erail) helper se aata hai", () => {
    expect(src).toContain("async function webFareForClass(");
    expect(src).toContain('for (const src of webChain("fare"))');
    expect(src).toContain("const web = await webFareForClass(trainNumber, date, from, to, classCode, quotaCode);");
  });

  it("train list ka web fallback confirmtkt route board se pehle (phir erail)", () => {
    const ctIdx = src.indexOf("const ctWeb = await confirmTktTrainsBetween(query);");
    const erailIdx = src.indexOf("const web = await scrapeTrainsBetweenWeb(query.from, query.to);");
    expect(ctIdx).toBeGreaterThan(0);
    expect(erailIdx).toBeGreaterThan(ctIdx);
    expect(src).toContain('logServed("web_confirmtkt", "trainSearch", started, true,');
  });

  it("fare ka source bhi apne provider ka hota hai (mix nahi)", () => {
    expect(src).toContain("{ ...row, fare: web.fare, fareSource: web.source }");
  });
});

describe("Round-33 · board → train list mapping (timings + fare)", () => {
  const board = [
    { trainNumber: "22478", trainName: "VANDE BHARAT EXP", fromCode: "LDH", toCode: "NDLS", departure: "10:32", arrival: "14:00", trainType: "VB", classes: [{ code: "EC", status: "AVAILABLE", seats: 8, fare: 1830 }] },
    { trainNumber: "14682", trainName: "JUC DLI EXP", fromCode: "LDH", toCode: "NDLS", departure: "03:10", arrival: "09:35", trainType: "EXP", classes: [{ code: "2S", status: "AVAILABLE", seats: 431, fare: 160 }, { code: "CC", status: "AVAILABLE", seats: 5, fare: 540 }] },
    /* Timing nahi hai → list me nahi (aadha sach nahi) */
    { trainNumber: "99999", trainName: "NO TIMING", fromCode: "LDH", toCode: "NDLS", departure: null, arrival: null, trainType: null, classes: [] },
    /* Doosre station ki row (cluster search) → nahi */
    { trainNumber: "12345", trainName: "WRONG ORIGIN", fromCode: "DLI", toCode: "NDLS", departure: "05:00", arrival: "06:00", trainType: null, classes: [] },
  ];

  it("sirf sahi from/to + timing wali rows, departure ke hisaab se sorted", () => {
    const rows = boardRowsToTrainResults(board as never, { from: "LDH", to: "NDLS", date: "2026-09-27" });
    expect(rows.map((r) => r.number)).toEqual(["14682", "22478"]);
  });

  it("har train me timings + duration + class-wise fare", () => {
    const rows = boardRowsToTrainResults(board as never, { from: "LDH", to: "NDLS", date: "2026-09-27" });
    const vb = rows.find((r) => r.number === "22478");
    expect(vb?.departure).toBe("10:32");
    expect(vb?.arrival).toBe("14:00");
    expect(vb?.durationLabel).toBe("3h 28m");
    const exp = rows.find((r) => r.number === "14682");
    expect(exp?.classes.map((c) => `${c.code}:${c.fare}`)).toEqual(["2S:160", "CC:540"]);
    expect(exp?.durationLabel).toBe("6h 25m");
  });

  it("raat-paar wali train ka arrivalDayOffset", () => {
    const rows = boardRowsToTrainResults(
      [{ trainNumber: "12617", trainName: "NIGHT", fromCode: "LDH", toCode: "NDLS", departure: "23:50", arrival: "02:10", trainType: null, classes: [] }] as never,
      { from: "LDH", to: "NDLS", date: "2026-09-27" },
    );
    expect(rows[0].arrivalDayOffset).toBe(1);
  });

  it("0 rows / khaali board par kuch nahi", () => {
    expect(boardRowsToTrainResults([], { from: "LDH", to: "NDLS", date: "2026-09-27" })).toEqual([]);
  });
});

describe("Round-33 · model ko saare tools khule hain (sirf 2 cheezein mana)", () => {
  const src = read("server/agent/agentic.ts");

  it("rule 27: sab tools allowed, sirf IRCTC continue + passenger form nahi", () => {
    expect(src).toContain("27. SAARE TOOLS KHULE HAIN");
    expect(src).toContain("Continue to IRCTC");
    expect(src).toContain("passenger details/passenger form khud se bharna");
  });

  it("rule 28: plan → journey tools, alternative → FIND_ALTERNATIVE_TRAINS, list → timings+fare", () => {
    expect(src).toContain("28. SAWAAL KA MATLAB PEHLE");
    expect(src).toContain("FIND_ALTERNATIVE_TRAINS");
    expect(src).toContain("without fare and timings");
  });

  it("web search ka count cap hat gaya (no restriction)", () => {
    expect(src).not.toContain("Ek reply mein max 1 web search.");
    expect(src).toContain("search count ki koi limit nahi");
  });

  it("SEARCH_TRAINS ab passengers ka mohtaaj nahi (list tool)", () => {
    const gateStart = src.indexOf("PASSENGERS MISSING — kitne log");
    const gate = src.slice(Math.max(0, gateStart - 2500), gateStart);
    expect(gate).toContain('toolName === "JOURNEY_ANALYZE"');
    expect(gate).toContain('toolName === "FIND_ALTERNATIVE_TRAINS"');
    expect(gate).not.toContain('toolName === "SEARCH_TRAINS" ||');
    expect(src).toContain("SEARCH_TRAINS\n           * ek LIST tool hai — usme passengers ki zaroorat hi nahi");
  });

  it("'Kal,1' jaisa jawab seed hota hai (pichhle pax sawaal ke baad bare number)", () => {
    expect(src).toContain("lastAskedPax");
    expect(src).toContain("if (m) args.passengers = Number(m[1]);");
    expect(src).toContain("args.passengers !== \"number\"");
  });

  it("model ka samjha hua pax capture hota hai (agla turn dobara na poochhe)", () => {
    expect(src).toContain("input.capture.passengers = args.passengers;");
    const run = read("server/agent/run.ts");
    expect(run).toContain("if (!(ctx.paxProvided && ctx.passengers) && capture.passengers) {");
    expect(run).toContain("ctx.paxProvided = true;");
  });

  it("train list ke data me ab class-wise fares bhi jaate hain", () => {
    expect(src).toContain("fares: t.classes.filter((c) => c.fare > 0).map((c) => ({ code: c.code, fare: c.fare, source: c.source ?? null })),");
  });
});

describe("Round-33 · 'Kal,1' jaisa jawab (date + passengers ek saath)", () => {
  it("pichhla sawaal passengers ka tha → message ka akela number pax hai", () => {
    expect(userStatedPax("Kal,1", 1, { bareDigitIsPax: true })).toBe(true);
    expect(userStatedPax("Kal,1", 2, { bareDigitIsPax: true })).toBe(false);
    expect(userStatedPax("kal 1", 1, { bareDigitIsPax: true })).toBe(true);
  });

  it("bina pax-sawaal ke number ko pax nahi maanta (koi assumption nahi)", () => {
    expect(userStatedPax("Kal,1", 1, { bareDigitIsPax: false })).toBe(false);
    expect(userStatedPax("2", 2)).toBe(false);
  });

  it("date aur train number ke hisse pax nahi bante", () => {
    expect(userStatedPax("27-09-2026 ko 1", 1, { bareDigitIsPax: true })).toBe(true);
    expect(userStatedPax("12013 dekho", 1, { bareDigitIsPax: true })).toBe(false);
  });
});
