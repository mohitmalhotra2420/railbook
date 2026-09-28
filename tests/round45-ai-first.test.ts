/* ══ ROUND-45 (28 Sep 2026) — user ka explicit choice: FULL AI-FIRST.
 * Har sawaal pehle MODEL ke paas jaata hai (wo khud tools chunta hai); deterministic handlers sirf
 *   (a) AI off/unconfigured, ya
 *   (b) model fail/timeout, YA (c) model ka jawab us sawaal ka jawab hi na ho (khokhla) — rescue.
 * Accuracy > speed (user: "sahi jawab, chahe 10-20s lage").
 * Ye test us architecture ko lock karta hai: model ka SAHI jawab jaata hai, khokhle jawab par
 * verified deterministic (real tool data) jawab aata hai.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { runAgent, answerKind45, replyAdequateFor45 } from "../server/agent/run";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setScrapeFetch } from "../server/railway/webscrape";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";
import { setProvider } from "../server/providers/index";

const BAD_SUMMARY = "12013 · Amritsar Shtabdi (NDLS → ASR, 16:30 → 23:05).";

function scheduleMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const sched = url.pathname.match(/\/trains\/(\d+)\/schedule$/);
    if (sched && sched[1] === "12013") {
      return json(200, {
        success: true,
        data: {
          train_number: "12013", train_name: "AMRITSAR SHATABDI", running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], classes: ["CC", "EC"],
          stops: [
            { station_code: "NDLS", station_name: "NEW DELHI", arrival_time: null, departure_time: "16:30", day: 1 },
            { station_code: "UMB", station_name: "AMBALA CANTT JN", arrival_time: "19:20", departure_time: "19:25", day: 1 },
            { station_code: "LDH", station_name: "LUDHIANA JN", arrival_time: "20:16", departure_time: "20:19", day: 1 },
            { station_code: "ASR", station_name: "AMRITSAR JN", arrival_time: "23:05", departure_time: null, day: 1 },
          ],
        },
      });
    }
    const live = url.pathname.match(/\/trains\/(\d+)\/live$/);
    if (live && live[1] === "12013") {
      return json(200, {
        success: true,
        data: { train_number: "12013", train_name: "AMRITSAR SHATABDI", status: "Train starts at 16:30 — Train hasn't started yet. But all looks good.", current_station: null, next_station: "AMBALA CANTT JN", delay_minutes: null, journey_date: url.searchParams.get("date") ?? "" },
      });
    }
    return json(404, { success: false, error: { message: "unknown endpoint" } });
  });
}

describe("Round-45 · full AI-first + adequacy net", () => {
  beforeEach(() => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
    process.env.AI_OWNS_FLOW = "";
    setProvider(null);
    scheduleMock();
    setScrapeFetch(async () => new Response(JSON.stringify({ success: false }), { status: 500, headers: { "Content-Type": "application/json" } }));
  });
  afterEach(() => {
    setRailcoreFetch(null);
    setScrapeFetch(null);
    setAgenticNvidiaFetch(null);
    delete process.env.NVIDIA_API_KEY;
    process.env.RAILWAY_PROVIDER = "mock";
    process.env.RAILCORE_API_KEY = "";
    setProvider(null);
  });

  it("sawaal ki qism (seat / arrival / live) — general, per-question nahi", () => {
    expect(answerKind45("12054 haridwar ke liye seat check krna")).toBe("seat");
    expect(answerKind45("12013 ki seat availability batao")).toBe("seat");
    expect(answerKind45("At what time 12013 arrived ldh on 27 sept")).toBe("arrival");
    expect(answerKind45("12013 kal ludhiana kitne baje pahunchi thi ?")).toBe("arrival");
    expect(answerKind45("12013 haridwar par rukti hai kya")).toBe("arrival");
    expect(answerKind45("12054 late hai kya")).toBe("live");
    expect(answerKind45("12054 kahan hai abhi")).toBe("live");
    expect(answerKind45("Ludhiana se Amritsar kal ki trains batao")).toBe(null);
    expect(answerKind45("12013 ka poora timetable batao")).toBe(null);
  });

  it("jawab me ASLI data hai ya nahi — summary/khokhla jawab pakda jaata hai", () => {
    expect(replyAdequateFor45("arrival", BAD_SUMMARY, "12013 kal ludhiana kitne baje pahunchi thi ?")).toBe(false);
    expect(replyAdequateFor45("arrival", "Kahan jaana hai? Station bataiye.", "At what time 12013 arrived ldh on 27 sept")).toBe(false);
    expect(replyAdequateFor45("arrival", "12013 ka LDH arrival 20:16 hai (timetable se).", "12013 ka LDH arrival btao")).toBe(true);
    expect(replyAdequateFor45("arrival", "Nahi, 12013 Haridwar par nahi rukti — iska route NDLS → ASR hai.", "12013 haridwar par rukti hai kya")).toBe(true);
    expect(replyAdequateFor45("seat", "12054 · Hw Janshatabdi (ASR → HW, 06:50 → 13:50).", "12054 haridwar ke liye seat check krna")).toBe(false);
    expect(replyAdequateFor45("seat", "12054 (ASR → HW) — seat availability: 2S AVAILABLE 673, CC WL 20 ₹650.", "12054 haridwar ke liye seat check krna")).toBe(true);
    expect(replyAdequateFor45("live", "12054 late hai kya", "12054 late hai kya")).toBe(false);
    expect(replyAdequateFor45("live", "12054 aaj on time hai — delay 0 min, abhi Ambala City ke paas (10:46 IST).", "12054 late hai kya")).toBe(true);
  });

  it("AI-first: model ka SAHI jawab hi user tak jaata hai (deterministic preempt nahi karta)", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    setAgenticNvidiaFetch(async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "12013 ka LDH arrival 20:16 hai (timetable ke hisaab se)." } }], model: "test" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const r = await runAgent({ text: "12013 ka LDH arrival btao", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(r.engine).toBe("agentic_tool_calling");
    expect(String(r.reply ?? "")).toMatch(/20:16/);
  });

  it("AI-first: model khokhla jawab de (train summary) to verified deterministic jawab (rescue)", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    setAgenticNvidiaFetch(async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: BAD_SUMMARY } }], model: "test" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const r = await runAgent({ text: "12013 kal ludhiana kitne baje pahunchi thi ?", known: {}, now: "2026-09-28T01:40:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply).toMatch(/arrival 20:16/);
    expect(reply).not.toMatch(/NDLS → ASR, 16:30/);
  });

  it("AI-first: model FAIL (network) par bhi poora verified jawab (adhoora sawaal nahi)", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    setAgenticNvidiaFetch(async () => { throw new Error("network down"); });
    const r = await runAgent({ text: "12013 kal ludhiana kitne baje pahunchi thi ?", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(String(r.reply ?? "")).toMatch(/arrival 20:16/);
  });

  it("AI off (key nahi) → deterministic handlers hi chalte hain", async () => {
    const r = await runAgent({ text: "12013 kal ludhiana kitne baje pahunchi thi ?", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(r.engine).toBe("deterministic");
    expect(String(r.reply ?? "")).toMatch(/arrival 20:16/);
  });
});
