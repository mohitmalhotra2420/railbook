/* Round-16e (user screenshot 2026-09-08): "12014 yan 12498 kon si better hai
 * ludhiana ke liye" — pehli baar model ne 12498 ka NDLS arrival (22:30) Ludhiana
 * ka bata diya; 12498 LDH par rukti hi nahi. GET_TIMETABLE ka summary ab
 * deterministic bolta hai ki destination route par hai ya nahi. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setRailcoreFetch } from "../server/railway/railcore";
import { resetFallbackProvider } from "../server/railway/router";
import { executeApprovedTool } from "../server/agent/agentic";

const SCHEDULE = {
  "12498": {
    train_number: "12498", train_name: "Shan-e-Punjab Express", running_days: ["Mon"], classes: ["SL"], total_duration_minutes: 440,
    stops: [
      { station_code: "ASR", station_name: "Amritsar Jn", arrival_time: null, departure_time: "15:10", day: 1 },
      { station_code: "JUC", station_name: "Jalandhar City", arrival_time: "16:10", departure_time: "16:15", day: 1 },
      { station_code: "PGW", station_name: "Phagwara Jn", arrival_time: "16:35", departure_time: "16:37", day: 1 },
      { station_code: "UMB", station_name: "Ambala Cant", arrival_time: "19:30", departure_time: "19:40", day: 1 },
      { station_code: "NDLS", station_name: "New Delhi", arrival_time: "22:30", departure_time: null, day: 1 },
    ],
  },
  "12014": {
    train_number: "12014", train_name: "Shatabdi Express", running_days: ["Mon"], classes: ["CC"], total_duration_minutes: 367,
    stops: [
      { station_code: "ASR", station_name: "Amritsar Jn", arrival_time: null, departure_time: "04:55", day: 1 },
      { station_code: "LDH", station_name: "Ludhiana Jn", arrival_time: "06:57", departure_time: "07:02", day: 1 },
      { station_code: "NDLS", station_name: "New Delhi", arrival_time: "11:02", departure_time: null, day: 1 },
    ],
  },
} as const;

function json(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() } as unknown as Response;
}

describe("Round-16e: GET_TIMETABLE tells deterministically whether asked station is on the route", () => {
  const saved = { core: process.env.RAILCORE_API_KEY, kit: process.env.RAILKIT_API_KEY, prov: process.env.RAILWAY_PROVIDER };
  beforeEach(() => {
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    process.env.RAILWAY_PROVIDER = "railcore";
    resetFallbackProvider();
    setRailcoreFetch(async (url: any) => {
      const m = String(url).match(/\/trains\/(\d{5})\/schedule/);
      if (m && (SCHEDULE as any)[m[1]]) return json(200, { success: true, data: (SCHEDULE as any)[m[1]] });
      return json(404, { success: false, error: { code: "NOT_FOUND" } });
    });
  });
  afterEach(() => {
    setRailcoreFetch(null);
    process.env.RAILCORE_API_KEY = saved.core;
    process.env.RAILKIT_API_KEY = saved.kit;
    process.env.RAILWAY_PROVIDER = saved.prov;
  });

  it("destination NOT on route → summary says so explicitly (LDH not on 12498)", async () => {
    const r = await executeApprovedTool("GET_TIMETABLE", { train_number: "12498", destination: "LDH" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/LDH .*route par NAHI hai/);
    expect(r.summary).toMatch(/poora route, segment nahi/);
    expect(r.summary).not.toMatch(/→LDH/); // koi ASR→LDH segment nahi banna chahiye
    const data = r.data as { stationChecks: { code: string | null; onRoute: boolean }[] };
    expect(data.stationChecks).toEqual([{ ref: "LDH", code: "LDH", onRoute: false }]);
  });

  it("destination ON route → arrival/departure + segment from first stop", async () => {
    const r = await executeApprovedTool("GET_TIMETABLE", { train_number: "12014", destination: "LDH" });
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/LDH par RUKTI HAI \(stop #2\/3, arr 06:57, dep 07:02\)/);
    expect(r.summary).toMatch(/ASR→LDH 04:55→06:57 \(2h 02m\)/);
  });

  it("origin + destination both given → segment as before", async () => {
    const r = await executeApprovedTool("GET_TIMETABLE", { train_number: "12498", origin: "ASR", destination: "PGW" });
    expect(r.summary).toMatch(/ASR→PGW 15:10→16:35 \(1h 25m\)/);
    expect(r.summary).toMatch(/PGW par RUKTI HAI/);
  });
});
