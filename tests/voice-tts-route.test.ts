/* ══ Round-62 (AI Booking) — server voice endpoints (naye, additive) ═══════════════════════════════════
 * Niyam:
 *   • /api/voice/config sirf provider ka NAAM batata hai — koi key/value leak nahi,
 *   • provider configured na ho to 501 (client device voice par chala jaata hai),
 *   • khaali/bada text par 400 (provider ko call hi nahi jaati),
 *   • maujooda routes (booking/agent/irctc flow) bilkul waise hi — sirf naye endpoints add hue hain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";

const app = createApp();
const ENV_KEYS = ["VOICE_TTS_PROVIDER", "VOICE_TTS_API_KEY", "VOICE_TTS_MODEL", "VOICE_TTS_VOICE", "VOICE_TTS_BASE_URL", "OPENAI_API_KEY", "ELEVENLABS_API_KEY"];
const saved: Record<string, string | undefined> = {};

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
  vi.restoreAllMocks();
});

describe("/api/voice/config", () => {
  it("default: server TTS off, provider 'browser' — koi key kahin nahi", async () => {
    const res = await request(app).get("/api/voice/config");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: "browser", serverTts: false });
    expect(JSON.stringify(res.body)).not.toMatch(/key|secret|token/i);
  });

  it("provider set par bhi sirf naam/model aate hain (value nahi)", async () => {
    process.env.VOICE_TTS_PROVIDER = "openai";
    process.env.VOICE_TTS_API_KEY = "super-secret-key";
    process.env.VOICE_TTS_MODEL = "gpt-4o-mini-tts";
    const res = await request(app).get("/api/voice/config");
    expect(res.body).toMatchObject({ provider: "openai", serverTts: true, model: "gpt-4o-mini-tts" });
    expect(JSON.stringify(res.body)).not.toContain("super-secret-key");
  });
});

describe("/api/voice/tts", () => {
  it("provider configured na ho to 501 + honest hint (client fallback)", async () => {
    const res = await request(app).post("/api/voice/tts").send({ text: "namaste", lang: "hi-IN" });
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body.hint).toMatch(/Render/i);
  });

  it("khaali text → 400, provider ko call nahi", async () => {
    process.env.VOICE_TTS_PROVIDER = "openai";
    process.env.VOICE_TTS_API_KEY = "k";
    const res = await request(app).post("/api/voice/tts").send({ text: "   " });
    expect(res.status).toBe(400);
  });

  it("bada text → 400 (booking ki chhoti lines hi bhejni hain)", async () => {
    process.env.VOICE_TTS_PROVIDER = "openai";
    process.env.VOICE_TTS_API_KEY = "k";
    const res = await request(app).post("/api/voice/tts").send({ text: "x".repeat(800) });
    expect(res.status).toBe(400);
  });

  it("provider ka error aaye to 502 (key/path kabhi leak nahi) aur client browser-voice par gir jaata hai", async () => {
    process.env.VOICE_TTS_PROVIDER = "openai";
    process.env.VOICE_TTS_API_KEY = "k";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 429 }));
    const res = await request(app).post("/api/voice/tts").send({ text: "namaste" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("k");
    expect(spy).toHaveBeenCalled();
  });

  it("success par audio/mpeg wapas aata hai (server hi provider ko call karta hai)", async () => {
    process.env.VOICE_TTS_PROVIDER = "openai";
    process.env.VOICE_TTS_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }),
    );
    const res = await request(app).post("/api/voice/tts").send({ text: "Passenger 1 ka naam bataiye" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/audio\/mpeg/);
  });
});

describe("maujooda endpoints wahi (additive change ka proof)", () => {
  it("wallet + trains + version jaise pehle chalte hain", async () => {
    expect((await request(app).get("/api/wallet")).status).toBe(200);
    expect((await request(app).get("/api/version")).status).toBe(200);
    const trains = await request(app).get("/api/trains").query({ from: "ASR", to: "NDLS", date: "2026-10-20" });
    expect(trains.status).toBe(200);
    expect(Array.isArray(trains.body.trains)).toBe(true);
  });
});
