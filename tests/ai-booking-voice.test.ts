/* ══ Round-62 (AI Booking) — voice adapter tests ══════════════════════════════════════════════════════
 * User ki shartein:
 *   • voice provider configurable (server env se), frontend me koi key nahi,
 *   • provider fail ho ya configured na ho → text booking flow chalta rahe (kabhi break na ho),
 *   • mic support check (native/browser/none).
 */
import { describe, expect, it, vi } from "vitest";
import { createAiBookingVoice, voiceLinesFor } from "../src/voice/aiBookingVoice";
import { hasNativeSpeak, nativeSpeak, nativeStopSpeaking } from "../src/voice/nativeSpeak";

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

/* ── R63-fix: AI ki awaaz sach me aaye (user: "background AI voice nahi aa rahi") ──────────────────
 * App (Android WebView) me `speechSynthesis` ke paas aksar voice nahi hoti → AI chup reh jaati thi.
 * Ab app ka native TTS bridge pehle use hota hai, warna browser TTS — aur agar dono nahi to UI sach
 * batati hai ("voice: output nahi"), chup nahi rehti. */
describe("R63 — native TTS bridge + output support", () => {
  it("native bridge ho to use wahi hota hai (app me awaaz), browser par fallback", () => {
    const calls: string[] = [];
    (globalThis as unknown as { window: Window & typeof globalThis }).window.RailBookVoice = {
      speak: (t: string) => calls.push(t),
      stopSpeaking: () => calls.push("stop"),
      ttsAvailable: () => true,
    };
    expect(hasNativeSpeak()).toBe(true);
    expect(nativeSpeak("Namaste")).toBe(true);
    expect(calls).toEqual(["Namaste"]);
    const voice = createAiBookingVoice(deps());
    expect(voice.outputSupport()).toBe("app");
    delete (globalThis as unknown as { window: { RailBookVoice?: unknown } }).window.RailBookVoice;
    expect(hasNativeSpeak()).toBe(false);
    expect(voice.outputSupport()).toBe(window.speechSynthesis ? "device" : "none");
  });

  it("bridge na ho (browser) to nativeSpeak false deta hai — purana browser TTS hi chalta hai", () => {
    expect(nativeSpeak("test")).toBe(false);
    expect(() => nativeStopSpeaking()).not.toThrow();
  });

  it("server provider configured ho to outputSupport 'server' (ChatGPT jaisi awaaz ke liye ready)", async () => {
    const voice = createAiBookingVoice(
      deps({ fetchConfig: vi.fn(async () => ({ provider: "openai", serverTts: true, model: "tts-1", languages: ["hi-IN"] })) }),
    );
    await voice.loadProvider();
    expect(voice.outputSupport()).toBe("server");
  });

  it("unlock() kabhi throw nahi karta (browser/Android dono par safe)", () => {
    const voice = createAiBookingVoice(deps());
    expect(() => voice.unlock()).not.toThrow();
  });
});

/* ══ R66 (30 Sep 2026) — user: "tts ki voice nahi aa rahi … jaise ChatGPT par voice conversation hoti
 * hai" ═════════════════════════════════════════════════════════════════════════════════════════════
 * (a) playback (autoplay policy) block hone par UI ko honest issue milta hai + device voice chalti hai,
 *     aur app me ho to native player ka raasta maujood hai (nativeSpeak.ts helpers),
 * (b) unlock() ab audio element bhi gesture ke andar unlock karta hai (pehla speak chup na ho).
 */
describe("R66 — voice output reliability", () => {
  /* jsdom me speechSynthesis hota hi nahi — "device voice maujood hai" wala case simulate karte hain
   * (asli phone/browser me ye hota hai). */
  const stubDeviceVoice = () => {
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      getVoices: () => [{ lang: "hi-IN", name: "Test Hindi" }],
      speak: () => undefined,
      cancel: () => undefined,
    };
  };
  it("playback block (autoplay policy) → device voice + honest issue 'playback-blocked'", async () => {
    stubDeviceVoice();
    const issues: (string | null)[] = [];
    const d = deps({
      fetchConfig: vi.fn(async () => ({ provider: "openai", serverTts: true, model: "tts-1", languages: ["hi-IN"] })),
      play: vi.fn(async () => {
        const err = new Error("play() failed because the user didn't interact with the document first");
        err.name = "NotAllowedError";
        throw err;
      }),
    });
    const voice = createAiBookingVoice(d!);
    voice.onIssue((i) => issues.push(i));
    await voice.loadProvider();
    voice.speak("Theek hai, 1 passenger note kar liya");
    await vi.waitFor(() => expect(d!.browserSpeak).toHaveBeenCalled());
    await vi.waitFor(() => expect(voice.lastIssue()).toBe("playback-blocked"));
    expect(issues).toContain("playback-blocked");
    expect(voice.lastRoute()).toMatch(/app-tts|device/);
  });

  it("server fetch fail → 'server-failed' issue, device voice chalti hai", async () => {
    stubDeviceVoice();
    const d = deps({
      fetchConfig: vi.fn(async () => ({ provider: "openai", serverTts: true, model: null, languages: [] })),
      fetchTts: vi.fn(async () => {
        throw new Error("provider 502");
      }),
    });
    const voice = createAiBookingVoice(d!);
    await voice.loadProvider();
    voice.speak("Namaste");
    await vi.waitFor(() => expect(voice.lastIssue()).toBe("server-failed"));
    expect(d!.browserSpeak).toHaveBeenCalled();
  });

  it("server audio jo chal gaya, use issue nahi milta (saaf state)", async () => {
    const d = deps({ fetchConfig: vi.fn(async () => ({ provider: "openai", serverTts: true, model: null, languages: [] })) });
    const voice = createAiBookingVoice(d);
    await voice.loadProvider();
    voice.speak("2 passengers.");
    await vi.waitFor(() => expect(d!.play).toHaveBeenCalled());
    await vi.waitFor(() => expect(voice.lastIssue()).toBeNull());
    expect(voice.lastRoute()).toBe("server-audio");
  });

  it("unlock() audio element bhi unlock karta hai (deps.unlockAudio) — browser me pehli awaaz chup na ho", () => {
    const unlockAudio = vi.fn();
    const d = deps({ unlockAudio });
    const voice = createAiBookingVoice(d!);
    expect(() => voice.unlock()).not.toThrow();
    expect(unlockAudio).toHaveBeenCalledTimes(1);
  });

  it("native audio bridge (app) maujood ho to MP3 native player ko jaata hai (WebView policy bypass)", async () => {
    const played: string[] = [];
    (globalThis as unknown as { window: { RailBookVoice?: unknown } }).window.RailBookVoice = {
      audioAvailable: () => true,
      playAudioBase64: (b64: string) => {
        played.push(b64);
        return true;
      },
      stopAudio: () => undefined,
    };
    const { hasNativeAudio, nativePlayAudioBase64, nativeStopAudio } = await import("../src/voice/nativeSpeak");
    expect(hasNativeAudio()).toBe(true);
    expect(nativePlayAudioBase64("QUJD", "audio/mpeg")).toBe(true);
    expect(played).toEqual(["QUJD"]);
    expect(() => nativeStopAudio()).not.toThrow();
    delete (globalThis as unknown as { window: { RailBookVoice?: unknown } }).window.RailBookVoice;
    expect(hasNativeAudio()).toBe(false);
  });
});
