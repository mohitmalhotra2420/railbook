/* ══ ROUND-44 (28 Sep 2026) — user ke 3 screenshots: "particular station kitne baje pahuchi thi" ka
 * jawab teen baar galat/dhila aaya:
 *   1. "12013 ka ludhiana aarival kitne baje ka tha 27 sept ko" → theek (model ne timetable se bataya)
 *   2. "At what time 12013 arrived ldh on 27 sept" → "Kahan jaana hai? Station bataiye." ❌
 *   3. "12013 kal ludhiana kitne baje pahunchi thi ?" → live+history+timetable ka poora dump, jawab
 *      beech me chhupa, aur SELECT TRAIN card me MODEL-INSTRUCTION leak ("uska tool AB call karo") ❌
 * Fix (general, per-question patch nahi): arrival-at-station DETERMINISTIC jawab ab AI-first mode me bhi
 * chalta hai (guard: saaf arrival sawaal, koi seat/fare/book/live intent nahi) · typo-tolerant words
 * ("aarival") · user ka din (27 sept / kal / aaj) jawab me run-date ke saath · tool data me model ke liye
 * likhi instruction kabhi nahi (UI me dikh jaati thi).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runAgent, simpleArrivalQuestion, runDateLabel } from "../server/agent/run";
import { scrubInternalNotes } from "../server/agent/answerMode";
import { setRailcoreFetch } from "../server/railway/railcore";
import { setScrapeFetch } from "../server/railway/webscrape";
import { setAgenticNvidiaFetch } from "../server/agent/agentic";
import { setProvider } from "../server/providers/index";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

/* 12013 = NDLS → ASR (Amritsar Shatabdi), LDH stop #4: arrival 20:16 / departure 20:19. */
function scheduleMock(): void {
  setRailcoreFetch(async (input) => {
    const url = new URL(String(input));
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const sched = url.pathname.match(/\/trains\/(\d+)\/schedule$/);
    if (sched) {
      const num = sched[1];
      if (num !== "12013") return json(404, { success: false, error: { code: "NOT_FOUND" } });
      return json(200, {
        success: true,
        data: {
          train_number: "12013",
          train_name: "AMRITSAR SHATABDI",
          running_days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
          classes: ["CC", "EC"],
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
      const date = url.searchParams.get("date") ?? "";
      const status = date === "2026-09-27" ? "Journey completed" : "Train starts at 16:30 — Train hasn't started yet. But all looks good.";
      return json(200, {
        success: true,
        data: {
          train_number: "12013",
          train_name: "AMRITSAR SHATABDI",
          status,
          current_station: date === "2026-09-27" ? "AMRITSAR JN" : null,
          next_station: date === "2026-09-27" ? null : "AMBALA CANTT JN",
          delay_minutes: date === "2026-09-27" ? 0 : null,
          journey_date: date,
        },
      });
    }
    return json(404, { success: false, error: { message: "unknown endpoint" } });
  });
}

describe("Round-44 · arrival-at-station (koi bhi phrasing: Hindi/English/typo, past/present)", () => {
  beforeEach(() => {
    process.env.RAILWAY_PROVIDER = "railcore";
    process.env.RAILCORE_API_KEY = "rk_live_test";
    process.env.RAILKIT_API_KEY = "";
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

  it("screenshot 2: 'At what time 12013 arrived ldh on 27 sept' → seedha LDH arrival (route poochhna NAHI)", async () => {
    const r = await runAgent({ text: "At what time 12013 arrived ldh on 27 sept", known: {}, now: "2026-09-28T01:40:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply).toMatch(/LDH/);
    expect(reply).toMatch(/arrival 20:16/);
    expect(reply).toMatch(/27 Sep 2026/);
    expect(reply).not.toMatch(/Kahan jaana hai|Kahan se/i);
    expect(r.engine).toBe("deterministic");
  });

  it("screenshot 3: '12013 kal ludhiana kitne baje pahunchi thi ?' → wahi seedha jawab (live dump nahi)", async () => {
    const r = await runAgent({ text: "12013 kal ludhiana kitne baje pahunchi thi ?", known: {}, now: "2026-09-28T01:40:00+05:30" });
    const reply = String(r.reply ?? "");
    expect(reply).toMatch(/arrival 20:16/);
    expect(reply).toMatch(/27 Sep 2026/); /* kal = 27 Sep (IST) */
    expect(reply).not.toMatch(/STALE|Journey completed|SELECT TRAIN/i);
  });

  it("screenshot 1 (typo 'aarival') + station code + naam — sab ek hi deterministic jawab", async () => {
    for (const q of ["12013 ka ludhiana aarival kitne baje ka tha 27 sept ko", "12013 ka LDH arrival btao", "12013 ludhiana reach kab karegi"]) {
      const r = await runAgent({ text: q, known: {}, now: "2026-09-28T01:40:00+05:30" });
      expect(String(r.reply ?? ""), q).toMatch(/arrival 20:16/);
    }
  });

  it("R45: AI-first — model ka sahi jawab hi jaata hai (deterministic pehle nahi chalta)", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    setAgenticNvidiaFetch(async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "12013 ka LDH arrival 20:16 hai (Confirmed: timetable)." } }], model: "test" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const r = await runAgent({ text: "12013 ka LDH arrival btao", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(r.engine).toBe("agentic_tool_calling");
    expect(String(r.reply ?? "")).toMatch(/20:16/);
  });

  it("R45: model ka jawab ADHOORA ho (" + '"Kahan jaana hai?"' + ") to verified deterministic jawab (rescue)", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    setAgenticNvidiaFetch(async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Kahan jaana hai? Station bataiye." } }], model: "test" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const r = await runAgent({ text: "At what time 12013 arrived ldh on 27 sept", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(String(r.reply ?? "")).toMatch(/arrival 20:16/);
    expect(String(r.reply ?? "")).not.toMatch(/Kahan jaana hai/);
  });

  it("R45: model poora FAIL ho (network error) to bhi verified deterministic jawab", async () => {
    process.env.NVIDIA_API_KEY = "nvapi-test";
    setAgenticNvidiaFetch(async () => { throw new Error("network down"); });
    const r = await runAgent({ text: "12013 ludhiana arrival btao", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(String(r.reply ?? "")).toMatch(/arrival 20:16/);
    expect(String(r.reply ?? "")).not.toMatch(/Kahan jaana hai/);
  });

  it("mixed/doosre intent wale sawaal hijack nahi hote (model hi handle kare)", () => {
    expect(simpleArrivalQuestion("12013 ka LDH arrival btao")).toBe(true);
    expect(simpleArrivalQuestion("At what time 12013 arrived ldh")).toBe(true);
    for (const q of [
      "12013 ki seat availability ludhiana se",
      "12013 ludhiana kitne baje pahunchi aur seat milegi?",
      "12013 LDH par kitne baje rukti hai aur fare kya hai",
      "12013 kahan hai abhi",
      "12013 late hai kya",
      "Ludhiana se Amritsar jaane wali trains batao",
    ]) expect(simpleArrivalQuestion(q), q).toBe(false);
  });

  it("'X par rukti hai kya' → haan/na seedha (route dump nahi)", async () => {
    const yes = await runAgent({ text: "12013 LDH par rukti hai?", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(String(yes.reply ?? "")).toMatch(/haan, Ludhiana Jn \(LDH\) par rukti hai — arrival 20:16, departure 20:19/i);
    const no = await runAgent({ text: "12013 haridwar par rukti hai kya", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(String(no.reply ?? "")).toMatch(/nahi, HW par rukti nahi/i);
    expect(String(no.reply ?? "")).not.toMatch(/^1\. NDLS|stops\. Route:/);
  });

  it("binary: 'X pahunch gayi kya' live data se (aaj ka run start nahi hua / kal poora ho chuka)", async () => {
    const today = await runAgent({ text: "12013 LDH pahunch gayi kya", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(String(today.reply ?? "")).toMatch(/nahi, Ludhiana Jn \(LDH\) abhi nahi pahunchi/i);
    expect(String(today.reply ?? "")).toMatch(/16:30/);
    const yday = await runAgent({ text: "12013 kal ludhiana pahunch gayi thi kya", known: {}, now: "2026-09-28T01:40:00+05:30" });
    expect(String(yday.reply ?? "")).toMatch(/haan, Ludhiana Jn \(LDH\) pahunch chuki hai/i);
  });

  it("runDateLabel: 27 sept / kal / aaj / 27-09 sab sahi din", () => {
    const now = "2026-09-28T01:40:00+05:30"; /* IST 28 Sep */
    expect(runDateLabel("27 sept ko", now)).toBe("27 Sep 2026");
    expect(runDateLabel("kal ki run", now)).toBe("27 Sep 2026");
    expect(runDateLabel("aaj", now)).toBe("28 Sep 2026");
    expect(runDateLabel("27/09", now)).toBe("27 Sep 2026");
    expect(runDateLabel("parso", now)).toBe("26 Sep 2026");
    expect(runDateLabel("ldh arrival", now)).toBeNull();
  });
});

describe("Round-44 · internal instruction kabhi UI/reply me nahi", () => {
  it("SEARCH_TRAIN_BY_NUMBER data me model-instruction note nahi (TrainPicker note UI me dikhta hai)", () => {
    const src = read("server/agent/agentic.ts");
    expect(src).not.toContain("Train resolve ho gayi");
    expect(src).toContain("33. RESOLVE-ONLY RESULT"); /* guidance ab system prompt me (general rule) */
  });

  it("scrubInternalNotes aise instruction lines drop karta hai", () => {
    const dirty = "12013 · Amritsar Shatabdi (NDLS → ASR).\nTrain resolve ho gayi. User ne jo poochha (status/time/seat/fare) uska tool AB call karo — sirf confirm karke mat ruko.";
    const clean = scrubInternalNotes(dirty);
    expect(clean).toContain("12013 · Amritsar Shatabdi");
    expect(clean).not.toMatch(/tool AB call karo|mat ruko|Train resolve ho gayi/);
  });
});
