/* ══ INTELLIGENCE regression (user issue 2026-09-06, screenshot) ══════
 * "esko intelligent banao kyunki user kuch bhi pooch sakta hai — any
 * questions related to trains and railway" + web search fallback.
 * Screenshot ke 4 bugs:
 *   1. "12014 vs 12054 kon si better" → flat "data nahi mila" (compare hi nahi)
 *   2. "kon kon se 11 stops hai" → "Kahan se jana hai?" (journey slots!)
 *   3. "jaana nhi hai sirf details chahiye" → statement ko station samjha
 *   4. "poora timetable do" → sirf "11 stops" count, list kabhi nahi           */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runAgent } from "../server/agent/run";
import { executeTool } from "../server/agent/tools";
import { classifyFollowUp, isQuestionPhraseNotTrainName } from "../server/agent/context";
import { understand } from "../server/understand/legacy-nlu";
import { setAgenticNvidiaFetch, executeApprovedTool } from "../server/agent/agentic";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setWebFetch } from "../server/agent/websearch";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

setAgenticNvidiaFetch(async () => {
  throw new Error("model unavailable — deterministic path");
});

/* RailCore mock: 12014 (8 stops, 4h55m) + 12054 (11 stops, 5h15m) */
function railcoreMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    if (p.endsWith("/stations/search")) {
      return jsonResponse(200, { success: true, data: { results: [] } });
    }
    const sched = p.match(/\/trains\/(\d+)\/schedule$/);
    if (sched) {
      const num = sched[1];
      if (num === "12014") {
        return jsonResponse(200, {
          success: true,
          data: {
            train_number: "12014",
            train_name: "AMRITSAR SHATABDI",
            running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
            classes: ["CC", "EC"],
            total_duration_minutes: 295,
            stops: [
              { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "17:45", day: 1 },
              { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "19:33", departure_time: "19:35", day: 1 },
              { station_code: "UMB", station_name: "AMBALA CANT", arrival_time: "20:55", departure_time: "20:57", day: 1 },
              { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: "22:40", departure_time: null, day: 1 },
            ],
          },
        });
      }
      if (num === "12054") {
        return jsonResponse(200, {
          success: true,
          data: {
            train_number: "12054",
            train_name: "JAN SHATABDI EXPRESS",
            running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
            classes: ["2S", "CC"],
            total_duration_minutes: 315,
            stops: [
              { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "06:15", day: 1 },
              { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "07:58", departure_time: "08:00", day: 1 },
              { station_code: "UMB", station_name: "AMBALA CANT", arrival_time: "09:20", departure_time: "09:22", day: 1 },
              { station_code: "HW", station_name: "HARIDWAR JN", arrival_time: "11:30", departure_time: null, day: 1 },
            ],
          },
        });
      }
      return jsonResponse(200, { success: true, data: { train_number: num, train_name: `TRAIN ${num}`, running_days: ["MON"], stops: [] } });
    }
    return jsonResponse(404, { success: false, error: { message: "unknown endpoint" } });
  });
}

beforeEach(() => {
  process.env.RAILWAY_PROVIDER = "railcore";
  process.env.RAILCORE_API_KEY = "rk_live_test_secret";
});
afterEach(() => {
  setRailcoreFetch(null);
  setWebFetch(null);
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
});

describe("BUG 1: do trains compare — honest data-based verdict", () => {
  it("NLU: '12014 and 12054 mein se kon si better' → COMPARE_TRAINS + dono numbers", () => {
    const r = understand("Mujhe 12014 and 12054 mein se btao kon si better hai");
    expect(r.intent).toBe("COMPARE_TRAINS");
    expect(r.compareNumbers).toEqual(["12014", "12054"]);
  });

  it("deterministic compare: dono ka data + verdict + route-alag note", async () => {
    railcoreMock();
    const r = await runAgent({ text: "Mujhe 12014 and 12054 mein se btao kon si better hai", now: "2026-09-06T00:03:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).toMatch(/12014/);
    expect(reply, reply).toMatch(/12054/);
    expect(reply, reply).toMatch(/12014.*better|better.*12014|Time mein 12014/); // 295 < 315
    expect(reply, reply).toMatch(/route alag/i); // NDLS vs HW
  });

  it("ek train missing: doosre ka data + kaunsa nahi mila (cancel nahi)", async () => {
    railcoreMock();
    const r = await runAgent({ text: "12951 aur 12014 mein se konsi better hai", now: "2026-09-06T00:03:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).toMatch(/12014/);
    expect(reply, reply).toMatch(/12951 ki timetable nahi mil paayi/);
  });
});

describe("BUG 2+3: stops follow-up — journey slots NAHI", () => {
  it("classifyFollowUp: stops/route/har-stop patterns → timetable", () => {
    expect(classifyFollowUp("Kon kon se 11 stops hai")).toBe("timetable");
    expect(classifyFollowUp("har stop ka naam btao")).toBe("timetable");
    expect(classifyFollowUp("poora timetable do")).toBe("timetable");
    expect(classifyFollowUp("mujhe jaana nhi hai sirf 11 stops ki details chahiye")).toBe("timetable");
    expect(classifyFollowUp("ye train kahan kahan rukti hai")).toBe("timetable");
  });
});

describe("BUG 4: poora timetable = stops LIST (sirf count nahi)", () => {
  it("executeTool getTimetable: summary mein 'Route:' + har stop naam+time", async () => {
    railcoreMock();
    const r = await executeTool("getTimetable", { trainNumber: "12054" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/Route: 1\. ASR /);
    expect(r.summary).toMatch(/LDH/);
    expect(r.summary).toMatch(/HW/);
    expect(r.summary).toMatch(/arr 11:30/);
  });

  it("runAgent: '12054 ka poora timetable do' → reply mein stops list", async () => {
    railcoreMock();
    const r = await runAgent({ text: "12054 ka poora timetable do", now: "2026-09-06T00:03:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).toMatch(/Route: 1\. ASR/);
    expect(reply, reply).not.toMatch(/Kahan se jana hai/);
  });
});

describe("WEB SEARCH (last-resort fallback, user request 2026-09-06)", () => {
  it("WEB_SEARCH tool: results laata hai, 'web' source label ke saath", async () => {
    setWebFetch(async (url: any) => {
      if (String(url).includes("api.duckduckgo.com")) {
        return jsonResponse(200, {
          AbstractText: "Vande Bharat Express is a semi-high speed train service operated by Indian Railways.",
          AbstractURL: "https://en.wikipedia.org/wiki/Vande_Bharat_Express",
          Heading: "Vande Bharat Express",
        });
      }
      if (String(url).includes("wikipedia.org")) {
        return jsonResponse(200, { query: { search: [] } });
      }
      return jsonResponse(404, {});
    });
    const r = await executeApprovedTool("WEB_SEARCH", { query: "vande bharat express" });
    expect(r.ok).toBe(true);
    expect(r.source).toBe("web");
    expect(r.summary).toMatch(/UNVERIFIED/i);
    const data = r.data as { results: { title: string; snippet: string }[]; note?: string };
    expect(data.results[0].title).toMatch(/Vande Bharat/i);
    expect(data.note).toMatch(/web/i);
  });

  it("web se kuch na mile → honest fail (invent nahi)", async () => {
    setWebFetch(async () => jsonResponse(200, { query: { search: [] } }));
    const r = await executeApprovedTool("WEB_SEARCH", { query: "xyz unknown train" });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/kuch nahi mila/);
  });
});

/* ══ Screenshot 2026-09-06 fixes: general-fact questions + "kahan se kahan" ══ */
describe("GENERAL-FACT sawaal (screenshot 2026-09-06): flat denial nahi, WEB se jawab", () => {
  it("classifyFollowUp: 'kahan se kahan jaati hai' → timetable (route)", () => {
    expect(classifyFollowUp("Kahan se kahan jaati hai")).toBe("timetable");
    expect(classifyFollowUp("kahan se kahan jaati")).toBe("timetable");
    expect(classifyFollowUp("ye train kaha se kaha jaati hai")).toBe("timetable");
    expect(classifyFollowUp("कहां से कहां जाती है")).toBe("timetable");
  });

  it("runAgent: '12014 ki top speed' → web se jawab (flat denial NAHI)", async () => {
    railcoreMock();
    setWebFetch(async (url: any) => {
      const u = String(url);
      if (u.includes("api.duckduckgo.com")) {
        return jsonResponse(200, {
          AbstractText: "Amritsar Shatabdi operates at a maximum speed of 150 km/h.",
          AbstractURL: "https://en.wikipedia.org/wiki/Amritsar_Shatabdi",
          Heading: "Amritsar Shatabdi",
        });
      }
      if (u.includes("wikipedia.org")) return jsonResponse(200, { query: { search: [] } });
      return jsonResponse(404, {});
    });
    const r = await runAgent({ text: "12014 ki top speed kitni hai", now: "2026-09-06T00:03:00+05:30" });
    expect(String(r.reply)).toMatch(/web se mila|Web se mila/i);
    expect(String(r.reply)).toMatch(/150 km\/h|wikipedia|Source/i);
    expect(String(r.reply)).not.toMatch(/available nahi|evidence mein nahi/i);
  });

  it("runAgent: 'vande bharat ki top speed' → TRAIN_NAME hijack NAHI (kaunsi? nahi)", async () => {
    setWebFetch(async (url: any) => {
      const u = String(url);
      if (u.includes("api.duckduckgo.com")) {
        return jsonResponse(200, {
          AbstractText: "Vande Bharat trains have a maximum operating speed of 160 km/h.",
          AbstractURL: "https://en.wikipedia.org/wiki/Vande_Bharat_Express",
          Heading: "Vande Bharat Express",
        });
      }
      if (u.includes("wikipedia.org")) return jsonResponse(200, { query: { search: [] } });
      return jsonResponse(404, {});
    });
    const r = await runAgent({ text: "vande bharat ki top speed kya hai", now: "2026-09-06T00:03:00+05:30" });
    expect(String(r.reply)).toMatch(/web se mila|Web se mila|160 km\/h/i);
    expect(String(r.reply)).not.toMatch(/kaunsi|10 trains|kon si/i);
    expect(String(r.reply)).not.toMatch(/available nahi|evidence mein nahi/i);
  });

  it("runAgent follow-up: 'kahan se kahan jaati hai' → pichhli train ka route", async () => {
    railcoreMock();
    setWebFetch(null);
    const first = await runAgent({ text: "12054 ka poora timetable do", now: "2026-09-06T00:03:00+05:30" });
    expect(String(first.reply)).toMatch(/Route: 1\. ASR/);
    const second = await runAgent({ text: "Kahan se kahan jaati hai", context: first.context as never, known: {}, now: "2026-09-06T00:04:00+05:30" });
    expect(String(second.reply)).toMatch(/ASR|Route/i);
    expect(String(second.reply)).not.toMatch(/evidence mein nahi/i);
  });
});

/* BUG-fix 2026-09-06 (live e2e pakda): "kon kon se stops hai" par model ne
 * TRAIN_NAME_SEARCH("kon kon") karke KONKAN KANYA dhoondh li thi —
 * question-words train naam nahi hote. */
describe("TRAIN_NAME_SEARCH question-word guard", () => {
  it("'kon kon se stops' jaisi phrase par train search fail (naam nahi hai)", async () => {
    setWebFetch(null);
    const r = await executeApprovedTool("TRAIN_NAME_SEARCH", { query: "kon kon se stops hai" });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/train ka naam nahi lagta/i);
  });
});

/* Guard-safety: real train naam "stops" word ke saath block NAHI hona chahiye */
describe("question-phrase guard: naam vs question", () => {
  it("'shane punjab ki stops' = naam (guard pass)", () => {
    expect(isQuestionPhraseNotTrainName("shane punjab ki stops batao")).toBe(false);
    expect(isQuestionPhraseNotTrainName("shane punjab")).toBe(false);
  });
  it("'kon kon se stops hai' = question (guard block)", () => {
    expect(isQuestionPhraseNotTrainName("kon kon se stops hai")).toBe(true);
    expect(isQuestionPhraseNotTrainName("poora timetable do")).toBe(true);
    expect(isQuestionPhraseNotTrainName("mujhe jaana nhi hai sirf stops ki details chahiye")).toBe(true);
  });
  it("runAgent follow-up: 'kon kon se stops hai' → pichhli train ki list (KONKAN nahi)", async () => {
    railcoreMock();
    const first = await runAgent({ text: "12054 ka poora timetable do", now: "2026-09-06T00:03:00+05:30" });
    expect(String(first.reply)).toMatch(/Route: 1\. ASR/);
    const second = await runAgent({ text: "Kon kon se stops hai", context: first.context as never, known: {}, now: "2026-09-06T00:04:00+05:30" });
    const reply = String(second.reply ?? "");
    expect(reply, reply).not.toMatch(/KONKAN/i);
    expect(reply, reply).toMatch(/12054|Route|stops/i);
  });
});

/* ══ SCREENSHOT REGRESSION #2 (2026-09-06, Screenshot_20260906-115134) ══════
 * Bug (b): "12054 ki seat availability?" — train context mein tha, phir bhi
 *          "Train, date, stations aur class chahiye" (sab maanga). Ab sirf
 *          class poochna chahiye (date aaj default, stations auto-route).
 * Bug (c): "Date aaj ki ludhiana se hw ki" — NLU ne naya SEARCH_TRAIN banaya
 *          + "hw" (Haridwar) 2-letter code resolve nahi hua → "Kahan jaana
 *          hai?". Ab: hw→HW resolve + availability slot-RESUME. */

function railcoreAvailMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const p = url.pathname;
    if (p.endsWith("/stations/search")) {
      return jsonResponse(200, { success: true, data: { results: [] } });
    }
    const sched = p.match(/\/trains\/(\d+)\/schedule$/);
    if (sched && sched[1] === "12054") {
      return jsonResponse(200, {
        success: true,
        data: {
          train_number: "12054",
          train_name: "JAN SHATABDI EXPRESS",
          running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
          classes: ["2S", "CC"],
          total_duration_minutes: 315,
          stops: [
            { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: null, departure_time: "06:15", day: 1 },
            { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "07:58", departure_time: "08:00", day: 1 },
            { station_code: "HW", station_name: "HARIDWAR JN", arrival_time: "11:30", departure_time: null, day: 1 },
          ],
        },
      });
    }
    if (p.endsWith("/availability/seats")) {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (from === "LDH" && to === "HW") {
        /* RailCore real behavior: intermediate segment = NOT_FOUND */
        return jsonResponse(404, { success: false, error: { code: "NOT_FOUND", message: "Resource not found" } });
      }
      return jsonResponse(200, {
        success: true,
        data: {
          train_number: url.searchParams.get("train_number"),
          from_station_code: from,
          to_station_code: to,
          journey_date: url.searchParams.get("date"),
          quota: "GN",
          classes: [
            { class_code: "CC", status: "AVAILABLE", availability_text: "AVAILABLE 112", total_fare: 650 },
          ],
        },
      });
    }
    return jsonResponse(404, { success: false, error: { message: "unknown endpoint" } });
  });
}

describe("SCREENSHOT #2 (2026-09-06): availability UX + hw-code + slot-resume", () => {
  it("'ludhiana se hw ki' — 2-letter station code HW resolve hota hai", () => {
    const r = understand("ludhiana se hw ki train", { now: new Date("2026-09-06T11:51:00+05:30"), lastAsked: null, known: {} });
    expect(r.from?.code).toBe("LDH");
    expect(r.to?.code).toBe("HW");
  });

  it("bug (b): '12054 ki seat availability?' — sirf CLASS poochho, sab nahi", async () => {
    railcoreAvailMock();
    const r = await runAgent({ text: "12054 ki seat availability?", now: "2026-09-06T11:52:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).toMatch(/kaunsi class/i);
    expect(reply, reply).not.toMatch(/Train, date, stations aur class chahiye/i);
  });

  it("bug (c): 'Date aaj ki ludhiana se hw ki' — availability RESUME, 'Kahan jaana hai?' nahi", async () => {
    railcoreAvailMock();
    const t2 = await runAgent({ text: "12054 ki seat availability?", now: "2026-09-06T11:52:00+05:30" });
    const t3 = await runAgent({
      text: "Date aaj ki ludhiana se hw ki",
      context: t2.context as never,
      known: {},
      now: "2026-09-06T11:53:00+05:30",
    });
    const reply = String(t3.reply ?? "");
    expect(reply, reply).toMatch(/12054/);
    expect(reply, reply).toMatch(/kaunsi class/i);
    expect(reply, reply).not.toMatch(/Kahan jaana|station bataiye/i);
    expect(t3.context?.origin?.code).toBe("LDH");
    expect(t3.context?.destination?.code).toBe("HW");
  });

  it("T4 'CC' — availability aati hai + LDH→HW NOT_FOUND par ASR→HW segment-fallback label", async () => {
    railcoreAvailMock();
    const t2 = await runAgent({ text: "12054 ki seat availability?", now: "2026-09-06T11:52:00+05:30" });
    const t3 = await runAgent({
      text: "Date aaj ki ludhiana se hw ki",
      context: t2.context as never,
      known: {},
      now: "2026-09-06T11:53:00+05:30",
    });
    const t4 = await runAgent({ text: "CC", context: t3.context as never, known: {}, now: "2026-09-06T11:54:00+05:30" });
    const reply = String(t4.reply ?? "");
    expect(reply, reply).toMatch(/12054 CC: AVAILABLE/i);
    expect(reply, reply).toMatch(/ASR→HW/);
    expect(reply, reply).toMatch(/LDH→HW segment ka direct data nahi/i);
  });
});

/* ══ SCREENSHOT REGRESSION #3 (2026-09-06, Screenshot_20260906-165721) ══════
 * "12054 ki top speed btana" → (1) agentic ne GET_TIMETABLE chala diya
 * (timetable dikha, speed ka jawab nahi); (2) web-search se pehla result
 * "List of production car speed records" (Wikipedia) — bilkul irrelevant —
 * unfiltered chala gaya; (3) web timeout par reply EMPTY — client fallthrough
 * "Kahan se kahan jaana hai?" dikhata tha. */

describe("SCREENSHOT #3 (2026-09-06): top speed — tool-block + irrelevant-web-filter + never-empty", () => {
  it("irrelevant web results (car speed records) reject — honest jawab, car-wala NAHI", async () => {
    railcoreMock();
    setWebFetch(async (url: any) => {
      const u = String(url);
      if (u.includes("api.duckduckgo.com")) {
        return jsonResponse(200, {
          AbstractText: "",
          AbstractURL: "",
          Heading: "",
        });
      }
      if (u.includes("wikipedia.org")) {
        return jsonResponse(200, {
          query: {
            search: [
              {
                title: "List of production car speed records",
                snippet:
                  "This is a list of the world's record-breaking top speeds achieved by street-legal production cars (as opposed to concept cars or modified cars).",
                url: "https://en.wikipedia.org/wiki/List_of_production_car_speed_records",
              },
            ],
          },
        });
      }
      return jsonResponse(404, {});
    });
    const r = await runAgent({ text: "12054 ki top speed btana", now: "2026-09-06T16:57:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, "reply kabhi empty nahi").toMatch(/.+/);
    expect(reply, reply).not.toMatch(/production car|street-legal/i);
    expect(reply, reply).toMatch(/nahi mil paya|guess nahi/i);
  });

  it("web timeout / 0 results par EMPTY nahi — honest denial", async () => {
    railcoreMock();
    setWebFetch(async () => {
      throw new Error("network timeout");
    });
    const r = await runAgent({ text: "12054 ki top speed btana", now: "2026-09-06T16:57:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, "reply kabhi empty nahi").toMatch(/.+/);
    expect(reply, reply).toMatch(/nahi mil paya/i);
  });

  it("complaint follow-up ('Maine to top speed poochi hai lekin') par 'Kahan se kahan jaana hai?' NAHI", async () => {
    railcoreMock();
    setWebFetch(async () => {
      throw new Error("network timeout");
    });
    const t1 = await runAgent({ text: "12054 ki top speed btana", now: "2026-09-06T16:57:00+05:30" });
    const t2 = await runAgent({
      text: "Maine to top speed poochi hai lekin",
      context: t1.context as never,
      known: {},
      now: "2026-09-06T16:58:00+05:30",
    });
    const reply = String(t2.reply ?? "");
    expect(reply, "reply kabhi empty nahi").toMatch(/.+/);
    expect(reply, reply).not.toMatch(/Kahan se kahan jaana|station bataiye/i);
    expect(reply, reply).toMatch(/top speed|nahi mil paya/i);
  });

  it("railway-relevant web result ab bhi aata hai (filter overreach nahi)", async () => {
    railcoreMock();
    setWebFetch(async (url: any) => {
      const u = String(url);
      if (u.includes("api.duckduckgo.com")) {
        return jsonResponse(200, {
          AbstractText: "The Gatimaan Express is India's fastest train with a top speed of 160 km/h.",
          AbstractURL: "https://en.wikipedia.org/wiki/Gatimaan_Express",
          Heading: "Gatimaan Express",
        });
      }
      if (u.includes("wikipedia.org")) return jsonResponse(200, { query: { search: [] } });
      return jsonResponse(404, {});
    });
    const r = await runAgent({ text: "gatimaan ki top speed kitni hai", now: "2026-09-06T16:57:00+05:30" });
    expect(String(r.reply)).toMatch(/160 km\/h/);
  });
});

/* ══ CHATGPT-JAISA SOURCE-SCRAPE (user request 2026-09-06: "jo sites ChatGPT
 * use karta hai wahi — question ke according khud scrape karo"). Train ka
 * Wikipedia page (e.g. "Haridwar–Amritsar Jan Shatabdi Express") — question-
 * relevant paragraph, number-verified (galat Una-Link page reject). */

import { findWikipediaPage } from "../server/agent/websearch";

describe("ChatGPT-jaisa train-page scrape (Wikipedia page, number-verified)", () => {
  it("findWikipediaPage: mustInclude galat pehli hit ko reject karke sahi page deta hai", async () => {
    setWebFetch(async (url: any) => {
      const u = String(url);
      if (u.includes("srsearch=Hw+Janshatabdi+12054") || u.includes("srsearch=Hw%20Janshatabdi%2012054") || u.includes("srsearch=")) {
        return jsonResponse(200, {
          query: {
            search: [
              { title: "Haridwar–Una Link Janshatabdi Express" },
              { title: "Haridwar–Amritsar Jan Shatabdi Express" },
            ],
          },
        });
      }
      if (u.includes("titles=Haridwar")) {
        const isUna = u.includes("Una");
        return jsonResponse(200, {
          query: {
            pages: {
              p1: {
                title: isUna ? "Haridwar–Una Link Janshatabdi Express" : "Haridwar–Amritsar Jan Shatabdi Express",
                extract: isUna ? "The Una Link train runs elsewhere. " + "x".repeat(200) : "The 12054/12053 Amritsar–Haridwar Jan Shatabdi Express covers 407 km with average speed above 55 km/h as per Indian Railways rules. " + "y".repeat(150),
              },
            },
          },
        });
      }
      return jsonResponse(404, {});
    });
    const p = await findWikipediaPage("Hw Janshatabdi 12054", "12054");
    expect(p).not.toBeNull();
    expect(p!.title).toBe("Haridwar–Amritsar Jan Shatabdi Express");
    expect(p!.extract).toContain("12054");
  });

  it("'12054 ki top speed' par train-page ka speed-paragraph (car records nahi)", async () => {
    railcoreMock();
    setWebFetch(async (url: any) => {
      const u = String(url);
      if (u.includes("srsearch=")) {
        return jsonResponse(200, { query: { search: [{ title: "Haridwar–Amritsar Jan Shatabdi Express" }] } });
      }
      if (u.includes("titles=")) {
        return jsonResponse(200, {
          query: {
            pages: {
              p1: {
                title: "Haridwar–Amritsar Jan Shatabdi Express",
                extract:
                  "The 12054/12053 Amritsar–Haridwar Jan Shatabdi Express is a Superfast Express train.\n\nService\nIt covers the distance of 407 kilometres at an average speed above 55 km/h, so its fare includes a Superfast surcharge.",
              },
            },
          },
        });
      }
      return jsonResponse(404, {});
    });
    const r = await runAgent({ text: "12054 ki top speed btana", now: "2026-09-06T17:05:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).toMatch(/Haridwar–Amritsar Jan Shatabdi Express/);
    expect(reply, reply).toMatch(/407 kilomet|55 km\/h/i);
    expect(reply, reply).not.toMatch(/production car/i);
    expect(reply, reply).toMatch(/web-scrape/i);
  });
});

/* ══ SCREENSHOT REGRESSION #4 (2026-09-06, Screenshot_20260906-181539) ══════
 * "Sleeper class kya hota hai train mein" → "web se nahi mil paya" (web
 * query bigdi thi) + "2s class kya hoti hai" → booking slot-ask ("Kahan se
 * jaana hai?"). User: "AI ke paas har cheez ka answer ho — railway ka kuch
 * bhi pooch sakta hai". */

describe("SCREENSHOT #4 (2026-09-06): railway-knowledge KB + class-questions booking nahi", () => {
  it("'Sleeper class kya hota hai train mein' → KB se instant jawab (web fail nahi)", async () => {
    setWebFetch(async () => {
      throw new Error("network timeout");
    });
    const r = await runAgent({ text: "Sleeper class kya hota hai train mein", now: "2026-09-06T18:15:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).toMatch(/Sleeper class \(SL\)/i);
    expect(reply, reply).toMatch(/non-AC sleeper coach/i);
    expect(reply, reply).not.toMatch(/nahi mil paya/i);
  });

  it("'2s class kya hoti hai' → KB jawab, 'Kahan se jaana hai?' NAHI (booking-slot galti nahi)", async () => {
    setWebFetch(async () => {
      throw new Error("network timeout");
    });
    const r = await runAgent({ text: "2s class kya hoti hai", now: "2026-09-06T18:15:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).toMatch(/Second Sitting/i);
    expect(reply, reply).not.toMatch(/Kahan se jaana|Departure station bataiye/i);
  });

  it("tatkal/rac/gnwl/chart concepts — KB se turant", async () => {
    setWebFetch(async () => {
      throw new Error("network timeout");
    });
    for (const [q, re] of [
      ["tatkal quota kya hota hai", /1 din pehle/i],
      ["rac kya hota hai", /Reservation Against Cancellation/i],
      ["gnwl kya hota hai", /GNWL/i],
      ["chart kab banta hai", /Reservation Chart/i],
      ["ac coach mein blanket milti hai kya", /Bedding/i],
    ] as const) {
      const r = await runAgent({ text: q, now: "2026-09-06T18:15:00+05:30" });
      expect(String(r.reply ?? ""), q).toMatch(re);
    }
  });

  it("REAL search ab bhi hota hai — class-question guard overreach nahi", async () => {
    railcoreMock();
    const r = await runAgent({ text: "amritsar se new delhi ki train dikhao", now: "2026-09-06T18:15:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply, reply).not.toMatch(/sawaal main theek se samajh nahi/i);
  });
});
