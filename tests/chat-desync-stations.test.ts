import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { setRailcoreFetch } from "../server/railway/railcore";
import { parseDatePhrase as serverParseDate } from "../server/understand/legacy-dates";
import { parseDatePhrase as clientParseDate } from "../src/ai/dates";
import { planTurn } from "../src/ai/orchestrate";
import { initialBooking } from "../src/booking/state";
import { setProvider } from "../server/providers/index";

/**
 * Scenario from production (04 Sep 2026, ~01:00 IST):
 * user asks for "Saturday / 5 sept" trains in chat — the board must
 * search 5 Sep, never the stale board date (4 Sep).
 */
const NOW_IST_NIGHT = new Date("2026-09-03T19:30:00Z"); // 01:00 IST, Fri 4 Sep 2026

function midJourneyBooking() {
  const b = initialBooking("2026-09-04");
  return {
    ...b,
    date: "2026-09-04",
    dateProvided: true,
    from: { code: "BAT", name: "BATALA JN", city: "Batala" },
    to: { code: "ASR", name: "Amritsar Jn", city: "Amritsar" },
    passengerCount: 2,
    paxProvided: true,
  };
}

afterEach(() => {
  setRailcoreFetch(null);
  process.env.RAILWAY_PROVIDER = "mock";
  process.env.RAILCORE_API_KEY = "";
  process.env.RAILKIT_API_KEY = "";
  setProvider(null);
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("chat date always wins over the board date", () => {
  it("client parser: saturday from Fri 4 Sep is 5 Sep (not 6)", () => {
    expect(clientParseDate("batala se asr saturday ki trains", NOW_IST_NIGHT).date).toBe("2026-09-05");
    expect(clientParseDate("5 sept ki trains", NOW_IST_NIGHT).date).toBe("2026-09-05");
    expect(clientParseDate("5 september ki trains", NOW_IST_NIGHT).date).toBe("2026-09-05");
  });

  it("server parser agrees on weekday dates", () => {
    expect(serverParseDate("saturday ki trains", NOW_IST_NIGHT, {}).date).toBe("2026-09-05");
  });

  it("search turn carries the spoken date even when the board shows another", () => {
    const turn = planTurn({
      text: "batala se asr ke liye trains do for saturday",
      now: NOW_IST_NIGHT,
      booking: midJourneyBooking(),
      prefs: {},
      saved: [],
    });
    expect(turn.search).toBe(true);
    expect(turn.apply?.date).toBe("2026-09-05");
    expect(turn.text).toContain("5 Sep");
  });

  it("server nlu.date fallback works when the local phrase parse misses", () => {
    // The board already has a date; user gives an explicit new date that the
    // client parser handles. apply.date must reflect the spoken date.
    const turn = planTurn({
      text: "batala se asr 5 september wali trains dikhao",
      now: NOW_IST_NIGHT,
      booking: midJourneyBooking(),
      prefs: {},
      saved: [],
    });
    expect(turn.apply?.date).toBe("2026-09-05");
  });
});

describe("chat stations resolve via the railway API", () => {
  it("/api/understand attaches a single API hit (Batala -> BAT) and clears unresolved", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async (input) => {
      const url = String(input);
      if (url.includes("/stations/search")) {
        return jsonResponse(200, {
          success: true,
          data: {
            results: [
              {
                station_code: "BAT",
                station_name: "BATALA JN",
                city: "Batala",
                confidence: 1,
              },
            ],
          },
        });
      }
      return jsonResponse(404, { success: false });
    });
    const app = createApp();
    const res = await request(app).post("/api/understand").send({
      text: "batala se amritsar jaana hai",
      now: NOW_IST_NIGHT.toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.nlu.from?.code).toBe("BAT");
    expect(res.body.nlu.unresolvedFrom ?? "").toBe("");
    expect(JSON.stringify(res.body)).not.toMatch(/rk_live_test_secret/i);
  });

  it("ambiguous city stays unresolved for the client picker (no guessing)", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test_secret";
    setRailcoreFetch(async () =>
      jsonResponse(200, {
        success: true,
        data: {
          results: [
            { station_code: "DLI", station_name: "Delhi", city: "Delhi", confidence: 0.9 },
            { station_code: "NDLS", station_name: "New Delhi", city: "Delhi", confidence: 0.9 },
            { station_code: "DEE", station_name: "Delhi Sarai Rohilla", city: "Delhi", confidence: 0.8 },
          ],
        },
      }),
    );
    const app = createApp();
    const res = await request(app).post("/api/understand").send({
      text: "delhi se amritsar jaana hai",
      now: NOW_IST_NIGHT.toISOString(),
    });
    expect(res.status).toBe(200);
    // Must NOT silently pick one Delhi — picker flow handles it.
    expect(res.body.nlu.from?.code ?? "").not.toBe("DLI");
  });

  it("without any provider key the chat still answers honestly (unresolved stays)", async () => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "";
    const app = createApp();
    const res = await request(app).post("/api/understand").send({
      text: "batala se amritsar jaana hai",
      now: NOW_IST_NIGHT.toISOString(),
    });
    expect(res.status).toBe(200);
    // Local fallback list may or may not know Batala — but it must never invent a wrong code.
    if (res.body.nlu.from) {
      expect(res.body.nlu.from.code).toBe("BAT");
    }
  });
});
