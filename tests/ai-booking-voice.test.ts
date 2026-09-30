/* ══ Round-62 (AI Booking) — voice adapter tests ══════════════════════════════════════════════════════
 * User ki shartein:
 *   • voice provider configurable (server env se), frontend me koi key nahi,
 *   • provider fail ho ya configured na ho → text booking flow chalta rahe (kabhi break na ho),
 *   • mic support check (native/browser/none).
 */
import { describe, expect, it, vi } from "vitest";
import { createAiBookingVoice, voiceLinesFor } from "../src/voice/aiBookingVoice";

function deps(over: Partial<Parameters<typeof createAiBookingVoice>[0]> = {}) {
  return {
    fetchConfig: vi.fn(async () => ({ provider: "browser", serverTts: false, model: null, languages: ["hi-IN"] })),
    fetchTts: vi.fn(async () => new Blob(["mp3"])),
    play: vi.fn(async () => undefined),
    stopPlayback: vi.fn(),
    browserSpeak: vi.fn(),
    browserStop: vi.fn(),
    ...over,
  } as Parameters<typeof createAiBookingVoice>[0];
}

describe("AI Booking voice — provider selection", () => {
  it("server provider configured na ho to device voice (browser) use hoti hai", async () => {
    const d = deps();
    const voice = createAiBookingVoice(d);
    const info = await voice.loadProvider();
    expect(info.kind).toBe("browser");
    voice.speak("Namaste");
    expect(d.browserSpeak).toHaveBeenCalledWith("Namaste");
    expect(d.fetchTts).not.toHaveBeenCalled();
  });

  it("server provider configured ho to wahi use hota hai (keys client par nahi)", async () => {
    const d = deps({
      fetchConfig: vi.fn(async () => ({ provider: "openai", serverTts: true, model: "gpt-4o-mini-tts", languages: ["hi-IN"] })),
    });
    const voice = createAiBookingVoice(d);
    const info = await voice.loadProvider();
    expect(info).toMatchObject({ kind: "server", provider: "openai", model: "gpt-4o-mini-tts" });
    voice.speak("Passenger 1 ka naam bataiye");
    await vi.waitFor(() => expect(d.play).toHaveBeenCalled());
    expect(d.fetchTts).toHaveBeenCalledWith("Passenger 1 ka naam bataiye", "hi-IN");
  });

  it("provider fail ho jaye to device voice par fallback — booking flow rukta nahi", async () => {
    const d = deps({
      fetchConfig: vi.fn(async () => ({ provider: "elevenlabs", serverTts: true, model: null, languages: [] })),
      fetchTts: vi.fn(async () => {
        throw new Error("provider 502");
      }),
    });
    const voice = createAiBookingVoice(d);
    await voice.loadProvider();
    voice.speak("Train 12014 select kar liya");
    await vi.waitFor(() => expect(d.browserSpeak).toHaveBeenCalledWith("Train 12014 select kar liya"));
    expect(voice.speaking()).toBe(false);
  });

  it("config endpoint bhi fail ho (offline) → browser voice, koi throw nahi", async () => {
    const d = deps({
      fetchConfig: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const voice = createAiBookingVoice(d);
    expect(await voice.loadProvider()).toMatchObject({ kind: "browser" });
    voice.speak("theek hai");
    expect(d.browserSpeak).toHaveBeenCalled();
  });
});

describe("AI Booking voice — mute / stop", () => {
  it("mute par kuch bola nahi jata", async () => {
    const d = deps();
    const voice = createAiBookingVoice(d);
    voice.setMuted(true);
    voice.speak("chup raho");
    expect(d.browserSpeak).not.toHaveBeenCalled();
    voice.setMuted(false);
    voice.speak("ab bolo");
    expect(d.browserSpeak).toHaveBeenCalledWith("ab bolo");
  });

  it("stop dono playback band karta hai", async () => {
    const d = deps();
    const voice = createAiBookingVoice(d);
    voice.stop();
    expect(d.stopPlayback).toHaveBeenCalled();
    expect(d.browserStop).toHaveBeenCalled();
  });

  it("khaali/space text par kuch nahi", () => {
    const d = deps();
    const voice = createAiBookingVoice(d);
    voice.speak("   ");
    expect(d.browserSpeak).not.toHaveBeenCalled();
  });
});

describe("AI Booking voice — mic support + voice lines", () => {
  it("micSupport hamesha ek valid value deta hai (jsdom me none/browser)", () => {
    const voice = createAiBookingVoice(deps());
    expect(["native", "browser", "none"]).toContain(voice.micSupport());
  });

  it("voiceLinesFor sirf aakhri 2 saaf lines bolta hai (emoji/hashtag ke bina)", () => {
    const lines = voiceLinesFor(["Pehla ✅", "Doosra 😊", "Teesra"], 2);
    expect(lines).toEqual(["Doosra", "Teesra"].map((l) => l.replace(/[✅😊]/gu, "").trim()));
    expect(voiceLinesFor([]).length).toBe(0);
  });
});
