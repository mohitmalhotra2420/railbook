/* ══ NATIVE TTS BRIDGE (ADDITIVE, Round-63-fix) ═══════════════════════════════════════════════════════
 * User (30 Sep, screenshot): "background AI voice bhi nhi aa rhi jaise chatgpt ke voice mein aati hai".
 *
 * Wajah: Android **WebView** me `window.speechSynthesis` hota hai lekin uske paas aksar koi voice nahi
 * hoti — matlab `speak()` chupchaap kuch nahi bolta (isi liye app ke andar AI ki awaaz kabhi nahi
 * aayi). Wahi problem Round-27 me mic ke saath thi, jiska hal native bridge tha.
 *
 * Ab app (naya APK) apna native TextToSpeech bhi deta hai:
 *   • page → app : window.RailBookVoice.speak(text, "hi-IN") · .stopSpeaking() · .ttsAvailable()
 *   • Bridge na ho (browser / purana APK) → yahan se `false` milta hai aur maujooda browser TTS
 *     (`speakGuide`) hi chalta rehta hai — kuch tootta nahi.
 *
 * Koi network, koi key, koi data bahar nahi — device ka apna TTS engine (jo Android me pehle se hai).
 * ══════════════════════════════════════════════════════════════════════════════════════════════════ */

type NativeSpeakBridge = {
  speak?: (text: string, lang?: string) => void;
  stopSpeaking?: () => void;
  ttsAvailable?: () => boolean;
};

function bridge(): NativeSpeakBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { RailBookVoice?: NativeSpeakBridge }).RailBookVoice;
  if (!b || typeof b.speak !== "function") return null;
  try {
    if (typeof b.ttsAvailable === "function" && b.ttsAvailable() === false) return null;
  } catch {
    /* bridge error → try anyway */
  }
  return b;
}

/** App (native TTS) available? Browser me hamesha false. */
export function hasNativeSpeak(): boolean {
  return bridge() !== null;
}

/** Native engine ko bolne do. true = haan, native ne le liya (browser TTS ki zaroorat nahi). */
export function nativeSpeak(text: string, lang = "hi-IN"): boolean {
  const b = bridge();
  if (!b?.speak) return false;
  try {
    b.speak(text, lang);
    return true;
  } catch {
    return false;
  }
}

export function nativeStopSpeaking(): void {
  const b = bridge();
  if (!b?.stopSpeaking) return;
  try {
    b.stopSpeaking();
  } catch {
    /* ignore */
  }
}
