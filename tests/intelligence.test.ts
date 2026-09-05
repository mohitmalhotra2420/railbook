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
