/* ══ VOICE AGENT R1 — ACCEPTANCE TESTS (naye, additive) ════════════════════════════════════════════════
 * User (R1 brief, section 20) ne 18 acceptance cheezein maangi hain. Ye file unhe hi verify karti hai —
 * aur khaas baat: is file me koi naya AI/railway logic nahi likha gaya; jo chalta hai wo sab maujooda
 * system hai jo voice layer ke through chal raha hai:
 *
 *   voice layer (naya)  →  src/voice/voiceAgent.ts + voiceSession.ts
 *   existing agent      →  src/ai/aiBookingFlow.ts  (R62/R62c/R63 ka wahi flow, badla nahi)
 *   existing TTS        →  src/voice/aiBookingVoice.ts (R62 adapter, badla nahi)
 *   existing server TTS →  server/voice/tts.ts (openai-edge-tts compatible base URL)
 *
 * Koi maujooda test file is liye touch nahi ki gayi — 18-number ka check "existing suites unchanged +
 * passing" alag se CHECK run me hota hai (wahi files, wahi expectations).
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import request from "supertest";

import {
  aiBookingClassSelected,
  aiBookingFinalPrompt,
  aiBookingStart,
  aiBookingTrainsReady,
  aiBookingTurn,
  type AiBookingState,
  type AiBookingTurn,
} from "../src/ai/aiBookingFlow";
import { createAiBookingVoice, voiceLinesFor } from "../src/voice/aiBookingVoice";
import { createVoiceAgent, type VoiceInputAdapter, type VoiceOutputAdapter } from "../src/voice/voiceAgent";
import { useVoiceInput } from "../src/voice/useVoiceInput";
import { createApp } from "../server/app";
import type { ClassAvailability, TrainResult } from "../src/types";

const NOW = new Date(2026, 8, 30); // 30 Sep 2026

/* ── fixtures: ASLI shapes (maujooda board ka data jaisa) ─────────────────────────────────────────── */

const board: TrainResult[] = [
  {
    number: "12014",
    name: "AMRITSAR SHTABDI",
    type: "S",
    from: { code: "ASR", name: "Amritsar Junction", city: "Amritsar" },
    to: { code: "NDLS", name: "New Delhi", city: "Delhi" },
    date: "2026-10-06",
    classes: [
      { code: "CC", classCode: "CC", label: "AC Chair Car", status: "AVAILABLE", fare: 1060, seats: 413 },
      { code: "EC", classCode: "EC", label: "Executive Chair Car", status: "AVAILABLE", fare: 2010, seats: 40 },
    ],
  } as unknown as TrainResult,
];
const cc = board[0].classes![0] as ClassAvailability;

/* ── fakes: input/output adapters (maujooda adapters ka wahi contract) ───────────────────────────── */

function fakeInput(startError: string | null = null) {
  const calls = { start: 0, stop: 0, cancel: 0 };
  let listening = false;
  const adapter: VoiceInputAdapter & { emit: (t: string) => void } = {
    async start() {
      calls.start += 1;
      if (!startError) listening = true;
      return startError;
    },
    stop() {
      calls.stop += 1;
      listening = false;
    },
    cancel() {
      calls.cancel += 1;
      listening = false;
    },
    listening: () => listening,
    emit: () => undefined, // test me handler seedha agent.submit() se bulata hai
  };
  return { adapter, calls };
}

function fakeOutput() {
  const spoken: string[] = [];
  const calls = { stop: 0 };
  const listeners = new Set<(s: "speaking" | "idle") => void>();
  const adapter: VoiceOutputAdapter = {
    speak: (t) => spoken.push(t),
    stop: () => {
      calls.stop += 1;
      for (const l of listeners) l("idle");
    },
    onState: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { adapter, spoken, calls, emitState: (s: "speaking" | "idle") => { for (const l of listeners) l(s); } };
}

/** Voice agent + ASLI AI Booking flow (handler me voice ka koi role nahi — existing agent hi hai). */
function harness(startError: string | null = null) {
  const input = fakeInput(startError);
  const output = fakeOutput();
  let state: AiBookingState = aiBookingStart(NOW).state;
  const turns: AiBookingTurn[] = [];
  const agent = createVoiceAgent({
    input: input.adapter,
    output: output.adapter,
    onTranscript: (text) => {
      const turn = aiBookingTurn(state, text, { now: NOW, trains: board, classes: board[0].classes as ClassAvailability[] });
      state = turn.state;
      turns.push(turn);
      /* Maujooda view bhi yahi karta hai: agent ke jawab ki lines bolna. */
      if (turn.say.length) agent.speak(turn.say);
    },
  });
  return {
    agent,
    input,
    output,
    turns,
    state: () => state,
    setState: (s: AiBookingState) => {
      state = s;
    },
    lastSay: () => turns.at(-1)?.say.join(" | ") ?? "",
  };
}

/* ── 1–2: maujooda STT (useVoiceInput) — mic start + transcript ──────────────────────────────────── */

class FakeRecognition {
  static last: FakeRecognition | null = null;
  static made = 0;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
    FakeRecognition.made += 1;
  }
  start() {
    this.started = true;
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
}

describe("Voice Agent R1 — acceptance", () => {
  beforeEach(() => {
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    (window as unknown as { isSecureContext?: boolean }).isSecureContext = true;
  });
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("1) microphone starts — maujooda hook mic shuru karta hai (background listening nahi)", async () => {
    const heard: string[] = [];
    const { result } = renderHook(() => useVoiceInput((t) => heard.push(t), () => undefined, { manualCommit: true, greet: false }));
    const err = await result.current.start();
    expect(err).toBeNull();
    expect(FakeRecognition.last?.started).toBe(true);
    await waitFor(() => expect(result.current.listening).toBe(true));
    /* Mic sirf isi explicit call par chala — background me koi doosra recognizer nahi banta. */
    result.current.cancel();
    await waitFor(() => expect(result.current.listening).toBe(false));
    expect(FakeRecognition.made).toBe(1);
  });

  it("2) speech becomes transcript — wahi text jo typed message banta hai", async () => {
    const heard: string[] = [];
    const { result } = renderHook(() => useVoiceInput((t) => heard.push(t), () => undefined, { manualCommit: true, greet: false }));
    await result.current.start();
    const rec = FakeRecognition.last!;
    rec.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "Mujhe Amritsar se New Delhi jaana hai" }, length: 1 }],
    });
    result.current.commit();
    expect(heard.join(" ")).toMatch(/Amritsar se New Delhi/);
  });

  /* ── 3–12: poora booking journey voice se — sab maujooda agent/flow se ─────────────────────────── */

  it("3) transcript reaches the EXISTING AI Booking Agent (koi voice-only brain nahi)", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    const s = h.state();
    expect(s.from?.code).toBe("ASR");
    expect(s.to?.code).toBe("NDLS");
    expect(s.stage).toBe("COLLECT_JOURNEY");
    expect(h.lastSay()).toMatch(/Kis date ko jaana hai/);
  });

  it("4) existing agent ka jawab bola jaata hai (source of truth wahi)", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    expect(h.output.spoken.length).toBeGreaterThan(0);
    /* Jo lines agent ne di, wahi (chhota kar ke) boli gayi — koi naya content nahi. */
    const last = h.turns.at(-1)!.say.at(-1)!;
    expect(h.output.spoken.join(" ")).toContain(last.replace(/[✅👍😊🙏]/gu, "").trim().split(" ").slice(0, 4).join(" "));
  });

  it("5) existing train search voice se chalti hai (SEARCH action wahi maujooda flow ka)", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    await h.agent.submit("6 October, 2 log");
    const turn = h.turns.at(-1)!;
    const search = turn.actions[0];
    expect(search.type).toBe("SEARCH");
    expect(search).toMatchObject({ from: { code: "ASR" }, to: { code: "NDLS" }, date: "2026-10-06", pax: 2 });
    /* Asli result aane par wahi purana flow trains dikhata hai. */
    const ready = aiBookingTrainsReady(h.state(), board);
    expect(ready.say.join(" ")).toMatch(/Kaunsi train leni hai/);
    expect(ready.say.join(" ")).toContain("12014 AMRITSAR SHTABDI");
  });

  it("6) alternatives bhi maujooda agent hi handle karta hai — conversation reset nahi hota", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    await h.agent.submit("6 October, 2 log");
    h.setState(aiBookingTrainsReady(h.state(), board).state);
    const before = h.state();

    await h.agent.submit("ye nahi chahiye, alternative dikhao");
    const after = h.state();

    /* Journey slots waise hi (voice ne kuch reset nahi kiya) aur list wahi asli board ki hai. */
    expect(after.from?.code).toBe(before.from?.code);
    expect(after.to?.code).toBe(before.to?.code);
    expect(after.date).toBe(before.date);
    expect(after.stage).toBe("SHOW_TRAIN_OPTIONS");
    expect(after.trainNumber).toBeNull();
    /* Koi banayi hui alternative nahi — maujooda agent ka jawab hi source of truth. */
    expect(h.lastSay()).toMatch(/12014 AMRITSAR SHTABDI/);
    expect(h.output.spoken.length).toBeGreaterThan(0);
  });

  it("7) train selection voice se (\"12014 wali\") — maujooda matcher", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    await h.agent.submit("6 October, 2 log");
    h.setState(aiBookingTrainsReady(h.state(), board).state);
    await h.agent.submit("12014 wali");
    expect(h.state().trainNumber).toBe("12014");
    expect(h.state().stage).toBe("CLASS_SELECTION");
    expect(h.lastSay()).toMatch(/CC \(AC Chair Car\)/);
  });

  it("8) availability voice se — board ka asli status hi bola jaata hai", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    await h.agent.submit("6 October, 2 log");
    h.setState(aiBookingTrainsReady(h.state(), board).state);
    await h.agent.submit("12014 wali");
    h.setState(aiBookingTurn(h.state(), "CC", { classes: board[0].classes as ClassAvailability[] }).state);

    const turn = aiBookingClassSelected(h.state(), cc, cc, { food: false });
    h.setState(turn.state);
    h.agent.speak(turn.say);

    expect(turn.say.join(" ")).toContain("AVL 413"); // board ka asli status (voice me aakhri lines jaati hain)
    expect(h.state().stage).toBe("PASSENGER_COLLECTION");
    /* speak() sirf bolta hai — flow/state ko chhua nahi jaata. */
    expect(h.state().stage).toBe("PASSENGER_COLLECTION");
    expect(h.output.spoken.join(" ")).toMatch(/passenger form khol rahi hoon/);
  });

  it("9) passenger flow voice se — ek-ek detail, maujooda parsing", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    await h.agent.submit("6 October, 2 log");
    h.setState(aiBookingTrainsReady(h.state(), board).state);
    await h.agent.submit("12014 wali");
    h.setState(aiBookingClassSelected(aiBookingTurn(h.state(), "CC", { classes: board[0].classes as ClassAvailability[] }).state, cc, cc, { food: false }).state);

    await h.agent.submit("Rahul Sharma, 31, male, window");
    const d = h.state().drafts[0];
    expect(d.name).toBe("Rahul Sharma");
    expect(d.age).toBe("31");
    expect(d.gender).toBe("MALE");
    expect(d.berthPreference).toBe("Window");
    expect(h.lastSay()).toMatch(/Passenger 2 ka naam/);
  });

  it("10) fare/review voice se — fare wahi jo review screen par hai (invent nahi)", async () => {
    const h = harness();
    const s: AiBookingState = {
      ...aiBookingStart(NOW).state,
      stage: "PASSENGER_REVIEW",
      from: board[0].from,
      to: board[0].to,
      date: "2026-10-06",
      pax: 1,
      trainNumber: "12014",
      trainName: "AMRITSAR SHTABDI",
      classCode: "CC",
      drafts: [{ name: "Rahul Sharma", age: "31", gender: "MALE", berthPreference: "Window" }],
    };
    h.setState(s);
    const turn = aiBookingFinalPrompt(h.state(), cc.fare ?? null);
    h.setState(turn.state);
    h.agent.speak(turn.say);
    const spoken = h.output.spoken.join(" ");
    expect(spoken).toMatch(/final details hain/i);
    /* Fare asli hi hai (board/review screen se) aur bolne me bhi wahi maujooda strip chalti hai. */
    expect(turn.say.join(" ")).toMatch(/₹1,060/);
    expect(spoken).toBe(voiceLinesFor(turn.say, 2).join(" "));
    expect(h.state().stage).toBe("FINAL_CONFIRMATION");
  });

  it("11) confirmation flow voice se — 'haan' ke bina handoff nahi", async () => {
    const h = harness();
    h.setState({ ...aiBookingStart(NOW).state, stage: "FINAL_CONFIRMATION", awaiting: "confirm", from: board[0].from, to: board[0].to, date: "2026-10-06", pax: 1, classCode: "CC" });

    await h.agent.submit("haan");
    const turn = h.turns.at(-1)!;
    expect(turn.actions.filter((a) => a.type === "IRCTC_HANDOFF")).toHaveLength(1);
    expect(h.lastSay()).toMatch(/Login \/ OTP \/ payment aap hi/);
    h.agent.speak(turn.say);
    expect(h.output.spoken.join(" ")).toMatch(/Continue to IRCTC/);
  });

  it("12) booking (IRCTC handoff) sirf explicit confirm par — koi auto/dummy booking nahi", async () => {
    const h = harness();
    const base: AiBookingState = { ...aiBookingStart(NOW).state, stage: "FINAL_CONFIRMATION", awaiting: "confirm", from: board[0].from, to: board[0].to, date: "2026-10-06", pax: 1, classCode: "CC" };

    /* Bina confirmation kuch nahi hota. */
    h.setState(base);
    await h.agent.submit("kuch aur batao");
    expect(h.turns.at(-1)!.actions.some((a) => a.type === "IRCTC_HANDOFF")).toBe(false);

    /* Confirmation par wahi maujooda handoff action (asli IRCTC backend/extension isse aage chalta hai). */
    h.setState({ ...base, awaiting: "confirm" });
    await h.agent.submit("haan");
    expect(h.turns.at(-1)!.actions.some((a) => a.type === "IRCTC_HANDOFF")).toBe(true);
  });

  /* ── 13–17: interruption, switching, failure isolation ────────────────────────────────────────── */

  it("13) interruption: bolte waqt mic tap → audio rukti hai, conversation nahi", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    const before = { ...h.state() };

    h.output.emitState("speaking");
    expect(h.agent.state().isSpeaking).toBe(true);
    await h.agent.startListening(); // mic tap = interruption

    expect(h.output.calls.stop).toBeGreaterThan(0);
    expect(h.agent.state().isSpeaking).toBe(false);
    expect(h.input.calls.start).toBe(1);
    /* Booking state bilkul waisi hi — koi reset nahi. */
    expect(h.state().from?.code).toBe(before.from?.code);
    expect(h.state().to?.code).toBe(before.to?.code);
    expect(h.state().stage).toBe(before.stage);
  });

  it("14) voice → text: wahi ek context chalta rehta hai", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai"); // voice
    await h.agent.submit("6 October, 2 log"); // text (typing bhi same handler)
    expect(h.state().date).toBe("2026-10-06");
    expect(h.state().pax).toBe(2);
    expect(h.state().from?.code).toBe("ASR");
  });

  it("15) text → voice: pehle type kiya tha, phir bola — context nahi toota", async () => {
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    /* Ab user mic dabata hai aur bolta hai — transcript usi state par lagta hai. */
    await h.agent.startListening();
    await h.agent.submit("6 October, 1 passenger");
    expect(h.state().date).toBe("2026-10-06");
    expect(h.state().pax).toBe(1);
    expect(h.lastSay()).toMatch(/available trains check/i);
  });

  it("16) TTS fail → text booking chalti rehti hai (device voice fallback, koi throw nahi)", async () => {
    const browserSpeak = vi.fn();
    const voice = createAiBookingVoice({
      fetchConfig: vi.fn(async () => ({ provider: "openai", serverTts: true, model: "tts-1", languages: ["hi-IN"] })),
      fetchTts: vi.fn(async () => {
        throw new Error("provider down");
      }),
      play: vi.fn(async () => undefined),
      stopPlayback: vi.fn(),
      browserSpeak,
      browserStop: vi.fn(),
    });
    await voice.loadProvider();
    expect(() => voice.speak("Bilkul, main check kar rahi hoon.")).not.toThrow();
    await vi.waitFor(() => expect(browserSpeak).toHaveBeenCalled());

    /* Aur usi waqt text flow bilkul theek. */
    const h = harness();
    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    expect(h.lastSay()).toMatch(/Kis date ko jaana hai/);
  });

  it("17) speech recognition fail → user type kar sakta hai, booking rukti nahi", async () => {
    const h = harness("denied"); // jaise mic permission denied
    const err = await h.agent.startListening();
    expect(err).toBe("denied");
    expect(h.agent.state().voiceError).toBe("denied");
    expect(h.agent.state().isListening).toBe(false);

    await h.agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    expect(h.lastSay()).toMatch(/Kis date ko jaana hai/);
  });

  it("18) existing AI Booking Agent standalone chalta hai (voice layer ke bina bhi)", () => {
    const r = aiBookingTurn(aiBookingStart(NOW).state, "Mujhe Amritsar se New Delhi jaana hai", { now: NOW });
    expect(r.say.join(" ")).toMatch(/Kis date ko jaana hai/);
    expect(r.state.from?.code).toBe("ASR");
  });

  /* ── extra: openai-edge-tts (user ka diya provider) — server-side, bina code change ───────────── */

  it("19) openai-edge-tts OpenAI-compatible base URL se chalta hai (keys server par hi)", async () => {
    const ENV = ["VOICE_TTS_PROVIDER", "VOICE_TTS_API_KEY", "VOICE_TTS_MODEL", "VOICE_TTS_VOICE", "VOICE_TTS_BASE_URL"];
    const saved: Record<string, string | undefined> = {};
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.VOICE_TTS_PROVIDER = "openai"; // openai-edge-tts OpenAI-compatible API deta hai
    process.env.VOICE_TTS_BASE_URL = "http://edge-tts.internal:5050/v1";
    process.env.VOICE_TTS_API_KEY = "edge-secret";
    process.env.VOICE_TTS_MODEL = "tts-1";
    process.env.VOICE_TTS_VOICE = "hi-IN-SwaraNeural";

    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);

    const app = createApp();
    const cfg = await request(app).get("/api/voice/config");
    expect(cfg.body).toMatchObject({ provider: "openai", serverTts: true });
    expect(JSON.stringify(cfg.body)).not.toContain("edge-secret");

    const res = await request(app).post("/api/voice/tts").send({ text: "Namaste", lang: "hi-IN" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);

    /* R67: config call provider ko background me warm karta hai (chhota "hmm") — isliye asli line ka
     * call dhoondhte hain, sirf pehla call nahi. */
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const hit = calls.find(([, init]) => String(JSON.parse(String(init.body)).input) === "Namaste");
    expect(hit, "asli TTS call milna chahiye").toBeTruthy();
    const [url, init] = hit!;
    expect(url).toBe("http://edge-tts.internal:5050/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer edge-secret");
    const body = JSON.parse(String(init.body)) as { voice: string; model: string; response_format: string; input: string };
    expect(body).toMatchObject({ voice: "hi-IN-SwaraNeural", model: "tts-1", response_format: "mp3", input: "Namaste" });

    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
});
