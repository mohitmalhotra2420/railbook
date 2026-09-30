/* ══ openai-edge-tts INTEGRATION TESTS (naye, additive — Round "Voice Agent R2") ════════════════════════
 * User: "Integrate https://github.com/travisvn/openai-edge-tts as the server-side TTS provider …
 * Don't modify the existing AI Booking Agent … run existing tests, especially verify 1–12."
 *
 * Ye file aapke §14 ke 12 points ko hi check karti hai — aur isme kuch bhi naya AI/railway/booking logic
 * nahi likha gaya. Chain jo test hoti hai (sab maujooda code):
 *
 *   maujooda STT hook (useVoiceInput)  →  maujooda agent (aiBookingFlow.aiBookingTurn)
 *      →  maujooda voice adapter (aiBookingVoice)  →  maujooda client (api.voiceTts → POST /api/voice/tts)
 *      →  maujooda server adapter (server/voice/tts.ts)  →  {VOICE_TTS_BASE_URL}/audio/speech
 *
 * openai-edge-tts OpenAI-compatible hai, isliye wahi `synthOpenAi` raasta chalta hai (koi naya protocol
 * nahi, koi naya endpoint nahi). Test me upstream fetch MOCK hai (mock sirf test ke andar — product me
 * asli server hi call hota hai).
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import request from "supertest";

import { aiBookingStart, aiBookingTurn } from "../src/ai/aiBookingFlow";
import { createAiBookingVoice } from "../src/voice/aiBookingVoice";
import { createVoiceAgent } from "../src/voice/voiceAgent";
import { useVoiceInput } from "../src/voice/useVoiceInput";
import { createApp } from "../server/app";

const NOW = new Date(2026, 8, 30);
const EDGE_BASE = "https://edge-tts.example.test/v1"; // configurable — code me hard-code nahi
const EDGE_KEY = "edge-server-side-secret";

/** Chhota asli-lagta MP3 frame (sirf bytes — asli TTS server asli MP3 deta hai). */
const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb]);

const ENV_KEYS = [
  "VOICE_TTS_PROVIDER",
  "VOICE_TTS_BASE_URL",
  "VOICE_TTS_API_KEY",
  "VOICE_TTS_MODEL",
  "VOICE_TTS_VOICE",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
];
const saved: Record<string, string | undefined> = {};

function setEdgeEnv(over: Record<string, string | undefined> = {}) {
  process.env.VOICE_TTS_PROVIDER = "openai"; // openai-edge-tts OpenAI-compatible API deta hai
  process.env.VOICE_TTS_BASE_URL = EDGE_BASE;
  process.env.VOICE_TTS_API_KEY = EDGE_KEY;
  delete process.env.VOICE_TTS_MODEL;
  delete process.env.VOICE_TTS_VOICE;
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function mockEdge(ok = true) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (!ok) return new Response("edge down", { status: 503, headers: { "content-type": "application/json" } });
    return new Response(MP3_BYTES, { status: 200, headers: { "content-type": "audio/mpeg" } });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

describe("openai-edge-tts integration — server side", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("5+6) /api/voice/tts configured edge-tts server ko {BASE}/audio/speech par call karta hai", async () => {
    setEdgeEnv();
    const edge = mockEdge();
    const app = createApp();
    const res = await request(app).post("/api/voice/tts").send({ text: "Bilkul, main trains check kar raha hoon.", lang: "hi-IN" });

    expect(res.status).toBe(200);
    expect(edge.calls).toHaveLength(1);
    expect(edge.calls[0].url).toBe(`${EDGE_BASE}/audio/speech`); // exactly {VOICE_TTS_BASE_URL}/audio/speech
  });

  it("7) request body me model · voice · input · response_format=mp3 (defaults tts-1 / SwaraNeural)", async () => {
    setEdgeEnv();
    const edge = mockEdge();
    const app = createApp();
    await request(app).post("/api/voice/tts").send({ text: "Amritsar se New Delhi", lang: "hi-IN" });

    const body = JSON.parse(String(edge.calls[0].init.body)) as Record<string, string>;
    expect(body).toMatchObject({
      model: "tts-1",
      voice: "hi-IN-SwaraNeural",
      input: "Amritsar se New Delhi",
      response_format: "mp3",
    });
  });

  it("7b) male voice sirf env se — model/voice hard-code nahi", async () => {
    setEdgeEnv({ VOICE_TTS_VOICE: "hi-IN-MadhurNeural", VOICE_TTS_MODEL: "tts-1-hd" });
    const edge = mockEdge();
    const app = createApp();
    await request(app).post("/api/voice/tts").send({ text: "namaste" });
    const body = JSON.parse(String(edge.calls[0].init.body)) as Record<string, string>;
    expect(body.voice).toBe("hi-IN-MadhurNeural");
    expect(body.model).toBe("tts-1-hd");
  });

  it("8) Authorization header server-side hi jaata hai (Bearer VOICE_TTS_API_KEY)", async () => {
    setEdgeEnv();
    const edge = mockEdge();
    const app = createApp();
    await request(app).post("/api/voice/tts").send({ text: "namaste" });
    const headers = edge.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${EDGE_KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("9) /api/voice/config me key kabhi nahi aati (sirf safe flags)", async () => {
    setEdgeEnv();
    const app = createApp();
    const cfg = await request(app).get("/api/voice/config");
    expect(cfg.status).toBe(200);
    expect(cfg.body).toMatchObject({ serverTts: true, model: "tts-1" });
    expect(JSON.stringify(cfg.body)).not.toContain(EDGE_KEY);
    expect(JSON.stringify(cfg.body)).not.toMatch(/api[_-]?key|secret|token|bearer/i);
  });

  it("10) audio 'audio/mpeg' ke saath wapas aata hai (aur no-store)", async () => {
    setEdgeEnv();
    mockEdge();
    const app = createApp();
    const res = await request(app).post("/api/voice/tts").send({ text: "namaste" });
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("11) edge-tts down → endpoint 502 (client device voice par fallback; booking nahi rukti)", async () => {
    setEdgeEnv();
    mockEdge(false);
    const app = createApp();
    const res = await request(app).post("/api/voice/tts").send({ text: "namaste" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/provider failed/i);
    /* Key/URL kabhi error me leak nahi. */
    expect(JSON.stringify(res.body)).not.toContain(EDGE_KEY);
    expect(JSON.stringify(res.body)).not.toContain(EDGE_BASE);
  });

  it("validation: khaali/bada text par 400 — upstream call hi nahi hoti", async () => {
    setEdgeEnv();
    const edge = mockEdge();
    const app = createApp();
    expect((await request(app).post("/api/voice/tts").send({ text: "   " })).status).toBe(400);
    expect((await request(app).post("/api/voice/tts").send({ text: "x".repeat(701) })).status).toBe(400);
    expect(edge.calls).toHaveLength(0);
  });

  it("env na ho to 501 (maujooda behaviour waisa hi) aur config serverTts false", async () => {
    const app = createApp();
    expect((await request(app).get("/api/voice/config")).body).toMatchObject({ serverTts: false });
    const res = await request(app).post("/api/voice/tts").send({ text: "namaste" });
    expect(res.status).toBe(501);
  });
});

describe("openai-edge-tts integration — client + end-to-end chain", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("1+2) microphone start + speech → transcript (maujooda STT, background listening nahi)", async () => {
    class FakeRec {
      static last: FakeRec | null = null;
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
        FakeRec.last = this;
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
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRec;
    (window as unknown as { isSecureContext?: boolean }).isSecureContext = true;

    const heard: string[] = [];
    const { result } = renderHook(() => useVoiceInput((t) => heard.push(t), () => undefined, { manualCommit: true, greet: false }));

    expect(await result.current.start()).toBeNull();
    expect(FakeRec.last?.started).toBe(true);
    await waitFor(() => expect(result.current.listening).toBe(true));

    act(() => {
      FakeRec.last!.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "Bilkul theek hai" }, length: 1 }],
      });
      result.current.commit();
    });
    expect(heard).toContain("Bilkul theek hai");
  });

  it("3+4) transcript EXISTING agent tak, jawab bhi existing agent ka", async () => {
    let state = aiBookingStart(NOW).state;
    const spoken: string[] = [];
    const agent = createVoiceAgent({
      input: { start: async () => null, stop: () => undefined, cancel: () => undefined },
      output: { speak: (t) => spoken.push(t), stop: () => undefined, onState: () => () => undefined },
      onTranscript: (text) => {
        const turn = aiBookingTurn(state, text, { now: NOW });
        state = turn.state;
        agent.speak(turn.say);
      },
    });
    await agent.submit("Mujhe Amritsar se New Delhi jaana hai");
    expect(state.from?.code).toBe("ASR");
    expect(state.to?.code).toBe("NDLS");
    expect(spoken.join(" ")).toMatch(/Kis date ko jaana hai/);
  });

  it("5) client ka jawab /api/voice/tts par jaata hai (maujooda api.voiceTts)", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(MP3_BYTES, { status: 200, headers: { "content-type": "audio/mpeg" } });
      }),
    );
    const played: string[] = [];
    const voice = createAiBookingVoice({
      fetchConfig: async () => ({ provider: "openai", serverTts: true, model: "tts-1", languages: ["hi-IN"] }),
      fetchTts: async (text, lang) => {
        const res = await fetch("/api/voice/tts", { method: "POST", body: JSON.stringify({ text, lang }) });
        return res.blob();
      },
      play: async () => {
        played.push("played");
      },
      stopPlayback: () => undefined,
      browserSpeak: vi.fn(),
      browserStop: vi.fn(),
    });
    await voice.loadProvider();
    voice.speak("Bilkul, main trains check kar raha hoon.");
    await waitFor(() => expect(played.length).toBe(1));
    expect(calls[0].url).toBe("/api/voice/tts");
    expect(calls[0].body).toMatchObject({ text: "Bilkul, main trains check kar raha hoon.", lang: "hi-IN" });
  });

  it("6+7+10) poora chain: client → /api/voice/tts → edge-tts → MP3 client tak", async () => {
    setEdgeEnv();
    const app = createApp();
    const edge = mockEdge();

    /* "server" = hamara asli express app (supertest), jaisa production me chalta hai. */
    const res = await request(app).post("/api/voice/tts").send({ text: "Trains check kar rahi hoon.", lang: "hi-IN" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);
    expect(edge.calls[0].url).toBe(`${EDGE_BASE}/audio/speech`);
    const upstreamBody = JSON.parse(String(edge.calls[0].init.body)) as Record<string, string>;
    expect(upstreamBody).toMatchObject({ model: "tts-1", voice: "hi-IN-SwaraNeural", response_format: "mp3" });

    /* Aur wahi audio (server se aaye asli bytes) client adapter bajata hai — maujooda raasta. */
    const served = new Uint8Array(res.body as Buffer);
    let playedBytes = 0;
    let asked: { text: string; lang: string } | null = null;
    const client = createAiBookingVoice({
      fetchConfig: async () => ({ provider: "openai", serverTts: true, model: "tts-1", languages: ["hi-IN"] }),
      fetchTts: async (text, lang) => {
        asked = { text, lang };
        return new Blob([served], { type: "audio/mpeg" });
      },
      play: async (blob) => {
        /* jsdom ke Blob par arrayBuffer() har version me nahi hota — size har jagah hota hai. */
        playedBytes = blob.size;
      },
      stopPlayback: () => undefined,
      browserSpeak: vi.fn(),
      browserStop: vi.fn(),
    });
    await client.loadProvider(); // provider info load — warna adapter device voice par chala jaata
    client.speak("Trains check kar rahi hoon.");
    await waitFor(() => expect(playedBytes).toBeGreaterThan(0));
    expect(asked).toMatchObject({ lang: "hi-IN" });
    expect(playedBytes).toBe(MP3_BYTES.length); // wahi MP3 bytes jo edge-tts se aaye the
  });

  it("11b) edge-tts fail → client device voice par chalta hai (conversation/booking intact)", async () => {
    setEdgeEnv();
    const edge = mockEdge(false);
    const app = createApp();
    const res = await request(app).post("/api/voice/tts").send({ text: "namaste" });
    expect(res.status).toBe(502);
    expect(edge.calls).toHaveLength(1);

    const browserSpeak = vi.fn();
    const client = createAiBookingVoice({
      fetchConfig: async () => ({ provider: "openai", serverTts: true, model: "tts-1", languages: ["hi-IN"] }),
      fetchTts: async () => {
        throw new Error("voice tts failed (502)");
      },
      play: async () => undefined,
      stopPlayback: () => undefined,
      browserSpeak,
      browserStop: vi.fn(),
    });
    await client.loadProvider();
    expect(() => client.speak("Bilkul, main check kar rahi hoon.")).not.toThrow();
    await waitFor(() => expect(browserSpeak).toHaveBeenCalledWith("Bilkul, main check kar rahi hoon."));

    /* Text booking usi waqt normal. */
    const turn = aiBookingTurn(aiBookingStart(NOW).state, "Mujhe Amritsar se New Delhi jaana hai", { now: NOW });
    expect(turn.say.join(" ")).toMatch(/Kis date ko jaana hai/);
  });

  it("12) maujooda agent ka behaviour waisa hi (voice/TTS se koi asar nahi)", () => {
    const r1 = aiBookingTurn(aiBookingStart(NOW).state, "Mujhe amritsar se delhi jaana hai", { now: NOW });
    expect(r1.state.from?.code).toBe("ASR");
    expect(r1.state.pendingCity?.city).toBe("delhi");
    expect(r1.say.join(" ")).toMatch(/kaunse wala/i);
    const r2 = aiBookingTurn(r1.state, "NDLS", { now: NOW });
    expect(r2.state.to?.code).toBe("NDLS");
    expect(r2.say.join(" ")).toMatch(/Kis date ko jaana hai/);
  });
});
